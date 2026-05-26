import * as React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import clipsData from "./data/clips.json";
import { Scene } from "./canvas/Scene";
import { Chrome } from "./ui/Chrome";

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

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Scene clips={clips} />
      <Chrome clips={clips} />
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
