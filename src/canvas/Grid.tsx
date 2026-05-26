import * as React from "react";
import { useFrame } from "@react-three/fiber";
import type { ClipData } from "../types";
import { GRID_COLS, TILE_SPACING, CHUNK_SIZE, RENDER_CHUNKS, PLAY_COUNT } from "../theme";
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

function buildTiles(clips: ClipData[]): TileEntry[] {
  const total = clips.length;
  const cols = GRID_COLS;
  const rows = Math.ceil(total / cols);
  const gridW = cols * TILE_SPACING;
  const gridH = rows * TILE_SPACING;
  const tiles: TileEntry[] = [];

  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    tiles.push({
      tileIndex: i,
      clip: clips[i],
      worldX: col * TILE_SPACING - gridW / 2 + TILE_SPACING / 2,
      worldY: -(row * TILE_SPACING - gridH / 2 + TILE_SPACING / 2),
    });
  }
  return tiles;
}

// Tiles within RENDER_CHUNKS of the camera chunk are mounted/painted.
function computeVisible(tiles: TileEntry[]): TileEntry[] {
  const cx = Math.round(cameraState.pos.x / CHUNK_SIZE);
  const cy = Math.round(cameraState.pos.y / CHUNK_SIZE);
  return tiles.filter((t) => {
    const tcx = Math.round(t.worldX / CHUNK_SIZE);
    const tcy = Math.round(t.worldY / CHUNK_SIZE);
    return Math.max(Math.abs(tcx - cx), Math.abs(tcy - cy)) <= RENDER_CHUNKS;
  });
}

// The PLAY_COUNT visible tiles closest to the camera get a real <video>; the rest stay posters.
function computePlaySet(visible: TileEntry[]): Set<number> {
  if (PLAY_COUNT <= 0) return new Set();
  const px = cameraState.pos.x;
  const py = cameraState.pos.y;
  return new Set(
    visible
      .map((t) => ({ i: t.tileIndex, d: (t.worldX - px) ** 2 + (t.worldY - py) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, PLAY_COUNT)
      .map((e) => e.i)
  );
}

const PLAY_RECOMPUTE_DIST_SQ = (TILE_SPACING * 0.5) ** 2;

export function Grid({ clips }: GridProps) {
  const tiles = React.useMemo(() => buildTiles(clips), [clips]);
  const [visibleSet, setVisibleSet] = React.useState<Set<number>>(new Set());
  const [playSet, setPlaySet] = React.useState<Set<number>>(new Set());

  // Refs let the frame loop recompute without depending on React state snapshots.
  const visibleTilesRef = React.useRef<TileEntry[]>([]);
  const lastChunkKey = React.useRef("");
  const lastPlayPos = React.useRef({ x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY });

  // Seed visible/play sets from the camera's starting position.
  React.useEffect(() => {
    const vis = computeVisible(tiles);
    visibleTilesRef.current = vis;
    lastChunkKey.current = `${Math.round(cameraState.pos.x / CHUNK_SIZE)},${Math.round(cameraState.pos.y / CHUNK_SIZE)}`;
    lastPlayPos.current = { x: cameraState.pos.x, y: cameraState.pos.y };
    setVisibleSet(new Set(vis.map((t) => t.tileIndex)));
    setPlaySet(computePlaySet(vis));
  }, [tiles]);

  useFrame(() => {
    const cx = Math.round(cameraState.pos.x / CHUNK_SIZE);
    const cy = Math.round(cameraState.pos.y / CHUNK_SIZE);
    const chunkKey = `${cx},${cy}`;

    let visibleChanged = false;
    if (chunkKey !== lastChunkKey.current) {
      lastChunkKey.current = chunkKey;
      const vis = computeVisible(tiles);
      visibleTilesRef.current = vis;
      setVisibleSet(new Set(vis.map((t) => t.tileIndex)));
      visibleChanged = true;
    }

    const dx = cameraState.pos.x - lastPlayPos.current.x;
    const dy = cameraState.pos.y - lastPlayPos.current.y;
    if (visibleChanged || dx * dx + dy * dy > PLAY_RECOMPUTE_DIST_SQ) {
      lastPlayPos.current = { x: cameraState.pos.x, y: cameraState.pos.y };
      setPlaySet(computePlaySet(visibleTilesRef.current));
    }
  });

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
