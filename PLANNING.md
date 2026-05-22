# PLANNING.md

One-time planning prompt for Claude Code. Run this in plan mode at project kickoff. Archive after the plan is approved and execution begins.

---

## Project

Build `daysofshiva`, an infinite-canvas video archive viewer for a daily creative practice. The full archive is ~600 numbered MP4 clips, 20 seconds each. Aesthetic target: pristine, minimal, generous negative space.

## Reference repos

Read both repos thoroughly before planning. Do not skim.

- https://github.com/edoardolunardi/infinite-canvas — primary architectural reference (R3F + chunk culling + progressive loading). The Codrops article linked from the README is also worth reading: https://tympanus.net/codrops/?p=106679
- https://github.com/MatthewGreenberg/shoe-finder — interaction reference (hover scaling + camera focus + Dynamic Island UI bar)

## Scope of this kickoff

**Start with a vertical slice using the 3 test MP4s I'll place in `/public/test-clips/`.** Do not build the full pipeline upfront. Defer the Backblaze upload script and the ffmpeg transcode script until the core pattern is validated. The first deliverable proves the video pool pattern works with a small grid of test clips, running entirely from local files.

## Stack

- Vite + React 19 + TypeScript
- React Three Fiber + Drei
- `@react-spring/three` for tile spring animations
- Tailwind CSS v4 for the DOM UI layer only (chrome, overlays, not R3F materials)
- Biome for lint and format (match the codrops repo conventions)

Do not add dependencies without proposing them first and justifying. No CSS-in-JS. No state management library unless local state and lifted state both demonstrably stop working.

## Core architecture, non-negotiable

### 1. Three asset versions per clip (full pipeline, defer scripts)

- `poster_{n}.jpg` — first frame, ~30kb, ~640px wide, ships with the site
- `preview_{n}.mp4` — 480p H.264, ~500kb, ships with the site, the looping canvas tile
- `source_{n}.mp4` — original quality, lives on Backblaze B2 behind Cloudflare CDN, fetched only when a tile is focused

For the vertical slice, just use the 3 test MP4s directly as previews. Skip transcoding for now. We'll add `scripts/transcode.ts` and `scripts/upload-b2.ts` after the pool pattern is proven.

### 2. The recycled video element pool

This is the critical pattern. Browsers cap simultaneous video decoders, Safari most aggressively. With 600 clips we cannot mount 600 `<video>` elements.

Build a `VideoPool` class:

- Maintains a fixed pool of ~25 `HTMLVideoElement` instances, hidden in DOM (style `display: none` is fine; element exists but is not visible)
- Each pool element is configured: `muted=true`, `loop=true`, `playsInline=true`, `preload="metadata"`
- Exposes `acquire(tileId, src): HTMLVideoElement` and `release(tileId): void`
- LRU eviction when the pool is at capacity
- Tiles that fail to acquire a pool element fall back to their poster image as a static texture

In R3F's `useFrame`, compute which tiles are within a "play radius" of the camera (in view + a small buffer ring). Request pool elements for those tiles, release elements for tiles outside the radius.

The pool size of 25 is a starting point. The plan should include how we'll validate or tune this number.

### 3. Grid layout

Tiles arranged in a 2D grid on the z=0 plane, ordered by numeric filename. Gap is ~1.6x tile width (negative space matters for the pristine feeling). Use chunk-based culling like the codrops repo: tiles are grouped into spatial chunks, only chunks intersecting the viewport (plus buffer) are mounted as R3F nodes.

Decide and justify in the plan: do we wrap modulo for "infinite" feel, or expose edges? Either is fine, but be explicit. Expose a config flag for both behaviors if cheap.

### 4. Tile component

Each tile is a `<mesh>` with `<planeGeometry>` and a material whose `map` is either:

- A `VideoTexture` wrapping the pool element assigned to that tile, or
- A regular `useTexture` of the poster (the fallback)

Idle: tile at base scale, video plays muted on loop.

Hover (pointer events): spring to ~1.3x scale, z-position lifts ~0.1 units, subtle shadow or rim if doable cheaply. Use `@react-spring/three` for animation.

Click: camera animates to fit the tile to viewport (~600ms ease). The focused tile gets a separate dedicated `HTMLVideoElement` (not from the main pool) that loads `source.mp4` instead of `preview.mp4`. Audio unmutes. Metadata overlay fades in via Tailwind DOM layer (day number, date if computable from filename).

Escape key or click on backdrop: reverse. Camera returns to previous position, source video releases, audio mutes, preview resumes.

### 5. Mobile / touch

Hover does not exist on touch. On touch input: first tap = grow (hover equivalent), second tap on same tile = focus (click equivalent), tap elsewhere = dismiss. Detect via pointer event type (`pointerType === 'touch'`), not viewport width.

### 6. UI chrome

Minimal. A single fixed element bottom-left showing current day count, like `001 / 600`. A small help glyph that reveals keyboard shortcuts on hover. No header, no nav, no logo.

Typography: a single neutral sans (Inter or system-ui), near-invisible weight and size, low contrast against background. Single accent color, configurable in `src/theme.ts`. Default to off-white background, near-black tiles.

### 7. Performance budget

- Initial JS bundle under 1MB
- Total transfer under 5MB before first interaction
- 60fps pan/zoom on M1 MacBook Air, 30fps minimum on iPhone 12
- Pool size tuned so peak GPU memory stays under 500MB
- Posters lazy-load by chunk, never all at once

If the plan would breach any of these, flag it.

## Deliverables for the vertical slice (Phase 1)

1. Working Vite + R3F project with the 3 test MP4s rendering in a small grid (say, 3x3 with the test clips repeated to fill it)
2. Functional video pool with LRU eviction
3. Hover scale + click-to-focus interactions
4. Pan/zoom navigation matching the codrops base
5. `data/clips.json` manifest, generated at build time from filesystem state
6. README covering setup and how to run locally
7. Deploys to Vercel or Netlify as a static build

**Out of scope for Phase 1:**

- `scripts/transcode.ts` (deferred until pattern is validated)
- `scripts/upload-b2.ts` (deferred)
- Source-quality fetch on focus (use preview for both states in Phase 1, swap to source.mp4 in Phase 2)
- Mobile touch handling polish (basic should work, edge cases later)
- Metadata overlay beyond day number

## What to plan before coding

Before writing any code, produce a plan covering:

1. Folder structure
2. State management approach (lifted state, context, or zustand — justify the choice)
3. The `VideoPool` API surface in detail: method signatures, eviction logic, how it interacts with React lifecycle
4. How `VideoTexture` updates are signaled to R3F when the underlying `<video>` element changes src (this is a known sharp edge)
5. The camera focus animation: does the focused tile keep its preview element while source loads, or swap immediately? What does the user see during the load?
6. Risks and unknowns you want to validate during the vertical slice
7. What you'd build first as the minimum viable test of the pool pattern

Do not start coding until the plan is approved.

## Constraints

- No unnecessary dependencies. Justify each addition past the listed stack.
- No CSS-in-JS, Tailwind only for the DOM UI layer.
- No `<form>` tags inside R3F.
- Comments explain why, not what.
- File names: kebab-case for non-component files, PascalCase for component files.
- Match the codrops repo's code style where reasonable (Biome config, hook patterns).
- After the plan is approved and Phase 1 is built, write a `CLAUDE.md` at the repo root with standing instructions for future sessions. (I'll provide a draft separately if needed.)

## When in doubt

Optimize for the feeling of the reference repos, not feature parity with any video platform. If a feature would make the canvas feel less pristine, it doesn't belong here.
