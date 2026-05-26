import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { damp3 } from "maath/easing";
import { BG_COLOR, INITIAL_CAM_Z, MIN_CAM_Z, MAX_CAM_Z } from "../theme";
import { cameraState, unfocusTile } from "./camera-state";
import { Grid } from "./Grid";
import type { ClipData } from "../types";

const VELOCITY_LERP = 0.10;
const VELOCITY_DECAY = 0.85;
const MAX_VEL = 1.8;
const SCROLL_SENSITIVITY = 0.0025;
const DRAG_SENSITIVITY = 0.012;
const TOUCH_DRAG_SENSITIVITY = 0.010;
const CLICK_THRESHOLD = 5;
const TOUCH_CLICK_THRESHOLD = 15;
// maath damp3 smoothTime: approximate seconds to reach target — smaller = snappier (tune for feel)
const FOCUS_SMOOTH_TIME = 0.22;
const UNFOCUS_SMOOTH_TIME = 0.18;

function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function CameraController() {
  const { camera } = useThree();
  const maxDragDist = React.useRef(0);

  React.useEffect(() => {
    const body = document.body;

    const onMouseDown = (e: MouseEvent) => {
      cameraState.isDragging = false;
      maxDragDist.current = 0;
      cameraState.lastMouse = { x: e.clientX, y: e.clientY };
      body.style.cursor = "grabbing";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - cameraState.lastMouse.x;
      const dy = e.clientY - cameraState.lastMouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDragDist.current) maxDragDist.current = dist;
      if (maxDragDist.current > CLICK_THRESHOLD) cameraState.isDragging = true;
      if (cameraState.isDragging) {
        cameraState.targetVel.x -= dx * DRAG_SENSITIVITY;
        cameraState.targetVel.y += dy * DRAG_SENSITIVITY;
        cameraState.lastMouse = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseUp = () => {
      body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setTimeout(() => { cameraState.isDragging = false; }, 0);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraState.scrollAccum += e.deltaY * SCROLL_SENSITIVITY;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") unfocusTile();
    };

    const onTouchStart = (e: TouchEvent) => {
      cameraState.isDragging = false;
      maxDragDist.current = 0;
      if (e.touches.length === 1) {
        cameraState.lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        cameraState.lastTouchDist = getTouchDistance(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
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
        cameraState.lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dist = getTouchDistance(e.touches);
        cameraState.scrollAccum += (cameraState.lastTouchDist - dist) * SCROLL_SENSITIVITY;
        cameraState.lastTouchDist = dist;
      }
    };

    const onTouchEnd = () => { setTimeout(() => { cameraState.isDragging = false; }, 0); };

    const canvas = document.querySelector("canvas");
    canvas?.addEventListener("mousedown", onMouseDown);
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    canvas?.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas?.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas?.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      canvas?.removeEventListener("mousedown", onMouseDown);
      canvas?.removeEventListener("wheel", onWheel);
      canvas?.removeEventListener("touchstart", onTouchStart);
      canvas?.removeEventListener("touchmove", onTouchMove);
      canvas?.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useFrame((_, delta) => {
    // Velocity physics — only applied during free nav
    if (cameraState.focusedTileId === null && !cameraState.isAnimatingFocus) {
      cameraState.targetVel.z += cameraState.scrollAccum;
      cameraState.scrollAccum *= 0.7;

      cameraState.targetVel.x = Math.max(-MAX_VEL, Math.min(MAX_VEL, cameraState.targetVel.x));
      cameraState.targetVel.y = Math.max(-MAX_VEL, Math.min(MAX_VEL, cameraState.targetVel.y));
      cameraState.targetVel.z = Math.max(-MAX_VEL, Math.min(MAX_VEL, cameraState.targetVel.z));

      cameraState.vel.x += (cameraState.targetVel.x - cameraState.vel.x) * VELOCITY_LERP;
      cameraState.vel.y += (cameraState.targetVel.y - cameraState.vel.y) * VELOCITY_LERP;
      cameraState.vel.z += (cameraState.targetVel.z - cameraState.vel.z) * VELOCITY_LERP;

      cameraState.pos.x += cameraState.vel.x;
      cameraState.pos.y += cameraState.vel.y;
      cameraState.pos.z = Math.max(MIN_CAM_Z, Math.min(MAX_CAM_Z, cameraState.pos.z + cameraState.vel.z));

      cameraState.targetVel.x *= VELOCITY_DECAY;
      cameraState.targetVel.y *= VELOCITY_DECAY;
      cameraState.targetVel.z *= VELOCITY_DECAY;

      cameraState.animTarget.copy(cameraState.pos);
      camera.position.set(cameraState.pos.x, cameraState.pos.y, cameraState.pos.z);
    } else {
      // Focus or unfocus: damp camera toward animTarget (zoom-out/unfocus snaps back faster)
      cameraState.scrollAccum = 0;
      const smoothTime = cameraState.focusedTileId === null ? UNFOCUS_SMOOTH_TIME : FOCUS_SMOOTH_TIME;
      damp3(camera.position, [cameraState.animTarget.x, cameraState.animTarget.y, cameraState.animTarget.z], smoothTime, delta);

      if (cameraState.isAnimatingFocus) {
        const dx = camera.position.x - cameraState.animTarget.x;
        const dy = camera.position.y - cameraState.animTarget.y;
        const dz = camera.position.z - cameraState.animTarget.z;
        // Unfocus unlocks controls early (looser threshold) so you can pan/zoom the instant
        // it's visually back, instead of waiting out the damp's slow tail.
        const endSq = cameraState.focusedTileId === null ? 0.02 : 0.0001;
        if (dx * dx + dy * dy + dz * dz < endSq) {
          cameraState.isAnimatingFocus = false;
          cameraState.pos.copy(cameraState.animTarget);
        }
      }
    }
  });

  return null;
}

interface SceneProps {
  clips: ClipData[];
}

export function Scene({ clips }: SceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, INITIAL_CAM_Z], fov: 45, near: 0.1, far: 1000 }}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false }}
      dpr={Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5)}
      onPointerMissed={unfocusTile}
    >
      <color attach="background" args={[BG_COLOR]} />
      <CameraController />
      <Grid clips={clips} />
    </Canvas>
  );
}
