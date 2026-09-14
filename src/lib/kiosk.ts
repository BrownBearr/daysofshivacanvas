import { cameraState } from "../canvas/camera-state";
import { RUNTIME } from "../runtime";

// Browser-level behaviours for an unattended machine at a showing. Nothing here runs on the web
// build: suppressing a visitor's context menu or hiding their cursor on their own laptop would be
// hostile, but on a kiosk they're the difference between an artwork and a browser window.

let installed = false;

export function installKioskBehaviour(): () => void {
  if (!RUNTIME.lockDownBrowserChrome && RUNTIME.hideCursorIdleMs === 0) return () => {};
  if (installed) return () => {};
  installed = true;

  const cleanups: Array<() => void> = [];
  const on = <K extends keyof DocumentEventMap>(
    target: Document | Window,
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    opts?: AddEventListenerOptions
  ) => {
    target.addEventListener(type, handler as EventListener, opts);
    cleanups.push(() => target.removeEventListener(type, handler as EventListener, opts));
  };

  if (RUNTIME.lockDownBrowserChrome) {
    on(document, "contextmenu", (e) => e.preventDefault());
    on(document, "selectstart", (e) => e.preventDefault());
    on(document, "dragstart", (e) => e.preventDefault());
    // Trackpad pinch and ctrl+wheel both arrive as a wheel event with ctrlKey set, and both zoom
    // the whole page rather than the canvas.
    on(
      document,
      "wheel",
      (e) => {
        if (e.ctrlKey) e.preventDefault();
      },
      { passive: false }
    );
    // iPad/Safari pinch.
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      const handler = (e: Event) => e.preventDefault();
      document.addEventListener(type, handler);
      cleanups.push(() => document.removeEventListener(type, handler));
    }
    on(document, "keydown", (e) => {
      // Ctrl/Cmd +/-/0 page zoom.
      if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
    });

    // A fullscreen request is only honoured from inside a user gesture, so it can't be done at boot.
    const goFullscreen = () => {
      document.documentElement.requestFullscreen?.().catch(() => {});
      document.removeEventListener("pointerdown", goFullscreen);
    };
    on(document, "pointerdown", goFullscreen, { once: true });
  }

  if (RUNTIME.hideCursorIdleMs > 0) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hidden = false;

    const show = () => {
      if (hidden) {
        hidden = false;
        document.body.style.cursor = "";
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Never hide the cursor mid-drag; the grab cursor is feedback the visitor needs.
        if (cameraState.isDragging) return;
        hidden = true;
        document.body.style.cursor = "none";
      }, RUNTIME.hideCursorIdleMs);
    };

    on(window, "pointermove", show);
    on(window, "pointerdown", show);
    on(window, "keydown", show);
    show();
    cleanups.push(() => {
      if (timer) clearTimeout(timer);
      document.body.style.cursor = "";
    });
  }

  return () => {
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    installed = false;
  };
}
