import * as React from "react";
import { useFrame } from "@react-three/fiber";
import type { ClipData } from "../types";
import { GRID_COLS, TILE_SPACING, CHUNK_SIZE, RENDER_CHUNKS, PLAY_RADIUS_CHUNKS } from "../theme";
import { cameraState } from "./camera-state";
import { Tile } from "./Tile";

interface TileEntry {
  tileIndex: number;
  clip: ClipData;
  worldX: number;
  worldY: number;
}

interface GridProps {
  clips: ClipData[];
}

// Build the full tile list from the clips manifest (Phase 1: repeat clips to fill 3×3)
function buildTiles(clips: ClipData[]): TileEntry[] {
  const total = GRID_COLS * GRID_COLS; // 3×3 = 9 for Phase 1
  const tiles: TileEntry[] = [];
  const rows = Math.ceil(total / GRID_COLS);
  const gridW = GRID_COLS * TILE_SPACING;
  const gridH = rows * TILE_SPACING;

  for (let i = 0; i < total; i++) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    tiles.push({
      tileIndex: i,
      clip: clips[i % clips.length],
      worldX: col * TILE_SPACING - gridW / 2 + TILE_SPACING / 2,
      worldY: -(row * TILE_SPACING - gridH / 2 + TILE_SPACING / 2),
    });
  }
  return tiles;
}

export function Grid({ clips }: GridProps) {
  const tiles = React.useMemo(() => buildTiles(clips), [clips]);
  const [visibleSet, setVisibleSet] = React.useState<Set<number>>(new Set());
  const [playSet, setPlaySet] = React.useState<Set<number>>(new Set());
  const lastChunkKey = React.useRef("");

  useFrame(() => {
    const cx = Math.round(cameraState.pos.x / CHUNK_SIZE);
    const cy = Math.round(cameraState.pos.y / CHUNK_SIZE);
    const key = `${cx},${cy}`;
    if (key === lastChunkKey.current) return;
    lastChunkKey.current = key;

    const newVisible = new Set<number>();
    const newPlay = new Set<number>();

    for (const tile of tiles) {
      const tcx = Math.round(tile.worldX / CHUNK_SIZE);
      const tcy = Math.round(tile.worldY / CHUNK_SIZE);
      const dist = Math.max(Math.abs(tcx - cx), Math.abs(tcy - cy));
      if (dist <= RENDER_CHUNKS) newVisible.add(tile.tileIndex);
      if (dist <= PLAY_RADIUS_CHUNKS) newPlay.add(tile.tileIndex);
    }

    setVisibleSet(newVisible);
    setPlaySet(newPlay);
  });

  // On first mount show everything (small Phase 1 grid fits in one chunk)
  React.useEffect(() => {
    setVisibleSet(new Set(tiles.map((t) => t.tileIndex)));
    setPlaySet(new Set(tiles.map((t) => t.tileIndex)));
  }, [tiles]);

  return (
    <group>
      {tiles
        .filter((t) => visibleSet.has(t.tileIndex))
        .map((t) => (
          <Tile
            key={t.tileIndex}
            tileIndex={t.tileIndex}
            clip={t.clip}
            position={[t.worldX, t.worldY, 0]}
            inPlayRadius={playSet.has(t.tileIndex)}
          />
        ))}
    </group>
  );
}
