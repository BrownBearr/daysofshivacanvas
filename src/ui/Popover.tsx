import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

/** A panel that rises out of the dock. Closes on outside press and Escape. */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  className = "",
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="dialog"
          aria-label={label}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.8 }}
          style={{ transformOrigin: "50% 100%" }}
          className={`absolute bottom-[calc(100%+10px)] rounded-[22px] border border-line bg-surface-solid p-2 shadow-float ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
