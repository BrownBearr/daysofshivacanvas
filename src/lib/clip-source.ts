import type { ClipData } from "../types";

// Public B2 bucket base, e.g. https://daysofshiva-source.s3.us-east-005.backblazeb2.com
// Bucket is public + CORS-enabled, so plain HTTPS works — no signed URLs needed.
// On the kiosk build this is "/clips", served from the local mirror by scripts/serve-kiosk.mjs.
const CDN_BASE = (import.meta.env.VITE_CDN_BASE ?? "").replace(/\/$/, "");

// Which poster tier the grid uses.
//
//   "full" (default) — {name}.jpg, the 712x400 landscape poster. Tiles are square, so the UV crop
//                      throws ~44% of it away after decoding and uploading the whole thing.
//   "sq"             — {name}-sq.webp, pre-cropped square WebP. ~2.5x less VRAM per tile and a
//                      much smaller download, but only exists once scripts/make-grid-posters.mjs
//                      has been run with --upload.
//
// Kept as a switch rather than a hard change so the app never depends on a tier that may not be in
// the bucket yet.
const POSTER_TIER = import.meta.env.VITE_POSTER_TIER === "sq" ? "sq" : "full";

// Full-quality H.264 source — fetched only on focus, range-streamed.
export function sourceUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}.mp4`;
}

// 480p muted loop shown while a tile is hovered (~700KB).
export function previewUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}-480.mp4`;
}

// Still frame painted on every tile before any video decodes.
export function posterUrl(clip: ClipData): string {
  return POSTER_TIER === "sq" ? `${CDN_BASE}/${clip.name}-sq.webp` : `${CDN_BASE}/${clip.name}.jpg`;
}
