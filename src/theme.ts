export const BG_COLOR = "#f5f5f0";
export const TILE_COLOR = "#1a1a1a";
export const ACCENT_COLOR = "#1a1a1a";
export const WRAP_GRID = false;

// Grid layout
export const GRID_COLS = 3; // Phase 1: 3 cols. Phase 2: 25
export const TILE_W = 1.0; // world units
export const TILE_H = TILE_W * (9 / 16);
export const TILE_SPACING = TILE_W * 1.6; // center-to-center

// Camera
export const INITIAL_CAM_Z = 8;
export const MIN_CAM_Z = 2;
export const MAX_CAM_Z = 40;

// Chunk system
export const CHUNK_TILE_COUNT = 8; // tiles per chunk side
export const CHUNK_SIZE = CHUNK_TILE_COUNT * TILE_SPACING;
export const RENDER_CHUNKS = 2; // camera chunk ± N
export const FADE_CHUNKS = 1; // additional fade margin

// Video pool
export const POOL_SIZE = 25;
export const PLAY_RADIUS_CHUNKS = 1; // camera chunk ± N gets pool elements
