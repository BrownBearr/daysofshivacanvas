import * as THREE from "three";
import { INITIAL_CAM_Z } from "../theme";
import type { ClipData } from "../types";

// Mutable canvas state, deliberately outside React: the frame loop writes to it every frame and
// routing that through useState would re-render the tree at 60Hz. React only learns about the
// bits the DOM overlay needs, and only when they actually change (see subscribe* below).
export const cameraState = {
  pos: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  animTarget: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  vel: new THREE.Vector3(0, 0, 0),
  targetVel: new THREE.Vector3(0, 0, 0),
  scrollAccum: 0,
  isDragging: false,
  // Mutated in place, never reassigned — these update on every mousemove/touchmove, and a fresh
  // object literal per pointer event is pure garbage at 60-144Hz.
  lastMouse: { x: 0, y: 0 },
  lastTouchPos: { x: 0, y: 0 },
  lastTouchDist: 0,
  focusedTileId: null as string | null,
  focusedClipName: null as string | null,
  focusedClip: null as ClipData | null,
  hoveredTileId: null as string | null,
  hoveredClipName: null as string | null,
  // performance.now() of the last real user input. Drives the kiosk attract/auto-reset timers.
  lastInputAt: 0,
};

// Set by the R3F CameraController. Focus/unfocus and hover start from DOM event handlers that run
// outside the render loop, so under `frameloop="demand"` they must kick a render or the animation
// they started would never advance.
let requestRender: () => void = () => {};
export function setRequestRender(fn: () => void) {
  requestRender = fn;
}
export function requestFrame() {
  requestRender();
}

function makeEmitter() {
  const listeners = new Set<() => void>();
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit() {
      for (const fn of listeners) fn();
    },
  };
}

const focusEmitter = makeEmitter();
const hoverEmitter = makeEmitter();

export const subscribeFocus = focusEmitter.subscribe;
/** Fires only when the hovered tile actually changes — replaces Chrome's 20Hz poll. */
export const subscribeHover = hoverEmitter.subscribe;

export function markInput(): void {
  cameraState.lastInputAt = performance.now();
}

export function setHover(tileId: string | null, clipName: string | null): void {
  if (cameraState.hoveredTileId === tileId) return;
  cameraState.hoveredTileId = tileId;
  cameraState.hoveredClipName = clipName;
  hoverEmitter.emit();
}

export function focusTile(tileId: string, clipName: string, clip: ClipData) {
  cameraState.focusedTileId = tileId;
  cameraState.focusedClipName = clipName;
  cameraState.focusedClip = clip;
  // Camera stays in place — the DOM overlay handles the focused video.
  cameraState.vel.set(0, 0, 0);
  cameraState.targetVel.set(0, 0, 0);
  focusEmitter.emit();
  requestRender();
}

export function unfocusTile() {
  if (cameraState.focusedTileId === null) return;
  cameraState.focusedTileId = null;
  cameraState.focusedClipName = null;
  cameraState.focusedClip = null;
  focusEmitter.emit();
  requestRender();
}

// Snap the camera back to the origin/default zoom. Used when the clip set is regrouped or
// filtered, and by the kiosk auto-reset between visitors.
export function resetView() {
  cameraState.pos.set(0, 0, INITIAL_CAM_Z);
  cameraState.animTarget.set(0, 0, INITIAL_CAM_Z);
  cameraState.vel.set(0, 0, 0);
  cameraState.targetVel.set(0, 0, 0);
  cameraState.scrollAccum = 0;
  requestRender();
}
