import { useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import { setPosterCacheCap } from "../lib/poster-cache";
import { IS_MOBILE } from "../runtime";
import { CAMERA_FOV, GRID_COLS, HOVER_SCALE, MAX_CAM_Z, TILE_H, TILE_SPACING, TILE_W, VISIBLE_MARGIN_TILES } from "../theme";
import type { ClipData } from "../types";
import { cameraState, focusTile, markInput, setHover, unfocusTile } from "./camera-state";
import { assignCell, parkSlot, slots } from "./slot";
import { Tile } from "./Tile";
import { armVideo, needsManualPump, pumpVideo, stopVideo } from "./tile-video";

const DEG2RAD = Math.PI / 180;

// Exponential-smoothing rates, in "per second" so the feel is identical at 30, 60 and 144Hz.
const OPACITY_LAMBDA = 7;
const SCALE_LAMBDA = 16;
const SETTLED = 0.002;

// Minimum gap between slot reassignments. At the clamped top pan speed the camera covers a bit
// under one tile in this window, so with VISIBLE_MARGIN_TILES rings of slack the deferral is never
// visible — but it stops a hard fling from rebuilding the window on every single frame.
const MIN_ASSIGN_MS = 24;

const mod = (n: number, m: number) => ((n % m) + m) % m;

interface Bounds {
  gxMin: number;
  gxMax: number;
  gyMin: number;
  gyMax: number;
}

/**
 * The infinite tile lattice.
 *
 * Owns everything that used to be spread across ~200 <Tile> components: the visible-window layout,
 * hover detection, video playback, and the animation loop. React's only job here is to mount a
 * fixed pool of meshes once per viewport size; panning and zooming touch no React state at all.
 */
export function Grid({ clips }: { clips: ClipData[] }) {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);

  const total = clips.length;
  const rows = Math.max(1, Math.ceil(total / GRID_COLS));

  // Wrap a lattice coordinate onto the clip list. The grid is toroidal, so the archive repeats
  // rather than ending.
  const clipAt = React.useCallback(
    (gx: number, gy: number): ClipData => {
      const col = mod(gx, GRID_COLS);
      const row = mod(gy, rows);
      return clips[(row * GRID_COLS + col) % total];
    },
    [clips, total, rows]
  );

  // The pool is sized for the worst case — fully zoomed out at this viewport — and then fixed, so
  // zooming in just parks the slots it doesn't need instead of unmounting them.
  const dims = React.useMemo(() => {
    const halfH = MAX_CAM_Z * Math.tan((CAMERA_FOV * DEG2RAD) / 2);
    const halfW = halfH * (size.width / Math.max(1, size.height));
    const cols = Math.ceil(halfW / TILE_SPACING) - Math.floor(-halfW / TILE_SPACING) + 1 + 2 * VISIBLE_MARGIN_TILES;
    const rowCount = Math.ceil(halfH / TILE_SPACING) - Math.floor(-halfH / TILE_SPACING) + 1 + 2 * VISIBLE_MARGIN_TILES;
    return { cols, rows: rowCount, count: cols * rowCount };
  }, [size.width, size.height]);

  // Poster textures are ~1.5MB each with mipmaps, so the cap is real VRAM. It has to clear the
  // worst-case visible count or eviction would fight the live grid.
  React.useEffect(() => {
    setPosterCacheCap(dims.count + 48);
  }, [dims.count]);

  React.useEffect(() => stopVideo, []);

  const used = React.useRef<Uint8Array>(new Uint8Array(0));
  if (used.current.length !== dims.count) used.current = new Uint8Array(dims.count);

  const lastBounds = React.useRef<Bounds>({ gxMin: NaN, gxMax: NaN, gyMin: NaN, gyMax: NaN });
  const lastAssignAt = React.useRef(0);
  const pointer = React.useRef({ x: 0, y: 0, inside: false });
  const cursorPointer = React.useRef(false);

  // Reassigning cells to slots is the only layout work, and it only touches slots whose cell
  // actually changed — a one-column shift dirties one column, not the whole window.
  const assign = React.useCallback(
    (b: Bounds) => {
      const { cols, rows: rowCount, count } = dims;
      const flags = used.current;
      flags.fill(0);

      for (let gy = b.gyMin; gy <= b.gyMax; gy++) {
        if (gy - b.gyMin >= rowCount) break;
        for (let gx = b.gxMin; gx <= b.gxMax; gx++) {
          if (gx - b.gxMin >= cols) break;
          const si = mod(gx, cols) * rowCount + mod(gy, rowCount);
          const slot = slots[si];
          if (!slot) continue;
          flags[si] = 1;
          assignCell(slot, gx, gy, clipAt(gx, gy), TILE_SPACING);
        }
      }

      for (let i = 0; i < count; i++) {
        if (flags[i]) continue;
        const slot = slots[i];
        if (slot) parkSlot(slot);
      }
    },
    [dims, clipAt]
  );

  // Force a full reassignment when the clip set is regrouped or the pool is resized. The body reads
  // nothing from `assign`, but `assign` changing is exactly the signal that the layout inputs (clip
  // ordering, pool dimensions) moved and the cached window has to be thrown away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: depends on `assign` as a change signal, not a value it reads.
  React.useEffect(() => {
    lastBounds.current = { gxMin: NaN, gxMax: NaN, gyMin: NaN, gyMax: NaN };
    lastAssignAt.current = 0;
    invalidate();
  }, [assign, invalidate]);

  // Screen pixel -> lattice cell. The camera is axis-aligned and unrotated, so the mapping onto the
  // z=0 plane is linear and this replaces raycasting entirely: R3F's event system was testing every
  // one of ~200 tile meshes on every pointermove, allocating an array per test.
  const cellAtPixel = React.useCallback(
    (px: number, py: number): { gx: number; gy: number } | null => {
      const halfH = cameraState.pos.z * Math.tan((CAMERA_FOV * DEG2RAD) / 2);
      const halfW = halfH * (size.width / Math.max(1, size.height));
      const wx = cameraState.pos.x + ((px / size.width) * 2 - 1) * halfW;
      const wy = cameraState.pos.y + (-(py / size.height) * 2 + 1) * halfH;
      const gx = Math.round(wx / TILE_SPACING);
      const gy = Math.round(wy / TILE_SPACING);
      // Reject the gaps between tiles so hovering the background reads as no tile.
      if (Math.abs(wx - gx * TILE_SPACING) > TILE_W / 2) return null;
      if (Math.abs(wy - gy * TILE_SPACING) > TILE_H / 2) return null;
      return { gx, gy };
    },
    [size.width, size.height]
  );

  React.useEffect(() => {
    const canvas = gl.domElement;

    const onPointerMove = (e: PointerEvent) => {
      pointer.current.x = e.offsetX;
      pointer.current.y = e.offsetY;
      pointer.current.inside = true;
      markInput();
      // Hover is resolved in the frame loop so it also tracks the camera moving under a
      // stationary cursor; this only needs to request the frame that does it.
      invalidate();
    };

    const onPointerLeave = () => {
      pointer.current.inside = false;
      invalidate();
    };

    const onClick = (e: MouseEvent) => {
      markInput();
      // A drag that happens to end over a tile is not a click.
      if (cameraState.isDragging) return;
      if (cameraState.focusedTileId !== null) {
        unfocusTile();
        return;
      }
      const cell = cellAtPixel(e.offsetX, e.offsetY);
      if (!cell) return;
      const clip = clipAt(cell.gx, cell.gy);
      focusTile(`${cell.gx}:${cell.gy}`, clip.name, clip);
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);
    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, [gl, cellAtPixel, clipAt, invalidate]);

  useFrame((_state, rawDelta) => {
    // Under `frameloop="demand"` the gap since the last rendered frame can be arbitrarily long, so
    // an unclamped delta would make every animation jump on the first frame after an idle period.
    const delta = Math.min(rawDelta, 1 / 30);
    const now = performance.now();

    // ---- 1. layout ----------------------------------------------------------------------
    const halfH = cameraState.pos.z * Math.tan((CAMERA_FOV * DEG2RAD) / 2);
    const halfW = halfH * (size.width / Math.max(1, size.height));
    const m = VISIBLE_MARGIN_TILES;
    const gxMin = Math.floor((cameraState.pos.x - halfW) / TILE_SPACING) - m;
    const gxMax = Math.ceil((cameraState.pos.x + halfW) / TILE_SPACING) + m;
    const gyMin = Math.floor((cameraState.pos.y - halfH) / TILE_SPACING) - m;
    const gyMax = Math.ceil((cameraState.pos.y + halfH) / TILE_SPACING) + m;

    const lb = lastBounds.current;
    if (
      (gxMin !== lb.gxMin || gxMax !== lb.gxMax || gyMin !== lb.gyMin || gyMax !== lb.gyMax) &&
      now - lastAssignAt.current >= MIN_ASSIGN_MS
    ) {
      lb.gxMin = gxMin;
      lb.gxMax = gxMax;
      lb.gyMin = gyMin;
      lb.gyMax = gyMax;
      lastAssignAt.current = now;
      assign(lb);
    }

    // ---- 2. hover -----------------------------------------------------------------------
    let hoverKey: string | null = null;
    let hoverClip: ClipData | null = null;
    if (!IS_MOBILE && pointer.current.inside && !cameraState.isDragging && cameraState.focusedTileId === null) {
      const cell = cellAtPixel(pointer.current.x, pointer.current.y);
      if (cell) {
        hoverKey = `${cell.gx}:${cell.gy}`;
        hoverClip = clipAt(cell.gx, cell.gy);
      }
    }
    setHover(hoverKey, hoverClip?.name ?? null);
    if (cursorPointer.current !== (hoverKey !== null)) {
      cursorPointer.current = hoverKey !== null;
      gl.domElement.style.cursor = cursorPointer.current ? "pointer" : "";
    }

    // ---- 3. per-slot animation and texture selection ------------------------------------
    let animating = false;
    const kOpacity = 1 - Math.exp(-OPACITY_LAMBDA * delta);
    const kScale = 1 - Math.exp(-SCALE_LAMBDA * delta);
    let hoverSlot: (typeof slots)[number] = null;

    for (let i = 0; i < dims.count; i++) {
      const s = slots[i];
      if (!s) continue;

      if (s.cellKey === null) {
        if (s.mesh.visible) s.mesh.visible = false;
        continue;
      }

      s.hovered = s.cellKey === hoverKey;
      if (s.hovered) hoverSlot = s;

      // The video texture only takes over once it has decoded a frame, so the swap never flashes
      // an empty black quad over the poster.
      const want = s.videoTex && s.videoReady ? s.videoTex : s.posterTex;
      if (s.mat.map !== want) {
        const hadMap = s.mat.map !== null;
        s.mat.map = want;
        // Gaining or losing a map toggles USE_MAP and needs a program rebuild. Swapping between
        // two textures does not, and forcing needsUpdate there would recompile the shader.
        if (hadMap !== (want !== null)) s.mat.needsUpdate = true;
      }

      const targetOpacity = want ? 1 : 0;
      if (Math.abs(targetOpacity - s.opacity) > SETTLED) {
        s.opacity += (targetOpacity - s.opacity) * kOpacity;
        animating = true;
      } else {
        s.opacity = targetOpacity;
      }

      const targetScale = s.hovered ? HOVER_SCALE : 1;
      if (Math.abs(targetScale - s.scale) > SETTLED) {
        s.scale += (targetScale - s.scale) * kScale;
        animating = true;
      } else {
        s.scale = targetScale;
      }

      s.mat.opacity = s.opacity;
      const visible = s.opacity > SETTLED;
      if (s.mesh.visible !== visible) s.mesh.visible = visible;

      // A fully faded, unscaled tile can be opaque: that drops it out of the sorted transparent
      // pass and lets it depth-write, so the steady-state grid gets early-Z instead of blending
      // ~200 quads back-to-front every frame. Only a fading or hover-scaled tile needs blending
      // (a 1.3x tile is wider than the 1.12x spacing, so it genuinely overlaps its neighbours).
      const opaque = s.opacity >= 0.999 && s.scale <= 1.001;
      if (s.mat.transparent === opaque) {
        // Note: no needsUpdate — these change render-list membership and GL state, not the shader.
        s.mat.transparent = !opaque;
        s.mat.depthWrite = opaque;
      }

      if (s.mesh.scale.x !== s.scale) {
        s.mesh.scale.setScalar(s.scale);
        // Lift and re-order a scaled tile so it draws over its neighbours rather than tying with
        // them at z=0.
        const raised = s.scale > 1.001;
        s.mesh.position.z = raised ? 0.01 : 0;
        s.mesh.renderOrder = raised ? 1 : 0;
        s.mesh.updateMatrix();
      }
    }

    // ---- 4. video -----------------------------------------------------------------------
    if (cameraState.focusedTileId !== null) {
      // The DOM overlay plays the focused clip at full quality; keeping the tile's own decode
      // alive behind it was decoding the same clip twice.
      stopVideo();
    } else {
      armVideo(hoverSlot, hoverKey, hoverClip);
    }
    if (needsManualPump() && pumpVideo()) animating = true;

    if (animating) invalidate();
  });

  if (!total) return null;

  return (
    <group>
      {/* Tiles are a fixed pool keyed by slot, not a list of content: cells are reassigned to
          slots rather than reordered, so the array index genuinely is the stable identity here.
          Keying by anything else would remount the pool on every pan, which is the exact cost
          this design exists to remove. */}
      {Array.from({ length: dims.count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the slot index is the tile's stable identity.
        <Tile key={i} slotIndex={i} />
      ))}
    </group>
  );
}
