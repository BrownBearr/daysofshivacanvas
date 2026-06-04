import * as THREE from "three";
import { INITIAL_CAM_Z } from "../theme";
import type { ClipData } from "../types";

export const cameraState = {
  pos: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  animTarget: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  vel: new THREE.Vector3(0, 0, 0),
  targetVel: new THREE.Vector3(0, 0, 0),
  scrollAccum: 0,
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
  focusedTileId: null as string | null,
  focusedClipName: null as string | null,
  focusedClip: null as ClipData | null,
  hoveredTileId: null as string | null,
  hoveredClipName: null as string | null,
  lastTouchPos: { x: 0, y: 0 },
  lastTouchDist: 0,
};

// Set by the R3F CameraController. Focus/unfocus start a camera animation from React event handlers
// (click, Esc, onPointerMissed) that run outside the render loop, so under the demand frameloop they
// must kick a render or the damp animation would never advance.
let requestRender: () => void = () => {};
export function setRequestRender(fn: () => void) {
  requestRender = fn;
}

// Tiles subscribe so a focused tile can keep playing (with audio) regardless of hover state, and
// disarm cleanly on unfocus — focus lives in this mutable object, not React state, so without a
// notification a tile that loses focus from Esc / click-elsewhere would never hear about it.
const focusListeners = new Set<() => void>();
export function subscribeFocus(fn: () => void): () => void {
  focusListeners.add(fn);
  return () => {
    focusListeners.delete(fn);
  };
}
function notifyFocus(): void {
  for (const fn of focusListeners) fn();
}

export function focusTile(tileId: string, clipName: string, clip: ClipData) {
  cameraState.focusedTileId = tileId;
  cameraState.focusedClipName = clipName;
  cameraState.focusedClip = clip;
  // Camera stays in place — the DOM overlay handles the focused video.
  cameraState.vel.set(0, 0, 0);
  cameraState.targetVel.set(0, 0, 0);
  notifyFocus();
  requestRender();
}

export function unfocusTile() {
  if (cameraState.focusedTileId === null) return;
  cameraState.focusedTileId = null;
  cameraState.focusedClipName = null;
  cameraState.focusedClip = null;
  notifyFocus();
  requestRender();
}
