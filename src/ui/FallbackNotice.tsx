import * as React from "react";

// Shown in place of the canvas when WebGL is unavailable (blocked or crashed), and as a
// banner when poster downloads are being blocked. Both explain the fix instead of leaving
// the visitor on a silent blank page — Brave's Strict fingerprinting shield and aggressive
// content blockers are the common causes.

interface WebglNoticeProps {
  darkMode: boolean;
}

export function WebglNotice({ darkMode }: WebglNoticeProps) {
  const fg = darkMode ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)";
  const dim = darkMode ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        textAlign: "center",
        background: darkMode ? "#121212" : "#ffffff",
        fontFamily: "Inter, system-ui, sans-serif",
        zIndex: 40,
      }}
    >
      <span
        style={{
          fontSize: 13,
          letterSpacing: "0.18em",
          color: dim,
          fontWeight: 500,
          textTransform: "uppercase",
        }}
      >
        Days of Shiva
      </span>
      <p style={{ maxWidth: 420, fontSize: 15, lineHeight: 1.6, color: fg, margin: 0 }}>
        This gallery renders with WebGL, which your browser is currently blocking.
      </p>
      <p style={{ maxWidth: 440, fontSize: 13, lineHeight: 1.7, color: dim, margin: 0 }}>
        If you're on Brave, set Shields → "Block fingerprinting" to Standard for this site
        (lion icon in the address bar), then reload. Otherwise check that graphics
        acceleration is enabled in your browser settings.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          padding: "8px 22px",
          fontSize: 12,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "inherit",
          color: darkMode ? "#121212" : "#ffffff",
          background: darkMode ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)",
          border: "none",
          borderRadius: 2,
          cursor: "pointer",
        }}
      >
        Reload
      </button>
    </div>
  );
}

interface AssetBlockedBannerProps {
  darkMode: boolean;
  onDismiss: () => void;
}

export function AssetBlockedBanner({ darkMode, onDismiss }: AssetBlockedBannerProps) {
  const fg = darkMode ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)";
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 56,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        maxWidth: "min(560px, calc(100vw - 32px))",
        padding: "10px 16px",
        background: darkMode ? "rgba(30,30,30,0.95)" : "rgba(255,255,255,0.95)",
        border: `1px solid ${darkMode ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}`,
        borderRadius: 4,
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: fg,
        zIndex: 45,
      }}
    >
      <span>
        The artwork images aren't loading — an ad/privacy blocker may be blocking
        cdn.shivav.space. Allow it for this site (in Brave: lion icon → Shields down) and
        reload.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: fg,
          fontSize: 16,
          lineHeight: 1,
          cursor: "pointer",
          padding: 2,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
