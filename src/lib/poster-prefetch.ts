// Warms the browser/CDN cache for poster images so the canvas composes from cache instead of
// triggering a network "load storm" when the user zooms out / pans. We download the files via
// Image() (not THREE textures) so GPU memory stays bounded by the poster-cache LRU; crossOrigin
// matches THREE.TextureLoader so the later texture decode reuses the same cached CORS response.
export function prefetchImages(
  urls: string[],
  onProgress: (loaded: number, total: number) => void,
  concurrency = 12
): Promise<void> {
  return new Promise((resolve) => {
    const total = urls.length;
    if (total === 0) {
      onProgress(0, 0);
      resolve();
      return;
    }

    let loaded = 0;
    let next = 0;

    const startOne = () => {
      if (next >= total) return;
      const url = urls[next++];
      const img = new Image();
      img.crossOrigin = "anonymous";
      const done = () => {
        loaded++;
        onProgress(loaded, total);
        if (loaded >= total) resolve();
        else startOne();
      };
      img.onload = done;
      img.onerror = done; // count failures too — a missing poster must not stall the loader
      img.src = url;
    };

    for (let i = 0; i < Math.min(concurrency, total); i++) startOne();
  });
}
