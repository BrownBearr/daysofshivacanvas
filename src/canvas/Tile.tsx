import * as React from "react";
import * as THREE from "three";
import { TILE_H, TILE_W } from "../theme";
import { slots, type TileSlot } from "./slot";

// Every tile is the same square plane, so one geometry is shared across every mounted mesh rather
// than allocating a BufferGeometry per tile.
const TILE_GEOMETRY = new THREE.PlaneGeometry(TILE_W, TILE_H);

/**
 * A recycled tile mesh. Deliberately inert: it mounts once, registers its mesh and material into
 * the slot registry, and never re-renders. Everything that used to live here — poster loading,
 * video acquire/release, hover state, the opacity spring, pointer handlers, a per-tile useFrame —
 * is now driven imperatively from Grid's single frame loop, because all of it was being paid ~200
 * times over for work that is either shared or only ever applies to one tile at a time.
 *
 * `visible` starts false so a slot that the viewport never uses costs nothing: three skips hidden
 * meshes before they reach the render lists.
 */
export const Tile = React.memo(function Tile({ slotIndex }: { slotIndex: number }) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const matRef = React.useRef<THREE.MeshBasicMaterial>(null);

  React.useLayoutEffect(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    const slot: TileSlot = {
      mesh,
      mat,
      cellKey: null,
      gx: 0,
      gy: 0,
      clip: null,
      posterHeld: null,
      posterTex: null,
      videoTex: null,
      videoReady: false,
      opacity: 0,
      scale: 1,
      hovered: false,
    };
    slots[slotIndex] = slot;

    return () => {
      if (slots[slotIndex] === slot) slots[slotIndex] = null;
    };
  }, [slotIndex]);

  return (
    // matrixAutoUpdate is off because three's updateMatrixWorld recurses into hidden children too,
    // so ~200 parked meshes would still recompose a matrix every frame. The frame loop calls
    // updateMatrix() itself whenever it moves or scales a slot, and that sets
    // matrixWorldNeedsUpdate, so matrixWorld stays correct for frustum culling.
    <mesh ref={meshRef} geometry={TILE_GEOMETRY} visible={false} matrixAutoUpdate={false}>
      {/* `map` is assigned imperatively (poster vs. video) by the frame loop; binding it here would
          let R3F re-apply a stale value on any re-render and clobber the active VideoTexture. */}
      <meshBasicMaterial ref={matRef} toneMapped={false} transparent opacity={0} />
    </mesh>
  );
});
