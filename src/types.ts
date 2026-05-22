export interface ClipData {
  id: number;
  name: string;
  preview: string;
  poster: string;
}

export interface TileData {
  tileIndex: number; // position in the 3×3 (or N×M) grid
  clipId: number;
  col: number;
  row: number;
  worldX: number;
  worldY: number;
}
