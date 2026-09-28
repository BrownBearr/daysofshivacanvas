import * as THREE from "three";

// One shader for every tile. It samples the atlas cell and the full poster (or live video) and
// crossfades between them, so a tile is never blank: the atlas paints instantly and the poster
// fades in over it when LOD asks for one. The reflection mesh reuses the same uniform objects with
// uReflect = 1, so it mirrors whatever its tile shows with no extra bookkeeping.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec4 uAtlasRect;
uniform sampler2D uMap;
uniform vec4 uMapRect;
uniform float uMix;
uniform float uOpacity;
uniform float uReflect;
uniform float uHover;
uniform vec3 uBg;
varying vec2 vUv;
void main() {
  // Uniform branches: a settled tile samples one texture, not two. Fill rate is most of the cost
  // of a zoomed-out field on weak GPUs.
  vec3 c;
  if (uMix <= 0.001) c = texture2D(uAtlas, uAtlasRect.xy + vUv * uAtlasRect.zw).rgb;
  else if (uMix >= 0.999) c = texture2D(uMap, uMapRect.xy + vUv * uMapRect.zw).rgb;
  else c = mix(texture2D(uAtlas, uAtlasRect.xy + vUv * uAtlasRect.zw).rgb, texture2D(uMap, uMapRect.xy + vUv * uMapRect.zw).rgb, uMix);
  if (uReflect > 0.5) {
    // Mirrored below the card: strongest where it touches the card, gone within ~60% of its height.
    // Faded into the page colour rather than made transparent, so reflections stay opaque and the
    // nearer one hides the farther one. Transparent reflections bled through each other.
    float f = clamp(1.0 - vUv.y * 1.6, 0.0, 1.0);
    gl_FragColor = vec4(mix(uBg, c, f * f * 0.3 * uOpacity), 1.0);
  } else {
    // Rail hover is a light lift in brightness, not geometry: moving a packed card intersects its neighbours.
    gl_FragColor = vec4(mix(c, vec3(1.0), uHover * 0.07), uOpacity);
  }
  #include <colorspace_fragment>
}`;

function solid(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export const BLANK = solid(128, 128, 128);

// Shared by every material: the stage background, which reflections fade into.
const BG = { value: new THREE.Color("#f3f3f1") };

export function setStageBackground(css: string): void {
  BG.value.set(css);
}

export interface TileUniforms {
  uAtlas: { value: THREE.Texture };
  uAtlasRect: { value: THREE.Vector4 };
  uMap: { value: THREE.Texture };
  uMapRect: { value: THREE.Vector4 };
  uMix: { value: number };
  uOpacity: { value: number };
  uReflect: { value: number };
  uHover: { value: number };
  uBg: { value: THREE.Color };
}

export function makeTileMaterials(): { mat: THREE.ShaderMaterial; refl: THREE.ShaderMaterial; u: TileUniforms } {
  const u: TileUniforms = {
    uAtlas: { value: BLANK },
    uAtlasRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMap: { value: BLANK },
    uMapRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMix: { value: 0 },
    uOpacity: { value: 0 },
    uReflect: { value: 0 },
    uHover: { value: 0 },
    uBg: BG,
  };
  // Identical source across every tile, so three compiles one program and shares it.
  const mat = new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const refl = new THREE.ShaderMaterial({
    uniforms: { ...u, uReflect: { value: 1 } } as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  return { mat, refl, u };
}
