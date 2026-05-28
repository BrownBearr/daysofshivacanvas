import * as React from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { useSpring, animated } from "@react-spring/three";
import type { ClipData } from "../types";
import { TILE_W, TILE_H, MIN_CAM_Z, IS_MOBILE } from "../theme";
import { videoPool } from "../lib/video-pool";
import { sourceUrl, previewUrl, posterUrl } from "../lib/clip-source";
import { cameraState, focusTile, unfocusTile, subscribeFocus } from "./camera-state";
import { muteState } from "./mute-state";

interface TileProps {
  // Unique per-cell identity on the infinite lattice ("gx:gy") — NOT the clip index,
  // since the same clip can appear in many cells once the grid wraps.
  tileKey: string;
  clip: ClipData;
  // World position split into primitives (not a [x,y,z] array) so the memoized Tile compares props
  // by value — a cell keeps the same x/y across grid rebuilds, so it never re-renders while panning.
  x: number;
  y: number;
}

// Per-frame texture upload is the dominant cost of an active video, so we only push a new
// frame to the GPU when the decoder actually produces one (requestVideoFrameCallback).
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const textureLoader = new THREE.TextureLoader();

// Every tile is the same 1.4×1.4 plane, so they all share one geometry instead of allocating a
// BufferGeometry per mounted cell (~135 when zoomed out).
const TILE_GEOMETRY = new THREE.PlaneGeometry(TILE_W, TILE_H);

// How long the cursor must rest on a tile before its video loads. Short enough to feel immediate
// on a deliberate hover, long enough that sweeping across tiles (or panning) loads nothing.
const HOVER_PLAY_DELAY = 90;

// Poster textures are cached across tiles and across pans. Map insertion order = recency (LRU); the
// cap bounds GPU memory so panning the wrapped lattice can't retain all ~566 posters for the session.
const POSTER_CACHE_CAP = IS_MOBILE ? 96 : 256;
const posterCache = new Map<string, THREE.Texture>();

function getCachedPoster(url: string): THREE.Texture | undefined {
  const tex = posterCache.get(url);
  if (tex) {
    // Move to most-recent.
    posterCache.delete(url);
    posterCache.set(url, tex);
  }
  return tex;
}

function setCachedPoster(url: string, tex: THREE.Texture): void {
  posterCache.set(url, tex);
  while (posterCache.size > POSTER_CACHE_CAP) {
    const oldest = posterCache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = posterCache.get(oldest);
    posterCache.delete(oldest);
    evicted?.dispose();
  }
}

// "cover" crop: fill a 1×1 square from any aspect ratio by trimming the longer axis
function applySquareCrop(tex: THREE.Texture, nativeW: number, nativeH: number) {
  if (!nativeW || !nativeH) return;
  const aspect = nativeW / nativeH;
  if (aspect > 1) {
    tex.repeat.set(1 / aspect, 1);
    tex.offset.set((1 - 1 / aspect) / 2, 0);
  } else if (aspect < 1) {
    tex.repeat.set(1, aspect);
    tex.offset.set(0, (1 - aspect) / 2);
  } else {
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
  }
}

function loadPoster(url: string): Promise<THREE.Texture> {
  const cached = getCachedPoster(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        const img = t.image as HTMLImageElement;
        applySquareCrop(t, img.naturalWidth, img.naturalHeight);
        setCachedPoster(url, t);
        resolve(t);
      },
      undefined,
      () => {
        const fallback = new THREE.DataTexture(new Uint8Array([210, 210, 210, 255]), 1, 1);
        fallback.needsUpdate = true;
        setCachedPoster(url, fallback);
        resolve(fallback);
      }
    );
  });
}

// Memoized: during a pan, Grid rebuilds the cell list every tile-boundary crossing, but a given
// cell's props (clip ref, x, y, inPlayRadius) are unchanged, so memo skips re-rendering it — only
// the ring of entering/exiting tiles does any work.
export const Tile = React.memo(function Tile({ tileKey, clip, x, y }: TileProps) {
  const { camera, invalidate } = useThree();
  const matRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const videoTexRef = React.useRef<THREE.VideoTexture | null>(null);
  const videoElRef = React.useRef<HTMLVideoElement | null>(null);

  const [hovered, setHovered] = React.useState(false);
  const hoveredRef = React.useRef(false);
  hoveredRef.current = hovered;
  const [posterTex, setPosterTex] = React.useState<THREE.Texture | null>(null);
  // Ref so cleanup closures always read the latest posterTex without it being a dep
  const posterTexRef = React.useRef<THREE.Texture | null>(null);
  posterTexRef.current = posterTex;

  // playArmed is the (debounced) signal that this tile should hold a real <video>. It's separate
  // from `hovered` so the hover scale reacts instantly while the expensive video acquire waits for
  // hover intent — a fast cursor sweep across the grid never cold-starts a decode it abandons.
  const [playArmed, setPlayArmed] = React.useState(false);
  const shouldPlay = playArmed;
  const shouldPlayRef = React.useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  // Hover → arm play after a short intent delay; un-hover disarms unless the tile is focused
  // (a focused tile keeps playing even if the cursor leaves it).
  React.useEffect(() => {
    if (!hovered) {
      if (cameraState.focusedTileId !== tileKey) setPlayArmed(false);
      return;
    }
    const t = setTimeout(() => setPlayArmed(true), HOVER_PLAY_DELAY);
    return () => clearTimeout(t);
  }, [hovered, tileKey]);

  // Focus changes live in the mutable cameraState, so subscribe: focusing this tile arms play
  // immediately (skip the hover delay); unfocusing disarms it only if the cursor isn't on it.
  React.useEffect(
    () =>
      subscribeFocus(() => {
        if (cameraState.focusedTileId === tileKey) setPlayArmed(true);
        else if (!hoveredRef.current) setPlayArmed(false);
      }),
    [tileKey]
  );
  // Tracks focus edges so the frame loop can swap preview<->source exactly on transition.
  const wasFocusedRef = React.useRef(false);
  // Whether the active element supports requestVideoFrameCallback (else fall back per-frame).
  const usesRVFCRef = React.useRef(false);
  // True once the video has produced its first frame. Until then we keep showing the poster,
  // so swapping in the video texture never reveals an empty (white) frame.
  const videoReadyRef = React.useRef(false);

  React.useEffect(() => {
    let canceled = false;
    loadPoster(posterUrl(clip)).then((t) => {
      if (!canceled) setPosterTex(t);
    });
    return () => { canceled = true; };
  }, [clip]);

  // Acquire / release a pooled <video> as the tile enters/leaves the play-or-hover state.
  React.useEffect(() => {
    if (!shouldPlay) {
      videoPool.release(tileKey);
      if (videoTexRef.current) { videoTexRef.current.dispose(); videoTexRef.current = null; }
      videoElRef.current = null;
      videoReadyRef.current = false;
      if (matRef.current) {
        matRef.current.map = posterTexRef.current;
        matRef.current.needsUpdate = true;
        invalidate(); // imperative map change won't auto-invalidate under demand mode
      }
      return;
    }

    const el = videoPool.acquire(tileKey, previewUrl(clip)) as RVFCVideo | null;
    if (!el) return;
    videoElRef.current = el;

    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    videoTexRef.current = tex;
    videoReadyRef.current = false;

    const onMeta = () => applySquareCrop(tex, el.videoWidth, el.videoHeight);
    if (el.readyState >= 1) onMeta();
    else el.addEventListener("loadedmetadata", onMeta, { once: true });

    // Keep the poster on-screen for now; the swap to video happens on the first decoded frame.
    if (matRef.current && posterTexRef.current) {
      matRef.current.map = posterTexRef.current;
      matRef.current.needsUpdate = true;
    }

    // Upload to the GPU only when a new decoded frame is available, and swap poster->video
    // on the first one so the transition is seamless (no empty/white frame).
    let rvfcHandle = 0;
    const supportsRVFC = typeof el.requestVideoFrameCallback === "function";
    usesRVFCRef.current = supportsRVFC;
    if (supportsRVFC) {
      const onFrame = () => {
        tex.needsUpdate = true;
        if (!videoReadyRef.current && el.readyState >= 2 && matRef.current) {
          videoReadyRef.current = true;
          matRef.current.map = tex;
          matRef.current.needsUpdate = true;
        }
        // Demand frameloop: a decoded frame is new content, so request a render. RVFC fires
        // independently of R3F, so this keeps playing tiles rendering at video framerate.
        invalidate();
        rvfcHandle = el.requestVideoFrameCallback!(onFrame);
      };
      rvfcHandle = el.requestVideoFrameCallback!(onFrame);
    }

    return () => {
      if (supportsRVFC && rvfcHandle) el.cancelVideoFrameCallback?.(rvfcHandle);
      videoPool.release(tileKey);
      tex.dispose();
      videoTexRef.current = null;
      videoElRef.current = null;
      videoReadyRef.current = false;
    };
  }, [shouldPlay, tileKey, clip, invalidate]);

  // Apply poster once loaded (unless the video is already showing its frames)
  React.useEffect(() => {
    if (!posterTex || !matRef.current || videoReadyRef.current) return;
    matRef.current.map = posterTex;
    matRef.current.needsUpdate = true;
    // The fade loop has gone idle waiting for this async poster — kick a frame so it fades in.
    invalidate();
  }, [posterTex, invalidate]);

  const isFocused = () => cameraState.focusedTileId === tileKey;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (cameraState.isDragging) return;

    // Any click while focused (this tile or any other) exits focus and returns to the prior zoom.
    if (cameraState.focusedTileId !== null) {
      unfocusTile();
    } else {
      const fovRad = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const fitZ = (TILE_W * 1.2) / (2 * Math.tan(fovRad / 2));
      focusTile(tileKey, x, y, Math.max(fitZ, MIN_CAM_Z), clip.name);
      // If a video element is already bound (the tile was hovered), upgrade to full source and
      // unmute now, inside the user gesture. Otherwise focusing arms play (via the focus
      // subscription), the acquire effect binds a preview element, and the frame loop's focus
      // edge upgrades it to source on the next frame.
      const el = videoElRef.current;
      if (el) {
        videoPool.acquire(tileKey, sourceUrl(clip));
        el.muted = muteState.muted;
        el.play().catch(() => {});
      }
    }
  };

  const { scale } = useSpring({
    // No hover scale on mobile (touch has no real hover; it just causes jank during pans).
    scale: !IS_MOBILE && hovered && !cameraState.isDragging && !isFocused() ? 1.3 : 1.0,
    config: { tension: 380, friction: 16 },
    // Under demand frameloop react-spring won't render itself; drive R3F each animation step.
    onChange: () => invalidate(),
  });

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;

    const tex = videoTexRef.current;
    const el = videoElRef.current;
    const focused = cameraState.focusedTileId === tileKey;
    const focusEdge = focused !== wasFocusedRef.current;

    const hasContent = (tex && el && el.readyState >= 2) || posterTex;
    const targetOpacity = hasContent ? 1 : 0;
    const opacitySettled = Math.abs(mat.opacity - targetOpacity) <= 0.001;

    // Fast path: a settled static-poster tile (no video element, no focus transition pending,
    // opacity already at target) needs zero per-frame work. While panning this is ~all visible
    // tiles, so bailing here is what keeps a fling cheap — only the entering ring and any
    // hovered/focused tile below do real work.
    if (!el && !focusEdge && opacitySettled) return;

    // Focus edge: swap preview<->source and toggle mute exactly when focus changes.
    if (focusEdge) {
      wasFocusedRef.current = focused;
      if (el) {
        if (focused) {
          videoPool.acquire(tileKey, sourceUrl(clip));
          el.muted = muteState.muted;
          el.play().catch(() => {});
        } else if (shouldPlayRef.current) {
          videoPool.acquire(tileKey, previewUrl(clip));
          el.muted = true;
        }
        if (tex) {
          el.addEventListener(
            "loadedmetadata",
            () => applySquareCrop(tex, el.videoWidth, el.videoHeight),
            { once: true }
          );
        }
      }
    }

    // Keep focused clip's muted state in sync with the global mute toggle.
    if (el && focused) el.muted = muteState.muted;

    // Fallback frame pump when requestVideoFrameCallback is unavailable. This runs inside useFrame,
    // so it must self-sustain the demand loop while the video plays.
    if (!usesRVFCRef.current && tex && el && !el.paused && el.readyState >= 2) {
      tex.needsUpdate = true;
      invalidate();
      if (!videoReadyRef.current) {
        videoReadyRef.current = true;
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }

    if (!opacitySettled) {
      mat.opacity += (targetOpacity - mat.opacity) * 0.12;
      // Keep rendering until the fade settles.
      invalidate();
    }
  });

  return (
    <animated.mesh
      position={[x, y, 0]}
      scale={scale}
      geometry={TILE_GEOMETRY}
      // Hover handlers only on non-touch: on mobile they'd fire on every tile the finger drags over,
      // churning state + raycasts. Omitting them leaves only onClick (raycast on tap), so panning is
      // just panning, a tap focuses, and a second tap unfocuses.
      onPointerOver={
        IS_MOBILE
          ? undefined
          : (e) => {
              e.stopPropagation();
              // While focused, no other tile may enter its hover state (scale/preview/label).
              if (cameraState.focusedTileId !== null) return;
              setHovered(true);
              cameraState.hoveredTileId = tileKey;
              cameraState.hoveredClipName = clip.name;
              document.body.style.cursor = "pointer";
            }
      }
      onPointerOut={
        IS_MOBILE
          ? undefined
          : () => {
              setHovered(false);
              if (cameraState.hoveredTileId === tileKey) {
                cameraState.hoveredTileId = null;
                cameraState.hoveredClipName = null;
              }
              document.body.style.cursor = "";
            }
      }
      onClick={handleClick}
    >
      {/* map is managed imperatively (poster vs. video) via the effects/frame loop;
          binding it here would let R3F re-apply the poster on every re-render and
          clobber the active VideoTexture. */}
      <meshBasicMaterial ref={matRef} toneMapped={false} transparent opacity={0} />
    </animated.mesh>
  );
});
