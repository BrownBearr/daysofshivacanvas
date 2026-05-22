import * as React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import clipsData from "./data/clips.json";
import { Scene } from "./canvas/Scene";
import { Chrome } from "./ui/Chrome";

function App() {
  const clips = clipsData.clips;

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
