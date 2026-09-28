import * as React from "react";
import { useApp } from "../state/store";

// Canvas clear colours, kept in step with --bg in index.css.
export const STAGE_BG = { light: "#f3f3f1", dark: "#0f0f10" } as const;

const darkQuery = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;

function subscribeSystem(fn: () => void) {
  darkQuery?.addEventListener("change", fn);
  return () => darkQuery?.removeEventListener("change", fn);
}

/** The theme actually in effect: the visitor's explicit choice, else the OS setting. */
export function useResolvedTheme(): "light" | "dark" {
  const pref = useApp((s) => s.theme);
  const systemDark = React.useSyncExternalStore(subscribeSystem, () => darkQuery?.matches ?? false);
  const resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  React.useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return resolved;
}
