import * as THREE from "three";
import { INITIAL_CAM_Z, MIN_CAM_Z } from "../theme";

export const cameraState = {
  pos: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  // Separate animation target lets us damp camera smoothly for focus/unfocus
  // while keeping instant tracking during free nav
  animTarget: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  vel: new THREE.Vector3(0, 0, 0),
  targetVel: new THREE.Vector3(0, 0, 0),
  scrollAccum: 0,
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
  focusedTileId: null as string | null,
  // Name of the focused clip, for the UI overlay (cell key can't index the clips array).
  focusedClipName: null as string | null,
  isAnimatingFocus: false,
  preFocusTarget: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  hoveredTileId: null as string | null,
  lastTouchPos: { x: 0, y: 0 },
  lastTouchDist: 0,
};

export function focusTile(tileId: string, x: number, y: number, z: number, clipName: string) {
  cameraState.preFocusTarget.copy(cameraState.animTarget);
  cameraState.focusedTileId = tileId;
  cameraState.focusedClipName = clipName;
  cameraState.animTarget.set(x, y, Math.max(z, MIN_CAM_Z));
  cameraState.pos.copy(cameraState.animTarget);
  cameraState.isAnimatingFocus = true;
  cameraState.vel.set(0, 0, 0);
  cameraState.targetVel.set(0, 0, 0);
}

export function unfocusTile() {
  if (cameraState.focusedTileId === null) return;
  cameraState.focusedTileId = null;
  cameraState.focusedClipName = null;
  cameraState.animTarget.copy(cameraState.preFocusTarget);
  cameraState.pos.copy(cameraState.preFocusTarget);
  cameraState.isAnimatingFocus = true;
  cameraState.vel.set(0, 0, 0);
  cameraState.targetVel.set(0, 0, 0);
}
