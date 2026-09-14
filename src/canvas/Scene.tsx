import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import { RUNTIME } from "../runtime";
import { CAMERA_FOV, INITIAL_CAM_Z, MAX_CAM_Z, MIN_CAM_Z } from "../theme";
import type { ClipData } from "../types";
import { cancelAttract, updateAttract } from "./attract";
import { cameraState, markInput, setRequestRender, unfocusTile } from "./camera-state";
import { Grid } from "./Grid";

// All motion constants are per-second, not per-frame.
//
// The previous version added raw velocity to the camera position once per frame with no delta term,
// which made pan and zoom speed scale with refresh rate — 2x faster on a 120Hz display, and slower
// on a machine that was already struggling, which fed back on itself. Worse, the old cap of 1.8
// units/frame exceeded TILE_SPACING (1.568), so a hard fling crossed a tile boundary every single
// frame and forced the grid to rebuild its visible window on the frame that could least afford it.
//
// MAX_VEL is now chosen so that one frame at 60Hz always covers less than one tile:
//   55 / 60 = 0.92 world units < TILE_SPACING (1.568)
const MAX_VEL = 55;
const VEL_APPROACH = 6.3;
const TARGET_DECAY = 9.8;
const SCROLL_TRANSFER = 21;
const DRAG_SENSITIVITY = 0.72;
const TOUCH_DRAG_SENSITIVITY = 0.6;
const SCROLL_SENSITIVITY = 0.15;
const CLICK_THRESHOLD = 5;
const TOUCH_CLICK_THRESHOLD = 15;
// Below this (world units/second) motion is treated as settled and the demand loop stops asking
// for frames.
const MOTION_EPS = 0.01;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function CameraController() {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const maxDragDist = React.useRef(0);

  React.useEffect(() => {
    // Focus/unfocus fire from React handlers outside the loop, so they need a way to kick the
    // demand frameloop or their animation would never advance.
    setRequestRender(invalidate);

    const canvas = gl.domElement;
    const body = document.body;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - cameraState.lastMouse.x;
      const dy = e.clientY - cameraState.lastMouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDragDist.current) maxDragDist.current = dist;
      if (maxDragDist.current > CLICK_THRESHOLD) cameraState.isDragging = true;
      if (cameraState.isDragging) {
        cameraState.targetVel.x -= dx * DRAG_SENSITIVITY;
        cameraState.targetVel.y += dy * DRAG_SENSITIVITY;
        // Mutated in place: this fires up to 144 times a second.
        cameraState.lastMouse.x = e.clientX;
        cameraState.lastMouse.y = e.clientY;
        markInput();
        cancelAttract();
        invalidate();
      }
    };

    const onMouseUp = () => {
      body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      // Cleared after the click event has been dispatched, so a drag that ends over a tile is not
      // mistaken for a click on it.
      setTimeout(() => {
        cameraState.isDragging = false;
      }, 0);
    };

    const onMouseDown = (e: MouseEvent) => {
      cameraState.isDragging = false;
      maxDragDist.current = 0;
      cameraState.lastMouse.x = e.clientX;
      cameraState.lastMouse.y = e.clientY;
      body.style.cursor = "grabbing";
      markInput();
      cancelAttract();
      // Panning is tracked on window so a drag that leaves the canvas still lands. There is no
      // longer any need to disable canvas pointer events during a drag: tile hit-testing is
      // arithmetic now, not raycasting, so a mousemove costs nothing to ignore.
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraState.scrollAccum += e.deltaY * SCROLL_SENSITIVITY;
      markInput();
      cancelAttract();
      invalidate();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      markInput();
      cancelAttract();
      if (e.key === "Escape") {
        unfocusTile();
        invalidate();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      cameraState.isDragging = false;
      maxDragDist.current = 0;
      markInput();
      cancelAttract();
      if (e.touches.length === 1) {
        cameraState.lastTouchPos.x = e.touches[0].clientX;
        cameraState.lastTouchPos.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        cameraState.lastTouchDist = getTouchDistance(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      markInput();
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - cameraState.lastTouchPos.x;
        const dy = e.touches[0].clientY - cameraState.lastTouchPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDragDist.current) maxDragDist.current = dist;
        if (maxDragDist.current > TOUCH_CLICK_THRESHOLD) cameraState.isDragging = true;
        if (cameraState.isDragging) {
          cameraState.targetVel.x -= dx * TOUCH_DRAG_SENSITIVITY;
          cameraState.targetVel.y += dy * TOUCH_DRAG_SENSITIVITY;
        }
        cameraState.lastTouchPos.x = e.touches[0].clientX;
        cameraState.lastTouchPos.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dist = getTouchDistance(e.touches);
        cameraState.scrollAccum += (cameraState.lastTouchDist - dist) * SCROLL_SENSITIVITY;
        cameraState.lastTouchDist = dist;
      }
      invalidate();
    };

    const onTouchEnd = () => {
      setTimeout(() => {
        cameraState.isDragging = false;
      }, 0);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [gl, invalidate]);

  useFrame((_state, rawDelta) => {
    // The demand frameloop can hand back an arbitrarily long delta after an idle gap; unclamped,
    // that would teleport the camera on the first frame of a new interaction.
    const delta = Math.min(rawDelta, 1 / 30);
    const now = performance.now();
    const { pos, vel, targetVel } = cameraState;

    if (cameraState.focusedTileId !== null) {
      // Overlay open: lock panning and zoom while the video plays full-screen.
      cameraState.scrollAccum = 0;
      vel.set(0, 0, 0);
      targetVel.set(0, 0, 0);
      return;
    }

    // Hand accumulated wheel delta to the zoom axis over time rather than all at once, so a single
    // notch still eases instead of stepping.
    const transfer = 1 - Math.exp(-SCROLL_TRANSFER * delta);
    const dz = cameraState.scrollAccum * transfer;
    targetVel.z += dz;
    cameraState.scrollAccum -= dz;

    targetVel.x = clamp(targetVel.x, -MAX_VEL, MAX_VEL);
    targetVel.y = clamp(targetVel.y, -MAX_VEL, MAX_VEL);
    targetVel.z = clamp(targetVel.z, -MAX_VEL, MAX_VEL);

    const approach = 1 - Math.exp(-VEL_APPROACH * delta);
    vel.x += (targetVel.x - vel.x) * approach;
    vel.y += (targetVel.y - vel.y) * approach;
    vel.z += (targetVel.z - vel.z) * approach;

    pos.x += vel.x * delta;
    pos.y += vel.y * delta;

    const nextZ = clamp(pos.z + vel.z * delta, MIN_CAM_Z, MAX_CAM_Z);
    // At a zoom limit, drop the velocity instead of letting it accumulate against the clamp —
    // otherwise the zoom "sticks" and needs an equal scroll back before it responds.
    if (nextZ === pos.z && vel.z !== 0) {
      vel.z = 0;
      targetVel.z = 0;
      cameraState.scrollAccum = 0;
    }
    pos.z = nextZ;

    const decay = Math.exp(-TARGET_DECAY * delta);
    targetVel.x *= decay;
    targetVel.y *= decay;
    targetVel.z *= decay;

    const drifted = updateAttract(now, delta);

    cameraState.animTarget.copy(pos);
    camera.position.set(pos.x, pos.y, pos.z);

    // Demand frameloop: keep rendering only while there is residual motion left to show.
    if (
      drifted ||
      Math.abs(vel.x) > MOTION_EPS ||
      Math.abs(vel.y) > MOTION_EPS ||
      Math.abs(vel.z) > MOTION_EPS ||
      Math.abs(targetVel.x) > MOTION_EPS ||
      Math.abs(targetVel.y) > MOTION_EPS ||
      Math.abs(targetVel.z) > MOTION_EPS ||
      Math.abs(cameraState.scrollAccum) > MOTION_EPS
    ) {
      invalidate();
    }
  });

  return null;
}

interface SceneProps {
  clips: ClipData[];
  bgColor: string;
}

export function Scene({ clips, bgColor }: SceneProps) {
  return (
    <Canvas
      frameloop="demand"
      // `flat` keeps R3F from installing ACESFilmic tone mapping. Every material already opted out
      // per-material; this states the intent once instead.
      flat
      camera={{ position: [0, 0, INITIAL_CAM_Z], fov: CAMERA_FOV, near: 0.1, far: 100 }}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      // A [min, max] range rather than a fixed scalar, so R3F clamps the real device ratio instead
      // of being recomputed on every parent re-render.
      dpr={[1, RUNTIME.maxDpr]}
    >
      <color attach="background" args={[bgColor]} />
      <CameraController />
      <Grid clips={clips} />
    </Canvas>
  );
}
