import * as React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { resetView, unfocusTile } from "./canvas/camera-state";
import { Scene } from "./canvas/Scene";
import clipsData from "./data/clips.json";
import { posterUrl } from "./lib/clip-source";
import { arrangeBySimilarity, SHUFFLE_VIEW } from "./lib/clip-order";
import { prefetchImages } from "./lib/poster-prefetch";
import { GRID_COLS, INITIAL_CAM_Z, TILE_SPACING, VISIBLE_MARGIN_TILES } from "./theme";
import type { ClipData } from "./types";
import { Chrome } from "./ui/Chrome";
import { LoadingScreen } from "./ui/LoadingScreen";

// Safety net: never trap the user behind the loader if some assets stall (no load/error event).
const MAX_LOAD_MS = 20000;

// Posters covering the initial camera view (z = INITIAL_CAM_Z, centered on the origin), mirroring
// Grid's frustum→cell math. We prefetch these first so the canvas reveals fully composed without
// waiting on the entire ~570-poster library; the rest warm in the background afterward.
function initialVisiblePosterUrls(clips: ClipData[]): string[] {
  const total = clips.length;
  if (!total) return [];
  const cols = GRID_COLS;
  const rows = Math.max(1, Math.ceil(total / cols));
  const fovRad = (45 * Math.PI) / 180; // matches Scene's Canvas camera fov
  const halfH = INITIAL_CAM_Z * Math.tan(fovRad / 2);
  const aspect = typeof window !== "undefined" ? window.innerWidth / Math.max(1, window.innerHeight) : 1.6;
  const halfW = halfH * aspect;
  const m = VISIBLE_MARGIN_TILES;
  const gxMin = Math.floor(-halfW / TILE_SPACING) - m;
  const gxMax = Math.ceil(halfW / TILE_SPACING) + m;
  const gyMin = Math.floor(-halfH / TILE_SPACING) - m;
  const gyMax = Math.ceil(halfH / TILE_SPACING) + m;
  const urls = new Set<string>();
  for (let gy = gyMin; gy <= gyMax; gy++) {
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const localCol = ((gx % cols) + cols) % cols;
      const localRow = ((gy % rows) + rows) % rows;
      urls.add(posterUrl(clips[(localRow * cols + localCol) % total]));
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

function App() {
  const [progress, setProgress] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(false);
  // View selection: SHUFFLE_VIEW (random grid) or SIMILARITY_VIEW (similar clips grouped).
  const [view, setView] = React.useState<string>(SHUFFLE_VIEW);

  const clips = React.useMemo(
    () => (view === SHUFFLE_VIEW ? shuffledClips : arrangeBySimilarity(shuffledClips)),
    [view]
  );

  // Re-grouping/filtering changes the spatial layout — snap back to the origin
  // and drop any open focus so the new arrangement reads from the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on `view` to fire on change; the body reads no reactive values.
  React.useEffect(() => {
    unfocusTile();
    resetView();
  }, [view]);

  const bgColor = darkMode ? "#121212" : "#ffffff";

  React.useEffect(() => {
    document.body.style.background = bgColor;
  }, [bgColor]);

  // Prefetch posters into the browser/CDN cache so the canvas composes from cache and zoom-out/pan
  // never trigger a network load storm. Two phases: the first-screen posters gate the loader (a
  // ~50-image wait, not ~570); the remainder warm in the background once the canvas is revealed.
  React.useEffect(() => {
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        setReady(true);
      }
    };
    const timer = setTimeout(finish, MAX_LOAD_MS);

    const allUrls = clips.map(posterUrl);
    const visible = initialVisiblePosterUrls(clips);
    const visibleSet = new Set(visible);
    const rest = allUrls.filter((u) => !visibleSet.has(u));

    prefetchImages(visible, (loaded, total) => {
      setProgress(total ? loaded / total : 1);
    }).then(() => {
      clearTimeout(timer);
      finish();
      // Background phase: no progress UI, just warm the cache for later pans.
      prefetchImages(rest, () => {});
    });
    return () => clearTimeout(timer);
  }, [clips]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Scene clips={clips} bgColor={bgColor} />
      <Chrome clips={clips} darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} view={view} onChangeView={setView} />
      <LoadingScreen progress={progress} done={ready} />
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
