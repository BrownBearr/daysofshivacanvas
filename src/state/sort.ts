// Sort + filter: (all clips, settings) -> the ordered list every view lays out. Pure.

import orderData from "../data/clip-order.json";
import stylesData from "../data/clip-styles.json";
import clipsData from "../data/clips.json";
import type { ClipData, SortDir, SortId } from "../types";

export const ALL_CLIPS: ClipData[] = clipsData.clips;

export interface StyleCluster {
  id: number;
  label: string;
  count: number;
}

// Cluster -1 is "didn't fit anywhere"; it sorts last and is labelled plainly.
export const STYLE_CLUSTERS: StyleCluster[] = stylesData.clusters
  .map((c) => ({ id: c.id, label: c.id === -1 ? "unsorted" : c.style, count: c.count }))
  .sort((a, b) => (a.id === -1 ? 1 : b.id === -1 ? -1 : b.count - a.count));

const clusterOf = new Map<string, number>(stylesData.images.map((im) => [im.name, im.cluster]));
const similarRank = new Map<string, number>(orderData.order.map((name, i) => [name, i]));
const dayOf = (c: ClipData) => Number(c.name) || 0;

export function styleOf(name: string): number {
  return clusterOf.get(name) ?? -1;
}

export function styleLabel(name: string): string {
  const id = styleOf(name);
  return STYLE_CLUSTERS.find((c) => c.id === id)?.label ?? "unsorted";
}

// Deterministic shuffle so a given seed always gives the same order (stable across re-renders and
// sort toggles; a new seed is drawn when the visitor asks for a reshuffle).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OrderInput {
  sort: SortId;
  dir: SortDir;
  styles: number[];
  seed: number;
}

export function orderClips({ sort, dir, styles, seed }: OrderInput): ClipData[] {
  const allow = styles.length ? new Set(styles) : null;
  const list = allow ? ALL_CLIPS.filter((c) => allow.has(styleOf(c.name))) : ALL_CLIPS.slice();

  switch (sort) {
    case "day":
      list.sort((a, b) => dayOf(a) - dayOf(b));
      break;
    case "style": {
      const rank = new Map(STYLE_CLUSTERS.map((c, i) => [c.id, i]));
      list.sort((a, b) => (rank.get(styleOf(a.name)) ?? 99) - (rank.get(styleOf(b.name)) ?? 99) || dayOf(a) - dayOf(b));
      break;
    }
    case "similar":
      list.sort((a, b) => (similarRank.get(a.name) ?? 1e9) - (similarRank.get(b.name) ?? 1e9));
      break;
    case "shuffle": {
      const rnd = mulberry32(seed);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      break;
    }
  }
  if (dir === "desc" && sort !== "shuffle") list.reverse();
  return list;
}
