// The stage engine: layouts, transitions, LOD, hover and video for every tile, in one frame loop.
//
// v1's rule stands: React is not in the motion path. A fixed pool of meshes ("slots") is mounted
// once per viewport size and everything here mutates them imperatively. What's new is that the
// camera never moves. Each layout is a function that places tiles in camera space, so switching
// view or sort is just changing which function runs, and every tile tweens from where it was drawn
// to where the new layout wants it.
import * as THREE from "three";
import { posterUrl } from "../lib/clip-source";
import { acquirePoster, releasePoster } from "../lib/poster-cache";
import { prefersReducedMotion } from "../runtime";
import type { ClipData, ViewId } from "../types";
import { atlasFor, onAtlasSheet } from "./atlas";
import {
  DRAG_SENSITIVITY,
  EXIT_MS,
  FIELD_HOVER_SCALE,
  FIELD_MARGIN,
  FIELD_MAX_COLS,
  FIELD_SPACING,
  FIELD_Z_MAX,
  FIELD_Z_MIN,
  FIELD_Z_START,
  FLOW_RANGE,
  MAX_VEL,
  MORPH_MS,
  MORPH_STAGGER_MS,
  POSTER_MIN_PX,
  RAIL_DEPTH,
  RAIL_FOLLOW,
  RAIL_SNAP_MS,
  SCROLL_TRANSFER,
  STACK_RANGE,
  TAN_HALF_FOV,
  TARGET_DECAY,
  TILE,
  TOUCH_DRAG_SENSITIVITY,
  VEL_APPROACH,
  ZOOM_SENSITIVITY,
} from "./config";
import { requestFrame } from "./frame";
import { BLANK, type TileUniforms } from "./material";
import { armVideo, needsManualPump, pumpVideo, stopVideo } from "./tile-video";

export type StageView = Exclude<ViewId, "index">;

export interface Slot {
  mesh: THREE.Mesh;
  refl: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  u: TileUniforms;
  /** Layout key of the item in this slot; NaN when parked. */
  key: number;
  /** Scene generation the key belongs to; a new scene forces every slot to reassign. */
  gen: number;
  stamp: number;
  index: number;
  clip: ClipData | null;
  videoKey: string;
  // target / current / morph-from transforms
  tx: number;
  ty: number;
  tz: number;
  trx: number;
  try: number;
  ts: number;
  tvis: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  s: number;
  fx: number;
  fy: number;
  fz: number;
  frx: number;
  fry: number;
  fs: number;
  fo: number;
  morphing: boolean;
  delay: number;
  presence: number;
  hover: number;
  atlasReady: boolean;
  posterUrl: string | null;
  posterTex: THREE.Texture | null;
  posterMix: number;
  videoTex: THREE.VideoTexture | null;
  videoReady: boolean;
}

interface Scene {
  view: StageView;
  clips: ClipData[];
  nameIndex: Map<string, number>;
  cols: number;
  rows: number;
}

interface Cam {
  x: number;
  y: number;
  z: number;
  rail: number;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
const KEY_BIAS = 32768;

// ---- state --------------------------------------------------------------------------------

export const slots: Slot[] = [];
if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug"))
  (window as unknown as { __slots: Slot[] }).__slots = slots;

const vp = { w: 1, h: 1, dpr: 1, aspect: 1 };
let poolCols = 1;
let poolRows = 1;
let poolCount = 1;
let camera: THREE.PerspectiveCamera | null = null;
let canvasEl: HTMLCanvasElement | null = null;

let scene: Scene | null = null;
let pending: { scene: Scene; cam: Cam; keep: Set<string>; at: number } | null = null;
let fromIndex = true;
let morphStart = -1;
let firstFrame = false;
let stamp = 0;
let gen = 0;
const snapshot = new Map<string, { x: number; y: number; z: number; rx: number; ry: number; s: number; o: number; d: number }>();

const cam: Cam = { x: 0, y: 0, z: FIELD_Z_START, rail: 0 };
const field = { vx: 0, vy: 0, vz: 0, tvx: 0, tvy: 0, tvz: 0, zoomAccum: 0 };
const rail = { target: 0, lastInput: 0, dragging: false };
export const pointer = { x: 0, y: 0, inside: false, mouse: true, dragging: false };

let locked = false;
let hidden: string | null = null;
let hoverSlot: Slot | null = null;
let current: string | null = null;
let atlasDirty = false;
// Decoded posters wait here and are handed to tiles a few per frame, so a burst of arrivals (a
// zoom-out, the end of a morph) never lands as one frame of texture uploads.
const arrived: { s: Slot; url: string; tex: THREE.Texture }[] = [];
const UPLOADS_PER_FRAME = 3;
const listeners = new Set<(name: string | null) => void>();

onAtlasSheet(() => {
  atlasDirty = true;
  requestFrame();
});

// ---- setup --------------------------------------------------------------------------------

export function attach(c: THREE.PerspectiveCamera, el: HTMLCanvasElement): void {
  camera = c;
  canvasEl = el;
}

/** Slot count for a viewport: the field window fully zoomed out, or the rails, whichever is larger. */
export function setViewport(w: number, h: number, dpr: number): number {
  vp.w = Math.max(1, w);
  vp.h = Math.max(1, h);
  vp.dpr = dpr;
  vp.aspect = vp.w / vp.h;
  const halfH = FIELD_Z_MAX * TAN_HALF_FOV;
  const halfW = halfH * vp.aspect;
  poolCols = Math.ceil((2 * halfW) / FIELD_SPACING) + 2 + 2 * FIELD_MARGIN;
  poolRows = Math.ceil((2 * halfH) / FIELD_SPACING) + 2 + 2 * FIELD_MARGIN;
  poolCount = Math.max(poolCols * poolRows, 2 * FLOW_RANGE + 4, STACK_RANGE + 4);
  return poolCount;
}

export function subscribeCurrent(fn: (name: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setCurrent(name: string | null) {
  if (name === current) return;
  current = name;
  for (const fn of listeners) fn(name);
}

export function setLocked(v: boolean): void {
  locked = v;
  if (v) stopVideo();
  requestFrame();
}

/** Hide a clip's tile while the player shows it, so the player reads as lifted out of the grid. */
export function setHidden(name: string | null): void {
  hidden = name;
  // Reappearing after the player morphs back must be instant, or the tile blinks.
  if (!name) for (const s of slots) if (s && !Number.isNaN(s.key) && s.atlasReady) s.presence = Math.max(s.presence, s.tvis);
  requestFrame();
}

export function currentView(): StageView | null {
  return scene?.view ?? null;
}

// ---- layouts ------------------------------------------------------------------------------
// Each visits the items it wants drawn and writes their camera-space transform into X.

const X = { x: 0, y: 0, z: 0, rx: 0, ry: 0, s: 1, vis: 1 };
type Visit = (key: number, index: number, slotIndex: number) => void;

function fieldGrid(n: number): { cols: number; rows: number } {
  if (n < FIELD_MAX_COLS * 2) {
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.6)));
    return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
  }
  // The lattice tiles the plane, so a short last row would repeat as a strip of holes. Pick the
  // column count near FIELD_MAX_COLS that leaves the fewest empty cells.
  let best = FIELD_MAX_COLS;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let c = FIELD_MAX_COLS - 4; c <= FIELD_MAX_COLS + 4; c++) {
    const gap = (c - (n % c)) % c;
    if (gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return { cols: best, rows: Math.ceil(n / best) };
}

function visitField(sc: Scene, c: Cam, cb: Visit) {
  const n = sc.clips.length;
  if (!n) return;
  const S = FIELD_SPACING;
  const halfH = c.z * TAN_HALF_FOV;
  const halfW = halfH * vp.aspect;
  const gx0 = Math.floor((c.x - halfW) / S) - FIELD_MARGIN;
  const gx1 = Math.ceil((c.x + halfW) / S) + FIELD_MARGIN;
  const gy0 = Math.floor((c.y - halfH) / S) - FIELD_MARGIN;
  const gy1 = Math.ceil((c.y + halfH) / S) + FIELD_MARGIN;
  for (let gy = gy0; gy <= gy1 && gy - gy0 < poolRows; gy++) {
    for (let gx = gx0; gx <= gx1 && gx - gx0 < poolCols; gx++) {
      // Row 0 at the top, reading left to right, so a sorted field reads like a page.
      let idx = mod(-gy, sc.rows) * sc.cols + mod(gx, sc.cols);
      // Any leftover cells in the last row borrow from the start rather than leave holes.
      if (idx >= n) idx -= n;
      if (idx >= n) continue;
      X.x = gx * S - c.x;
      X.y = gy * S - c.y;
      X.z = -c.z;
      X.rx = 0;
      X.ry = 0;
      X.s = 1;
      X.vis = 1;
      cb((gx + KEY_BIAS) * 65536 + (gy + KEY_BIAS), idx, mod(gx, poolCols) * poolRows + mod(gy, poolRows));
    }
  }
}

/** World width of the rail's front card for the current viewport. */
function railCard(view: StageView): number {
  const halfH = RAIL_DEPTH * TAN_HALF_FOV;
  const halfW = halfH * vp.aspect;
  return view === "flow" ? Math.min(halfH * 0.95, halfW * 1.2) : Math.min(halfH * 0.86, halfW * 1.3);
}

function visitFlow(sc: Scene, c: Cam, cb: Visit) {
  const n = sc.clips.length;
  if (!n) return;
  const W = railCard("flow");
  const scale = W / TILE;
  const i0 = Math.max(0, Math.floor(c.rail) - FLOW_RANGE);
  const i1 = Math.min(n - 1, Math.ceil(c.rail) + FLOW_RANGE);
  for (let i = i0; i <= i1; i++) {
    const o = i - c.rail;
    const s = clamp(o, -1, 1);
    // Cover Flow: the centre card faces you; the rest turn ~72 degrees to face the centre like
    // paintings along a corridor, packed tight and pushed back.
    X.x = (s * 0.66 + (o - s) * 0.2) * W;
    X.y = W * 0.18;
    X.z = -RAIL_DEPTH - Math.abs(s) * W * 0.6;
    X.rx = 0;
    X.ry = -s * 1.2566;
    X.s = scale;
    X.vis = 1 - smoothstep(FLOW_RANGE - 3, FLOW_RANGE, Math.abs(o));
    cb(i, i, mod(i, poolCount));
  }
}

function visitStack(sc: Scene, c: Cam, cb: Visit) {
  const n = sc.clips.length;
  if (!n) return;
  const W = railCard("stack");
  const scale = W / TILE;
  const half = W / 2;
  const i0 = Math.max(0, Math.floor(c.rail) - 1);
  const i1 = Math.min(n - 1, Math.floor(c.rail) + STACK_RANGE);
  const base = -W * 0.72;
  for (let i = i0; i <= i1; i++) {
    const o = i - c.rail;
    if (o <= -1) continue;
    // A card file: cards hinge at their bottom edge. The front card stands upright; cards behind
    // recede and rise so a band of each one shows above the next; a card flipped past falls forward.
    let a: number;
    let hy: number;
    let hz: number;
    let vis: number;
    if (o < 0) {
      a = -o * 1.75;
      hy = base;
      hz = -RAIL_DEPTH;
      vis = 1 + o;
    } else {
      a = -0.05 * Math.min(o, 1);
      hy = base + o * W * 0.19;
      hz = -RAIL_DEPTH - o * W * 0.26;
      vis = 1 - smoothstep(STACK_RANGE - 4, STACK_RANGE, o);
    }
    X.x = 0;
    X.y = hy + half * Math.cos(a);
    X.z = hz + half * Math.sin(a);
    X.rx = a;
    X.ry = 0;
    X.s = scale;
    X.vis = vis;
    cb(i, i, mod(i, poolCount));
  }
}

function visit(sc: Scene, c: Cam, cb: Visit) {
  if (sc.view === "field") visitField(sc, c, cb);
  else if (sc.view === "flow") visitFlow(sc, c, cb);
  else visitStack(sc, c, cb);
}

// ---- scene changes ------------------------------------------------------------------------

function buildScene(view: StageView, clips: ClipData[]): Scene {
  return { view, clips, nameIndex: new Map(clips.map((c, i) => [c.name, i])), ...fieldGrid(clips.length) };
}

/** The clip drawn nearest the centre of the screen right now. */
function centreClip(): string | null {
  if (!scene) return null;
  if (scene.view !== "field") return scene.clips[Math.round(cam.rail)]?.name ?? null;
  let best: Slot | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    if (!s?.clip || Number.isNaN(s.key)) continue;
    const d = s.x * s.x + s.y * s.y;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best?.clip?.name ?? null;
}

/**
 * Switch layout and/or clip order. Tiles not in the next scene fade first; then everything morphs
 * from where it is drawn to where the next layout puts it. The clip at the centre of the screen
 * stays the centre of attention across the change.
 */
export function requestScene(view: StageView, clips: ClipData[], opts: { entering?: boolean } = {}): void {
  const next = buildScene(view, clips);
  const anchor = opts.entering ? null : centreClip();
  const c: Cam = { ...cam };
  const n = clips.length;

  if (view === "field") {
    const k = anchor !== null ? next.nameIndex.get(anchor) : undefined;
    if (!scene) {
      // First paint: the start of the order sits near the top-left, like the first page of a book.
      const halfH = c.z * TAN_HALF_FOV;
      c.x = halfH * vp.aspect - FIELD_SPACING * 1.1;
      c.y = -(halfH - FIELD_SPACING * 1.1);
    } else if (k !== undefined && (scene.view !== "field" || opts.entering)) {
      c.x = (k % next.cols) * FIELD_SPACING;
      c.y = -Math.floor(k / next.cols) * FIELD_SPACING;
    }
  } else {
    const k = anchor !== null ? next.nameIndex.get(anchor) : undefined;
    c.rail = k ?? clamp(Math.round(cam.rail), 0, Math.max(0, n - 1));
  }

  const keep = new Set<string>();
  visit(next, c, (_k, idx) => keep.add(clips[idx].name));
  pending = { scene: next, cam: c, keep, at: performance.now() };
  fromIndex = !!opts.entering;
  if (!scene || prefersReducedMotion()) applyPending(performance.now());
  requestFrame();
}

function applyPending(now: number) {
  if (!pending) return;
  snapshot.clear();
  if (scene && !fromIndex) {
    for (const s of slots) {
      if (!s?.clip || Number.isNaN(s.key) || s.presence < 0.05) continue;
      const d = s.x * s.x + s.y * s.y;
      const prev = snapshot.get(s.clip.name);
      if (!prev || prev.d > d)
        snapshot.set(s.clip.name, { x: s.x, y: s.y, z: s.z, rx: s.rx, ry: s.ry, s: s.s, o: s.presence, d });
    }
  }
  scene = pending.scene;
  cam.x = pending.cam.x;
  cam.y = pending.cam.y;
  cam.rail = pending.cam.rail;
  rail.target = cam.rail;
  field.vx = field.vy = field.vz = field.tvx = field.tvy = field.tvz = 0;
  pending = null;
  gen++;
  morphStart = now;
  firstFrame = true;
  stopVideo();
}

// ---- slot bookkeeping ---------------------------------------------------------------------

function releaseSlotPoster(s: Slot) {
  if (s.posterUrl) releasePoster(s.posterUrl);
  s.posterUrl = null;
  s.posterTex = null;
  s.posterMix = 0;
}

function setClip(s: Slot, clip: ClipData) {
  if (s.clip === clip) return;
  releaseSlotPoster(s);
  s.clip = clip;
  const a = atlasFor(clip.name, s.u.uAtlasRect.value);
  s.u.uAtlas.value = a.tex;
  s.atlasReady = a.ready;
  s.u.uMap.value = BLANK;
  s.u.uMix.value = 0;
}

function park(s: Slot) {
  s.key = Number.NaN;
  s.morphing = false;
  s.presence = 0;
  s.hover = 0;
  s.mesh.visible = false;
  s.refl.visible = false;
  releaseSlotPoster(s);
  s.clip = null;
}

function assign(s: Slot, key: number, idx: number, clip: ClipData, now: number) {
  s.key = key;
  s.index = idx;
  setClip(s, clip);
  s.videoKey = `${scene?.view}:${key}:${clip.name}`;

  if (firstFrame) {
    const from = snapshot.get(clip.name);
    s.morphing = true;
    const d = Math.hypot(s.tx, s.ty) / Math.max(1, -s.tz * TAN_HALF_FOV * vp.aspect);
    if (from) {
      s.fx = from.x;
      s.fy = from.y;
      s.fz = from.z;
      s.frx = from.rx;
      s.fry = from.ry;
      s.fs = from.s;
      s.fo = from.o;
      s.delay = Math.min(1, d) * MORPH_STAGGER_MS * 0.5;
    } else {
      // Entering: rise into place from slightly smaller and further back.
      s.fx = s.tx;
      s.fy = s.ty;
      s.fz = s.tz - 0.6;
      s.frx = s.trx;
      s.fry = s.try;
      s.fs = s.ts * 0.9;
      s.fo = 0;
      s.delay = Math.min(1, d) * MORPH_STAGGER_MS;
    }
    return;
  }
  s.morphing = false;
  s.x = s.tx;
  s.y = s.ty;
  s.z = s.tz;
  s.rx = s.trx;
  s.ry = s.try;
  s.s = s.ts;
  // During an ongoing morph a newly revealed tile fades in; otherwise it's just there.
  s.presence = now - morphStart < MORPH_MS ? 0 : s.atlasReady ? s.tvis : 0;
}

// ---- input API (called from input.ts) -----------------------------------------------------

export function isLocked(): boolean {
  return locked;
}

export function fieldDrag(dx: number, dy: number, touch: boolean) {
  const k = touch ? TOUCH_DRAG_SENSITIVITY : DRAG_SENSITIVITY;
  // Drag feels the same at every zoom level: scale by distance.
  const z = cam.z / FIELD_Z_START;
  field.tvx -= dx * k * z;
  field.tvy += dy * k * z;
  requestFrame();
}

export function fieldPan(dx: number, dy: number) {
  const z = cam.z / FIELD_Z_START;
  field.tvx += dx * 0.35 * z;
  field.tvy -= dy * 0.35 * z;
  requestFrame();
}

export function fieldZoom(delta: number) {
  field.zoomAccum += delta * ZOOM_SENSITIVITY;
  requestFrame();
}

export function railBy(d: number, snapNow = false) {
  if (!scene || scene.view === "field") return;
  const n = scene.clips.length;
  rail.target = clamp(rail.target + d, -0.45, n - 1 + 0.45);
  rail.lastInput = snapNow ? 0 : performance.now();
  if (snapNow) rail.target = clamp(Math.round(rail.target), 0, n - 1);
  requestFrame();
  // Under the demand loop, something has to wake the frame that performs the snap.
  if (!snapNow) setTimeout(requestFrame, RAIL_SNAP_MS + 16);
}

export function railTo(i: number) {
  if (!scene || scene.view === "field") return;
  rail.target = clamp(i, 0, scene.clips.length - 1);
  rail.lastInput = 0;
  requestFrame();
}

export function railDragging(v: boolean) {
  rail.dragging = v;
  rail.lastInput = performance.now();
  if (!v) setTimeout(requestFrame, RAIL_SNAP_MS + 16);
  requestFrame();
}

/** Pixel width of one step along the rail, so a drag moves the rail under the finger. */
export function railStepPx(): number {
  if (!scene) return 100;
  const W = railCard(scene.view);
  const step = scene.view === "flow" ? 0.2 * W : 0.3 * W;
  return (step / (2 * RAIL_DEPTH * TAN_HALF_FOV * vp.aspect)) * vp.w * (scene.view === "flow" ? 1.6 : 1);
}

export function railIndex(): number {
  return Math.round(cam.rail);
}

// ---- picking ------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickList: THREE.Object3D[] = [];

/** `forgiving`: a touch tap in the gap between field tiles still picks the nearest tile. */
export function pick(px: number, py: number, forgiving = false): Slot | null {
  if (!scene) return null;
  if (scene.view === "field") {
    // Camera is unrotated, so pixel -> cell is arithmetic. No raycasting over ~300 meshes.
    const halfH = cam.z * TAN_HALF_FOV;
    const halfW = halfH * vp.aspect;
    const wx = cam.x + ((px / vp.w) * 2 - 1) * halfW;
    const wy = cam.y + (1 - (py / vp.h) * 2) * halfH;
    const gx = Math.round(wx / FIELD_SPACING);
    const gy = Math.round(wy / FIELD_SPACING);
    if (!forgiving && (Math.abs(wx - gx * FIELD_SPACING) > TILE / 2 || Math.abs(wy - gy * FIELD_SPACING) > TILE / 2)) return null;
    const s = slots[mod(gx, poolCols) * poolRows + mod(gy, poolRows)];
    return s && s.key === (gx + KEY_BIAS) * 65536 + (gy + KEY_BIAS) ? s : null;
  }
  if (!camera) return null;
  // Rails draw ~30 cards at most, so a raycast over just those is cheap.
  pickList.length = 0;
  for (const s of slots) if (s && !Number.isNaN(s.key) && s.presence > 0.5) pickList.push(s.mesh);
  ndc.set((px / vp.w) * 2 - 1, 1 - (py / vp.h) * 2);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickList, false)[0];
  return (hit?.object.userData.slot as Slot | undefined) ?? null;
}

const corner = new THREE.Vector3();

/** Screen rect (CSS px) of the tile showing `name`, for the player's shared-element morph. */
export function rectOf(name: string): { x: number; y: number; w: number; h: number } | null {
  if (!camera) return null;
  let best: Slot | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    if (!s?.clip || s.clip.name !== name || Number.isNaN(s.key)) continue;
    const d = s.x * s.x + s.y * s.y;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (!best) return null;
  best.mesh.updateMatrixWorld();
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [cx, cy] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ]) {
    corner
      .set(cx * TILE, cy * TILE, 0)
      .applyMatrix4(best.mesh.matrixWorld)
      .project(camera);
    const sx = ((corner.x + 1) / 2) * vp.w;
    const sy = ((1 - corner.y) / 2) * vp.h;
    x0 = Math.min(x0, sx);
    y0 = Math.min(y0, sy);
    x1 = Math.max(x1, sx);
    y1 = Math.max(y1, sy);
  }
  if (x1 < 0 || y1 < 0 || x0 > vp.w || y0 > vp.h) return null;
  const rect = canvasEl?.getBoundingClientRect();
  return { x: x0 + (rect?.left ?? 0), y: y0 + (rect?.top ?? 0), w: x1 - x0, h: y1 - y0 };
}

// ---- the frame loop -----------------------------------------------------------------------

function stepField(dt: number): boolean {
  const f = field;
  const dz = f.zoomAccum * damp(SCROLL_TRANSFER, dt);
  f.tvz += dz;
  f.zoomAccum -= dz;
  f.tvx = clamp(f.tvx, -MAX_VEL, MAX_VEL);
  f.tvy = clamp(f.tvy, -MAX_VEL, MAX_VEL);
  f.tvz = clamp(f.tvz, -MAX_VEL, MAX_VEL);
  const k = damp(VEL_APPROACH, dt);
  f.vx += (f.tvx - f.vx) * k;
  f.vy += (f.tvy - f.vy) * k;
  f.vz += (f.tvz - f.vz) * k;
  cam.x += f.vx * dt;
  cam.y += f.vy * dt;
  const nz = clamp(cam.z + f.vz * dt, FIELD_Z_MIN, FIELD_Z_MAX);
  // At a zoom limit drop the velocity rather than letting it pile up against the clamp.
  if (nz === cam.z && f.vz !== 0) f.vz = f.tvz = f.zoomAccum = 0;
  cam.z = nz;
  const decay = Math.exp(-TARGET_DECAY * dt);
  f.tvx *= decay;
  f.tvy *= decay;
  f.tvz *= decay;
  const e = 0.01;
  return (
    Math.abs(f.vx) > e ||
    Math.abs(f.vy) > e ||
    Math.abs(f.vz) > e ||
    Math.abs(f.tvx) > e ||
    Math.abs(f.tvy) > e ||
    Math.abs(f.tvz) > e ||
    Math.abs(f.zoomAccum) > e
  );
}

function stepRail(dt: number, now: number): boolean {
  if (!scene) return false;
  const n = scene.clips.length;
  if (!rail.dragging && now - rail.lastInput >= RAIL_SNAP_MS) rail.target = clamp(Math.round(rail.target), 0, Math.max(0, n - 1));
  const diff = rail.target - cam.rail;
  if (Math.abs(diff) < 0.0005) {
    cam.rail = rail.target;
    return false;
  }
  cam.rail += diff * damp(rail.dragging ? 22 : RAIL_FOLLOW, dt);
  return true;
}

let lastCursor = false;

export function tick(rawDt: number, now: number): boolean {
  const dt = Math.min(rawDt, 1 / 30);
  let anim = false;

  if (pending && now - pending.at >= EXIT_MS) applyPending(now);
  if (!scene) return !!pending;

  // Physics keeps running under the player, so stepping clips there glides the rail behind it.
  if (scene.view === "field") anim = stepField(dt) || anim;
  else anim = stepRail(dt, now) || anim;

  // ---- 1. layout: visit wanted items, (re)assign slots, record targets ----
  stamp++;
  const sc = scene;
  visit(sc, cam, (key, idx, si) => {
    const s = slots[si];
    if (!s) return;
    s.stamp = stamp;
    s.tx = X.x;
    s.ty = X.y;
    s.tz = X.z;
    s.trx = X.rx;
    s.try = X.ry;
    s.ts = X.s;
    s.tvis = X.vis;
    if (s.key !== key || s.gen !== gen) {
      s.gen = gen;
      assign(s, key, idx, sc.clips[idx], now);
    }
  });
  firstFrame = false;
  for (const s of slots) if (s && s.stamp !== stamp && !Number.isNaN(s.key)) park(s);

  if (atlasDirty) {
    atlasDirty = false;
    for (const s of slots) {
      if (!s?.clip) continue;
      const a = atlasFor(s.clip.name, s.u.uAtlasRect.value);
      s.u.uAtlas.value = a.tex;
      s.atlasReady = a.ready;
    }
  }

  // ---- 2. hover + current ----
  const hovered = !locked && pointer.inside && pointer.mouse && !pointer.dragging ? pick(pointer.x, pointer.y) : null;
  hoverSlot = hovered;
  if (canvasEl && lastCursor !== !!hovered) {
    lastCursor = !!hovered;
    canvasEl.style.cursor = hovered ? "pointer" : "";
  }
  const railFront = sc.view !== "field" ? (sc.clips[Math.round(cam.rail)]?.name ?? null) : null;
  setCurrent(hovered?.clip?.name ?? railFront);

  // ---- 3. per-slot animation, LOD, material state ----
  for (let n = 0; n < UPLOADS_PER_FRAME && arrived.length; n++) {
    const a = arrived.shift();
    if (a && a.s.posterUrl === a.url) a.s.posterTex = a.tex;
  }
  if (arrived.length) anim = true;
  const kPresence = damp(pending ? (1000 / EXIT_MS) * 2.2 : 8, dt);
  const kHover = damp(14, dt);
  const kMix = damp(9, dt);
  const fast = sc.view === "field" ? Math.hypot(field.vx, field.vy) > 14 : Math.abs(rail.target - cam.rail) > 0.8;
  // Only the field grows a hovered tile; rail cards overlap, so they brighten instead (shader).
  const isField = sc.view === "field";
  const hoverAmt = isField ? FIELD_HOVER_SCALE - 1 : 0;
  const morphing = now - morphStart < MORPH_MS + MORPH_STAGGER_MS;
  if (morphing) anim = true;

  for (const s of slots) {
    if (!s || Number.isNaN(s.key) || !s.clip) continue;

    // transform
    if (s.morphing) {
      const t = (now - morphStart - s.delay) / MORPH_MS;
      const e = easeOut(clamp(t, 0, 1));
      s.x = s.fx + (s.tx - s.fx) * e;
      s.y = s.fy + (s.ty - s.fy) * e;
      s.z = s.fz + (s.tz - s.fz) * e;
      s.rx = s.frx + (s.trx - s.frx) * e;
      s.ry = s.fry + (s.try - s.fry) * e;
      s.s = s.fs + (s.ts - s.fs) * e;
      const target = s.atlasReady || s.posterTex ? s.tvis : 0;
      s.presence = s.fo + (target - s.fo) * e;
      if (t >= 1) s.morphing = false;
    } else {
      s.x = s.tx;
      s.y = s.ty;
      s.z = s.tz;
      s.rx = s.trx;
      s.ry = s.try;
      s.s = s.ts;
    }

    // presence: layout visibility x texture ready x not hidden x not leaving
    const leaving = pending !== null && !pending.keep.has(s.clip.name);
    const want = leaving || s.clip.name === hidden ? 0 : s.atlasReady || s.posterTex ? s.tvis : 0;
    if (!s.morphing || leaving) {
      const d = want - s.presence;
      if (Math.abs(d) > 0.002) {
        s.presence += d * kPresence;
        anim = true;
      } else s.presence = want;
    }
    if (s.clip.name === hidden) s.presence = 0;

    // hover
    const hv = s === hoverSlot ? 1 : 0;
    if (Math.abs(hv - s.hover) > 0.002) {
      s.hover += (hv - s.hover) * kHover;
      anim = true;
    } else s.hover = hv;

    // LOD: swap the atlas cell for the real poster once the tile is big on screen and not flying past.
    // Only tiles actually on screen upgrade; the margin rings stay on the atlas until they arrive.
    const halfH = -s.z * TAN_HALF_FOV;
    const onScreen = Math.abs(s.x) < halfH * vp.aspect + TILE * s.s * 0.5 && Math.abs(s.y) < halfH + TILE * s.s * 0.5;
    const px = ((TILE * s.s) / (2 * halfH)) * vp.h * vp.dpr;
    const wantsPoster = !s.posterUrl && s.presence > 0.01 && px > POSTER_MIN_PX && onScreen;
    // Deferred only while flying or morphing. Keep the demand loop ticking until it isn't, or a
    // tile that settles without further input would stay on its 96px atlas cell forever.
    if (wantsPoster && (fast || morphing)) anim = true;
    if (!s.posterUrl && s.presence > 0.01 && (s === hoverSlot || (wantsPoster && !fast && !morphing))) {
      const url = posterUrl(s.clip);
      s.posterUrl = url;
      acquirePoster(url).then((tex) => {
        if (s.posterUrl !== url) {
          releasePoster(url);
          return;
        }
        arrived.push({ s, url, tex });
        requestFrame();
      });
    }

    // texture selection: video > poster > atlas
    const u = s.u;
    if (s.videoTex && s.videoReady) {
      u.uMap.value = s.videoTex;
      u.uMapRect.value.set(s.videoTex.offset.x, s.videoTex.offset.y, s.videoTex.repeat.x, s.videoTex.repeat.y);
      u.uMix.value = 1;
    } else if (s.posterTex) {
      if (u.uMap.value !== s.posterTex) {
        u.uMap.value = s.posterTex;
        u.uMapRect.value.set(s.posterTex.offset.x, s.posterTex.offset.y, s.posterTex.repeat.x, s.posterTex.repeat.y);
      }
      // A poster arriving for a tile that was already on screen crossfades from the atlas cell.
      const target = 1;
      if (s.posterMix < 0.999) {
        s.posterMix = s.atlasReady ? s.posterMix + (target - s.posterMix) * kMix : 1;
        anim = true;
      } else s.posterMix = 1;
      u.uMix.value = s.posterMix;
    } else {
      u.uMix.value = 0;
    }
    u.uOpacity.value = s.presence;

    // write the mesh
    const visible = s.presence > 0.003;
    s.mesh.visible = visible;
    s.refl.visible = visible && sc.view === "flow";
    if (!visible) continue;
    const scale = s.s * (1 + hoverAmt * s.hover);
    s.mesh.position.set(s.x, s.y, s.z + (isField ? 0.02 * s.hover : 0));
    s.mesh.rotation.set(s.rx, s.ry, 0);
    s.mesh.scale.setScalar(scale);
    s.mesh.updateMatrix();

    // A settled tile renders in the opaque pass with depth writes (early-Z, no sorting). Only
    // fading or hover-enlarged tiles, which overlap neighbours, need blending.
    const opaque = s.presence >= 0.999 && (!isField || s.hover < 0.001);
    if (s.mat.transparent === opaque) {
      s.mat.transparent = !opaque;
      s.mat.depthWrite = opaque;
    }
    s.mesh.renderOrder = isField && s.hover > 0.001 ? 1 : 0;
    u.uHover.value = isField ? 0 : s.hover;
  }

  // ---- 4. video: the hovered tile in the field, the front card on a rail ----
  if (locked) stopVideo();
  else {
    let vs: Slot | null = null;
    if (sc.view === "field") vs = hoverSlot;
    else if (!rail.dragging && Math.abs(rail.target - cam.rail) < 0.05) {
      const idx = Math.round(cam.rail);
      for (const s of slots) if (s && s.index === idx && !Number.isNaN(s.key) && s.presence > 0.5) vs = s;
    }
    armVideo(vs, vs ? vs.videoKey : null, vs?.clip ?? null);
  }
  if (needsManualPump() && pumpVideo()) anim = true;

  return anim || pending !== null;
}
