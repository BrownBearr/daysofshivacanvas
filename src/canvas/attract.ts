import { RUNTIME } from "../runtime";
import { cameraState, resetView, unfocusTile } from "./camera-state";

// Kiosk idle behaviour. A gallery machine sits unattended for long stretches, so the piece needs to
// stay alive on its own and hand the next visitor a clean starting frame. All of this is disabled on
// the web build (the idle thresholds are 0), where hijacking a stationary user's camera would be
// obnoxious.

// A slow diagonal drift, in world units per second. Deliberately well under the pan speed cap so it
// reads as the piece breathing rather than as input.
const DRIFT_SPEED = 1.5;
// Radians per second the drift direction rotates, so it wanders instead of leaving in a straight line.
const DRIFT_TURN = 0.05;

let heading = Math.PI / 5;
let didAutoReset = false;

export function idleMs(now: number): number {
  return cameraState.lastInputAt === 0 ? 0 : now - cameraState.lastInputAt;
}

/**
 * Advance the idle behaviours. Returns true if it moved the camera, so the caller knows to keep
 * requesting frames under the demand frameloop.
 */
export function updateAttract(now: number, delta: number): boolean {
  const { attractIdleMs, autoResetIdleMs } = RUNTIME;
  if (attractIdleMs === 0 && autoResetIdleMs === 0) return false;

  const idle = idleMs(now);

  if (autoResetIdleMs > 0 && idle >= autoResetIdleMs) {
    // Once per idle period, not once per frame.
    if (!didAutoReset) {
      didAutoReset = true;
      unfocusTile();
      resetView();
    }
  } else {
    didAutoReset = false;
  }

  if (attractIdleMs === 0 || idle < attractIdleMs) return false;
  if (cameraState.focusedTileId !== null) return false;

  heading += DRIFT_TURN * delta;
  cameraState.pos.x += Math.cos(heading) * DRIFT_SPEED * delta;
  cameraState.pos.y += Math.sin(heading) * DRIFT_SPEED * delta;
  return true;
}

/** Called on any real input: cancels drift and re-arms the auto-reset. */
export function cancelAttract(): void {
  didAutoReset = false;
}
