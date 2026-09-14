# CLAUDE.md

Standing instructions for all future sessions on this repo.

---

## What this is

`daysofshiva` — an infinite-canvas video archive for a daily creative practice (630 numbered clips,
served from Backblaze B2). React 19 + React Three Fiber, deployed at days.shivav.space.

Ships in **two runtime targets** from one codebase (`src/runtime.ts`):

- **web** — the public site. Conservative pool sizes, first-screen posters only, delayed background
  prefetch, welcome modal.
- **kiosk** — an unattended machine at a gallery showing. Assets mirrored to local disk, large video
  pool, whole library preloaded, attract drift + auto-reset, cursor hiding, browser chrome locked
  down. Selected by `VITE_TARGET=kiosk` at build time or `?kiosk=1` at runtime.

---

## Stack

- **Vite 5** + **React 19** + **TypeScript** (strict)
- **React Three Fiber 9** — the only 3D dependency. No drei, no react-spring, no maath: they were
  removed because nothing imported them while `manualChunks` still shipped them.
- **Tailwind CSS v4** — DOM UI layer only (`src/ui/`), never inside R3F
- **Biome** for lint + format. `npm run lint`, `npm run format`

---

## Project structure

```
src/
  runtime.ts            # web vs kiosk target + every tunable that differs between them
  theme.ts              # layout + camera constants
  types.ts              # ClipData
  data/clips.json       # clip manifest (name only; URLs derived in lib/clip-source)
  data/clip-order.json  # precomputed similarity ordering
  canvas/
    Scene.tsx           # <Canvas> + CameraController (delta-scaled inertia pan/zoom)
    Grid.tsx            # slot layout, hover hit-test, and THE single frame loop
    Tile.tsx            # inert recycled mesh — registers into the slot registry, never re-renders
    slot.ts             # TileSlot registry + cell->slot recycling
    tile-video.ts       # the one hovered video: pooled element, VideoTexture, frame pump
    camera-state.ts     # mutable canvas state + focus/hover emitters
    attract.ts          # kiosk idle drift + auto-reset
  lib/
    poster-cache.ts     # refcounted LRU texture cache + in-flight dedupe
    poster-prefetch.ts  # preparePosters (decode) vs warmPosters (HTTP only)
    video-pool.ts       # pooled <video> elements, LRU
    clip-source.ts      # all asset URLs; poster tier switch
    kiosk.ts            # fullscreen, cursor hiding, gesture/context-menu lockdown
  ui/
    Chrome.tsx          # DOM overlay — bars, modals, focus video overlay
    LoadingScreen.tsx   # loader + its own progress store
scripts/
  bench.mjs             # frame-time benchmark (Playwright)
  smoke.mjs             # functional test (Playwright)
  mirror-local.mjs      # B2 -> local-clips/ for the kiosk
  serve-kiosk.mjs       # static server: dist/ at /, local-clips/ at /clips
  make-grid-posters.mjs # square poster tier generator (dry-run by default)
  normalize-b2.mjs      # the original B2 transcode/upload pipeline
```

---

## Key architectural rules

### The grid is a recycled slot pool — React is not in the pan path

This is the single most important thing about this codebase. Do not undo it.

`Grid` mounts a **fixed** pool of `<Tile>` meshes, sized for the worst case (fully zoomed out at the
current viewport, plus `VISIBLE_MARGIN_TILES` rings). Panning **reassigns cells to existing slots**;
it never mounts or unmounts anything. Cell -> slot is toroidal:

```
slot = mod(gx, cols) * rows + mod(gy, rows)
```

Within any contiguous `cols x rows` window every cell maps to a distinct slot, and shifting the
window by one column reuses exactly the column that scrolled out.

The previous design mounted a `<Tile>` component per visible cell. Crossing a tile boundary
destroyed and recreated a ring of components — each one a spring controller, a `useFrame`
subscription (which sorts R3F's subscriber array), a material, and a poster effect. That landed on
the frame that was already busiest. Measured at 4x CPU throttle, max zoom: **29 fps with 105 hitches
over a sustained drag, p95 frame time 134ms**. After: **57 fps, 7 hitches, p95 19ms**.

Corollaries, all load-bearing:

- **One `useFrame`, in `Grid`.** Not one per tile. It drives layout, hover, opacity, hover scale,
  texture selection and the video pump.
- **`Tile` is inert.** It mounts, registers `{mesh, mat}` into `slots[i]`, and never re-renders.
  If you find yourself adding a prop to `Tile`, you are probably putting React back in the pan path.
- **No raycasting.** The camera is axis-aligned and unrotated, so screen pixel -> cell is arithmetic
  (`cellAtPixel` in `Grid.tsx`). Tile meshes have no pointer handlers. R3F's event system used to
  test every one of ~200 meshes per `pointermove`, allocating an array per test.
- **`matrixAutoUpdate = false` on tiles.** `updateMatrixWorld` recurses into hidden children, so
  parked meshes would still recompose a matrix every frame. Anything that moves or scales a slot must
  call `mesh.updateMatrix()` itself.

### Frame-rate independence

All motion constants are **per second** and every `useFrame` clamps `delta` to `1/30`. Under
`frameloop="demand"` the gap since the last rendered frame is unbounded, so an unclamped delta
teleports the camera on the first frame after an idle period.

`MAX_VEL` (55 u/s) is chosen so one frame at 60Hz covers less than `TILE_SPACING` (1.568):
`55/60 = 0.92`. **Keep it that way.** The old value of 1.8 *per frame* exceeded tile spacing, so a
hard fling crossed a boundary every single frame.

### Demand frameloop

`frameloop="demand"` means nothing renders unless something calls `invalidate()`. Anything async that
changes what is on screen must request a frame — poster arrival, focus change, video frame. Equally,
anything that keeps calling it forever pins the GPU at 60fps for an all-day kiosk. `scripts/smoke.mjs`
asserts the loop reaches **zero draws** when idle; keep that test passing.

### Material transparency

A settled, unscaled tile is flipped to `transparent: false` / `depthWrite: true` so the steady-state
grid renders in the opaque pass with early-Z instead of blending ~200 quads back-to-front. Only
fading or hover-scaled tiles need blending (a 1.3x tile overlaps its 1.12x spacing).

Never set `material.needsUpdate` for `transparent`/`depthWrite` — those are render-list and GL state,
not shader defines, and `needsUpdate` forces a program recompile. Do set it when `map` goes
null <-> non-null, because that toggles `USE_MAP`.

### Textures

`poster-cache.ts` is **refcounted**. Eviction never disposes a texture a live slot still holds, and
the cap is derived from the worst-case visible count (`Grid` calls `setPosterCacheCap`). In-flight
loads are deduped by URL. Posters decode via `createImageBitmap` where available so the JPEG decode
happens off the main thread rather than at `texImage2D` time.

Video textures are created per acquire and disposed on release. A `THREE.VideoTexture` is bound to
its element at construction — swapping `.src` does not update it, so a new texture is needed whenever
the pooled element changes.

### Video

Only ever **one** tile plays: the hovered one. All of it lives in `tile-video.ts`. Pool elements stay
`muted` for their whole life — browsers only autoplay muted media, so unmuting them makes `play()`
reject and the tile never gets a frame. Audio belongs to the focused clip, which `VideoOverlay` owns.
A focused tile releases its own preview so the clip is not decoded twice.

### DOM overlay

`Chrome` subscribes to `subscribeFocus` / `subscribeHover`. It must not poll — it used to re-render
its whole tree 20x/second and lag the hover label by up to 50ms.

**No `backdrop-filter` over the canvas.** A full-viewport backdrop filter makes the compositor
snapshot the WebGL canvas on every recomposite. Use a flat scrim.

---

## Testing

```bash
npm run build && npx vite preview --port 4173

npm run smoke                       # 16 functional checks — must be 16/16
npm run bench -- --cpu 4            # frame times; --cpu 4 stands in for slower hardware
npm run bench -- --cpu 4 --out bench/x.json
```

**Always benchmark with `--cpu 4` or higher.** On a fast machine every version of this code renders
at 60fps and the benchmark tells you nothing — the original stutter was invisible unthrottled.

Reference numbers, 1920x1080 at `--cpu 4`, max zoom sustained drag: **57 fps / p95 19ms / 7 hitches**.

---

## Assets

Three tiers on B2, all derived from the clip `name` in `lib/clip-source.ts`:

| URL | What | Size |
|---|---|---|
| `{name}.mp4` | full-quality source, focus overlay only | 3-12MB |
| `{name}-480.mp4` | 640x360 muted hover preview | ~700KB |
| `{name}.jpg` | 712x400 poster | 18-29KB |
| `{name}-sq.jpg/webp` | optional square grid tier, `VITE_POSTER_TIER=sq` | ~7KB |

**Known outstanding issue:** the bucket is hit directly and returns **no `Cache-Control` header** at
all, with ~250ms TTFB. The site shell is behind Cloudflare but the assets are not. Putting a
Cloudflare hostname in front of the bucket with `public, max-age=31536000, immutable` (filenames are
stable day numbers) is the largest remaining win for web visitors and needs no code change beyond
`VITE_CDN_BASE`.

`public/` must stay empty of clips — 254MB of leftovers used to be copied into `dist/` on every build.

---

## Running

```bash
npm run dev          # http://localhost:5173
npm run build        # web build
npm run lint

# kiosk
npm run clips:mirror              # B2 -> local-clips/ (~415MB; --with-sources for full quality)
npm run kiosk                     # build with VITE_TARGET=kiosk VITE_CDN_BASE=/clips, then serve
```

Lint currently reports ~37 pre-existing errors, nearly all a11y rules in `Chrome.tsx`. That is the
baseline; don't add to it.

---

## Aesthetic target

Pristine, minimal, generous negative space. If a feature makes the canvas feel less clean, it doesn't
belong here. No header, no nav, no logo.
