import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { setPosterByteBudget, setPosterCacheCap } from "../lib/poster-cache";
import { RUNTIME } from "../runtime";
import { appStore } from "../state/store";
import { loadAtlas } from "./atlas";
import { FOV, TILE } from "./config";
import { attach, requestScene, type Slot, type StageView, setLocked, setViewport, slots, tick } from "./engine";
import { requestFrame, setFrameRequester } from "./frame";
import { installInput } from "./input";
import { makeTileMaterials, setStageBackground } from "./material";

// Shared by every tile and reflection.
const GEOMETRY = new THREE.PlaneGeometry(TILE, TILE);

/** Mounts the fixed slot pool once per pool size and runs THE frame loop. Never re-renders otherwise. */
const Tiles = React.memo(function Tiles() {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const group = React.useRef<THREE.Group>(null);

  const count = React.useMemo(() => setViewport(size.width, size.height, dpr), [size.width, size.height, dpr]);

  React.useEffect(() => {
    setFrameRequester(invalidate);
    attach(camera as THREE.PerspectiveCamera, gl.domElement);
    return installInput(gl.domElement);
  }, [invalidate, camera, gl]);

  React.useEffect(() => {
    setPosterCacheCap(count + 48);
    setPosterByteBudget(RUNTIME.posterBudgetMb * 1024 * 1024);
  }, [count]);

  // Build the pool imperatively: meshes are pure GPU objects with no React props to reconcile.
  React.useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    const made: Slot[] = [];
    for (let i = 0; i < count; i++) {
      const { mat, refl: reflMat, u } = makeTileMaterials();
      const mesh = new THREE.Mesh(GEOMETRY, mat);
      // matrixAutoUpdate off: parked meshes would otherwise recompose matrices every frame. The
      // engine calls updateMatrix() whenever it moves one.
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      reflMat.side = THREE.DoubleSide;
      const refl = new THREE.Mesh(GEOMETRY, reflMat);
      // Flush with the card's bottom edge, like the floor it stands on.
      refl.position.set(0, -TILE, 0);
      refl.scale.set(1, -1, 1);
      refl.matrixAutoUpdate = false;
      refl.updateMatrix();
      refl.visible = false;
      mesh.add(refl);
      const slot: Slot = {
        mesh,
        refl,
        mat,
        u,
        key: Number.NaN,
        gen: -1,
        stamp: 0,
        index: -1,
        clip: null,
        videoKey: "",
        tx: 0,
        ty: 0,
        tz: 0,
        trx: 0,
        try: 0,
        ts: 1,
        tvis: 1,
        x: 0,
        y: 0,
        z: 0,
        rx: 0,
        ry: 0,
        s: 1,
        fx: 0,
        fy: 0,
        fz: 0,
        frx: 0,
        fry: 0,
        fs: 1,
        fo: 0,
        morphing: false,
        delay: 0,
        presence: 0,
        hover: 0,
        atlasReady: false,
        posterUrl: null,
        posterTex: null,
        posterMix: 0,
        videoTex: null,
        videoReady: false,
      };
      mesh.userData.slot = slot;
      g.add(mesh);
      made.push(slot);
      slots[i] = slot;
    }
    slots.length = count;
    // A new pool starts from nothing, so re-issue the current scene as an entrance.
    const s = appStore.getState();
    if (s.view !== "index") requestScene(s.view, s.ordered, { entering: true });
    invalidate();
    return () => {
      for (const s of made) {
        g.remove(s.mesh);
        s.mat.dispose();
        (s.refl.material as THREE.Material).dispose();
      }
    };
  }, [count, invalidate]);

  useFrame((_s, delta) => {
    if (tick(delta, performance.now())) invalidate();
  });

  return <group ref={group} />;
});

/** Keeps the engine's scene in step with the store: view, order, and whether the player is open. */
function useSceneSync(ready: boolean) {
  React.useEffect(() => {
    if (!ready) return;
    // The initial scene is issued by Tiles when the pool mounts.
    setLocked(appStore.getState().focused !== null);
    return appStore.subscribe((s, prev) => {
      if (s.focused !== prev.focused) setLocked(s.focused !== null);
      if (s.view === "index") return;
      if (s.view !== prev.view || s.ordered !== prev.ordered) {
        requestScene(s.view as StageView, s.ordered, { entering: prev.view === "index" });
      }
    });
  }, [ready]);
}

export function Stage({ background }: { background: string }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setStageBackground(background);
    requestFrame();
  }, [background]);

  // The atlas gates the first scene so the entrance plays with pictures, not placeholders. A slow
  // network still gets a stage after 2.5s; posters fill in as they land.
  React.useEffect(() => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    loadAtlas().then(go);
    const t = setTimeout(go, 2500);
    return () => clearTimeout(t);
  }, []);

  useSceneSync(ready);

  return (
    <Canvas
      frameloop="demand"
      flat
      camera={{ position: [0, 0, 0], fov: FOV, near: 0.1, far: 200 }}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      dpr={[1, RUNTIME.maxDpr]}
      style={{ touchAction: "none" }}
      aria-label="Gallery of daily clips"
    >
      <color attach="background" args={[background]} />
      {ready && <Tiles />}
    </Canvas>
  );
}
