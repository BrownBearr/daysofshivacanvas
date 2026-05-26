import * as React from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { useSpring, animated } from "@react-spring/three";
import type { ClipData } from "../types";
import { TILE_W, TILE_H, MIN_CAM_Z } from "../theme";
import { videoPool } from "../lib/video-pool";
import { sourceUrl, previewUrl, posterUrl } from "../lib/clip-source";
import { cameraState, focusTile, unfocusTile } from "./camera-state";

interface TileProps {
  tileIndex: number;
  clip: ClipData;
  position: [number, number, number];
  // True when this tile is among the camera's nearest tiles and should auto-play.
  inPlayRadius: boolean;
}

// Per-frame texture upload is the dominant cost of an active video, so we only push a new
// frame to the GPU when the decoder actually produces one (requestVideoFrameCallback).
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const textureLoader = new THREE.TextureLoader();
const posterCache = new Map<string, THREE.Texture>();

// "cover" crop: fill a 1×1 square from any aspect ratio by trimming the longer axis
function applySquareCrop(tex: THREE.Texture, nativeW: number, nativeH: number) {
  if (!nativeW || !nativeH) return;
  const aspect = nativeW / nativeH;
  if (aspect > 1) {
    tex.repeat.set(1 / aspect, 1);
    tex.offset.set((1 - 1 / aspect) / 2, 0);
  } else if (aspect < 1) {
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
  // Ref so cleanup closures always read the latest posterTex without it being a dep
  const posterTexRef = React.useRef<THREE.Texture | null>(null);
  posterTexRef.current = posterTex;

  // A tile plays real video when it's near the camera OR being hovered.
  const shouldPlay = inPlayRadius || hovered;
  const shouldPlayRef = React.useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;
  // Tracks focus edges so the frame loop can swap preview<->source exactly on transition.
  const wasFocusedRef = React.useRef(false);
  // Whether the active element supports requestVideoFrameCallback (else fall back per-frame).
  const usesRVFCRef = React.useRef(false);
  // True once the video has produced its first frame. Until then we keep showing the poster,
  // so swapping in the video texture never reveals an empty (white) frame.
  const videoReadyRef = React.useRef(false);

  React.useEffect(() => {
    let canceled = false;
    loadPoster(posterUrl(clip)).then((t) => {
      if (!canceled) setPosterTex(t);
    });
    return () => { canceled = true; };
  }, [clip]);

  // Acquire / release a pooled <video> as the tile enters/leaves the play-or-hover state.
  React.useEffect(() => {
    if (!shouldPlay) {
      videoPool.release(tileIndex);
      if (videoTexRef.current) { videoTexRef.current.dispose(); videoTexRef.current = null; }
      videoElRef.current = null;
      videoReadyRef.current = false;
      if (matRef.current) {
        matRef.current.map = posterTexRef.current;
        matRef.current.needsUpdate = true;
      }
      return;
    }

    const el = videoPool.acquire(tileIndex, previewUrl(clip)) as RVFCVideo | null;
    if (!el) return;
    videoElRef.current = el;

    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    videoTexRef.current = tex;
    videoReadyRef.current = false;

    const onMeta = () => applySquareCrop(tex, el.videoWidth, el.videoHeight);
    if (el.readyState >= 1) onMeta();
    else el.addEventListener("loadedmetadata", onMeta, { once: true });

    // Keep the poster on-screen for now; the swap to video happens on the first decoded frame.
    if (matRef.current && posterTexRef.current) {
      matRef.current.map = posterTexRef.current;
      matRef.current.needsUpdate = true;
    }

    // Upload to the GPU only when a new decoded frame is available, and swap poster->video
    // on the first one so the transition is seamless (no empty/white frame).
    let rvfcHandle = 0;
    const supportsRVFC = typeof el.requestVideoFrameCallback === "function";
    usesRVFCRef.current = supportsRVFC;
    if (supportsRVFC) {
      const onFrame = () => {
        tex.needsUpdate = true;
        if (!videoReadyRef.current && el.readyState >= 2 && matRef.current) {
          videoReadyRef.current = true;
          matRef.current.map = tex;
          matRef.current.needsUpdate = true;
        }
        rvfcHandle = el.requestVideoFrameCallback!(onFrame);
      };
      rvfcHandle = el.requestVideoFrameCallback!(onFrame);
    }

    return () => {
      if (supportsRVFC && rvfcHandle) el.cancelVideoFrameCallback?.(rvfcHandle);
      videoPool.release(tileIndex);
      tex.dispose();
      videoTexRef.current = null;
      videoElRef.current = null;
      videoReadyRef.current = false;
    };
  }, [shouldPlay, tileIndex, clip]);

  // Apply poster once loaded (unless the video is already showing its frames)
  React.useEffect(() => {
    if (!posterTex || !matRef.current || videoReadyRef.current) return;
    matRef.current.map = posterTex;
    matRef.current.needsUpdate = true;
  }, [posterTex]);

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
      // If a video element is already bound, upgrade to the full source and unmute now,
      // inside the user gesture. Otherwise the frame loop swaps it in once the tile
      // becomes the camera's nearest tile (it will, since we zoom to it).
      const el = videoElRef.current;
      if (el) {
        videoPool.acquire(tileIndex, sourceUrl(clip));
        el.muted = false;
        el.play().catch(() => {});
      }
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

    // Focus edge: swap preview<->source and toggle mute exactly when focus changes.
    const focused = cameraState.focusedTileId === tileIndex;
    if (focused !== wasFocusedRef.current) {
      wasFocusedRef.current = focused;
      if (el) {
        if (focused) {
          videoPool.acquire(tileIndex, sourceUrl(clip));
          el.muted = false;
          el.play().catch(() => {});
        } else if (shouldPlayRef.current) {
          videoPool.acquire(tileIndex, previewUrl(clip));
          el.muted = true;
        }
        if (tex) {
          el.addEventListener(
            "loadedmetadata",
            () => applySquareCrop(tex, el.videoWidth, el.videoHeight),
            { once: true }
          );
        }
      }
    }

    // Fallback frame pump when requestVideoFrameCallback is unavailable.
    if (!usesRVFCRef.current && tex && el && !el.paused && el.readyState >= 2) {
      tex.needsUpdate = true;
      if (!videoReadyRef.current) {
        videoReadyRef.current = true;
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }

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
      {/* map is managed imperatively (poster vs. video) via the effects/frame loop;
          binding it here would let R3F re-apply the poster on every re-render and
          clobber the active VideoTexture. */}
      <meshBasicMaterial ref={matRef} toneMapped={false} transparent opacity={0} />
    </animated.mesh>
  );
}
