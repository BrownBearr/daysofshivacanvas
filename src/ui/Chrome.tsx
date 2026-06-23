import * as React from "react";
import { cameraState, unfocusTile } from "../canvas/camera-state";
import { muteState } from "../canvas/mute-state";
import { sourceUrl } from "../lib/clip-source";
import { SHUFFLE_VIEW, SIMILARITY_VIEW } from "../lib/clip-order";
import { videoPool } from "../lib/video-pool";
import type { ClipData } from "../types";

interface ChromeProps {
  clips: ClipData[];
  darkMode: boolean;
  onToggleDark: () => void;
  view: string;
  onChangeView: (view: string) => void;
}

const BAR_H = 60;
const DENOM_BASE = 1733;
const DENOM_ANCHOR = new Date(2026, 4, 25);
const ICON_SIZE = 22;

function denominatorForToday(): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const anchor = new Date(DENOM_ANCHOR.getFullYear(), DENOM_ANCHOR.getMonth(), DENOM_ANCHOR.getDate()).getTime();
  const daysElapsed = Math.max(0, Math.floor((today - anchor) / 86_400_000));
  return DENOM_BASE + daysElapsed;
}

function SunIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function VolumeIcon({ volume }: { volume: number }) {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {volume === 0 ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : volume < 0.5 ? (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
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

function WelcomeModal({
  darkMode,
  onClose,
}: {
  darkMode: boolean;
  onClose: () => void;
}) {
  const [visible, setVisible] = React.useState(false);

  React.useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = darkMode ? "#ffffff" : "#000000";
  const textDim = darkMode ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";
  const panelBg = darkMode ? "rgba(22,22,22,0.98)" : "rgba(255,255,255,0.98)";
  const panelBorder = darkMode ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const rule = darkMode ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";

  const instructions: [string, string][] = [
    ["Drag", "pan around the gallery"],
    ["Scroll", "zoom in and out"],
    ["Click", "focus a thumbnail"],
    ["Esc", "dismiss"],
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.25s ease",
        pointerEvents: "auto",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(440px, 100%)",
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          borderRadius: 14,
          padding: "32px 32px 28px",
          color: text,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          transform: visible ? "scale(1)" : "scale(0.94)",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            ...iconBtnStyle,
            position: "absolute",
            top: 16,
            right: 18,
            fontSize: 20,
            lineHeight: 1,
            color: textDim,
          }}
        >
          ×
        </button>

        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, letterSpacing: "0.01em" }}>
          Welcome to the gallery of Shiva
        </div>
        <div style={{ fontSize: 17, color: textDim, marginTop: 10, lineHeight: 1.4 }}>
          Enjoy your stay. Click on any thumbnail to see the full image.
        </div>

        <div style={{ height: 1, background: rule, margin: "22px 0 18px" }} />

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 11, columnGap: 16 }}>
          {instructions.map(([key, desc]) => (
            <React.Fragment key={key}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  justifySelf: "start",
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: `1px solid ${rule}`,
                  whiteSpace: "nowrap",
                }}
              >
                {key}
              </span>
              <span style={{ fontSize: 16, color: textDim, alignSelf: "center" }}>{desc}</span>
            </React.Fragment>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            ...iconBtnStyle,
            marginTop: 24,
            width: "100%",
            justifyContent: "center",
            padding: "11px 0",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            borderRadius: 8,
            background: text,
            color: panelBg,
          }}
        >
          Enter the gallery
        </button>
      </div>
    </div>
  );
}

function AboutModal({
  darkMode,
  onClose,
}: {
  darkMode: boolean;
  onClose: () => void;
}) {
  const [visible, setVisible] = React.useState(false);

  React.useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = darkMode ? "#ffffff" : "#000000";
  const textDim = darkMode ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.62)";
  const panelBg = darkMode ? "rgba(22,22,22,0.98)" : "rgba(255,255,255,0.98)";
  const panelBorder = darkMode ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.25s ease",
        pointerEvents: "auto",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(540px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          borderRadius: 14,
          padding: "34px 36px 32px",
          color: text,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          transform: visible ? "scale(1)" : "scale(0.94)",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            ...iconBtnStyle,
            position: "absolute",
            top: 16,
            right: 18,
            fontSize: 20,
            lineHeight: 1,
            color: textDim,
          }}
        >
          ×
        </button>

        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, letterSpacing: "0.01em" }}>About</div>

        <div style={{ fontSize: 17, color: textDim, marginTop: 18, lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>
            For the last 4+ years I have been making a work of art everyday. What started out as a simple project of
            self improvement has grown into a practice of expression, learning and persistence. Every project took real
            time to create and make and yet as a part of the grid it’s just one of many.
          </p>
          <p style={{ margin: "14px 0 0" }}>
            The site does not contain all the work I have made but it’s all present on my Instagram{" "}
            <a
              href="https://instagram.com/daysofshiva"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: text, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              @daysofshiva
            </a>
            .
          </p>
          <p style={{ margin: "14px 0 0" }}>
            My message to you the reader is that if you want to grow and learn and make, you can, it just takes 5 minutes
            over a longer period of time.
          </p>
        </div>
      </div>
    </div>
  );
}

function VideoOverlay({ clip, muted, volume }: { clip: ClipData; muted: boolean; volume: number }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = volume;
  }, [muted, volume]);

  return (
    <div
      onClick={unfocusTile}
      style={{
        position: "fixed",
        // Sit between the top and bottom bars so they remain fully visible
        top: BAR_H,
        bottom: BAR_H,
        left: 0,
        right: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Semi-transparent + blur so the grid is visible but softened behind
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
        pointerEvents: "auto",
        cursor: "default",
      }}
    >
      <video
        ref={videoRef}
        src={sourceUrl(clip)}
        autoPlay
        loop
        playsInline
        muted={muted}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "88%",
          maxHeight: "88%",
          objectFit: "contain",
          display: "block",
          transform: visible ? "scale(1)" : "scale(0.08)",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
          cursor: "auto",
        }}
      />
    </div>
  );
}

export function Chrome({ clips, darkMode, onToggleDark, view, onChangeView }: ChromeProps) {
  const [focusedName, setFocusedName] = React.useState<string | null>(cameraState.focusedClipName);
  const [focusedClip, setFocusedClip] = React.useState<ClipData | null>(cameraState.focusedClip);
  const [hoveredName, setHoveredName] = React.useState<string | null>(cameraState.hoveredClipName);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(true);
  const [showAbout, setShowAbout] = React.useState(false);
  const [muted, setMuted] = React.useState(muteState.muted);
  const [volume, setVolume] = React.useState(muteState.volume);

  React.useEffect(() => {
    const id = setInterval(() => {
      setFocusedName(cameraState.focusedClipName);
      setFocusedClip(cameraState.focusedClip);
      setHoveredName(cameraState.hoveredClipName);
    }, 50);
    return () => clearInterval(id);
  }, []);

  function toggleMute() {
    muteState.muted = !muteState.muted;
    setMuted(muteState.muted);
  }

  function changeVolume(v: number) {
    muteState.volume = v;
    videoPool.setAllVolume(v);
    setVolume(v);
    // Dragging above 0 should be audible, so clear mute if it was on.
    if (v > 0 && muteState.muted) {
      muteState.muted = false;
      setMuted(false);
    }
  }

  const bg = darkMode ? "#121212" : "#ffffff";
  const text = darkMode ? "#ffffff" : "#000000";
  const textDim = darkMode ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const trackDim = darkMode ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.15)";
  const helpBg = darkMode ? "rgba(22,22,22,0.97)" : "rgba(255,255,255,0.97)";
  const helpBorder = darkMode ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)";

  const activeName = focusedName ?? hoveredName;
  const denom = denominatorForToday();
  // Icon reflects audible state: muted or zeroed both read as silent.
  const effVol = muted ? 0 : volume;
  const fillPct = Math.round(volume * 100);

  return (
    <div
      className="fixed inset-0 pointer-events-none select-none"
      style={{ fontFamily: "'Darker Grotesque', Inter, system-ui, sans-serif", color: text }}
    >
      {/* Welcome modal — shown once on load, dismissible by button, backdrop, or Esc */}
      {showWelcome && <WelcomeModal darkMode={darkMode} onClose={() => setShowWelcome(false)} />}

      {/* About modal — opened from the top bar */}
      {showAbout && <AboutModal darkMode={darkMode} onClose={() => setShowAbout(false)} />}

      {/* Full-screen video overlay — mounts/unmounts on focus; key forces fresh video element */}
      {focusedClip && <VideoOverlay key={focusedClip.name} clip={focusedClip} muted={muted} volume={volume} />}

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between"
        style={{ height: BAR_H, background: bg, padding: "0 24px", transition: "background 0.25s" }}
      >
        <span style={{ fontSize: 17, letterSpacing: "0.16em", fontWeight: 700, textTransform: "uppercase" }}>Days of Shiva</span>

        <div className="pointer-events-auto flex items-center" style={{ gap: 20 }}>
          <button
            onClick={() => setShowAbout(true)}
            style={{ ...iconBtnStyle, fontSize: 16, fontWeight: 600, letterSpacing: "0.04em" }}
          >
            about
          </button>
          <select
            value={view}
            onChange={(e) => onChangeView(e.target.value)}
            aria-label="Arrange tiles"
            style={{
              ...iconBtnStyle,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "0.02em",
              background: bg,
              color: text,
              borderRadius: 6,
              outline: "none",
            }}
          >
            <option value={SHUFFLE_VIEW}>Shuffle</option>
            <option value={SIMILARITY_VIEW}>By similarity</option>
          </select>
          <button onClick={onToggleDark} style={iconBtnStyle} aria-label={darkMode ? "Light mode" : "Dark mode"}>
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          <div className="flex items-center" style={{ gap: 9, color: text }}>
            <span style={{ display: "flex", alignItems: "center" }} aria-hidden="true">
              <VolumeIcon volume={effVol} />
            </span>
            <input
              type="range"
              className="vol-slider"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => changeVolume(Number.parseFloat(e.target.value))}
              aria-label="Volume"
              style={{
                width: 76,
                background: `linear-gradient(to right, ${text} ${fillPct}%, ${trackDim} ${fillPct}%)`,
              }}
            />
          </div>
          <button onClick={toggleMute} style={{ ...iconBtnStyle, fontSize: 16, fontWeight: 600, letterSpacing: "0.04em" }}>
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
