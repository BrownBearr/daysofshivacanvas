// Similarity ordering for the grid. clip-order.json (produced by
// `scripts/tag-styles.py arrange`) lists every clip name in an order such that,
// laid out row-major over the GRID_COLS-wide grid, visually-similar clips become
// neighbors. The grid already maps array index -> cell, so reordering the clips
// array is all that's needed — no renderer changes.
import orderData from "../data/clip-order.json";
import type { ClipData } from "../types";

// View selections used across main.tsx and Chrome.tsx.
export const SHUFFLE_VIEW = "__shuffle";
export const SIMILARITY_VIEW = "__similarity";

// name -> position in the similarity ordering.
const rank = new Map<string, number>(orderData.order.map((name, i) => [name, i]));

// Reorder clips to the precomputed similarity layout. Any clip missing from the
// ordering (e.g. added to clips.json before `arrange` was re-run) sorts to the end.
export function arrangeBySimilarity(clips: ClipData[]): ClipData[] {
  return clips.slice().sort((a, b) => {
    const ra = rank.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}
