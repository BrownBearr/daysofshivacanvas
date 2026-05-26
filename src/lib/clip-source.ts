import type { ClipData } from "../types";

// Public B2 bucket base, e.g. https://daysofshiva-source.s3.us-east-005.backblazeb2.com
// Bucket is public + CORS-enabled, so plain HTTPS works — no signed URLs needed.
// All three asset tiers live in B2 under a consistent {name}-based naming scheme.
const CDN_BASE = (import.meta.env.VITE_CDN_BASE ?? "").replace(/\/$/, "");

// Full-quality H.264 source — fetched only on focus (~40MB, range-streamed).
export function sourceUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}.mp4`;
}

// 480p muted loop shown on idle tiles (~500KB).
export function previewUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}-480.mp4`;
}

// First-frame JPG, painted before any video decodes (~30KB).
export function posterUrl(clip: ClipData): string {
  return `${CDN_BASE}/${clip.name}.jpg`;
}
