import * as THREE from "three";

// Shared poster textures for the tile grid.
//
// Three jobs the previous tile-local cache didn't do:
//
//  1. Refcounting. The old LRU disposed the oldest entry unconditionally, with no idea whether
//     a live material still had it as `.map`. Its cap (256) was below the worst-case visible
//     tile count on a wide display, so panning could dispose a texture that was still on screen
//     and leave a blank tile. Nothing with a live holder is evictable here.
//  2. In-flight dedupe. Two slots asking for the same URL in the same frame both used to start a
//     TextureLoader load, and the second one to finish overwrote the first in the map without
//     disposing it — an unreachable, never-freed texture.
//  3. HTTP-only warming. `warm()` fetches without decoding, so prefetching the whole library
//     costs bandwidth but not a decoded bitmap per clip held in memory.

interface Entry {
  texture: THREE.Texture;
  refs: number;
  /** Approximate GPU cost in bytes, including the mipmap chain. */
  bytes: number;
}

const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");

// Posters are decoded to an ImageBitmap where possible. Uploading a texture from an
// HTMLImageElement makes the browser decode the JPEG on the main thread at texImage2D time, which
// during a fast pan at max zoom lands as a multi-frame hitch per newly revealed tile. createImageBitmap
// does the decode on a worker thread and hands back something the GL driver can upload directly.
const supportsImageBitmap = typeof createImageBitmap === "function";

function loadViaImageBitmap(url: string): Promise<THREE.Texture> {
  return fetch(url, { mode: "cors", credentials: "omit" })
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.blob();
    })
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
      // Three needs telling that the source is a bitmap, or it treats it as a DOM image.
      (tex as unknown as { isVideoTexture?: boolean }).isVideoTexture = false;
      tex.needsUpdate = true;
      applySquareCrop(tex, bitmap.width, bitmap.height);
      return tex;
    });
}

// Insertion order is recency: re-inserted on every acquire, so the front is the LRU candidate.
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<THREE.Texture>>();
const warmed = new Set<string>();

// Two independent limits, because poster dimensions are not uniform in practice.
//
// `cap` is the count, set by Grid from the worst-case visible tile count. `byteBudget` exists
// because a count alone is not a bound on anything that matters: normalized posters are 712x400
// (~1.5MB with mipmaps) but the library also contains un-resized 1920x1080 originals at ~11MB
// each, so a 320-entry cache can mean 0.5GB or 3.5GB of VRAM depending on which clips you panned
// past. Whichever limit binds first wins.
let cap = 320;
let byteBudget = 512 * 1024 * 1024;
let bytesHeld = 0;

export function setPosterCacheCap(next: number): void {
  cap = Math.max(32, next);
  evict();
}

export function setPosterByteBudget(next: number): void {
  byteBudget = Math.max(64 * 1024 * 1024, next);
  evict();
}

// width * height * RGBA, plus ~1/3 again for the mipmap chain.
function estimateBytes(tex: THREE.Texture): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return 4;
  return Math.round(w * h * 4 * 1.34);
}

/** "cover" crop: fill a square from any aspect by trimming the longer axis. */
function applySquareCrop(tex: THREE.Texture, nativeW: number, nativeH: number): void {
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

export { applySquareCrop };

function touch(url: string, entry: Entry): void {
  cache.delete(url);
  cache.set(url, entry);
}

// Evict from the front (oldest) but skip anything a live tile still holds. A held texture that
// falls out of the window gets its chance the next time eviction runs, after it's released.
function evict(): void {
  if (cache.size <= cap && bytesHeld <= byteBudget) return;
  for (const [url, entry] of cache) {
    if (cache.size <= cap && bytesHeld <= byteBudget) break;
    if (entry.refs > 0) continue;
    cache.delete(url);
    bytesHeld -= entry.bytes;
    entry.texture.dispose();
  }
}

function makeFallback(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([210, 210, 210, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Resolve a poster texture and register a reference to it. Every `acquire` must be paired with a
 * `release` for the same URL, or the texture is pinned in the cache forever.
 */
export function acquirePoster(url: string): Promise<THREE.Texture> {
  const hit = cache.get(url);
  if (hit) {
    hit.refs++;
    touch(url, hit);
    return Promise.resolve(hit.texture);
  }

  const pending = inFlight.get(url);
  if (pending) {
    // Reserve the reference now so a release that arrives before the load settles still balances.
    return pending.then((tex) => {
      const entry = cache.get(url);
      if (entry) {
        entry.refs++;
        touch(url, entry);
      }
      return tex;
    });
  }

  const viaLoader = () =>
    new Promise<THREE.Texture>((resolve) => {
      loader.load(
        url,
        (tex) => {
          const img = tex.image as HTMLImageElement;
          applySquareCrop(tex, img?.naturalWidth ?? 0, img?.naturalHeight ?? 0);
          resolve(tex);
        },
        undefined,
        () => resolve(makeFallback())
      );
    });

  const promise = (supportsImageBitmap ? loadViaImageBitmap(url).catch(viaLoader) : viaLoader())
    .then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      // Mipmaps stay on: a 712px poster drawn at ~130px (max zoom) shimmers badly without them.
      tex.anisotropy = 4;
      return tex;
    })
    .then((tex) => {
      inFlight.delete(url);
      // A concurrent acquire may have already installed an entry; keep the first and drop this one.
      const existing = cache.get(url);
      if (existing) {
        if (existing.texture !== tex) tex.dispose();
        return existing.texture;
      }
      const bytes = estimateBytes(tex);
      cache.set(url, { texture: tex, refs: 0, bytes });
      bytesHeld += bytes;
      evict();
      return tex;
    });

  inFlight.set(url, promise);
  return promise.then((tex) => {
    const entry = cache.get(url);
    if (entry) {
      entry.refs++;
      touch(url, entry);
    }
    return tex;
  });
}

export function releasePoster(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) evict();
}

/**
 * Warm the HTTP cache for a poster without decoding it or holding a bitmap. Used for the
 * long tail of the library: `new Image()` would force a decode and retain ~1MB per poster,
 * which across the whole library is hundreds of MB for images that may never be looked at.
 */
export function warmPoster(url: string): Promise<void> {
  if (warmed.has(url) || cache.has(url)) return Promise.resolve();
  warmed.add(url);
  return fetch(url, { mode: "cors", credentials: "omit" })
    .then((r) => r.arrayBuffer())
    .then(() => undefined)
    .catch(() => {
      warmed.delete(url);
    });
}

export function posterCacheStats(): {
  size: number;
  held: number;
  cap: number;
  megabytes: number;
  budgetMb: number;
} {
  let held = 0;
  for (const e of cache.values()) if (e.refs > 0) held++;
  return {
    size: cache.size,
    held,
    cap,
    megabytes: Math.round(bytesHeld / 1e5) / 10,
    budgetMb: Math.round(byteBudget / 1e6),
  };
}
