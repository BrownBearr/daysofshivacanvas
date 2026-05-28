import * as React from "react";

interface LoadingScreenProps {
  // 0..1
  progress: number;
  // When true the overlay fades out and then unmounts itself.
  done: boolean;
}

// Full-screen white overlay shown on first load while poster thumbnails prefetch, so the canvas is
// revealed already-composed instead of popping in tile-by-tile. Visual matches the Chrome bars.
export function LoadingScreen({ progress, done }: LoadingScreenProps) {
  const [hidden, setHidden] = React.useState(false);
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
