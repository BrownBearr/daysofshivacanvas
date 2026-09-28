// One store for everything the visitor chooses. Vanilla zustand so the stage's frame loop can read
// and subscribe without React; UI components use the `useApp` hook.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ClipData, SortDir, SortId, ThemePref, ViewId } from "../types";
import { ALL_CLIPS, orderClips } from "./sort";

export interface AppState {
  view: ViewId;
  sort: SortId;
  dir: SortDir;
  styles: number[];
  seed: number;
  /** Clips in display order after sort + filter. Recomputed only when those inputs change. */
  ordered: ClipData[];
  /** Name of the clip open in the player. */
  focused: string | null;
  theme: ThemePref;
  muted: boolean;
  volume: number;
  aboutOpen: boolean;
}

const VIEWS: ViewId[] = ["field", "flow", "stack", "index"];
const SORTS: SortId[] = ["day", "style", "similar", "shuffle"];

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem("days:theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function fromUrl(): Partial<AppState> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const out: Partial<AppState> = {};
  const v = q.get("v") as ViewId | null;
  if (v && VIEWS.includes(v)) out.view = v;
  const s = q.get("s") as SortId | null;
  if (s && SORTS.includes(s)) out.sort = s;
  if (q.get("d") === "desc") out.dir = "desc";
  const st = q.get("st");
  if (st)
    out.styles = st
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n));
  const c = q.get("c");
  out.focused = c && ALL_CLIPS.some((x) => x.name === c) ? c : null;
  return out;
}

function initial(): AppState {
  const base = {
    view: "field" as ViewId,
    sort: "shuffle" as SortId,
    dir: "asc" as SortDir,
    styles: [] as number[],
    seed: newSeed(),
    focused: null,
    theme: readTheme(),
    muted: false,
    volume: 0.8,
    aboutOpen: false,
    ...fromUrl(),
  };
  return { ...base, ordered: orderClips(base) };
}

export const appStore = createStore<AppState>()(() => initial());

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

// ---- actions ------------------------------------------------------------------------------

function reorder(patch: Partial<AppState>) {
  const next = { ...appStore.getState(), ...patch };
  appStore.setState({ ...patch, ordered: orderClips(next) });
}

export const actions = {
  setView(view: ViewId) {
    if (appStore.getState().view !== view) appStore.setState({ view });
  },
  setSort(sort: SortId) {
    const s = appStore.getState();
    // Picking shuffle again is the "reshuffle" gesture.
    if (sort === "shuffle") reorder({ sort, seed: s.sort === "shuffle" ? newSeed() : s.seed });
    else if (s.sort === sort) reorder({ dir: s.dir === "asc" ? "desc" : "asc" });
    else reorder({ sort, dir: "asc" });
  },
  toggleStyle(id: number) {
    const cur = appStore.getState().styles;
    reorder({ styles: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
  clearStyles() {
    if (appStore.getState().styles.length) reorder({ styles: [] });
  },
  focus(name: string | null) {
    const s = appStore.getState();
    if (s.focused === name) return;
    if (name && !s.focused) {
      // Opening pushes a history entry so Back closes the player.
      suppressUrl = true;
      appStore.setState({ focused: name });
      suppressUrl = false;
      writeUrl("push");
      focusPushed = true;
      return;
    }
    if (!name && focusPushed) {
      focusPushed = false;
      history.back();
      return;
    }
    appStore.setState({ focused: name });
  },
  setTheme(theme: ThemePref) {
    try {
      if (theme === "system") localStorage.removeItem("days:theme");
      else localStorage.setItem("days:theme", theme);
    } catch {
      // Storage blocked: the choice still applies for this visit.
    }
    appStore.setState({ theme });
  },
  setMuted(muted: boolean) {
    appStore.setState({ muted });
  },
  setVolume(volume: number) {
    appStore.setState({ volume, muted: volume === 0 ? appStore.getState().muted : false });
  },
  setAbout(aboutOpen: boolean) {
    appStore.setState({ aboutOpen });
  },
};

// ---- URL sync -----------------------------------------------------------------------------

let focusPushed = false;
let suppressUrl = false;

function urlFor(s: AppState): string {
  const q = new URLSearchParams();
  if (s.view !== "field") q.set("v", s.view);
  if (s.sort !== "shuffle") q.set("s", s.sort);
  if (s.dir === "desc") q.set("d", "desc");
  if (s.styles.length) q.set("st", s.styles.join(","));
  if (s.focused) q.set("c", s.focused);
  const qs = q.toString();
  return `${window.location.pathname}${qs ? `?${qs}` : ""}`;
}

function writeUrl(mode: "push" | "replace") {
  const url = urlFor(appStore.getState());
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

export function installUrlSync(): () => void {
  const unsub = appStore.subscribe((s, prev) => {
    if (suppressUrl) return;
    if (s.view !== prev.view || s.ordered !== prev.ordered || s.focused !== prev.focused) writeUrl("replace");
  });
  const onPop = () => {
    focusPushed = false;
    const u = fromUrl();
    const s = appStore.getState();
    const patch: Partial<AppState> = { focused: u.focused ?? null };
    if (u.view && u.view !== s.view) patch.view = u.view;
    appStore.setState(patch);
  };
  window.addEventListener("popstate", onPop);
  return () => {
    unsub();
    window.removeEventListener("popstate", onPop);
  };
}
