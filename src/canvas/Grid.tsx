import * as React from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ClipData } from "../types";
import { GRID_COLS, TILE_SPACING, VISIBLE_MARGIN_TILES } from "../theme";
import { cameraState } from "./camera-state";
import { Tile } from "./Tile";

interface GridProps {
  clips: ClipData[];
}

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

export function Grid({ clips }: GridProps) {
  const { camera, size } = useThree();
  const total = clips.length;
  const cols = GRID_COLS;
  const rows = Math.max(1, Math.ceil(total / cols));

  const clipAt = React.useCallback(
    (gx: number, gy: number): ClipData => {
      const localCol = ((gx % cols) + cols) % cols;
      const localRow = ((gy % rows) + rows) % rows;
      return clips[(localRow * cols + localCol) % total];
    },
    [clips, total, cols, rows]
  );

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

  const [cells, setCells] = React.useState<CellEntry[]>([]);
  const lastBounds = React.useRef<Bounds>({ gxMin: NaN, gxMax: NaN, gyMin: NaN, gyMax: NaN });

  // Seed cells on mount and whenever the clip set or camera projection changes.
  React.useEffect(() => {
    const b = computeBounds();
    lastBounds.current = b;
    setCells(buildCells(b));
  }, [computeBounds, buildCells]);

  // Update the visible cell set as the camera moves — no play-set tracking needed since
  // video decode is driven entirely by hover/focus, not proximity.
  useFrame(() => {
    const b = computeBounds();
    const lb = lastBounds.current;
    if (b.gxMin !== lb.gxMin || b.gxMax !== lb.gxMax || b.gyMin !== lb.gyMin || b.gyMax !== lb.gyMax) {
      lastBounds.current = b;
      // startTransition defers tile mount/unmount reconciliation so it doesn't block
      // the animation frame that triggered the frustum boundary crossing.
      React.startTransition(() => setCells(buildCells(b)));
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
          x={c.worldX}
          y={c.worldY}
        />
      ))}
    </group>
  );
}
