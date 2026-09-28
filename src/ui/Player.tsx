import { CaretLeft, CaretRight, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { posterUrl, sourceUrl } from "../lib/clip-source";
import { formatDay } from "../lib/days";
import { railTo, rectOf, setHidden } from "../stage/engine";
import { styleLabel } from "../state/sort";
import { actions, appStore, useApp } from "../state/store";
import type { ClipData } from "../types";

// Clips are 16:9 (posters are 712x400). The frame is sized from that before any video metadata
// arrives, so the morph target never has to change mid-flight.
const ASPECT = 712 / 400;

type Rect = { x: number; y: number; w: number; h: number };

/** Where a clip's thumbnail is on screen right now: a canvas tile, or a cell in the index view. */
export function originRect(name: string): Rect | null {
  if (appStore.getState().view === "index") {
    const el = document.querySelector<HTMLElement>(`[data-clip="${CSS.escape(name)}"] [data-thumb]`);
    const r = el?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return rectOf(name);
}

function frameRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < 640;
  const padX = mobile ? 12 : 40;
  const top = mobile ? 64 : 72;
  const bottom = mobile ? 132 : 112;
  let w = vw - padX * 2;
  let h = w / ASPECT;
  const maxH = vh - top - bottom;
  if (h > maxH) {
    h = maxH;
    w = h * ASPECT;
  }
  return { x: (vw - w) / 2, y: top + (maxH - h) / 2, w, h };
}

/**
 * Motion values that make the full frame `f` look exactly like the square thumbnail `o`: scale so
 * the heights match, then clip the sides so only the centred square shows.
 */
function morphFrom(o: Rect | null, f: Rect) {
  if (!o) return { x: 0, y: 12, scale: 0.97, clipPath: "inset(0px 0px 0px 0px)", opacity: 0 };
  const k = o.h / f.h;
  const inset = Math.max(0, (f.w - o.w / k) / 2);
  return { x: o.x - f.x - inset * k, y: o.y - f.y, scale: k, clipPath: `inset(0px ${inset}px 0px ${inset}px)`, opacity: 1 };
}

const TO = { x: 0, y: 0, scale: 1, clipPath: "inset(0px 0px 0px 0px)", opacity: 1 };
const SPRING = { type: "spring", stiffness: 210, damping: 30, mass: 1 } as const;

function Media({ clip }: { clip: ClipData }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const muted = useApp((s) => s.muted);
  const volume = useApp((s) => s.volume);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    el.volume = volume;
  }, [muted, volume]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Opening came from a click, so sound is usually allowed. If the browser still refuses,
    // fall back to muted rather than showing a frozen frame.
    el.play().catch(() => {
      actions.setMuted(true);
      el.muted = true;
      el.play().catch(() => {});
    });
  }, []);

  return (
    <>
      <img
        src={posterUrl(clip)}
        crossOrigin="anonymous"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* biome-ignore lint/a11y/useMediaCaption: the clips are wordless art pieces; there is nothing to caption. */}
      <video
        ref={ref}
        src={sourceUrl(clip)}
        crossOrigin="anonymous"
        loop
        playsInline
        preload="auto"
        onPlaying={() => setPlaying(true)}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity: playing ? 1 : 0 }}
      />
    </>
  );
}

function Controls({
  clip,
  index,
  total,
  onStep,
  onClose,
}: {
  clip: ClipData;
  index: number;
  total: number;
  onStep: (d: number) => void;
  onClose: () => void;
}) {
  const muted = useApp((s) => s.muted);
  const volume = useApp((s) => s.volume);
  const pct = Math.round((muted ? 0 : volume) * 100);
  const iconBtn =
    "grid h-10 w-10 place-items-center rounded-full text-[var(--pc)] transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-30";

  return (
    <div
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      style={{ ["--pc" as string]: "#ececea" }}
    >
      <div className="min-w-0 text-[#ececea]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={clip.name}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="text-xl leading-tight font-semibold">Day {clip.name}</div>
            <div className="truncate text-sm text-[#9b9b98]">
              {formatDay(clip.name)}
              <span className="px-1.5">/</span>
              {styleLabel(clip.name)}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="-ml-2.5 flex shrink-0 items-center gap-1 sm:ml-0">
        <div className="mr-2 hidden items-center gap-2 text-[#ececea] sm:flex">
          <input
            type="range"
            className="vol w-20"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => actions.setVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ background: `linear-gradient(to right, #ececea ${pct}%, rgb(236 236 234 / 0.2) ${pct}%)` }}
          />
        </div>
        <button type="button" className={iconBtn} onClick={() => actions.setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"}>
          {muted || volume === 0 ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
        </button>
        <button type="button" className={iconBtn} onClick={() => onStep(-1)} disabled={index <= 0} aria-label="Previous clip">
          <CaretLeft size={20} />
        </button>
        <span className="w-16 text-center text-sm text-[#9b9b98] tabular-nums">
          {index + 1} / {total}
        </span>
        <button type="button" className={iconBtn} onClick={() => onStep(1)} disabled={index >= total - 1} aria-label="Next clip">
          <CaretRight size={20} />
        </button>
        <button type="button" className={`${iconBtn} ml-1`} onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

function PlayerInner({ name, exitRect }: { name: string; exitRect: React.RefObject<Rect | null> }) {
  const ordered = useApp((s) => s.ordered);
  const view = useApp((s) => s.view);
  const reduce = useReducedMotion();
  const index = ordered.findIndex((c) => c.name === name);
  const clip = ordered[index] ?? { id: -1, name };
  const [frame, setFrame] = React.useState(frameRect);
  // Captured once at open: the morph starts from wherever the thumbnail was when clicked.
  const [from] = React.useState(() => morphFrom(originRect(name), frameRect()));
  const dialog = React.useRef<HTMLDivElement>(null);
  const openedAt = React.useRef(performance.now());

  React.useLayoutEffect(() => setHidden(name), [name]);

  React.useEffect(() => {
    const onResize = () => setFrame(frameRect());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const close = React.useCallback(() => {
    exitRect.current = originRect(name);
    actions.focus(null);
  }, [name, exitRect]);

  const step = React.useCallback(
    (d: number) => {
      const next = ordered[index + d];
      if (!next) return;
      // On a rail the cards glide along behind the player so closing lands on the right one.
      if (view === "flow" || view === "stack") railTo(index + d);
      actions.focus(next.name);
    },
    [ordered, index, view]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "m") actions.setMuted(!appStore.getState().muted);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, step]);

  React.useEffect(() => {
    dialog.current?.focus();
  }, []);

  return (
    <motion.div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Day ${name}`}
      tabIndex={-1}
      className="fixed inset-0 z-40 outline-none"
    >
      <motion.div
        className="absolute inset-0 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.3 } }}
        transition={{ duration: 0.35 }}
        onClick={() => {
          // Ignore the click that opened us, if it lands here after the player mounts.
          if (performance.now() - openedAt.current > 350) close();
        }}
      />
      <motion.div
        className="absolute overflow-hidden bg-[#1a1a1c] will-change-transform"
        style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, transformOrigin: "0 0" }}
        initial={reduce ? { opacity: 0 } : from}
        animate={TO}
        exit="exit"
        variants={{
          exit: () => {
            if (reduce) return { opacity: 0 };
            const r = exitRect.current;
            return r
              ? { ...morphFrom(r, frameRect()), transition: SPRING }
              : { opacity: 0, scale: 0.97, transition: { duration: 0.25 } };
          },
        }}
        transition={SPRING}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={clip.name}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Media clip={clip} />
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <motion.div
        className="absolute"
        style={{ left: frame.x, top: frame.y + frame.h + 14, width: frame.w }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.2, duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
      >
        <Controls clip={clip} index={index} total={ordered.length} onStep={step} onClose={close} />
      </motion.div>
    </motion.div>
  );
}

export function Player() {
  const focused = useApp((s) => s.focused);
  const exitRect = React.useRef<Rect | null>(null);
  const last = React.useRef<string | null>(null);

  // Closing via Back skips close(), so capture the landing rect whenever focus clears.
  if (focused) last.current = focused;
  else if (last.current && exitRect.current === null) exitRect.current = originRect(last.current);

  return (
    <AnimatePresence
      onExitComplete={() => {
        exitRect.current = null;
        last.current = null;
        setHidden(null);
      }}
    >
      {focused && <PlayerInner key="player" name={focused} exitRect={exitRect} />}
    </AnimatePresence>
  );
}
