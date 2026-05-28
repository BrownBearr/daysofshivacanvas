import * as React from "react";
import { cameraState } from "../canvas/camera-state";
import { muteState } from "../canvas/mute-state";
import { videoPool } from "../lib/video-pool";
import type { ClipData } from "../types";

interface ChromeProps {
  clips: ClipData[];
  darkMode: boolean;
  onToggleDark: () => void;
}

const BAR_H = 60;
const DENOM_BASE = 1733;
const DENOM_ANCHOR = new Date(2026, 4, 25);
const VOLUME_STEPS = [1.0, 0.75, 0.5, 0.25, 0.0];
const ICON_SIZE = 22;

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

function SunIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function VolumeIcon({ volume }: { volume: number }) {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      {volume === 0 ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </>
      ) : volume < 0.5 ? (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </>
      )}
    </svg>
  );
}

const iconBtnStyle: React.CSSProperties = {
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  display: "flex",
  alignItems: "center",
  color: "inherit",
};

export function Chrome({ clips, darkMode, onToggleDark }: ChromeProps) {
  const [focusedName, setFocusedName] = React.useState<string | null>(cameraState.focusedClipName);
  const [hoveredName, setHoveredName] = React.useState<string | null>(cameraState.hoveredClipName);
  const [showHelp, setShowHelp] = React.useState(false);
  const [muted, setMuted] = React.useState(muteState.muted);
  const [volume, setVolume] = React.useState(muteState.volume);

  React.useEffect(() => {
    const id = setInterval(() => {
      setFocusedName(cameraState.focusedClipName);
      setHoveredName(cameraState.hoveredClipName);
    }, 50);
    return () => clearInterval(id);
  }, []);

  function toggleMute() {
    muteState.muted = !muteState.muted;
    setMuted(muteState.muted);
  }

  function stepVolume() {
    const idx = VOLUME_STEPS.findIndex((v) => Math.abs(v - muteState.volume) < 0.01);
    const next = VOLUME_STEPS[(idx + 1) % VOLUME_STEPS.length];
    muteState.volume = next;
    videoPool.setAllVolume(next);
    setVolume(next);
    // Sync mute state with volume edge cases
    if (next === 0 && !muteState.muted) {
      muteState.muted = true;
      setMuted(true);
    } else if (next > 0 && muteState.muted) {
      muteState.muted = false;
      setMuted(false);
    }
  }

  const bg = darkMode ? "#121212" : "#ffffff";
  const text = darkMode ? "#ffffff" : "#000000";
  const textDim = darkMode ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const helpBg = darkMode ? "rgba(22,22,22,0.97)" : "rgba(255,255,255,0.97)";
  const helpBorder = darkMode ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)";

  const activeName = focusedName ?? hoveredName;
  const denom = denominatorForToday();

  return (
    <div
      className="fixed inset-0 pointer-events-none select-none"
      style={{ fontFamily: "'Darker Grotesque', Inter, system-ui, sans-serif", color: text }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between"
        style={{ height: BAR_H, background: bg, padding: "0 24px", transition: "background 0.25s" }}
      >
        <span style={{ fontSize: 17, letterSpacing: "0.16em", fontWeight: 700, textTransform: "uppercase" }}>
          Days of Shiva
        </span>

        <div className="pointer-events-auto flex items-center" style={{ gap: 20 }}>
          <button onClick={onToggleDark} style={iconBtnStyle} aria-label={darkMode ? "Light mode" : "Dark mode"}>
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          <button onClick={stepVolume} style={iconBtnStyle} aria-label="Cycle volume">
            <VolumeIcon volume={volume} />
          </button>
          <button
            onClick={toggleMute}
            style={{ ...iconBtnStyle, fontSize: 16, fontWeight: 600, letterSpacing: "0.04em" }}
          >
            {muted ? "unmute" : "mute"}
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between"
        style={{ height: BAR_H, background: bg, padding: "0 24px", transition: "background 0.25s" }}
      >
        {/* Fraction with labels */}
        <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
          {clips.length}
          <span style={{ fontSize: 12, fontWeight: 400, color: textDim, marginLeft: 4 }}>on site</span>
          <span style={{ color: textDim, margin: "0 8px", fontWeight: 400 }}>/</span>
          {denom}
          <span style={{ fontSize: 12, fontWeight: 400, color: textDim, marginLeft: 4 }}>days made</span>
        </span>

        {/* Clip name — focused or hovered, true-centered */}
        {activeName && (
          <span
            className="absolute"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 14,
              letterSpacing: "0.10em",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {activeName}
          </span>
        )}

        {/* Help */}
        <div
          className="pointer-events-auto relative"
          onMouseEnter={() => setShowHelp(true)}
          onMouseLeave={() => setShowHelp(false)}
        >
          <span style={{ fontSize: 22, fontWeight: 700, cursor: "default", lineHeight: 1 }}>?</span>
          {showHelp && (
            <div
              className="absolute right-0"
              style={{
                bottom: "calc(100% + 10px)",
                background: helpBg,
                backdropFilter: "blur(8px)",
                border: `1px solid ${helpBorder}`,
                borderRadius: 8,
                padding: "10px 14px",
                minWidth: 160,
                fontSize: 14,
                color: text,
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
