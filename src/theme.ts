export const BG_COLOR = "#ffffff";
export const TILE_COLOR = "#1a1a1a";
export const ACCENT_COLOR = "#1a1a1a";
export const WRAP_GRID = false;

// Grid layout
export const GRID_COLS = 20;
export const TILE_W = 1.4; // world units
export const TILE_H = TILE_W; // square tiles; UV cropping handles non-square videos
export const TILE_SPACING = TILE_W * 1.12; // center-to-center (small margin between tiles)

// Camera
export const INITIAL_CAM_Z = 8;
export const MIN_CAM_Z = 2;
export const MAX_CAM_Z = 25;

// Chunk system
export const CHUNK_TILE_COUNT = 8; // tiles per chunk side
export const CHUNK_SIZE = CHUNK_TILE_COUNT * TILE_SPACING;
export const RENDER_CHUNKS = 1; // camera chunk ± N
export const FADE_CHUNKS = 1; // additional fade margin

// Video pool
// Browsers can only smoothly decode a handful of <video> elements at once, so the pool is
// small. PLAY_COUNT tiles auto-play (the ones nearest the camera); everything else stays a
// static poster. Set PLAY_COUNT = 0 for pure hover/click-only playback.
export const POOL_SIZE = 12;
export const PLAY_COUNT = 9;
