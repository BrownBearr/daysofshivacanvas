import * as React from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useSpring, animated } from "@react-spring/three";
import { damp } from "maath/easing";
import type { ClipData } from "../types";
import { TILE_W, TILE_H, MIN_CAM_Z } from "../theme";
import { videoPool } from "../lib/video-pool";
import { cameraState } from "./camera-state";

interface TileProps {
  tileIndex: number;
  clip: ClipData;
  position: [number, number, number];
  inPlayRadius: boolean;
}

export function Tile({ tileIndex, clip, position, inPlayRadius }: TileProps) {
  const { camera } = useThree();
  const meshRef = React.useRef<THREE.Mesh>(null);
  const matRef = React.useRef<THREE.MeshBasicMaterial>(null);

  const [hovered, setHovered] = React.useState(false);
  const [videoEl, setVideoEl] = React.useState<HTMLVideoElement | null>(null);

  const videoTexture = React.useMemo(() => {
    if (!videoEl) return null;
    const t = new THREE.VideoTexture(videoEl);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [videoEl]);

  React.useEffect(() => {
    return () => {
      videoTexture?.dispose();
    };
  }, [videoTexture]);

  // Poster texture — falls back to a plain color if the URL isn't loadable
  const posterTexture = useTexture(clip.poster, (t) => {
    if (Array.isArray(t)) return;
    t.colorSpace = THREE.SRGBColorSpace;
  });

  // Acquire / release pool element when play radius changes
  React.useEffect(() => {
    if (inPlayRadius) {
      const el = videoPool.acquire(tileIndex, clip.preview);
      setVideoEl(el);
    } else {
      videoPool.release(tileIndex);
      setVideoEl(null);
    }
    return () => {
      videoPool.release(tileIndex);
      setVideoEl(null);
    };
  }, [inPlayRadius, tileIndex, clip.preview]);

  const isFocused = cameraState.focusedTileId === tileIndex;

  const { scale, posZ } = useSpring({
    scale: hovered && !cameraState.isDragging && !isFocused ? 1.3 : isFocused ? 1.0 : 1.0,
    posZ: hovered && !cameraState.isDragging ? 0.1 : 0,
    config: { tension: 280, friction: 26 },
  });

  useFrame((_, delta) => {
    if (!matRef.current) return;
    // Fade in when texture is ready
    const targetOpacity = videoEl ? 1 : posterTexture ? 1 : 0;
    damp(matRef.current, "opacity", targetOpacity, 0.1, delta);
  });

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (cameraState.isDragging) return;

    if (cameraState.focusedTileId === tileIndex) {
      // Unfocus
      cameraState.focusedTileId = null;
      cameraState.targetVel.set(0, 0, 0);
      cameraState.pos.copy(cameraState.preFocusPos);
    } else {
      // Focus: camera zooms to fit this tile
      cameraState.preFocusPos.copy(cameraState.pos);
      cameraState.focusedTileId = tileIndex;
      const fovRad = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const fitZ = (TILE_W * 1.1) / (2 * Math.tan(fovRad / 2));
      cameraState.pos.set(position[0], position[1], Math.max(fitZ, MIN_CAM_Z));
      cameraState.targetVel.set(0, 0, 0);
      cameraState.vel.set(0, 0, 0);
    }
  };

  return (
    <animated.mesh
      ref={meshRef}
      position={[position[0], position[1], position[2]]}
      position-z={posZ}
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
        map={videoTexture ?? posterTexture}
        toneMapped={false}
        transparent
        opacity={0}
      />
    </animated.mesh>
  );
}
