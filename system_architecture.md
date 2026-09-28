# System architecture (v2 stage)

Save-state for future sessions. Read before changing `src/stage/`.

## Data flow

```
store (zustand)  --subscribe-->  Stage.useSceneSync  --requestScene(view, ordered)-->  engine
   ^                                                                                  |
   | actions.*                                                                        | tick() every frame
 Dock / Player / input.ts  <--- subscribeCurrent (hover / front card) ----------------+
```

- `state/sort.ts#orderClips` turns `{sort, dir, styles, seed}` into `ordered`. The store keeps
  `ordered` as a value and only replaces it when those inputs change, so `ordered !== prev.ordered`
  is the "order changed" signal.
- Index view reads `ordered` directly. The stage keeps its last scene while Index is open and
  re-enters with an entrance animation (`{ entering: true }`) when you come back.

## Slots

`Stage.tsx` builds `setViewport()`-many meshes imperatively (not JSX) and stores them in
`engine.slots`. The count is the Field window at max zoom-out plus margins, or the rails' needs,
whichever is larger. Resizing remounts the pool and re-enters the scene.

Each `Slot` holds three transforms: target (`t*`, written by the layout), current (drawn), and
morph-from (`f*`). `key` identifies the layout item, `gen` the scene. A new scene bumps `gen`,
so every slot reassigns on the next frame, and any slot the new layout doesn't visit gets parked.

## Layouts

`visitField` / `visitFlow` / `visitStack` enumerate the items they want drawn, write the transform
into the shared `X` object, and call back with `(key, index, slotIndex)`:

- Field: lattice cell `(gx, gy)`, toroidal slot mapping `mod(gx, poolCols) * poolRows + mod(gy, poolRows)`
  (v1's scheme: a cell keeps its slot while on screen). Row 0 is at the top. The column count is
  chosen near 20 to minimise short-row holes, and any leftover cells borrow from the start.
- Flow / Stack: rail index `i`, slot `mod(i, poolCount)`. Both read `cam.rail`, so switching
  between them keeps your place.

## Scene changes (`requestScene` -> `applyPending`)

1. Compute the next scene and its camera. The clip nearest screen centre anchors it: Field centres on
   that clip's cell, rails put it at the front.
2. Enumerate the next scene to get the `keep` set. Tiles whose clip isn't in it fade for `EXIT_MS`.
3. Apply: snapshot current transforms by clip name (nearest-centre instance wins), swap the scene,
   bump `gen`. On the first frame each assigned slot starts from its snapshot, or, when entering,
   from slightly smaller, further back and transparent. It eases (expo-out) to the target with a
   stagger by distance from centre.

Reduced motion applies immediately with no exit phase.

## LOD and textures

- Atlas first: `atlas.ts` loads 2 WebP sheets; every tile samples its 96px cell from frame one.
  `Stage` waits for sheet 0 (max 2.5s) before the first scene so the entrance has pictures.
- Poster upgrade when the tile is on screen, taller than `POSTER_MIN_PX` device px, and neither
  flying (`fast`) nor morphing. Arrivals queue and at most `UPLOADS_PER_FRAME` (3) are handed to
  tiles per frame, which keeps texture uploads from bunching into one hitch.
- Shader crossfades atlas to poster with `uMix`, and samples only one texture when `uMix` is 0 or 1.
- Video: `tile-video.ts` arms the hovered tile (Field) or the settled front card (rails).
  `uMix = 1` with `uMap` = the VideoTexture once a frame has decoded.

## Player

`ui/Player.tsx` computes the tile's screen rect (`engine.rectOf` or the index cell's DOM rect) and
animates the 16:9 frame from "scaled to the tile's height, sides clipped to a square" to full. On
close it animates back to wherever that clip's tile is now. The engine hides the focused clip's
tile (`setHidden`) so it reads as lifted out, and `setLocked` stops input and previews while the
player is open. Rail physics keeps running, so prev/next glides the rail behind the player.

## Performance notes

- Transparent only while fading or hover-enlarged; settled tiles are opaque and write depth.
- Field hit-testing is arithmetic; rails raycast only their ~30 visible meshes.
- Remaining cost at max zoom-out is ~130 draw calls. The next step, if needed, is an InstancedMesh
  atlas layer (1 draw call) with separate meshes only for poster/video tiles.
