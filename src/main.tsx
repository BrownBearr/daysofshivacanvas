import * as React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import clipsData from "./data/clips.json";
import { Scene } from "./canvas/Scene";
import { Chrome } from "./ui/Chrome";
import { LoadingScreen } from "./ui/LoadingScreen";
import { posterUrl } from "./lib/clip-source";
import { prefetchImages } from "./lib/poster-prefetch";

// Safety net: never trap the user behind the loader if some assets stall (no load/error event).
const MAX_LOAD_MS = 20000;

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
  const clips = shuffledClips;
  const [progress, setProgress] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(false);

  const bgColor = darkMode ? "#121212" : "#ffffff";

  React.useEffect(() => {
    document.body.style.background = bgColor;
  }, [bgColor]);

  // Prefetch every poster into the browser/CDN cache so the canvas (mounted behind the overlay)
  // composes from cache and zoom-out/pan never trigger a network load storm.
  React.useEffect(() => {
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        setReady(true);
      }
    };
    const timer = setTimeout(finish, MAX_LOAD_MS);
    prefetchImages(clips.map(posterUrl), (loaded, total) => {
      setProgress(total ? loaded / total : 1);
    }).then(() => {
      clearTimeout(timer);
      finish();
    });
    return () => clearTimeout(timer);
  }, [clips]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Scene clips={clips} bgColor={bgColor} />
      <Chrome clips={clips} darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />
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
