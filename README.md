# daysofshiva

Infinite-canvas video archive viewer for a daily creative practice. Built with React Three Fiber.

## Setup

```bash
npm install
```

## Running locally

Place your 3 test MP4s in `public/test-clips/`:

```
public/test-clips/clip-001.mp4
public/test-clips/clip-002.mp4
public/test-clips/clip-003.mp4
```

Optionally add poster images (first-frame JPEGs):

```
public/test-clips/poster-001.jpg
public/test-clips/poster-002.jpg
public/test-clips/poster-003.jpg
```

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Controls

| Input | Action |
|-------|--------|
| Drag | Pan |
| Scroll / pinch | Zoom |
| Click tile | Focus |
| Escape | Dismiss focus |

## Phase 1 scope

- 3×3 grid of test clips (clips repeat to fill 9 tiles)
- VideoPool: up to 25 simultaneous video decoders, LRU eviction
- Hover scale spring, click-to-focus camera animation
- Inertia pan/zoom

## Deferred to Phase 2

- `scripts/transcode.ts` — ffmpeg transcode to 480p preview + poster extraction
- `scripts/upload-b2.ts` — Backblaze B2 upload for source-quality files
- Source-quality fetch on focus (currently uses preview for both states)
- Full 600-clip grid with 25-column layout
