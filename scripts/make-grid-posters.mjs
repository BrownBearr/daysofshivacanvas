// Generate a small square poster tier for the tile grid.
//
// Why: tiles render as squares, but the current posters are 712x400 landscape. So ~44% of every
// poster is downloaded, decoded, uploaded to the GPU and then cropped away by the UV transform —
// and at max zoom a tile is only ~130px on screen, so what survives the crop is still ~3x
// oversampled. Each poster costs ~1.5MB of VRAM with mipmaps, and the grid holds ~250 of them.
//
// A pre-cropped 384x384 tier is ~590KB in VRAM (2.5x less) with no wasted pixels, and as WebP is
// roughly a third of the download. That is the remaining cost behind the hitches when panning fast
// at max zoom, where newly revealed tiles have to decode and upload a poster each.
//
// Produces, per clip:  {name}-sq.webp (or -sq.jpg if this ffmpeg has no webp encoder),
//                      used by the app when VITE_POSTER_TIER=sq
//
// Usage:
//   node scripts/make-grid-posters.mjs --dry-run        # default: report only, touches nothing
//   node scripts/make-grid-posters.mjs --limit 5        # build 5 locally into .cache, no upload
//   node scripts/make-grid-posters.mjs --upload         # build all and upload to B2
//   node scripts/make-grid-posters.mjs --size 512       # different edge length (default 384)
//
// Requires ffmpeg on PATH (same dependency normalize-b2.mjs already has).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const SIZE = Number(argOf("size", 384));
const LIMIT = Number(argOf("limit", 0));
const UPLOAD = has("upload");
// Uploading writes to the live bucket, so it is never the default.
const DRY = !UPLOAD;

function env() {
  const out = {};
  for (const file of [".env", ".env.local"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/["']/g, "").trim();
    }
  }
  return out;
}

const E = env();
const CDN = (E.VITE_CDN_BASE ?? "").replace(/\/$/, "");
if (!CDN) throw new Error("VITE_CDN_BASE not set in .env / .env.local");

const clips = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/clips.json"), "utf8")).clips;
const work = LIMIT > 0 ? clips.slice(0, LIMIT) : clips;

const CACHE = path.join(ROOT, "scripts/.cache/grid-posters");
fs.mkdirSync(CACHE, { recursive: true });

if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("ffmpeg not found on PATH — required to crop and re-encode.");
  process.exit(1);
}

// Not every ffmpeg build ships libwebp. The square crop is the bigger win anyway (it is what cuts
// VRAM and decode cost); WebP only shrinks the download further. So use it when it is available and
// fall back to JPEG when it is not, rather than failing.
function detectFormat() {
  const forced = argOf("format", "");
  if (forced === "webp" || forced === "jpg") return forced;
  const encoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  return /\blibwebp\b|\bwebp\b/.test(encoders) ? "webp" : "jpg";
}

const FORMAT = detectFormat();
const EXT = FORMAT === "webp" ? "webp" : "jpg";
const MIME = FORMAT === "webp" ? "image/webp" : "image/jpeg";

let s3 = null;
if (UPLOAD) {
  for (const k of ["B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT", "B2_REGION"]) {
    if (!E[k]) throw new Error(`${k} missing from .env.local — needed to upload`);
  }
  s3 = new S3Client({
    region: E.B2_REGION,
    endpoint: E.B2_ENDPOINT,
    credentials: { accessKeyId: E.B2_KEY_ID, secretAccessKey: E.B2_APP_KEY },
  });
}

let built = 0;
let uploaded = 0;
let skipped = 0;
let failed = 0;
let srcBytes = 0;
let outBytes = 0;

async function one(clip) {
  const key = `${clip.name}-sq.${EXT}`;
  const dest = path.join(CACHE, key);

  if (UPLOAD) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: E.B2_BUCKET, Key: key }));
      skipped++;
      return;
    } catch {
      // Not present yet — build and upload it.
    }
  }

  const srcUrl = `${CDN}/${clip.name}.jpg`;
  const srcFile = path.join(CACHE, `${clip.name}.src.jpg`);

  if (!fs.existsSync(srcFile)) {
    const res = await fetch(srcUrl);
    if (!res.ok) {
      failed++;
      process.stderr.write(`\n  ! ${clip.name}: source poster HTTP ${res.status}\n`);
      return;
    }
    fs.writeFileSync(srcFile, Buffer.from(await res.arrayBuffer()));
  }
  srcBytes += fs.statSync(srcFile).size;

  if (!fs.existsSync(dest)) {
    // Center-crop to a square on the short edge, then scale to SIZE. `increase` + crop is what
    // makes this match the UV "cover" crop the renderer was doing at runtime.
    const encodeArgs = FORMAT === "webp" ? ["-c:v", "libwebp", "-quality", "82"] : ["-c:v", "mjpeg", "-q:v", "4"];
    const r = spawnSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      srcFile,
      "-vf",
      `crop='min(iw,ih)':'min(iw,ih)',scale=${SIZE}:${SIZE}:flags=lanczos`,
      ...encodeArgs,
      dest,
    ]);
    if (r.status !== 0) {
      failed++;
      process.stderr.write(`\n  ! ${clip.name}: ffmpeg failed\n`);
      return;
    }
  }
  built++;
  outBytes += fs.statSync(dest).size;

  if (UPLOAD) {
    await s3.send(
      new PutObjectCommand({
        Bucket: E.B2_BUCKET,
        Key: key,
        Body: fs.readFileSync(dest),
        ContentType: MIME,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    uploaded++;
  }

  process.stdout.write(
    `\r  ${built + skipped + failed}/${work.length}  built ${built}  uploaded ${uploaded}  skipped ${skipped}  failed ${failed}   `
  );
}

console.log(`Grid poster tier: ${SIZE}x${SIZE} ${EXT.toUpperCase()}, ${work.length} clips`);
console.log(DRY ? "  DRY RUN — building locally only, nothing is uploaded\n" : `  UPLOADING to ${E.B2_BUCKET}\n`);

for (const clip of work) await one(clip);

console.log("\n");
if (built > 0) {
  const avgIn = srcBytes / Math.max(1, built);
  const avgOut = outBytes / Math.max(1, built);
  console.log(
    `  average poster ${(avgIn / 1024).toFixed(1)}KB -> ${(avgOut / 1024).toFixed(1)}KB  (${((1 - avgOut / avgIn) * 100).toFixed(0)}% smaller)`
  );
  console.log(`  VRAM per texture 712x400 RGBA ~1.09MB -> ${SIZE}x${SIZE} ~${((SIZE * SIZE * 4) / 1e6).toFixed(2)}MB`);
}
if (DRY) {
  console.log(`\n  Nothing was uploaded. Re-run with --upload to publish, then set VITE_POSTER_TIER=sq`);
  if (EXT === "jpg") console.log("  (this ffmpeg has no webp encoder, so the tier would be JPEG — still square-cropped)");
} else {
  console.log(`\n  Done. Set VITE_POSTER_TIER=sq in the environment to use the new tier.`);
}
