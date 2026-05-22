import * as THREE from "three";
import { INITIAL_CAM_Z } from "../theme";

export const cameraState = {
  pos: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  vel: new THREE.Vector3(0, 0, 0),
  targetVel: new THREE.Vector3(0, 0, 0),
  scrollAccum: 0,
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
  focusedTileId: null as number | null,
  preFocusPos: new THREE.Vector3(0, 0, INITIAL_CAM_Z),
  hoveredTileId: null as number | null,
  // Touch state
  lastTouchPos: { x: 0, y: 0 },
  lastTouchDist: 0,
};
