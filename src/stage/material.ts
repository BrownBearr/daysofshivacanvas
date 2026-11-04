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
uniform float uMapVideo;
uniform float uOpacity;
uniform float uReflect;
uniform float uHover;
uniform vec3 uBg;
uniform float uReveal;
uniform vec2 uRevealDir;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec3 sampleAtlas(vec2 uv) {
  return texture2D(uAtlas, uAtlasRect.xy + uv * uAtlasRect.zw).rgb;
}
vec3 sampleMap(vec2 uv) {
  vec4 t = texture2D(uMap, uMapRect.xy + uv * uMapRect.zw);
  // three uploads video frames as linear RGBA8 (no sRGB8 storage), and its built-in materials
  // decode them in the shader (DECODE_VIDEO_TEXTURE). A ShaderMaterial has to do it itself, or the
  // sRGB frame is encoded twice by colorspace_fragment and the preview reads washed out and lighter
  // than the poster under it.
  if (uMapVideo > 0.5) t = sRGBTransferEOTF(t);
  return t.rgb;
}
void main() {
  vec2 uv = vUv;
  float glow = 0.0;
  // Resolve: a field tile arriving on screen is built from coarse blocks, starting at the edge it
  // came in from. Each block of an 8x8 grid pops in on a jittered front, as one flat colour, then
  // sharpens through 16, 32 and 64 blocks to the full image, carrying a faint light that settles
  // as it resolves. Hidden blocks are discarded, so the tile stays in the opaque pass.
  if (uReveal < 0.999) {
    const float G = 8.0;
    vec2 cell = floor(vUv * G);
    vec2 cc = (cell + 0.5) / G - 0.5;
    float span = abs(uRevealDir.x) + abs(uRevealDir.y) + 1e-4;
    float d = clamp((0.5 * span - dot(cc, uRevealDir)) / span, 0.0, 1.0);
    // sweep 0.9 + jitter 0.25 + per-block resolve 0.4 = 1.55, so every block is sharp at uReveal = 1.
    float p = clamp((uReveal * 1.55 - d * 0.9 - hash(cell) * 0.25) / 0.4, 0.0, 1.0);
    if (p <= 0.0) discard;
    if (p < 1.0) {
      float n = G * exp2(floor(p * 4.0));
      uv = (floor(vUv * n) + 0.5) / n;
    }
    glow = 1.0 - p;
  }
  // Uniform branches: a settled tile samples one texture, not two. Fill rate is most of the cost
  // of a zoomed-out field on weak GPUs.
  vec3 c;
  if (uMix <= 0.001) c = sampleAtlas(uv);
  else if (uMix >= 0.999) c = sampleMap(uv);
  else c = mix(sampleAtlas(uv), sampleMap(uv), uMix);
  c = min(c * (1.0 + glow * 0.4) + glow * 0.025, vec3(1.0));
  if (uReflect > 0.5) {
    // Mirrored below the card: strongest where it touches the card, gone within ~60% of its height.
    // Faded into the page colour rather than made transparent, so reflections stay opaque and the
    // nearer one hides the farther one. Transparent reflections bled through each other.
    float f = clamp(1.0 - vUv.y * 1.6, 0.0, 1.0);
    gl_FragColor = vec4(mix(uBg, c, f * f * 0.3 * uOpacity), 1.0);
  } else {
    // Rail hover is a light lift in brightness, not geometry: moving a packed card intersects its neighbours.
    // A multiply, not a mix toward white, so blacks stay black and dark work doesn't wash out.
    gl_FragColor = vec4(min(c * (1.0 + uHover * 0.08), vec3(1.0)), uOpacity);
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
  /** 1 when uMap is a VideoTexture, which needs decoding to linear in the shader. */
  uMapVideo: { value: number };
  uOpacity: { value: number };
  uReflect: { value: number };
  uHover: { value: number };
  uBg: { value: THREE.Color };
  /** Field reveal progress, 0..1 (1 = settled). */
  uReveal: { value: number };
  /** Unit direction from screen centre to where the tile entered, in tile space. */
  uRevealDir: { value: THREE.Vector2 };
}

export function makeTileMaterials(): { mat: THREE.ShaderMaterial; refl: THREE.ShaderMaterial; u: TileUniforms } {
  const u: TileUniforms = {
    uAtlas: { value: BLANK },
    uAtlasRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMap: { value: BLANK },
    uMapRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMix: { value: 0 },
    uMapVideo: { value: 0 },
    uOpacity: { value: 0 },
    uReflect: { value: 0 },
    uHover: { value: 0 },
    uBg: BG,
    uReveal: { value: 1 },
    uRevealDir: { value: new THREE.Vector2(1, 0) },
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
