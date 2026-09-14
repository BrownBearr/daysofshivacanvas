import * as THREE from "three";
import { previewUrl } from "../lib/clip-source";
import { applySquareCrop } from "../lib/poster-cache";
import { videoPool } from "../lib/video-pool";
import type { ClipData } from "../types";
import { requestFrame } from "./camera-state";
import type { TileSlot } from "./slot";

// Video playback for the grid, in one place.
//
// Only ever one tile plays at a time (the hovered one), so the old design — video acquire/release
// effects, a debounce timer, a focus subscription and a `playArmed` state on every one of ~200
// mounted tiles — was ~200 copies of a singleton. This owns the whole thing: the pooled element,
// the VideoTexture, the frame pump, and the hover-intent delay.

// Per-frame texture upload is the dominant cost of an active video, so a new frame is pushed to
// the GPU only when the decoder actually produces one.
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

// How long the cursor must rest on a tile before its video loads. Short enough to feel immediate on
// a deliberate hover, long enough that sweeping across the grid never cold-starts a decode it
// abandons — each abandoned start is a ~700KB request.
export const HOVER_PLAY_DELAY = 90;

let armTimer: ReturnType<typeof setTimeout> | null = null;
let pendingKey: string | null = null;

let activeSlot: TileSlot | null = null;
let activeKey: string | null = null;
let activeEl: RVFCVideo | null = null;
let rvfcHandle = 0;
let usesRvfc = false;

function teardown(): void {
  if (activeEl && usesRvfc && rvfcHandle) activeEl.cancelVideoFrameCallback?.(rvfcHandle);
  rvfcHandle = 0;
  usesRvfc = false;

  if (activeKey) videoPool.release(activeKey);

  if (activeSlot) {
    activeSlot.videoTex?.dispose();
    activeSlot.videoTex = null;
    activeSlot.videoReady = false;
  }

  activeSlot = null;
  activeKey = null;
  activeEl = null;
}

function start(slot: TileSlot, cellKey: string, clip: ClipData): void {
  const el = videoPool.acquire(cellKey, previewUrl(clip)) as RVFCVideo | null;
  if (!el) return;

  const tex = new THREE.VideoTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps for video: they'd be rebuilt on every decoded frame.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  activeSlot = slot;
  activeKey = cellKey;
  activeEl = el;
  slot.videoTex = tex;
  slot.videoReady = false;

  const onMeta = () => applySquareCrop(tex, el.videoWidth, el.videoHeight);
  if (el.readyState >= 1) onMeta();
  else el.addEventListener("loadedmetadata", onMeta, { once: true });

  const requestFrameCallback = el.requestVideoFrameCallback?.bind(el);
  usesRvfc = requestFrameCallback !== undefined;
  if (requestFrameCallback) {
    const onFrame = () => {
      // Guard against a callback that outlives its teardown.
      if (activeEl !== el) return;
      tex.needsUpdate = true;
      if (!slot.videoReady && el.readyState >= 2) slot.videoReady = true;
      // RVFC fires independently of R3F, so this is what keeps a playing tile rendering at
      // video framerate under the demand frameloop.
      requestFrame();
      rvfcHandle = requestFrameCallback(onFrame);
    };
    rvfcHandle = requestFrameCallback(onFrame);
  }
  requestFrame();
}

/**
 * Ask for `slot` to be the playing tile, after the hover-intent delay. Passing null stops playback.
 * Calling repeatedly with the same cell is a no-op, so this is safe to drive from a frame loop.
 */
export function armVideo(slot: TileSlot | null, cellKey: string | null, clip: ClipData | null): void {
  // These guards must not fire for the "stop everything" call (cellKey === null), or a cursor
  // leaving the grid would match the null pendingKey and return before tearing down — leaving the
  // preview decoding, and its requestVideoFrameCallback pinning the demand frameloop, forever.
  if (cellKey !== null && cellKey === activeKey && activeSlot) return;
  if (cellKey !== null && cellKey === pendingKey) return;
  if (cellKey === null && activeKey === null && pendingKey === null) return;

  if (armTimer !== null) {
    clearTimeout(armTimer);
    armTimer = null;
  }
  pendingKey = null;

  if (!slot || !cellKey || !clip) {
    teardown();
    return;
  }

  pendingKey = cellKey;
  armTimer = setTimeout(() => {
    armTimer = null;
    pendingKey = null;
    // The slot may have been recycled to a different cell during the delay.
    if (slot.cellKey !== cellKey) return;
    teardown();
    start(slot, cellKey, clip);
  }, HOVER_PLAY_DELAY);
}

/** Whether the fallback per-frame pump is needed (no requestVideoFrameCallback support). */
export function needsManualPump(): boolean {
  return activeSlot !== null && activeEl !== null && !usesRvfc;
}

/** Fallback frame pump for browsers without requestVideoFrameCallback. */
export function pumpVideo(): boolean {
  const slot = activeSlot;
  const el = activeEl;
  if (!slot || !el || usesRvfc) return false;
  if (el.paused || el.readyState < 2 || !slot.videoTex) return false;
  slot.videoTex.needsUpdate = true;
  slot.videoReady = true;
  return true;
}

export function stopVideo(): void {
  if (armTimer !== null) {
    clearTimeout(armTimer);
    armTimer = null;
  }
  pendingKey = null;
  teardown();
}
