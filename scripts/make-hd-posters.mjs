// HD poster tier: a sharp square still per clip, cut straight from the full-quality source.
//
// Why: the original {name}.jpg posters are 712x400 at heavy JPEG compression (~23KB). The stage
// crops them to a 400px square, then a zoomed-in tile stretches that over 1000-1800 device px, so
// every still looked soft and blocky. The sources are 1422x720, so a centre-square frame at 720px
// is the native resolution, with no upscale.
//
// The frame is taken at the same 0.5s the old posters used, so tiles don't change picture. ffmpeg
// reads the remote MP4 with HTTP range requests, so each clip costs ~1-2MB of download, not the
// whole file.
//
// Produces, per clip:  scripts/.cache/hd-posters/{name}.webp   (used by make-atlas.mjs too)
//                      B2 {name}-hd.webp                        (with --upload; app uses it when
//                                                                VITE_POSTER_TIER=hd)
//
//   node scripts/make-hd-posters.mjs                # build all locally, upload nothing
//   node scripts/make-hd-posters.mjs --limit 10     # first 10 only
//   node scripts/make-hd-posters.mjs --upload       # build missing ones and upload to B2
//
// Requires ffmpeg with libwebp on PATH.

import { spawn, spawnSync } from "node:child_process";
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

const SIZE = Number(argOf("size", 720));
const QUALITY = Number(argOf("quality", 84));
const LIMIT = Number(argOf("limit", 0));
const CONCURRENCY = Number(argOf("concurrency", 8));
const UPLOAD = has("upload");
const FORCE = has("force");

function env() {
  const out = { ...process.env };
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
if (!CDN) throw new Error("VITE_CDN_BASE not set in env / .env / .env.local");

if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("ffmpeg not found on PATH.");
  process.exit(1);
}

const clips = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/clips.json"), "utf8")).clips;
const work = LIMIT > 0 ? clips.slice(0, LIMIT) : clips;
const CACHE = path.join(ROOT, "scripts/.cache/hd-posters");
fs.mkdirSync(CACHE, { recursive: true });

let s3 = null;
if (UPLOAD) {
  for (const k of ["B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT", "B2_REGION"]) {
    if (!E[k]) throw new Error(`${k} missing from .env.local, needed to upload`);
  }
  s3 = new S3Client({
    region: E.B2_REGION,
    endpoint: E.B2_ENDPOINT,
    credentials: { accessKeyId: E.B2_KEY_ID, secretAccessKey: E.B2_APP_KEY },
  });
}

function ffmpeg(argv) {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", argv, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d;
    });
    p.on("close", (code) => resolve({ code, err }));
  });
}

const stats = { built: 0, cached: 0, uploaded: 0, skipped: 0, failed: 0, bytes: 0 };

async function one(clip) {
  const key = `${clip.name}-hd.webp`;
  const dest = path.join(CACHE, `${clip.name}.webp`);

  if (UPLOAD && !FORCE) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: E.B2_BUCKET, Key: key }));
      stats.skipped++;
      return;
    } catch {
      // Not in the bucket yet.
    }
  }

  if (FORCE || !fs.existsSync(dest)) {
    // Centre square on the short edge, never upscaled past the source.
    const r = await ffmpeg([
      "-y",
      "-loglevel",
      "error",
      "-ss",
      "0.5",
      "-i",
      `${CDN}/${clip.name}.mp4`,
      "-frames:v",
      "1",
      "-vf",
      `crop='min(iw,ih)':'min(iw,ih)',scale='min(${SIZE},iw)':'min(${SIZE},ih)':flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      String(QUALITY),
      dest,
    ]);
    if (r.code !== 0 || !fs.existsSync(dest)) {
      stats.failed++;
      process.stderr.write(`\n  ! ${clip.name}: ${r.err.trim().split("\n").pop()}\n`);
      return;
    }
    stats.built++;
  } else stats.cached++;
  stats.bytes += fs.statSync(dest).size;

  if (UPLOAD) {
    await s3.send(
      new PutObjectCommand({
        Bucket: E.B2_BUCKET,
        Key: key,
        Body: fs.readFileSync(dest),
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    stats.uploaded++;
  }
}

console.log(`HD posters: ${SIZE}px square WebP q${QUALITY}, ${work.length} clips${UPLOAD ? `, uploading to ${E.B2_BUCKET}` : ""}`);
let next = 0;
let done = 0;
async function worker() {
  while (next < work.length) {
    const clip = work[next++];
    await one(clip).catch((e) => {
      stats.failed++;
      process.stderr.write(`\n  ! ${clip.name}: ${e.message}\n`);
    });
    done++;
    process.stdout.write(
      `\r  ${done}/${work.length}  built ${stats.built}  cached ${stats.cached}  uploaded ${stats.uploaded}  skipped ${stats.skipped}  failed ${stats.failed}   `
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const n = stats.built + stats.cached;
console.log(`\n  average ${n ? (stats.bytes / n / 1024).toFixed(1) : 0}KB per poster`);
if (!UPLOAD) console.log("  Nothing uploaded. Re-run with --upload (needs B2 keys in .env.local), then set VITE_POSTER_TIER=hd.");
