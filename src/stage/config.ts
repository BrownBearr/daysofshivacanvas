// Stage constants. World units; the camera sits at the origin looking down -z and never moves.
// Every layout places tiles in camera space, which is what lets any layout morph into any other.

export const TILE = 1.4; // every tile is this square plane, scaled per layout
export const FOV = 45;
export const TAN_HALF_FOV = Math.tan((FOV * Math.PI) / 360);

// ---- Field (infinite lattice) ----
export const FIELD_SPACING = TILE * 1.12;
export const FIELD_MAX_COLS = 20;
export const FIELD_Z_MIN = 2;
export const FIELD_Z_MAX = 14;
export const FIELD_Z_START = 8;
export const FIELD_MARGIN = 2; // extra tile rings kept assigned beyond the visible edge
export const FIELD_HOVER_SCALE = 1.14;

// Inertia, all per second (see CLAUDE.md "Frame-rate independence"). MAX_VEL keeps one 60Hz frame
// under one tile of travel: 55 / 60 = 0.92 < FIELD_SPACING.
export const MAX_VEL = 55;
export const VEL_APPROACH = 6.3;
export const TARGET_DECAY = 9.8;
export const SCROLL_TRANSFER = 21;
export const DRAG_SENSITIVITY = 0.72;
export const TOUCH_DRAG_SENSITIVITY = 0.6;
export const ZOOM_SENSITIVITY = 0.15;

// ---- Flow (Cover Flow) + Stack (card file) ----
export const RAIL_DEPTH = 8; // distance of the front card from the camera
export const FLOW_RANGE = 14; // cards drawn either side of centre
export const STACK_RANGE = 12; // cards drawn behind the front card
export const RAIL_SNAP_MS = 140; // idle time before the rail settles on the nearest card
export const RAIL_FOLLOW = 9; // per-second approach of pos -> target

// ---- Transitions ----
export const EXIT_MS = 170; // tiles leaving the scene fade before the morph starts
export const MORPH_MS = 900;
export const MORPH_STAGGER_MS = 260; // max extra delay, by distance from screen centre

// ---- LOD ----
// The atlas cell is 96px. Above ~1.25x that on screen, a tile swaps to its full poster.
export const POSTER_MIN_PX = 120;
