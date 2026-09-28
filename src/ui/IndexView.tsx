import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { posterUrl, previewUrl } from "../lib/clip-source";
import { formatDay } from "../lib/days";
import { atlasCss } from "../stage/atlas";
import { STYLE_CLUSTERS, styleOf } from "../state/sort";
import { actions, useApp } from "../state/store";
import type { ClipData } from "../types";

// The fast way to find a specific day: a plain scrolling grid. Cells render lazily through
// `content-visibility`, so ~700 of them cost about as much as the ones on screen.

interface Group {
  label: string | null;
  clips: ClipData[];
}

function groupsFor(ordered: ClipData[], sort: string): Group[] {
  if (sort !== "day" && sort !== "style") return [{ label: null, clips: ordered }];
  const out: Group[] = [];
  for (const c of ordered) {
    const label =
      sort === "day" ? formatDay(c.name).slice(-4) : (STYLE_CLUSTERS.find((s) => s.id === styleOf(c.name))?.label ?? "unsorted");
    const g = out[out.length - 1];
    if (g && g.label === label) g.clips.push(c);
    else out.push({ label, clips: [c] });
  }
  return out;
}

const Cell = React.memo(function Cell({
  clip,
  order,
  hovered,
  onHover,
}: {
  clip: ClipData;
  order: number;
  hovered: boolean;
  onHover: (n: string | null) => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const reduce = useReducedMotion();
  const sprite = atlasCss(clip.name);
  // Only the first screenful staggers in; everything below just appears as it scrolls into view.
  const animate = order < 48 && !reduce;

  return (
    <motion.li
      data-clip={clip.name}
      className="index-cell"
      initial={animate ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: animate ? order * 0.012 : 0, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        type="button"
        onClick={() => actions.focus(clip.name)}
        onPointerEnter={(e) => e.pointerType === "mouse" && onHover(clip.name)}
        onPointerLeave={() => onHover(null)}
        className="group block w-full text-left"
        aria-label={`Day ${clip.name}, ${formatDay(clip.name)}`}
      >
        <div
          data-thumb
          className="relative aspect-square w-full overflow-hidden bg-line transition-transform duration-500 ease-out-expo group-hover:scale-[1.03] group-active:scale-[0.98]"
          style={
            sprite
              ? {
                  backgroundImage: `url(${sprite.url})`,
                  backgroundSize: `${(sprite.w / sprite.cell) * 100}% ${(sprite.h / sprite.cell) * 100}%`,
                  backgroundPosition: `${(sprite.x / Math.max(1, sprite.w - sprite.cell)) * 100}% ${(sprite.y / Math.max(1, sprite.h - sprite.cell)) * 100}%`,
                }
              : undefined
          }
        >
          <img
            src={posterUrl(clip)}
            // CORS mode like the stage's fetches, so the two never share a non-CORS cache entry.
            crossOrigin="anonymous"
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
            style={{ opacity: loaded ? 1 : 0 }}
          />
          {hovered && (
            <video
              src={previewUrl(clip)}
              crossOrigin="anonymous"
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2 text-[13.5px]">
          <span className="font-medium text-ink">{clip.name}</span>
          <span className="truncate text-dim">{formatDay(clip.name)}</span>
        </div>
      </button>
    </motion.li>
  );
});

export default function IndexView() {
  const ordered = useApp((s) => s.ordered);
  const sort = useApp((s) => s.sort);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const groups = React.useMemo(() => groupsFor(ordered, sort), [ordered, sort]);
  let order = 0;

  return (
    <div className="no-scrollbar fixed inset-0 z-10 overflow-y-auto bg-bg">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 h-20 bg-gradient-to-b from-bg via-bg/85 to-transparent" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-36 bg-gradient-to-t from-bg via-bg/80 to-transparent" />
      <div className="mx-auto max-w-[1400px] px-4 pt-20 pb-36 sm:px-8">
        <p className="mb-6 text-[15px] text-dim">
          <span className="font-semibold text-ink">{ordered.length}</span> clips
        </p>
        {groups.map((g) => (
          <section key={g.label ?? "all"} className="mb-10">
            {g.label && (
              <h2 className="sticky top-0 z-10 -mx-4 mb-4 bg-bg/95 px-4 py-3 text-lg font-medium text-ink sm:-mx-8 sm:px-8">
                {g.label}
                <span className="ml-2 text-dim">{g.clips.length}</span>
              </h2>
            )}
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] sm:gap-x-5 sm:gap-y-8">
              {g.clips.map((c) => (
                <Cell key={c.name} clip={c} order={order++} hovered={hovered === c.name} onHover={setHovered} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
