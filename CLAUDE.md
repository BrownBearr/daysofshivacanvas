# CLAUDE.md

Standing instructions for all future sessions on this repo.

---

## What this is

`daysofshiva` — an infinite-canvas video archive viewer for a daily creative practice (~600 numbered MP4 clips). Built with React 19 + React Three Fiber. Currently Phase 1: a working grid of real clips served from local files.

---

## Stack

- **Vite 5** + **React 19** + **TypeScript** (strict)
- **React Three Fiber 9** + **@react-three/drei** for 3D canvas
- **@react-spring/three** for tile hover/scale animations
- **maath** (`easing.damp3`) for camera animations in `useFrame`
- **Tailwind CSS v4** — DOM UI layer only (`src/ui/`), never inside R3F
- **Biome** for lint + format (not ESLint). Run: `npm run lint`, `npm run format`

---

## Project structure

```
src/
  main.tsx              # App root; passes clips to Scene + Chrome
  theme.ts              # All layout constants + color config — change values here
  types.ts              # ClipData, TileData interfaces
  data/clips.json       # Clip manifest — name (filename sans ext), preview, poster paths
  lib/
    video-pool.ts       # VideoPool singleton — 25 HTMLVideoElement LRU pool
  canvas/
    camera-state.ts     # Shared mutable ref (no React state); focusTile(), unfocusTile()
    Scene.tsx           # <Canvas> + CameraController (inertia pan/zoom/Escape)
    Grid.tsx            # Chunk-based visible/play set; builds tile layout from clips
    Tile.tsx            # <mesh> per clip; VideoTexture, UV crop, hover spring, focus
  ui/
    Chrome.tsx          # Fixed DOM overlay — clip name on focus, day count, help glyph
public/
  test-clips/           # MP4s + JPG posters — named by clip number (e.g. 965.mp4, 965.jpg)
```

---

## Key architectural rules

### State management
- **Never write React state in `useFrame`** — use the mutable `cameraState` object in `camera-state.ts`
- `useState` / `setState` is only for chunk grid changes and DOM UI polling (50ms interval)
- Focus/unfocus always goes through `focusTile()` / `unfocusTile()` — they manage `animTarget` and `isAnimatingFocus`

### VideoPool
- Singleton in `src/lib/video-pool.ts` — 25 `<video>` elements, LRU eviction
- `acquire(tileId, src)` → `HTMLVideoElement | null`; `release(tileId)` → void
- Pool elements: `muted=true`, `loop=true`, `playsInline=true`
- Tiles unmute their element when `cameraState.focusedTileId === tileIndex`
- Pool size is `POOL_SIZE` in `theme.ts` — tune if Safari hits decoder cap (error 4)

### VideoTexture sharp edge
- `THREE.VideoTexture` is bound to a specific element at construction; swapping `.src` does not update it
- Solution: create a new `VideoTexture` whenever the pool element reference changes
- UV square-crop (`applySquareCrop`) is applied on `loadedmetadata` for videos; on load for posters

### Camera
- Free nav: velocity physics (inertia) → `cameraState.pos` → `camera.position` set directly
- Focus/unfocus: `damp3(camera.position, animTarget, FOCUS_LAMBDA=5, delta)` in `useFrame`
- `isAnimatingFocus` prevents free-nav physics from running during transitions
- Sensitivity constants live at the top of `Scene.tsx`: `DRAG_SENSITIVITY`, `SCROLL_SENSITIVITY`

### Tiles
- Always square (`TILE_W = TILE_H = 1.0`); non-square videos center-cropped via `texture.repeat/offset`
- Hover spring via `@react-spring/three` `useSpring` — `tension: 280, friction: 26`
- `planeGeometry args={[TILE_W, TILE_H]}`

---

## Adding more clips

1. Drop MP4s into `public/test-clips/` named by day number (e.g. `1250.mp4`)
2. Generate posters: `ffmpeg -i 1250.mp4 -frames:v 1 -q:v 3 -vf scale=640:-1 1250.jpg`
3. Regenerate `src/data/clips.json`:
   ```bash
   cd public/test-clips && python3 -c "
   import os, json
   files = sorted([f[:-4] for f in os.listdir('.') if f.endswith('.mp4')], key=lambda x: int(x))
   clips = [{'id': i+1, 'name': n, 'preview': f'/test-clips/{n}.mp4', 'poster': f'/test-clips/{n}.jpg'} for i, n in enumerate(files)]
   print(json.dumps({'clips': clips, 'total': len(clips)}, indent=2))
   " > ../../src/data/clips.json
   ```
4. Adjust `GRID_COLS` in `theme.ts` if needed

---

## Phase 2 work (deferred)

- `scripts/transcode.ts` — ffmpeg to 480p H.264 preview + poster extraction
- `scripts/upload-b2.ts` — Backblaze B2 upload for source-quality files
- Source-quality fetch on focus (swap `preview` → `source.mp4` when tile is clicked)
- Mobile touch polish (two-tap focus flow)
- Full 600-clip grid with `GRID_COLS = 25`

---

## Running locally

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build — chunks Three/R3F/spring separately
npm run lint      # Biome check
npm run format    # Biome format --write
```

Clips must be in `public/test-clips/` — see `src/data/clips.json` for the expected names.

---

## Aesthetic target

Pristine, minimal, generous negative space. Off-white background (`#ffffff`), near-black tiles. If a feature makes the canvas feel less clean, it doesn't belong here. Typography: Inter/system-ui, small, low contrast. No header, no nav, no logo.
