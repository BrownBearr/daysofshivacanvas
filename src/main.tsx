import * as React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { resetView, unfocusTile } from "./canvas/camera-state";
import { Scene } from "./canvas/Scene";
import clipsData from "./data/clips.json";
import { arrangeBySimilarity, SHUFFLE_VIEW } from "./lib/clip-order";
import { posterUrl } from "./lib/clip-source";
import { installKioskBehaviour } from "./lib/kiosk";
import { preparePosters, warmPosters } from "./lib/poster-prefetch";
import { RUNTIME } from "./runtime";
import { CAMERA_FOV, GRID_COLS, INITIAL_CAM_Z, TILE_SPACING, VISIBLE_MARGIN_TILES } from "./theme";
import type { ClipData } from "./types";
import { Chrome } from "./ui/Chrome";
import { LoadingScreen, setLoadProgress } from "./ui/LoadingScreen";

// Safety net: never trap the visitor behind the loader if some assets stall with no load/error event.
const MAX_LOAD_MS = 20000;

// Posters covering the initial camera view, mirroring Grid's frustum->cell math. These are decoded
// and uploaded before the loader lifts, so the canvas is revealed genuinely composed rather than
// merely downloaded — the previous version only warmed the HTTP cache, which put every decode and
// GPU upload on the frame the loader faded out.
function initialVisiblePosterUrls(clips: ClipData[]): string[] {
  const total = clips.length;
  if (!total) return [];
  const rows = Math.max(1, Math.ceil(total / GRID_COLS));
  const halfH = INITIAL_CAM_Z * Math.tan((CAMERA_FOV * Math.PI) / 360);
  const aspect = typeof window !== "undefined" ? window.innerWidth / Math.max(1, window.innerHeight) : 1.6;
  const halfW = halfH * aspect;
  const m = VISIBLE_MARGIN_TILES;
  const urls = new Set<string>();
  for (let gy = Math.floor(-halfH / TILE_SPACING) - m; gy <= Math.ceil(halfH / TILE_SPACING) + m; gy++) {
    for (let gx = Math.floor(-halfW / TILE_SPACING) - m; gx <= Math.ceil(halfW / TILE_SPACING) + m; gx++) {
      const col = ((gx % GRID_COLS) + GRID_COLS) % GRID_COLS;
      const row = ((gy % rows) + rows) % rows;
      urls.add(posterUrl(clips[(row * GRID_COLS + col) % total]));
    }
  }
  return [...urls];
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const shuffledClips = shuffle(clipsData.clips);

// Memoized so poster-load progress and other App-level state can't re-render the whole canvas
// subtree. Scene only actually needs to re-render when the clip ordering or background changes.
const MemoScene = React.memo(Scene);

function App() {
  const [ready, setReady] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(false);
  // View selection: SHUFFLE_VIEW (random grid) or SIMILARITY_VIEW (similar clips grouped).
  const [view, setView] = React.useState<string>(SHUFFLE_VIEW);

  const clips = React.useMemo(() => (view === SHUFFLE_VIEW ? shuffledClips : arrangeBySimilarity(shuffledClips)), [view]);

  // Re-grouping changes the spatial layout — snap back to the origin and drop any open focus so the
  // new arrangement reads from the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on `view` to fire on change; the body reads no reactive values.
  React.useEffect(() => {
    unfocusTile();
    resetView();
  }, [view]);

  const bgColor = darkMode ? "#121212" : "#ffffff";

  React.useEffect(() => {
    document.body.style.background = bgColor;
  }, [bgColor]);

  React.useEffect(installKioskBehaviour, []);

  // Two phases. The first screen is decoded into real textures and gates the loader. The long tail
  // is only HTTP-warmed, and on the web build not until the visitor has had a moment to look around
  // — at full concurrency it used to saturate the connection during the first pan.
  React.useEffect(() => {
    let cancelled = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setReady(true);
    };
    const timer = setTimeout(finish, MAX_LOAD_MS);

    const allUrls = clips.map(posterUrl);
    const visible = initialVisiblePosterUrls(clips);
    const visibleSet = new Set(visible);
    const rest = allUrls.filter((u) => !visibleSet.has(u));

    const gated = RUNTIME.preloadAllPosters
      ? // Kiosk: assets are on local disk, so the whole library can be warmed before the loader
        // lifts and nothing ever pops in mid-show.
        preparePosters(visible, (l, t) => setLoadProgress(t ? (l / t) * 0.4 : 1)).then(() =>
          warmPosters(rest, (l, t) => setLoadProgress(t ? 0.4 + (l / t) * 0.6 : 1), RUNTIME.prefetchConcurrency)
        )
      : preparePosters(visible, (l, t) => setLoadProgress(t ? l / t : 1));

    gated.then(() => {
      if (cancelled) return;
      clearTimeout(timer);
      finish();
      if (RUNTIME.preloadAllPosters) return;
      const delay = RUNTIME.backgroundPrefetchDelayMs;
      const start = () => {
        if (!cancelled) warmPosters(rest, () => {}, RUNTIME.prefetchConcurrency);
      };
      if (delay > 0) setTimeout(start, delay);
      else start();
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clips]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <MemoScene clips={clips} bgColor={bgColor} />
      <Chrome clips={clips} darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} view={view} onChangeView={setView} />
      <LoadingScreen done={ready} />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
