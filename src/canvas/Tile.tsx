import * as React from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { useSpring, animated } from "@react-spring/three";
import type { ClipData } from "../types";
import { TILE_W, TILE_H, MIN_CAM_Z } from "../theme";
import { videoPool } from "../lib/video-pool";
import { cameraState, focusTile, unfocusTile } from "./camera-state";

interface TileProps {
  tileIndex: number;
  clip: ClipData;
  position: [number, number, number];
  inPlayRadius: boolean;
}

const textureLoader = new THREE.TextureLoader();
const posterCache = new Map<string, THREE.Texture>();

// "cover" crop: fill a 1×1 square from any aspect ratio by trimming the longer axis
function applySquareCrop(tex: THREE.Texture, nativeW: number, nativeH: number) {
  if (!nativeW || !nativeH) return;
  const aspect = nativeW / nativeH;
  if (aspect > 1) {
    // Landscape → trim sides
    tex.repeat.set(1 / aspect, 1);
    tex.offset.set((1 - 1 / aspect) / 2, 0);
  } else if (aspect < 1) {
    // Portrait → trim top/bottom
    tex.repeat.set(1, aspect);
    tex.offset.set(0, (1 - aspect) / 2);
  } else {
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
  }
}

function loadPoster(url: string): Promise<THREE.Texture> {
  const cached = posterCache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        const img = t.image as HTMLImageElement;
        applySquareCrop(t, img.naturalWidth, img.naturalHeight);
        posterCache.set(url, t);
        resolve(t);
      },
      undefined,
      () => {
        const fallback = new THREE.DataTexture(new Uint8Array([210, 210, 210, 255]), 1, 1);
        fallback.needsUpdate = true;
        posterCache.set(url, fallback);
        resolve(fallback);
      }
    );
  });
}

export function Tile({ tileIndex, clip, position, inPlayRadius }: TileProps) {
  const { camera } = useThree();
  const matRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const videoTexRef = React.useRef<THREE.VideoTexture | null>(null);
  const videoElRef = React.useRef<HTMLVideoElement | null>(null);

  const [hovered, setHovered] = React.useState(false);
  const [posterTex, setPosterTex] = React.useState<THREE.Texture | null>(null);

  React.useEffect(() => {
    let canceled = false;
    loadPoster(clip.poster).then((t) => {
      if (!canceled) setPosterTex(t);
    });
    return () => { canceled = true; };
  }, [clip.poster]);

  // Acquire / release pool element when play radius changes
  React.useEffect(() => {
    if (!inPlayRadius) {
      videoPool.release(tileIndex);
      if (videoTexRef.current) { videoTexRef.current.dispose(); videoTexRef.current = null; }
      videoElRef.current = null;
      if (matRef.current) matRef.current.map = posterTex;
      return;
    }

    const el = videoPool.acquire(tileIndex, clip.preview);
    if (!el) return;
    videoElRef.current = el;

    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    videoTexRef.current = tex;

    // Apply square crop once we know the video dimensions
    const onMeta = () => {
      applySquareCrop(tex, el.videoWidth, el.videoHeight);
    };
    if (el.readyState >= 1) {
      onMeta();
    } else {
      el.addEventListener("loadedmetadata", onMeta, { once: true });
    }

    if (matRef.current) {
      matRef.current.map = tex;
      matRef.current.needsUpdate = true;
    }

    return () => {
      videoPool.release(tileIndex);
      tex.dispose();
      videoTexRef.current = null;
      videoElRef.current = null;
    };
  }, [inPlayRadius, tileIndex, clip.preview, posterTex]);

  // Apply poster once loaded (if no video tex is active)
  React.useEffect(() => {
    if (!posterTex || !matRef.current || videoTexRef.current) return;
    matRef.current.map = posterTex;
    matRef.current.needsUpdate = true;
  }, [posterTex]);

  // Unmute when focused, mute when not
  React.useEffect(() => {
    const interval = setInterval(() => {
      const el = videoElRef.current;
      if (el) el.muted = cameraState.focusedTileId !== tileIndex;
    }, 50);
    return () => clearInterval(interval);
  }, [tileIndex]);

  const isFocused = () => cameraState.focusedTileId === tileIndex;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (cameraState.isDragging) return;

    if (isFocused()) {
      unfocusTile();
    } else {
      const fovRad = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const fitZ = (TILE_W * 1.2) / (2 * Math.tan(fovRad / 2));
      focusTile(tileIndex, position[0], position[1], Math.max(fitZ, MIN_CAM_Z));
    }
  };

  const { scale } = useSpring({
    scale: hovered && !cameraState.isDragging && !isFocused() ? 1.3 : 1.0,
    config: { tension: 280, friction: 26 },
  });

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;

    const tex = videoTexRef.current;
    const el = videoElRef.current;
    if (tex && el && !el.paused && el.readyState >= 2) tex.needsUpdate = true;

    const hasContent = (tex && el && el.readyState >= 2) || posterTex;
    const targetOpacity = hasContent ? 1 : 0;
    if (Math.abs(mat.opacity - targetOpacity) > 0.001) {
      mat.opacity += (targetOpacity - mat.opacity) * 0.12;
    }
  });

  return (
    <animated.mesh
      position={position}
      scale={scale}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        cameraState.hoveredTileId = tileIndex;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        if (cameraState.hoveredTileId === tileIndex) cameraState.hoveredTileId = null;
        document.body.style.cursor = "";
      }}
      onClick={handleClick}
    >
      <planeGeometry args={[TILE_W, TILE_H]} />
      <meshBasicMaterial
        ref={matRef}
        map={posterTex ?? undefined}
        toneMapped={false}
        transparent
        opacity={0}
      />
    </animated.mesh>
  );
}
