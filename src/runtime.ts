// Runtime target resolution.
//
// The site ships in two shapes from one codebase:
//
//   web    — the public site. Conservative: small video pool, first-screen posters only,
//            bandwidth-aware prefetch, welcome modal, dpr capped low.
//   kiosk  — an unattended machine at a gallery showing. Assets are on local disk, so
//            everything can be preloaded and the video pool can be large; adds attract
//            drift and an auto-reset so the piece survives all day without an operator.
//
// Resolved once at module load. `VITE_TARGET=kiosk` picks it at build time; `?kiosk=1`
// forces it at runtime so the show machine can run a stock web build.

export type Target = "web" | "kiosk";

function resolveTarget(): Target {
  const built = import.meta.env.VITE_TARGET;
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    if (q.has("kiosk")) return q.get("kiosk") === "0" ? "web" : "kiosk";
  }
  return built === "kiosk" ? "kiosk" : "web";
}

export const TARGET: Target = resolveTarget();
export const IS_KIOSK = TARGET === "kiosk";

// Coarse pointer or a mobile UA ⇒ treat as mobile: far less GPU and video-decode headroom.
// A kiosk is never "mobile" even on a touchscreen — it's a known machine with real hardware.
export const IS_MOBILE =
  !IS_KIOSK &&
  typeof navigator !== "undefined" &&
  (/Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent) ||
    (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches));

interface RuntimeConfig {
  /** Concurrent <video> elements. Only hover + focus decode, so this only needs to cover
   *  overlapping hover transitions — but a kiosk can afford headroom for instant re-hover. */
  poolSize: number;
  /** Upper bound on the device-pixel-ratio R3F renders at. */
  maxDpr: number;
  /** Ceiling on poster-texture VRAM. The real bound on the cache — see poster-cache.ts. */
  posterBudgetMb: number;
  /** Prefetch every poster behind the loading screen instead of just the first screen.
   *  Only sane when the assets are local. */
  preloadAllPosters: boolean;
  /** Parallel poster requests during the background warm phase. */
  prefetchConcurrency: number;
  /** Delay before the background poster warm starts, so it doesn't compete with the
   *  user's first pan for bandwidth and image-decode time. */
  backgroundPrefetchDelayMs: number;
  /** Show the welcome modal (gated on localStorage). Never on a kiosk — nobody dismisses it. */
  welcomeModal: boolean;
  /** Idle ms before the camera starts drifting on its own. 0 disables. */
  attractIdleMs: number;
  /** Idle ms before the view snaps back to the origin for the next visitor. 0 disables. */
  autoResetIdleMs: number;
  /** Hide the cursor after this many ms of no pointer movement. 0 disables. */
  hideCursorIdleMs: number;
  /** Suppress context menu, pinch-zoom, text selection and overscroll. */
  lockDownBrowserChrome: boolean;
}

const web: RuntimeConfig = {
  poolSize: IS_MOBILE ? 2 : 4,
  maxDpr: IS_MOBILE ? 1 : 1.5,
  posterBudgetMb: IS_MOBILE ? 192 : 512,
  preloadAllPosters: false,
  prefetchConcurrency: IS_MOBILE ? 4 : 6,
  backgroundPrefetchDelayMs: 2500,
  welcomeModal: true,
  attractIdleMs: 0,
  autoResetIdleMs: 0,
  hideCursorIdleMs: 0,
  lockDownBrowserChrome: false,
};

const kiosk: RuntimeConfig = {
  poolSize: 10,
  maxDpr: 2,
  posterBudgetMb: 1024,
  preloadAllPosters: true,
  prefetchConcurrency: 16,
  backgroundPrefetchDelayMs: 0,
  welcomeModal: false,
  attractIdleMs: 60_000,
  autoResetIdleMs: 180_000,
  hideCursorIdleMs: 4_000,
  lockDownBrowserChrome: true,
};

export const RUNTIME: RuntimeConfig = IS_KIOSK ? kiosk : web;
