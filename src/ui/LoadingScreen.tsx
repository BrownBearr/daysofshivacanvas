import * as React from "react";

// Progress lives in a module store rather than App state. Poster prefetch reports ~50-570 times
// during load, and routing that through App re-rendered Scene and Chrome on every tick — in the
// exact window the browser is busy decoding those posters. Only this component subscribes.
let progressValue = 0;
const progressListeners = new Set<() => void>();

export function setLoadProgress(next: number): void {
  if (next === progressValue) return;
  progressValue = next;
  for (const fn of progressListeners) fn();
}

function subscribeProgress(fn: () => void): () => void {
  progressListeners.add(fn);
  return () => {
    progressListeners.delete(fn);
  };
}

function useLoadProgress(): number {
  return React.useSyncExternalStore(
    subscribeProgress,
    () => progressValue,
    () => 0
  );
}

interface LoadingScreenProps {
  // When true the overlay fades out and then unmounts itself.
  done: boolean;
}

// Full-screen white overlay shown on first load while poster thumbnails prefetch, so the canvas is
// revealed already-composed instead of popping in tile-by-tile. Visual matches the Chrome bars.
export function LoadingScreen({ done }: LoadingScreenProps) {
  const [hidden, setHidden] = React.useState(false);
  const progress = useLoadProgress();
  if (hidden) return null;

  const pct = Math.round(progress * 100);

  return (
    <div
      onTransitionEnd={(e) => {
        if (done && e.propertyName === "opacity") setHidden(true);
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        opacity: done ? 0 : 1,
        transition: "opacity 450ms ease",
        pointerEvents: done ? "none" : "auto",
        zIndex: 50,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <span
        style={{
          fontSize: 13,
          letterSpacing: "0.18em",
          color: "rgba(0,0,0,0.55)",
          fontWeight: 500,
          textTransform: "uppercase",
        }}
      >
        Days of Shiva
      </span>

      <div
        style={{
          width: 180,
          height: 2,
          background: "rgba(0,0,0,0.08)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "rgba(0,0,0,0.55)",
            transition: "width 200ms ease",
          }}
        />
      </div>

      <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(0,0,0,0.3)" }}>{pct}%</span>
    </div>
  );
}
