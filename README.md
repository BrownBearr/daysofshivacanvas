# daysofshiva

A gallery for a daily creative practice: every clip, one per day. Four views (Field, Flow, Stack,
Index), sorting by day, style, similarity or shuffle, and style filters.

## Setup

```bash
npm install
echo VITE_CDN_BASE=https://daysofshiva-source.s3.us-east-005.backblazeb2.com > .env
npm run dev          # http://localhost:5173
```

## Controls

| Input | Action |
|---|---|
| Drag / two-finger swipe | Pan the field, scrub a rail |
| Scroll / pinch | Zoom the field, flip through a rail |
| Click | Open a clip (on a rail, bring it to the front first) |
| 1 2 3 4 | Field, Flow, Stack, Index |
| Arrows | Pan / step; in the player, previous and next |
| Esc | Close |

## After adding clips

```bash
npm run clips:atlas   # rebuild the thumbnail atlas
```

See `CLAUDE.md` for architecture rules and testing.
