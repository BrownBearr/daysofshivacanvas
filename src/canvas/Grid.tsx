import * as React from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ClipData } from "../types";
import { GRID_COLS, TILE_SPACING, PLAY_COUNT, VISIBLE_MARGIN_TILES } from "../theme";
import { cameraState } from "./camera-state";
import { Tile } from "./Tile";

interface GridProps {
  clips: ClipData[];
}

// One mounted lattice cell. `key` ("gx:gy") is the cell's identity — the same clip can appear in
// many cells once the grid wraps, so identity is positional, not clip-based.
interface CellEntry {
  key: string;
  clip: ClipData;
  worldX: number;
  worldY: number;
}

interface Bounds {
  gxMin: number;
  gxMax: number;
  gyMin: number;
  gyMax: number;
}

// Recompute the play set once the camera drifts half a tile from where it was last computed.
const PLAY_RECOMPUTE_DIST_SQ = (TILE_SPACING * 0.5) ** 2;

export function Grid({ clips }: GridProps) {
  const { camera, size } = useThree();
  const total = clips.length;
  const cols = GRID_COLS;
  const rows = Math.max(1, Math.ceil(total / cols));

  // Map an infinite lattice cell to a clip by wrapping into the base cols×rows block.
  // `% total` fills the partial last row so every cell resolves to a video (no white space).
  const clipAt = React.useCallback(
    (gx: number, gy: number): ClipData => {
      const localCol = ((gx % cols) + cols) % cols;
      const localRow = ((gy % rows) + rows) % rows;
      return clips[(localRow * cols + localCol) % total];
    },
    [clips, total, cols, rows]
  );

  // Integer cell bounds covering the camera frustum (at the current z) plus a margin ring.
  const computeBounds = React.useCallback((): Bounds => {
    const fovRad = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const halfH = Math.abs(cameraState.pos.z) * Math.tan(fovRad / 2);
    const aspect = size.width / Math.max(1, size.height);
    const halfW = halfH * aspect;
    const m = VISIBLE_MARGIN_TILES;
    return {
      gxMin: Math.floor((cameraState.pos.x - halfW) / TILE_SPACING) - m,
      gxMax: Math.ceil((cameraState.pos.x + halfW) / TILE_SPACING) + m,
      gyMin: Math.floor((cameraState.pos.y - halfH) / TILE_SPACING) - m,
      gyMax: Math.ceil((cameraState.pos.y + halfH) / TILE_SPACING) + m,
    };
  }, [camera, size]);

  const buildCells = React.useCallback(
    (b: Bounds): CellEntry[] => {
      const out: CellEntry[] = [];
      for (let gy = b.gyMin; gy <= b.gyMax; gy++) {
        for (let gx = b.gxMin; gx <= b.gxMax; gx++) {
          out.push({
            key: `${gx}:${gy}`,
            clip: clipAt(gx, gy),
            worldX: gx * TILE_SPACING,
            worldY: gy * TILE_SPACING,
          });
        }
      }
      return out;
    },
    [clipAt]
  );

  // The PLAY_COUNT cells nearest the camera get a real <video>; the rest stay posters.
  const computePlaySet = React.useCallback((list: CellEntry[]): Set<string> => {
    if (PLAY_COUNT <= 0) return new Set();
    const px = cameraState.pos.x;
    const py = cameraState.pos.y;
    return new Set(
      list
        .map((c) => ({ k: c.key, d: (c.worldX - px) ** 2 + (c.worldY - py) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, PLAY_COUNT)
        .map((e) => e.k)
    );
  }, []);

  const [cells, setCells] = React.useState<CellEntry[]>([]);
  const [playSet, setPlaySet] = React.useState<Set<string>>(new Set());

  const lastBounds = React.useRef<Bounds>({ gxMin: NaN, gxMax: NaN, gyMin: NaN, gyMax: NaN });
  const lastPlayPos = React.useRef({ x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY });

  // Seed (and re-seed on resize / clip-set change) from the camera's current position.
  React.useEffect(() => {
    const b = computeBounds();
    lastBounds.current = b;
    const list = buildCells(b);
    lastPlayPos.current = { x: cameraState.pos.x, y: cameraState.pos.y };
    setCells(list);
    setPlaySet(computePlaySet(list));
  }, [computeBounds, buildCells, computePlaySet]);

  useFrame(() => {
    const b = computeBounds();
    const lb = lastBounds.current;
    const boundsChanged =
      b.gxMin !== lb.gxMin || b.gxMax !== lb.gxMax || b.gyMin !== lb.gyMin || b.gyMax !== lb.gyMax;

    let list = cells;
    if (boundsChanged) {
      lastBounds.current = b;
      list = buildCells(b);
      setCells(list);
    }

    const dx = cameraState.pos.x - lastPlayPos.current.x;
    const dy = cameraState.pos.y - lastPlayPos.current.y;
    if (boundsChanged || dx * dx + dy * dy > PLAY_RECOMPUTE_DIST_SQ) {
      lastPlayPos.current = { x: cameraState.pos.x, y: cameraState.pos.y };
      setPlaySet(computePlaySet(list));
    }
  });

  if (!total) return <group />;

  return (
    <group>
      {cells.map((c) => (
        <Tile
          key={c.key}
          tileKey={c.key}
          clip={c.clip}
          position={[c.worldX, c.worldY, 0]}
          inPlayRadius={playSet.has(c.key)}
        />
      ))}
    </group>
  );
}
