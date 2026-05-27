export const BG_COLOR = "#ffffff";
export const TILE_COLOR = "#1a1a1a";
export const ACCENT_COLOR = "#1a1a1a";

// Grid layout
export const GRID_COLS = 20;
export const TILE_W = 1.4; // world units
export const TILE_H = TILE_W; // square tiles; UV cropping handles non-square videos
export const TILE_SPACING = TILE_W * 1.12; // center-to-center (small margin between tiles)

// Camera
export const INITIAL_CAM_Z = 8;
export const MIN_CAM_Z = 2;
export const MAX_CAM_Z = 14;

// Infinite (toroidal) grid: how many extra tile rings to mount beyond the visible
// frustum edge, so tiles are ready before they scroll into view.
export const VISIBLE_MARGIN_TILES = 1;

// Mobile devices have far less GPU + video-decode headroom, so we cap concurrent decodes
// here and render resolution in Scene. Coarse pointer or a mobile UA ⇒ treat as mobile.
export const IS_MOBILE =
  typeof navigator !== "undefined" &&
  (/Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent) ||
    (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches));

// Video pool
// Browsers can only smoothly decode a handful of <video> elements at once, so the pool is
// small. PLAY_COUNT tiles auto-play (the ones nearest the camera); everything else stays a
// static poster. Set PLAY_COUNT = 0 for pure hover/click-only playback.
// Mobile gets a smaller pool + fewer simultaneous decodes to avoid jank and decode stalls.
export const POOL_SIZE = IS_MOBILE ? 6 : 12;
export const PLAY_COUNT = IS_MOBILE ? 4 : 9;
