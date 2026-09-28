# CLAUDE.md

Standing instructions for all future sessions on this repo. Read `system_architecture.md` before
changing anything in `src/stage/`.

---

## What this is

`daysofshiva` v2: a gallery for a daily creative practice (~680 numbered clips on Backblaze B2).
Four views over one ordered list of clips, all sortable and filterable:

| View | What |
|---|---|
| Field | infinite drag/zoom lattice (v1's canvas) |
| Flow | iTunes Cover Flow rail with a floor reflection |
| Stack | card-file rail: cards stand in a receding stack, the front one flips away |
| Index | plain DOM grid, grouped by year or style |

Field, Flow and Stack share one WebGL stage. Switching view or sort morphs every tile from where it
is to where the new layout wants it. Index is DOM and lazy-loaded. Deployed at days.shivav.space.

---

## Stack

- **Vite 7** + **React 19** + **TypeScript** (strict)
- **React Three Fiber 9** for the stage. No drei.
- **Motion** (`motion/react`) for DOM UI only. Never inside the stage.
- **zustand** (vanilla store) for app state, readable from the frame loop without React
- **Tailwind CSS v4**, tokens in `src/index.css`
- **@phosphor-icons/react**, the only icon set
- **Clash Grotesk** variable, self-hosted in `public/fonts/`
- **Biome** for lint + format. `npm run lint`, `npm run format`

---

## Project structure

```
src/
  main.tsx              # app shell: stage, index view, chrome, dock, player, modals
  runtime.ts            # mobile vs desktop tunables, reduced-motion query
  types.ts
  data/                 # clips.json, clip-styles.json, clip-order.json, atlas.json (generated)
  state/
    store.ts            # zustand store, actions, URL sync (?v ?s ?d ?st ?c)
    sort.ts             # orderClips(): sort + style filter, pure
  stage/
    Stage.tsx           # <Canvas>, slot pool mount, THE useFrame, store -> engine sync
    engine.ts           # layouts, morphs, LOD, hover, picking, video arming
    input.ts            # pointer/wheel/keys -> engine
    material.ts         # the one tile shader (atlas + poster/video crossfade, reflection)
    atlas.ts            # thumbnail atlas sheets + per-clip UV rects
    tile-video.ts       # the single preview video
    config.ts           # every stage constant
    frame.ts            # requestFrame() for the demand loop
  lib/
    poster-cache.ts     # refcounted LRU poster textures, ImageBitmap decode
    video-pool.ts       # pooled muted <video> elements
    clip-source.ts      # all B2 asset URLs
    days.ts             # day number <-> date, "days made"
  ui/
    Dock.tsx            # view switch, sort menu, filter + go-to-day, theme
    Player.tsx          # shared-element player (morphs out of the tile)
    IndexView.tsx       # lazy DOM grid
    Chrome.tsx          # top bar, readout, empty state, About, Welcome
    Popover.tsx, theme.ts
scripts/
  make-atlas.mjs        # posters -> public/atlas/*.webp + src/data/atlas.json
  smoke.mjs             # functional test (Playwright), must be 29/29
  smoke-mobile.mjs      # touch/phone test, must be 25/25
  bench.mjs             # frame-time benchmark (Playwright)
  tag-styles.py         # CLIP style clusters + similarity order
  normalize-b2.mjs, make-grid-posters.mjs
```

---

## Key rules (details and reasons in system_architecture.md)

- **React is not in the motion path.** A fixed pool of meshes is mounted once per viewport size.
  The engine mutates them. No per-tile components, no per-tile `useFrame`, no React state in the loop.
- **The camera never moves.** Layouts place tiles in camera space. That is what makes any layout
  morph into any other. Field "panning" moves the tiles.
- **One frame loop** (`tick` in `engine.ts`), called from `Stage.tsx`.
- **Demand frameloop.** Anything async that changes the picture calls `requestFrame()`. Idle must
  reach zero draws (smoke test checks it).
- **All motion constants are per second**; `tick` clamps delta to 1/30.
- **Never set `material.needsUpdate`** to flip `transparent`/`depthWrite`.
- **No `backdrop-filter`** over the canvas. Use flat scrims and gradients.
- **Motion and Three never share a component tree.**
- **Rail hover is shader-only** (`uHover` brightens). Never scale or move a Flow/Stack card on hover:
  they overlap, so any geometric lift pokes through neighbours. Field tiles may scale.
- **Reflections are opaque**, faded into `uBg` (set from the theme). Transparent reflections bled
  through each other.
- **Canvas taps open on `click`, not `pointerup`.** Opening on pointerup put the player's scrim under
  the browser's own click, which closed it again (seen as a flash on mobile).
- DOM `<img>`/`<video>` of B2 assets must set `crossOrigin="anonymous"`, or they poison the HTTP
  cache for the stage's CORS fetches.

---

## Design rules

- Tokens only (`--bg`, `--ink`, `--dim`, `--line`, `--surface`, `--accent`...). Light and dark both,
  resolved before first paint by the inline script in `index.html`.
- One accent: the brand blue. Controls are pills, panels 22px, media square.
- No em dashes in visible text.
- Every animation respects `prefers-reduced-motion` (`MotionConfig reducedMotion="user"`, and the
  engine skips morphs).

---

## Testing

```bash
npm run build && npx vite preview --port 4173

npm run smoke                        # 29 checks, must be 29/29
npm run smoke:mobile                 # 25 checks on a 390px touch device (real CDP touch events)
npm run bench -- --cpu 4             # always throttle; unthrottled everything reads 60fps
```

Reference, 1920x1080 at `--cpu 4` on the dev machine (v1 from `main` in brackets):

| Scenario | fps | hitches |
|---|---|---|
| fling | 59.2 (37.1) | 0 (21) |
| sustained drag | 57.9 (34.5) | 1 (133) |
| max-zoom fling | 38.5 (13.9) | 22 (58) |
| max-zoom sustained | 49.8 (20.6) | 15 (300) |
| morph stack > field | 57.5 | 1 |

`?debug` exposes `window.__slots` for inspecting tile state from the console.

---

## Assets

| URL | What |
|---|---|
| B2 `{name}.mp4` | full quality, player only |
| B2 `{name}-480.mp4` | muted hover / front-card preview |
| B2 `{name}.jpg` | 712x400 poster, stage LOD + index + player |
| `/atlas/atlas-{n}.webp` | every clip at 96px, 2 sheets, ~880KB |

**After adding clips** (and running `tag-styles.py`), run `npm run clips:atlas` (set
`VITE_CDN_BASE`). A clip missing from the atlas still works; it just paints grey until its poster lands.

The B2 bucket still sends no `Cache-Control`. A Cloudflare hostname in front of it with
`immutable` caching remains the biggest network win; it only needs `VITE_CDN_BASE`.

---

## Aesthetic target

Quiet, gallery-like, the work first. The chrome is a top line, a readout and one floating dock.
