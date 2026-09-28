import * as THREE from "three";
import atlasData from "../data/atlas.json";
import { BLANK } from "./material";

// The thumbnail atlas (scripts/make-atlas.mjs): a few WebP sheets holding every clip at 96px.
// Loaded before anything else so every tile can paint on its first frame.

type Item = [sheet: number, col: number, row: number];
const items = atlasData.items as unknown as Record<string, Item>;
const sheets: (THREE.Texture | null)[] = Array.from({ length: atlasData.sheets }, () => null);
const listeners = new Set<() => void>();

export function atlasUrl(sheet: number): string {
  return `/atlas/atlas-${sheet}.webp`;
}

function load(sheet: number): Promise<void> {
  return (
    fetch(atlasUrl(sheet))
      .then((r) => r.blob())
      // WebGL ignores UNPACK_FLIP_Y for ImageBitmap, so flip at decode time instead.
      .then((b) => createImageBitmap(b, { imageOrientation: "flipY" }))
      .then((bmp) => {
        const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        // No mipmaps: lower levels would bleed neighbouring cells into each other, and tiles are
        // rarely drawn much below the 96px cell size.
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        sheets[sheet] = t;
        for (const fn of listeners) fn();
      })
      .catch(() => {
        // A missing sheet leaves those tiles on the flat placeholder until their poster arrives.
      })
  );
}

let started: Promise<void> | null = null;

/** Starts loading every sheet; resolves once the first one is ready. */
export function loadAtlas(): Promise<void> {
  if (!started) {
    const all = sheets.map((_, i) => load(i));
    started = all[0] ?? Promise.resolve();
  }
  return started;
}

export function onAtlasSheet(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Point `rect` at the clip's cell. Returns the sheet texture, or BLANK if not loaded yet. */
export function atlasFor(name: string, rect: THREE.Vector4): { tex: THREE.Texture; ready: boolean } {
  const it = items[name];
  if (!it) return { tex: BLANK, ready: false };
  const [s, col, row] = it;
  const tex = sheets[s];
  if (!tex) return { tex: BLANK, ready: false };
  const w = atlasData.width;
  const h = atlasData.heights[s];
  const c = atlasData.cell;
  // Half-texel inset so bilinear filtering never reaches the neighbouring cell.
  const inset = 0.5;
  rect.set((col * c + inset) / w, 1 - ((row + 1) * c - inset) / h, (c - 2 * inset) / w, (c - 2 * inset) / h);
  return { tex, ready: true };
}

/** CSS sprite position for the same cell, used by the DOM index view as an instant placeholder. */
export function atlasCss(name: string): { url: string; x: number; y: number; w: number; h: number; cell: number } | null {
  const it = items[name];
  if (!it) return null;
  const [s, col, row] = it;
  return {
    url: atlasUrl(s),
    x: col * atlasData.cell,
    y: row * atlasData.cell,
    w: atlasData.width,
    h: atlasData.heights[s],
    cell: atlasData.cell,
  };
}
