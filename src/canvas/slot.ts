import type * as THREE from "three";
import { posterUrl } from "../lib/clip-source";
import { acquirePoster, releasePoster } from "../lib/poster-cache";
import type { ClipData } from "../types";
import { requestFrame } from "./camera-state";

// One slot = one mounted mesh that gets recycled across grid cells.
//
// The previous design mounted and unmounted a <Tile> component per visible cell, so panning across
// a tile boundary destroyed and recreated a ring of components — each one a spring controller, a
// useFrame subscription (which sorts R3F's subscriber array), a material, and a poster effect
// cycle. That work landed on the exact frame that was already busiest, which is what the stutter
// was. Here the mesh count is fixed for the viewport and cells are *reassigned* to existing slots,
// so a pan mounts nothing and React is not involved at all.
//
// Cell -> slot is a toroidal mapping: slot = mod(gx, cols) * rows + mod(gy, rows). Within any
// contiguous cols x rows window every cell lands on a distinct slot, and when the window shifts by
// one column the column that scrolled out is exactly the one reused by the column scrolling in.
// So a cell that stays on screen keeps its slot, its mesh, and its already-loaded poster.

export interface TileSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  /** "gx:gy" of the cell currently occupying this slot, or null when parked off-grid. */
  cellKey: string | null;
  /** The same cell as integers, so the frame loop can compare without building a string. */
  gx: number;
  gy: number;
  clip: ClipData | null;
  /** Poster URL this slot holds a reference to, so it can be released on reassignment. */
  posterHeld: string | null;
  posterTex: THREE.Texture | null;
  /** Set by the video manager while this slot is the hovered/playing tile. */
  videoTex: THREE.VideoTexture | null;
  videoReady: boolean;
  /** Animation state, driven by Grid's single frame loop. */
  opacity: number;
  scale: number;
  hovered: boolean;
}

// A module singleton, consistent with cameraState / videoPool / muteState: there is exactly one
// grid, and threading this through props or context would reintroduce the React churn being removed.
export const slots: (TileSlot | null)[] = [];

export function resetSlots(): void {
  slots.length = 0;
}

/**
 * Point a slot at a new cell. Swaps the poster reference and moves the mesh; deliberately does no
 * React work, because this runs inside the frame loop while the user is panning.
 *
 * Cells are compared as integers rather than as "gx:gy" strings: this is called for every visible
 * cell on every window shift, and only the handful that actually changed should allocate.
 */
export function assignCell(slot: TileSlot, gx: number, gy: number, clip: ClipData, spacing: number): void {
  if (slot.cellKey !== null && slot.gx === gx && slot.gy === gy) return;

  slot.gx = gx;
  slot.gy = gy;
  slot.cellKey = `${gx}:${gy}`;
  slot.mesh.position.set(gx * spacing, gy * spacing, 0);
  slot.mesh.updateMatrix();

  const nextUrl = posterUrl(clip);
  if (slot.posterHeld === nextUrl) {
    slot.clip = clip;
    return;
  }

  if (slot.posterHeld) releasePoster(slot.posterHeld);
  slot.posterHeld = nextUrl;
  slot.clip = clip;
  slot.posterTex = null;
  // Recycled slots fade their new poster in from wherever the old one left off, which reads as a
  // crossfade rather than a pop. Reset to 0 so an empty slot doesn't flash the previous clip.
  slot.opacity = 0;

  acquirePoster(nextUrl).then((tex) => {
    // The slot may have been reassigned again while this was in flight; the URL check is what
    // makes that safe, and the release below balances the acquire we just made.
    if (slot.posterHeld !== nextUrl) {
      releasePoster(nextUrl);
      return;
    }
    slot.posterTex = tex;
    // Under `frameloop="demand"` an async arrival has to ask for a frame or it never appears.
    requestFrame();
  });
}

/** Park a slot that the current viewport doesn't need: hide it and drop its poster reference. */
export function parkSlot(slot: TileSlot): void {
  if (slot.cellKey === null) return;
  slot.cellKey = null;
  slot.clip = null;
  slot.hovered = false;
  slot.opacity = 0;
  slot.mesh.visible = false;
  if (slot.posterHeld) {
    releasePoster(slot.posterHeld);
    slot.posterHeld = null;
  }
  slot.posterTex = null;
}

export function findSlotByCell(cellKey: string): TileSlot | null {
  for (const s of slots) if (s && s.cellKey === cellKey) return s;
  return null;
}
