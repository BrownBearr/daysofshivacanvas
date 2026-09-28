import {
  ArrowDown,
  ArrowUp,
  CardsThree,
  Check,
  FunnelSimple,
  GridFour,
  type Icon,
  Moon,
  Rows,
  Shuffle,
  Stack,
  Sun,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import * as React from "react";
import { STYLE_CLUSTERS } from "../state/sort";
import { actions, useApp } from "../state/store";
import type { SortId, ViewId } from "../types";
import { Popover } from "./Popover";
import { useResolvedTheme } from "./theme";

const VIEWS: { id: ViewId; label: string; icon: Icon; key: string }[] = [
  { id: "field", label: "Field", icon: GridFour, key: "1" },
  { id: "flow", label: "Flow", icon: CardsThree, key: "2" },
  { id: "stack", label: "Stack", icon: Stack, key: "3" },
  { id: "index", label: "Index", icon: Rows, key: "4" },
];

const SORTS: { id: SortId; label: string }[] = [
  { id: "shuffle", label: "Shuffle" },
  { id: "day", label: "Day" },
  { id: "style", label: "Style" },
  { id: "similar", label: "Similarity" },
];

const press = { whileTap: { scale: 0.94 }, transition: { type: "spring", stiffness: 600, damping: 30 } } as const;
const btn =
  "relative grid h-10 min-w-10 place-items-center rounded-full px-2.5 text-dim transition-colors duration-200 hover:text-ink";

function ViewSwitch() {
  const view = useApp((s) => s.view);
  return (
    <div className="flex items-center" role="radiogroup" aria-label="View">
      {VIEWS.map((v) => {
        const on = v.id === view;
        return (
          <motion.button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={v.label}
            title={`${v.label} (${v.key})`}
            onClick={() => actions.setView(v.id)}
            className={`${btn} ${on ? "text-accent-ink hover:text-accent-ink" : ""}`}
            {...press}
          >
            {on && (
              <motion.span
                layoutId="view-pill"
                className="absolute inset-0 rounded-full bg-accent"
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
              />
            )}
            <v.icon size={19} weight={on ? "fill" : "regular"} className="relative" />
          </motion.button>
        );
      })}
    </div>
  );
}

function SortControl() {
  const sort = useApp((s) => s.sort);
  const dir = useApp((s) => s.dir);
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLButtonElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  const label = SORTS.find((s) => s.id === sort)?.label ?? "";
  const DirIcon = sort === "shuffle" ? Shuffle : dir === "asc" ? ArrowUp : ArrowDown;

  return (
    // No `relative` here: panels position against the dock, so they stay centred on narrow screens.
    <div>
      <motion.button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Sort: ${label}`}
        onClick={() => setOpen((o) => !o)}
        className={`${btn} gap-1.5 !px-3.5 ${open ? "text-ink" : ""}`}
        {...press}
      >
        <span className="flex items-center gap-1.5">
          <DirIcon size={16} />
          <span className="hidden text-[15px] font-medium sm:inline">{label}</span>
        </span>
      </motion.button>
      <Popover open={open} onClose={close} anchorRef={anchor} label="Sort" className="left-1/2 w-56 -translate-x-1/2">
        <ul className="flex flex-col">
          {SORTS.map((s) => {
            const on = s.id === sort;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => actions.setSort(s.id)}
                  className="flex h-10 w-full items-center justify-between rounded-full px-3.5 text-left text-[15px] transition-colors hover:bg-line"
                >
                  <span className={on ? "font-semibold text-ink" : "text-dim"}>{s.label}</span>
                  {on &&
                    (s.id === "shuffle" ? (
                      <span className="text-xs text-dim">again</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-dim">
                        {dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                        {dir === "asc" ? "oldest" : "newest"}
                      </span>
                    ))}
                  {!on && <Check size={14} className="opacity-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}

function FilterControl() {
  const styles = useApp((s) => s.styles);
  const ordered = useApp((s) => s.ordered);
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLButtonElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  const [day, setDay] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const goToDay = (e: React.FormEvent) => {
    e.preventDefault();
    const name = day.trim();
    if (!name) return;
    if (!ordered.some((c) => c.name === name)) {
      setErr(styles.length ? `Day ${name} isn't in the selected styles.` : `Day ${name} isn't on the site.`);
      return;
    }
    setErr(null);
    setOpen(false);
    actions.focus(name);
  };

  return (
    // No `relative` here: panels position against the dock, so they stay centred on narrow screens.
    <div>
      <motion.button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={styles.length ? `Filter: ${styles.length} styles` : "Filter and find"}
        onClick={() => setOpen((o) => !o)}
        className={`${btn} ${open ? "text-ink" : ""}`}
        {...press}
      >
        <FunnelSimple size={19} weight={styles.length ? "fill" : "regular"} className={styles.length ? "text-accent" : ""} />
        {styles.length > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink"
          >
            {styles.length}
          </motion.span>
        )}
      </motion.button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchor}
        label="Filter and find"
        className="left-1/2 w-[min(92vw,440px)] -translate-x-1/2 !p-4"
      >
        <form onSubmit={goToDay} className="flex flex-col gap-2">
          <label htmlFor="goto-day" className="text-sm font-medium text-ink">
            Go to day
          </label>
          <div className="flex gap-2">
            <input
              id="goto-day"
              inputMode="numeric"
              pattern="[0-9]*"
              value={day}
              onChange={(e) => {
                setDay(e.target.value.replace(/\D/g, ""));
                setErr(null);
              }}
              aria-describedby={err ? "goto-err" : undefined}
              aria-invalid={!!err}
              className="h-10 min-w-0 flex-1 rounded-full border border-line bg-bg px-4 text-[15px] text-ink outline-none transition-colors focus:border-accent"
            />
            <button
              type="submit"
              className="h-10 rounded-full bg-ink px-4 text-[15px] font-medium text-bg transition-transform active:scale-[0.97]"
            >
              Open
            </button>
          </div>
          {err && (
            <p id="goto-err" className="text-sm text-dim">
              {err}
            </p>
          )}
        </form>

        <div className="mt-5 mb-2 flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink">Styles</span>
          {styles.length > 0 && (
            <button
              type="button"
              onClick={actions.clearStyles}
              className="text-sm text-dim underline-offset-2 hover:text-ink hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="no-scrollbar -mx-1 flex max-h-[42dvh] flex-wrap gap-1.5 overflow-y-auto px-1 pb-1">
          {STYLE_CLUSTERS.map((c) => {
            const on = styles.includes(c.id);
            return (
              <motion.button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => actions.toggleStyle(c.id)}
                layout="position"
                className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13.5px] transition-colors ${
                  on ? "border-accent bg-accent text-accent-ink" : "border-line text-dim hover:text-ink"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                {c.label}
                <span className={on ? "opacity-70" : "text-faint"}>{c.count}</span>
              </motion.button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

function ThemeToggle() {
  const resolved = useResolvedTheme();
  const dark = resolved === "dark";
  return (
    <motion.button
      type="button"
      aria-label={dark ? "Light mode" : "Dark mode"}
      onClick={() => actions.setTheme(dark ? "light" : "dark")}
      className={btn}
      {...press}
    >
      <motion.span key={resolved} initial={{ rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} className="grid">
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </motion.span>
    </motion.button>
  );
}

export function Dock() {
  // Number keys switch views, matching the order in the dock.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) actions.setView(v.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <motion.nav
      aria-label="Gallery controls"
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 30, delay: 0.25 }}
      className="fixed bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface p-1 shadow-float"
    >
      <ViewSwitch />
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <SortControl />
      <FilterControl />
      <ThemeToggle />
    </motion.nav>
  );
}
