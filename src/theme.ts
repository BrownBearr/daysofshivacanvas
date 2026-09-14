import { RUNTIME } from "./runtime";

// Grid layout
export const GRID_COLS = 20;
export const TILE_W = 1.4; // world units
export const TILE_H = TILE_W; // square tiles; UV cropping handles non-square videos
export const TILE_SPACING = TILE_W * 1.12; // center-to-center (small margin between tiles)
export const HOVER_SCALE = 1.3;

// Camera
export const CAMERA_FOV = 45;
export const INITIAL_CAM_Z = 8;
export const MIN_CAM_Z = 2;
export const MAX_CAM_Z = 14;

// Infinite (toroidal) grid: how many extra tile rings to keep mounted beyond the visible
// frustum edge. The slot pool is sized for MAX_CAM_Z plus this margin and then never grows,
// so a wider margin costs mounted-but-hidden meshes (near-free) and buys the slack that lets
// the slot reassignment be throttled without the user ever seeing an empty edge.
export const VISIBLE_MARGIN_TILES = 2;

// Video pool — see runtime.ts for why this differs between web and kiosk.
export const POOL_SIZE = RUNTIME.poolSize;
