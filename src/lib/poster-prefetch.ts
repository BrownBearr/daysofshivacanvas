import { acquirePoster, releasePoster, warmPoster } from "./poster-cache";

/**
 * Decode and upload posters for the first screen, reporting progress. These are the ones the
 * loading screen waits on, so they must be genuinely *ready* rather than merely downloaded — the
 * previous version only warmed the HTTP cache, which meant the decode, mipmap and GPU upload of
 * every visible poster all landed at the moment the loader faded out.
 *
 * The reference is released immediately: the grid re-acquires these through the same cache a moment
 * later, and holding them here would double-count them against the cache cap.
 */
export function preparePosters(
  urls: string[],
  onProgress: (loaded: number, total: number) => void,
  concurrency = 8
): Promise<void> {
  return pool(urls, concurrency, onProgress, (url) =>
    acquirePoster(url).then(() => {
      releasePoster(url);
    })
  );
}

/**
 * Warm the HTTP cache for the rest of the library. This deliberately does not decode: `new Image()`
 * on all ~566 posters would retain that many decoded bitmaps (~1MB each) for images the visitor may
 * never pan to.
 */
export function warmPosters(urls: string[], onProgress: (loaded: number, total: number) => void, concurrency = 6): Promise<void> {
  return pool(urls, concurrency, onProgress, warmPoster);
}

function pool(
  urls: string[],
  concurrency: number,
  onProgress: (loaded: number, total: number) => void,
  work: (url: string) => Promise<unknown>
): Promise<void> {
  const total = urls.length;
  if (total === 0) {
    onProgress(0, 0);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let loaded = 0;
    let next = 0;
    let settled = false;

    const startOne = () => {
      if (next >= total) return;
      const url = urls[next++];
      // Failures count as done: one missing poster must never stall the loader.
      work(url)
        .catch(() => {})
        .then(() => {
          loaded++;
          onProgress(loaded, total);
          if (loaded >= total) {
            if (!settled) {
              settled = true;
              resolve();
            }
          } else {
            startOne();
          }
        });
    };

    for (let i = 0; i < Math.min(concurrency, total); i++) startOne();
  });
}
