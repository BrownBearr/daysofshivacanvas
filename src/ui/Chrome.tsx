import * as React from "react";
import { cameraState } from "../canvas/camera-state";
import { muteState } from "../canvas/mute-state";
import type { ClipData } from "../types";

interface ChromeProps {
  clips: ClipData[];
}

// Height of the solid white bars; text is flex-centered within this.
const BAR_H = 56;

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
  const [focusedName, setFocusedName] = React.useState<string | null>(cameraState.focusedClipName);
  const [showHelp, setShowHelp] = React.useState(false);
  const [muted, setMuted] = React.useState(muteState.muted);

  React.useEffect(() => {
    const id = setInterval(() => setFocusedName(cameraState.focusedClipName), 50);
    return () => clearInterval(id);
  }, []);

  function toggleMute() {
    muteState.muted = !muteState.muted;
    setMuted(muteState.muted);
  }

  return (
    <div className="fixed inset-0 pointer-events-none select-none" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Solid white bar — top. Flex row, items vertically centered on the bar. */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between"
        style={{ height: BAR_H, background: "#ffffff", padding: "0 24px" }}
      >
        <span style={{ fontSize: 13, letterSpacing: "0.18em", color: "rgba(0,0,0,0.55)", fontWeight: 500, textTransform: "uppercase" }}>
          Days of Shiva
        </span>
        <span
          className="pointer-events-auto"
          onClick={toggleMute}
          style={{ cursor: "pointer", fontSize: 11, letterSpacing: "0.08em", color: "rgba(0,0,0,0.3)", fontWeight: 400 }}
        >
          {muted ? "unmute" : "mute"}
        </span>
      </div>

      {/* Solid white bar — bottom. Counter (left), clip name (true-centered), help (right). */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between"
        style={{ height: BAR_H, background: "#ffffff", padding: "0 24px" }}
      >
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(0,0,0,0.3)", fontWeight: 400 }}>
          {clips.length} / {denominatorForToday()}
        </span>

        {focusedName && (
          <span
            className="absolute"
            style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: 11, letterSpacing: "0.12em", color: "rgba(0,0,0,0.45)", fontWeight: 400, whiteSpace: "nowrap" }}
          >
            {focusedName}
          </span>
        )}

        <div
          className="pointer-events-auto relative"
          onMouseEnter={() => setShowHelp(true)}
          onMouseLeave={() => setShowHelp(false)}
        >
          <span style={{ fontSize: 11, color: "rgba(0,0,0,0.2)", cursor: "default" }}>?</span>
          {showHelp && (
            <div
              className="absolute right-0"
              style={{
                bottom: "calc(100% + 10px)",
                background: "rgba(255,255,255,0.95)",
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
    </div>
  );
}
