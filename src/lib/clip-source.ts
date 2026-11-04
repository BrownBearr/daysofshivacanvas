import type { ClipData } from "../types";

// Public B2 bucket base, e.g. https://daysofshiva-source.s3.us-east-005.backblazeb2.com
// Bucket is public + CORS-enabled, so plain HTTPS works — no signed URLs needed.
const CDN_BASE = (import.meta.env.VITE_CDN_BASE ?? "").replace(/\/$/, "");

// Which still the square grid tiles use (stage LOD and the index view).
//
//   "full" (default) - {name}.jpg, the 712x400 landscape poster, cropped to a 400px square. Soft
//                      once a tile is bigger than ~400 device px.
//   "hd"             - {name}-hd.webp, a 720px square cut from the full-quality source
//                      (scripts/make-hd-posters.mjs --upload). Sharp up to near full zoom.
//   "sq"             - {name}-sq.webp, a 384px square re-encode of the old poster.
//
// Kept as a switch so the app never depends on a tier that may not be in the bucket yet. A clip
// missing from the chosen tier falls back to its .jpg (see tilePosterFallback).
// Where the hd/sq tile tiers live. Defaults to the bucket; overridable (e.g. a local folder while
// testing a tier before uploading it).
const TILE_BASE = (import.meta.env.VITE_TILE_POSTER_BASE ?? CDN_BASE).replace(/\/$/, "");
const POSTER_TIER = (["hd", "sq"] as const).find((t) => t === import.meta.env.VITE_POSTER_TIER) ?? "full";

// Full-quality H.264 source, fetched only on focus, range-streamed.
export function sourceUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}.mp4`;
}

// 480p muted loop shown while a tile is hovered (~700KB).
export function previewUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}-480.mp4`;
}

// The landscape 16:9 still. The player's frame is 16:9, so it always uses this.
export function posterUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}.jpg`;
}

// The square still for grid tiles.
export function tilePosterUrl(clip: ClipData): string {
  if (POSTER_TIER === "hd") return `${TILE_BASE}/${clip.name}-hd.webp`;
  if (POSTER_TIER === "sq") return `${TILE_BASE}/${clip.name}-sq.webp`;
  return posterUrl(clip);
}

/** What to load if tilePosterUrl 404s (a clip added after the tier was built), or null. */
export function tilePosterFallback(clip: ClipData): string | null {
  return POSTER_TIER === "full" ? null : posterUrl(clip);
}
