import * as React from "react";
import { cameraState } from "../canvas/camera-state";
import { muteState } from "../canvas/mute-state";
import type { ClipData } from "../types";

interface ChromeProps {
  clips: ClipData[];
}

// Counter denominator: a target that grows by one at the end of every day.
// Anchored so that 2026-05-25 (local) reads 1733; each day past that adds 1.
const DENOM_BASE = 1733;
const DENOM_ANCHOR = new Date(2026, 4, 25); // local midnight, May 25 2026

function denominatorForToday(): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const anchor = new Date(
    DENOM_ANCHOR.getFullYear(),
    DENOM_ANCHOR.getMonth(),
    DENOM_ANCHOR.getDate()
  ).getTime();
  const daysElapsed = Math.max(0, Math.floor((today - anchor) / 86_400_000));
  return DENOM_BASE + daysElapsed;
}

export function Chrome({ clips }: ChromeProps) {
  const [focusedId, setFocusedId] = React.useState<number | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [muted, setMuted] = React.useState(muteState.muted);

  React.useEffect(() => {
    const id = setInterval(() => setFocusedId(cameraState.focusedTileId), 50);
    return () => clearInterval(id);
  }, []);

  function toggleMute() {
    muteState.muted = !muteState.muted;
    setMuted(muteState.muted);
  }

  const focusedClip = focusedId !== null ? clips[focusedId] : null;

  return (
    <div className="fixed inset-0 pointer-events-none select-none" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* White bands behind the corner text so it stays legible over any video.
          Painted first (and pointer-events-none) so text sits on top and panning still works. */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: 72, background: "linear-gradient(to bottom, #ffffff 0%, #ffffff 58%, rgba(255,255,255,0) 100%)" }}
      />
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 72, background: "linear-gradient(to top, #ffffff 0%, #ffffff 58%, rgba(255,255,255,0) 100%)" }}
      />

      {/* Site headline — top left */}
      <div className="absolute top-6 left-6">
        <span style={{ fontSize: 13, letterSpacing: "0.18em", color: "rgba(0,0,0,0.55)", fontWeight: 500, textTransform: "uppercase" }}>
          Days of Shiva
        </span>
      </div>

      {/* Mute toggle — top right */}
      <div
        className="absolute top-6 right-6 pointer-events-auto"
        onClick={toggleMute}
        style={{ cursor: "pointer" }}
      >
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(0,0,0,0.3)", fontWeight: 400 }}>
          {muted ? "unmute" : "mute"}
        </span>
      </div>

      {/* Day counter — bottom left: videos in library / daily-growing target */}
      <div className="absolute bottom-6 left-6">
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(0,0,0,0.3)", fontWeight: 400 }}>
          {clips.length} / {denominatorForToday()}
        </span>
      </div>

      {/* Focused clip name — bottom center */}
      {focusedClip && (
        <div className="absolute bottom-6 left-1/2" style={{ transform: "translateX(-50%)" }}>
          <span style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(0,0,0,0.45)", fontWeight: 400 }}>
            {focusedClip.name}
          </span>
        </div>
      )}

      {/* Help glyph — bottom right */}
      <div
        className="absolute bottom-6 right-6 pointer-events-auto relative"
        onMouseEnter={() => setShowHelp(true)}
        onMouseLeave={() => setShowHelp(false)}
      >
        <span style={{ fontSize: 11, color: "rgba(0,0,0,0.2)", cursor: "default" }}>?</span>
        {showHelp && (
          <div
            className="absolute bottom-6 right-0"
            style={{
              background: "rgba(255,255,255,0.9)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(0,0,0,0.06)",
              borderRadius: 8,
              padding: "10px 14px",
              minWidth: 160,
              fontSize: 11,
              color: "rgba(0,0,0,0.45)",
              lineHeight: 1.9,
              whiteSpace: "nowrap",
            }}
          >
            <div>Drag — pan</div>
            <div>Scroll — zoom</div>
            <div>Click — focus</div>
            <div>Esc — dismiss</div>
          </div>
        )}
      </div>
    </div>
  );
}
