// Device-class tunables. Resolved once at module load.

// Coarse pointer or a mobile UA: far less GPU and video-decode headroom.
export const IS_MOBILE =
  typeof navigator !== "undefined" &&
  (/Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent) ||
    (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches));

export const RUNTIME = {
  /** Concurrent <video> elements. Only one tile previews at a time; the spare covers the handoff. */
  poolSize: IS_MOBILE ? 2 : 3,
  /** Upper bound on the device-pixel-ratio the canvas renders at. */
  maxDpr: IS_MOBILE ? 1.5 : 1.75,
  /** Ceiling on full-poster texture VRAM. The atlas covers everything below this. */
  posterBudgetMb: IS_MOBILE ? 160 : 384,
};

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
