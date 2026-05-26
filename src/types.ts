export interface ClipData {
  id: number;
  name: string; // clip number; all B2 asset URLs are derived from this (see lib/clip-source)
}

export interface TileData {
  tileIndex: number; // position in the 3×3 (or N×M) grid
  clipId: number;
  col: number;
  row: number;
  worldX: number;
  worldY: number;
}
