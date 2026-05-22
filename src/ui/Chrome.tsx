import * as React from "react";
import { cameraState } from "../canvas/camera-state";

interface ChromeProps {
  total: number;
}

export function Chrome({ total }: ChromeProps) {
  const [focusedId, setFocusedId] = React.useState<number | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);

  // Poll cameraState ref for focused tile ID
  React.useEffect(() => {
    const id = setInterval(() => {
      setFocusedId(cameraState.focusedTileId);
    }, 50);
    return () => clearInterval(id);
  }, []);

  const dayLabel = focusedId !== null ? String(focusedId + 1).padStart(3, "0") : null;
  const totalLabel = String(total).padStart(3, "0");

  return (
    <div className="fixed inset-0 pointer-events-none select-none" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Day counter — bottom left */}
      <div className="absolute bottom-6 left-6 pointer-events-auto">
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(0,0,0,0.35)", fontWeight: 400 }}>
          {dayLabel ? `${dayLabel} / ${totalLabel}` : `— / ${totalLabel}`}
        </span>
      </div>

      {/* Help glyph — bottom right */}
      <div
        className="absolute bottom-6 right-6 pointer-events-auto relative"
        onMouseEnter={() => setShowHelp(true)}
        onMouseLeave={() => setShowHelp(false)}
      >
        <span style={{ fontSize: 11, color: "rgba(0,0,0,0.25)", cursor: "default", letterSpacing: "0.04em" }}>?</span>
        {showHelp && (
          <div
            className="absolute bottom-6 right-0"
            style={{
              background: "rgba(245,245,240,0.92)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 8,
              padding: "10px 14px",
              minWidth: 160,
              fontSize: 11,
              color: "rgba(0,0,0,0.5)",
              lineHeight: 1.9,
              whiteSpace: "nowrap",
            }}
          >
            <div>Drag — pan</div>
            <div>Scroll — zoom</div>
            <div>Click — focus tile</div>
            <div>Esc — dismiss</div>
          </div>
        )}
      </div>

      {/* Focused tile overlay — day number */}
      {focusedId !== null && (
        <div
          className="absolute bottom-6 left-1/2"
          style={{ transform: "translateX(-50%)", fontSize: 11, color: "rgba(0,0,0,0.4)", letterSpacing: "0.1em" }}
        >
          day {dayLabel}
        </div>
      )}
    </div>
  );
}
