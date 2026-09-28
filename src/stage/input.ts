// Pointer, wheel and keyboard -> engine. Pointer Events cover mouse, pen and touch in one path.
import { actions, appStore } from "../state/store";
import {
  currentView,
  fieldDrag,
  fieldPan,
  fieldZoom,
  isLocked,
  pick,
  pointer,
  railBy,
  railDragging,
  railIndex,
  railStepPx,
  railTo,
} from "./engine";
import { requestFrame } from "./frame";

const CLICK_PX = 5;
const TOUCH_CLICK_PX = 12;

export function installInput(canvas: HTMLCanvasElement): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let startX = 0;
  let startY = 0;
  let moved = 0;
  let pinchDist = 0;
  let railStart = 0;
  let railAccum = 0;
  let lastMoveT = 0;
  let railVel = 0;
  let pendingTap: { x: number; y: number; touch: boolean } | null = null;

  const openAt = (x: number, y: number, touch: boolean) => {
    const s = pick(x, y, touch);
    if (!s?.clip) return;
    const view = currentView();
    // On a rail, a card off-centre comes to the front first; the front card opens.
    if (view && view !== "field" && s.index !== railIndex()) {
      railTo(s.index);
      return;
    }
    actions.focus(s.clip.name);
  };

  const onDown = (e: PointerEvent) => {
    if (isLocked()) return;
    // A primary pointer starts a new gesture. Drop anything left from the last one: a finger whose
    // up event went missing would otherwise make every later tap look like the second finger of a pinch.
    if (e.isPrimary) active.clear();
    canvas.setPointerCapture(e.pointerId);
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointer.mouse = e.pointerType === "mouse";
    if (active.size === 1) {
      startX = e.clientX;
      startY = e.clientY;
      moved = 0;
      railAccum = 0;
      railVel = 0;
      lastMoveT = performance.now();
      railStart = railIndex();
      pointer.dragging = false;
    } else if (active.size === 2) {
      const [a, b] = [...active.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.inside = true;
    pointer.mouse = e.pointerType === "mouse";
    const prev = active.get(e.pointerId);
    if (!prev || isLocked()) {
      requestFrame();
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    const view = currentView();

    if (active.size === 2) {
      const [a, b] = [...active.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (view === "field") fieldZoom((pinchDist - d) * 1.2);
      pinchDist = d;
      pointer.dragging = true;
      return;
    }

    moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
    const touch = e.pointerType !== "mouse";
    if (!pointer.dragging && moved > (touch ? TOUCH_CLICK_PX : CLICK_PX)) {
      pointer.dragging = true;
      if (view !== "field") railDragging(true);
      document.body.style.cursor = "grabbing";
    }
    if (!pointer.dragging) return;

    if (view === "field") fieldDrag(dx, dy, touch);
    else {
      // Flow scrubs horizontally, the card file vertically.
      const along = view === "flow" ? -dx : -dy;
      const step = railStepPx();
      railAccum += along / step;
      const now = performance.now();
      const dt = Math.max(1, now - lastMoveT);
      railVel = railVel * 0.6 + (along / step / dt) * 1000 * 0.4;
      lastMoveT = now;
      railTo(railStart + railAccum);
      railDragging(true);
    }
  };

  const onUp = (e: PointerEvent) => {
    const had = active.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!had || active.size > 0) return;
    document.body.style.cursor = "";
    const view = currentView();
    if (pointer.dragging) {
      if (view !== "field") {
        // A flick carries on a few cards before settling.
        railBy(railVel * 0.18);
        railDragging(false);
      }
      // Cleared after this event so the click that follows a drag is ignored.
      setTimeout(() => {
        pointer.dragging = false;
        requestFrame();
      }, 0);
      return;
    }
    // Open on the click that follows, not here. Opening on pointerup put the player's backdrop
    // under the browser's own click a few ms later, which closed it again.
    const r = canvas.getBoundingClientRect();
    const tap = { x: e.clientX - r.left, y: e.clientY - r.top, touch: e.pointerType !== "mouse" };
    pendingTap = tap;
    // Fallback in case no click arrives (some browsers drop it after a long press).
    setTimeout(() => {
      if (pendingTap === tap) {
        pendingTap = null;
        openAt(tap.x, tap.y, tap.touch);
      }
    }, 450);
  };

  const onClick = () => {
    const tap = pendingTap;
    pendingTap = null;
    if (tap) openAt(tap.x, tap.y, tap.touch);
  };

  // The browser took the gesture over (scroll, system swipe). Forget it; never treat it as a tap.
  const onCancel = (e: PointerEvent) => {
    active.delete(e.pointerId);
    if (active.size > 0) return;
    document.body.style.cursor = "";
    if (pointer.dragging && currentView() !== "field") railDragging(false);
    pointer.dragging = false;
    requestFrame();
  };

  const onLeave = () => {
    pointer.inside = false;
    requestFrame();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (isLocked()) return;
    const view = currentView();
    const scale = e.deltaMode === 1 ? 16 : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    if (view === "field") {
      // Pinch on a trackpad arrives as ctrl+wheel. A horizontal component means two-finger pan;
      // a purely vertical wheel is a mouse wheel and zooms.
      if (e.ctrlKey) fieldZoom(dy * 3);
      else if (dx !== 0 || (Math.abs(dy) < 40 && !Number.isInteger(dy))) fieldPan(dx, dy);
      else fieldZoom(dy);
    } else {
      railBy((Math.abs(dx) > Math.abs(dy) ? dx : dy) * 0.006);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (isLocked() || appStore.getState().aboutOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const view = currentView();
    if (!view) return;
    if (view === "field") {
      const step = 18;
      if (e.key === "ArrowLeft") fieldPan(-step * 4, 0);
      else if (e.key === "ArrowRight") fieldPan(step * 4, 0);
      else if (e.key === "ArrowUp") fieldPan(0, -step * 4);
      else if (e.key === "ArrowDown") fieldPan(0, step * 4);
      else if (e.key === "+" || e.key === "=") fieldZoom(-120);
      else if (e.key === "-") fieldZoom(120);
      else return;
    } else {
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
      if (back || fwd) railBy(back ? -1 : 1, true);
      else if (e.key === "Enter" || e.key === " ") {
        const name = appStore.getState().ordered[railIndex()]?.name;
        if (name) actions.focus(name);
      } else return;
    }
    e.preventDefault();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onCancel);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
  };
}
