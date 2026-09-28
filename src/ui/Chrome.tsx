import { X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { daysMadeToday, formatDay } from "../lib/days";
import { subscribeCurrent } from "../stage/engine";
import { styleLabel } from "../state/sort";
import { actions, useApp } from "../state/store";

const EASE = [0.16, 1, 0.3, 1] as const;

export function TopBar() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between px-4 sm:px-6"
    >
      <h1 className="text-[17px] font-semibold tracking-tight text-ink">Days of Shiva</h1>
      <button
        type="button"
        onClick={() => actions.setAbout(true)}
        className="pointer-events-auto rounded-full px-3 py-1.5 text-[15px] text-dim transition-colors hover:text-ink"
      >
        About
      </button>
    </motion.header>
  );
}

/** Bottom-left: the clip under the cursor (or at the front of a rail), else the archive count. */
export function Readout() {
  const [name, setName] = React.useState<string | null>(null);
  const count = useApp((s) => s.ordered.length);
  const view = useApp((s) => s.view);
  const filtered = useApp((s) => s.styles.length > 0);
  React.useEffect(() => subscribeCurrent(setName), []);
  const show = view !== "index" && name;
  const key = show ? name : `count-${count}`;
  // The index view has its own header with the count; a floating readout would sit on its captions.
  if (view === "index") return null;

  return (
    <div className="pointer-events-none fixed bottom-[calc(max(16px,env(safe-area-inset-bottom))+64px)] left-4 z-20 h-11 overflow-hidden sm:bottom-6 sm:left-6">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={key}
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -18, opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
          className="leading-tight"
        >
          {show ? (
            <>
              <div className="text-[17px] font-semibold text-ink">Day {name}</div>
              <div className="text-[13px] text-dim">
                {formatDay(name)}
                <span className="px-1.5">/</span>
                {styleLabel(name)}
              </div>
            </>
          ) : (
            <>
              <div className="text-[17px] font-semibold text-ink">
                {count}
                <span className="ml-1.5 text-[13px] font-normal text-dim">{filtered ? "in these styles" : "on site"}</span>
              </div>
              <div className="text-[13px] text-dim">{daysMadeToday().toLocaleString()} days made</div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function EmptyState() {
  const empty = useApp((s) => s.ordered.length === 0);
  return (
    <AnimatePresence>
      {empty && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-20 grid place-items-center px-6 text-center"
        >
          <div>
            <p className="text-2xl font-medium text-ink">No clips in these styles</p>
            <p className="mt-2 text-dim">Pick different styles, or show everything again.</p>
            <button
              type="button"
              onClick={actions.clearStyles}
              className="mt-6 h-11 rounded-full bg-ink px-6 text-[15px] font-medium text-bg transition-transform active:scale-[0.97]"
            >
              Show all
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Modal({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={label}>
          {/* Flat scrim: a backdrop-filter over the WebGL canvas forces a canvas snapshot per composite. */}
          <motion.div
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative max-h-[calc(100dvh-32px)] w-[min(560px,100%)] overflow-y-auto rounded-[22px] border border-line bg-surface-solid p-7 text-ink shadow-float sm:p-9"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full text-dim transition-colors hover:bg-line hover:text-ink"
            >
              <X size={18} />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function About() {
  const open = useApp((s) => s.aboutOpen);
  const close = React.useCallback(() => actions.setAbout(false), []);
  return (
    <Modal open={open} onClose={close} label="About">
      <h2 className="text-3xl font-semibold tracking-tight">About</h2>
      <div className="mt-5 max-w-[60ch] space-y-4 text-[17px] leading-relaxed text-dim">
        <p>
          For the last 4+ years I have been making a work of art everyday. What started out as a simple project of self
          improvement has grown into a practice of expression, learning and persistence. Every project took real time to create
          and make and yet as a part of the grid it’s just one of many.
        </p>
        <p>
          The site does not contain all the work I have made but it’s all present on my Instagram{" "}
          <a
            href="https://instagram.com/daysofshiva"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink underline underline-offset-2 hover:text-accent"
          >
            @daysofshiva
          </a>
          .
        </p>
        <p>
          My message to you the reader is that if you want to grow and learn and make, you can, it just takes 5 minutes over a
          longer period of time.
        </p>
      </div>
    </Modal>
  );
}

const WELCOME_KEY = "daysofshiva:welcome-seen";

function seenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) !== null;
  } catch {
    return false;
  }
}

const HINTS: [string, string][] = [
  ["Drag", "move around"],
  ["Scroll", "zoom, or flip through a stack"],
  ["Click", "open a clip"],
  ["1 to 4", "switch views"],
  ["Esc", "close"],
];

export function Welcome() {
  const [open, setOpen] = React.useState(() => !seenWelcome() && !new URLSearchParams(location.search).has("c"));
  const close = React.useCallback(() => {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Blocked storage: it shows again next visit, which is harmless.
    }
    setOpen(false);
  }, []);
  return (
    <Modal open={open} onClose={close} label="Welcome">
      <h2 className="pr-8 text-3xl font-semibold tracking-tight">Welcome to the gallery of Shiva</h2>
      <p className="mt-3 text-[17px] text-dim">Enjoy your stay. Click on any thumbnail to see the full piece.</p>
      <dl className="mt-7 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 border-t border-line pt-6">
        {HINTS.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="justify-self-start rounded-full border border-line px-3 py-1 text-[13px] font-medium">{k}</dt>
            <dd className="text-[16px] text-dim">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <button
        type="button"
        onClick={close}
        className="mt-8 h-12 w-full rounded-full bg-ink text-[16px] font-medium text-bg transition-transform active:scale-[0.98]"
      >
        Enter the gallery
      </button>
    </Modal>
  );
}
