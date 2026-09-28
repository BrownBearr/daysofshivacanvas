export interface ClipData {
  id: number;
  name: string; // day number; all B2 asset URLs are derived from this (see lib/clip-source)
}

export type ViewId = "field" | "flow" | "stack" | "index";
export type SortId = "day" | "style" | "similar" | "shuffle";
export type SortDir = "asc" | "desc";
export type ThemePref = "system" | "light" | "dark";
