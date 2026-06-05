// Normalize Backblaze B2 clips in place: download each messy original
// (mixed .mov/.mp4, spaces, "Made with Clipchamp" suffixes), transcode to a
// consistent web-ready set, re-upload, and regenerate src/data/clips.json.
//
// Per clip "1303.mov" -> 1303.mp4 (H.264 source) + 1303-480.mp4 (preview) + 1303.jpg (poster)
//
// Setup: put B2 credentials in .env.local (gitignored). Create an Application Key
// in Backblaze with read+write on the bucket.
//   B2_KEY_ID=...
//   B2_APP_KEY=...
//   B2_BUCKET=daysofshiva-source
//   B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
//   B2_REGION=us-east-005
//
// Usage:
//   node scripts/normalize-b2.mjs --cors-only        # just configure bucket CORS
//   node scripts/normalize-b2.mjs --dry-run          # list what would happen
//   node scripts/normalize-b2.mjs --limit 3          # process first 3 clips (test)
//   node scripts/normalize-b2.mjs                     # full run (keeps originals)
//   node scripts/normalize-b2.mjs --delete-originals  # also remove messy originals
//   node scripts/normalize-b2.mjs --manifest-only     # just rebuild clips.json
//   node scripts/normalize-b2.mjs --force             # re-process already-normalized clips
//   node scripts/normalize-b2.mjs --posters-only      # re-generate + re-upload just poster JPGs
//                                                     # (fast: downloads source, makes poster, uploads — skips video transcode)
//   node scripts/normalize-b2.mjs --reencode-sources  # re-encode all source mp4s to H.264 720p CRF23
//                                                     # (83% smaller: ~47MB avg → ~6MB avg, ~28 min total)
//   node scripts/normalize-b2.mjs --reencode-sources --min-size-mb 40  # second pass: skip files <40MB

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "src", "data", "clips.json");

// --- minimal .env loader (no dependency); .env.local wins over .env ---
function loadEnv(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

// --- ffmpeg / ffprobe resolution (Windows full-build default) ---
const FFMPEG =
  process.env.FFMPEG_PATH ||
  (fs.existsSync("C:/ffmpeg/bin/ffmpeg.exe") ? "C:/ffmpeg/bin/ffmpeg.exe" : "ffmpeg");
const FFPROBE =
  process.env.FFPROBE_PATH ||
  (fs.existsSync("C:/ffmpeg/bin/ffprobe.exe") ? "C:/ffmpeg/bin/ffprobe.exe" : "ffprobe");

// --- args ---
const args = new Set(process.argv.slice(2));
const flag = (name) => args.has(name);
const limitArg = process.argv.find((a, i) => process.argv[i - 1] === "--limit");
const LIMIT = limitArg ? Number.parseInt(limitArg, 10) : Infinity;
const minSizeArg = process.argv.find((a, i) => process.argv[i - 1] === "--min-size-mb");
const MIN_SIZE_BYTES = minSizeArg ? Number.parseInt(minSizeArg, 10) * 1024 * 1024 : 0;
const DRY = flag("--dry-run");
const FORCE = flag("--force");
const DELETE_ORIGINALS = flag("--delete-originals");
const POSTERS_ONLY = flag("--posters-only");
const REENCODE_SOURCES = flag("--reencode-sources");

const BUCKET = process.env.B2_BUCKET;
const ENDPOINT = process.env.B2_ENDPOINT;
const REGION = process.env.B2_REGION;

function requireEnv() {
  const missing = ["B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT", "B2_REGION"].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}\nAdd them to .env.local — see .env.example.`);
    process.exit(1);
  }
}

const s3 = () =>
  new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY },
  });

// --- ffmpeg helpers ---
function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} exited ${r.status}`);
}

function probe(file) {
  const r = spawnSync(
    FFPROBE,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "json", file],
    { encoding: "utf8" }
  );
  try {
    const s = JSON.parse(r.stdout).streams?.[0] ?? {};
    return { codec: s.codec_name ?? "", pix: s.pix_fmt ?? "" };
  } catch {
    return { codec: "", pix: "" };
  }
}

function makeSource(input, output) {
  const { codec, pix } = probe(input);
  const webReady = codec === "h264" && (pix === "yuv420p" || pix === "yuvj420p");
  if (webReady) {
    // Already browser-safe video: remux into faststart mp4 without re-encoding (lossless, fast).
    run(FFMPEG, ["-y", "-i", input, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output]);
  } else {
    // HEVC / ProRes / 10-bit / non-420: transcode to broadly compatible H.264 8-bit.
    run(FFMPEG, [
      "-y", "-i", input,
      "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output,
    ]);
  }
  return { codec, pix, webReady };
}

function makePreview(input, output) {
  // Small, cheap-to-decode grid loop: 360p, 24fps, closed short GOP for seamless looping.
  run(FFMPEG, [
    "-y", "-i", input,
    "-vf", "scale=-2:360", "-r", "24",
    "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-crf", "30", "-preset", "veryfast", "-an", "-movflags", "+faststart", output,
  ]);
}

function reencodeSource(input, output) {
  // Re-encode to H.264 720p CRF23: ~83% smaller than lossless remux of Clipchamp originals.
  // scale=-2:720 → height=720, width auto (div-by-2); handles both landscape and portrait.
  run(FFMPEG, [
    "-y", "-i", input,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-vf", "scale=-2:720", "-crf", "23", "-preset", "fast",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output,
  ]);
}

function makePoster(input, output) {
  // Scale to 400px height (≈2.4× the on-screen tile size at default zoom, enough for retina).
  // q:v 5 is still visually lossless at thumbnail size; was q:v 3 at native (1280p) resolution
  // which produced 250KB+ files — 17× larger than necessary for a ~170px tile.
  const vf = "scale=-2:400";
  try {
    run(FFMPEG, ["-y", "-ss", "0.5", "-i", input, "-frames:v", "1", "-vf", vf, "-q:v", "5", output]);
  } catch {
    run(FFMPEG, ["-y", "-i", input, "-frames:v", "1", "-vf", vf, "-q:v", "5", output]);
  }
}

// --- B2 helpers ---
async function listAll(client) {
  const out = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) out.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function isNormalized(client, key) {
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.Metadata?.normalized === "1";
  } catch {
    return false; // 404 -> not there
  }
}

async function download(client, key, dest) {
  const r = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(r.Body, fs.createWriteStream(dest));
}

async function upload(client, key, file, contentType, normalized = false) {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fs.readFileSync(file),
      ContentType: contentType,
      ...(normalized ? { Metadata: { normalized: "1" } } : {}),
    })
  );
}

async function setCors(client) {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ["*"],
            AllowedMethods: ["GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Content-Type"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
  console.log("✓ CORS configured: GET/HEAD from any origin (range headers exposed).");
}

const VIDEO_EXT = /\.(mov|mp4|m4v|avi|mkv|webm)$/i;
const PREVIEW = /-480\.mp4$/i;

async function buildManifest(client) {
  const keys = await listAll(client);
  // Derive the manifest from preview files: a {name}-480.mp4 only exists after a clip has
  // been fully normalized (source + preview + poster), so this guarantees every manifest
  // entry is playable. Plain {name}.mp4 files include un-normalized originals — don't use them.
  const names = keys
    .map((k) => k.match(/^(\d+)-480\.mp4$/i))
    .filter(Boolean)
    .map((m) => m[1]);
  const unique = [...new Set(names)].sort((a, b) => Number(a) - Number(b));
  const clips = unique.map((name, i) => ({ id: i + 1, name }));
  fs.writeFileSync(MANIFEST, `${JSON.stringify({ clips, total: clips.length }, null, 2)}\n`);
  console.log(`✓ Wrote ${clips.length} clips to src/data/clips.json`);
}

async function reencodeAllSources(client) {
  const keys = await listAll(client);
  const sources = keys.filter(k => /^\d+\.mp4$/i.test(k)).sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    return na - nb;
  });
  console.log(`Re-encoding ${sources.length} source files to H.264 720p CRF23...`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daysofshiva-reencode-"));
  let done = 0, skipped = 0, failed = 0;

  for (const key of sources) {
    if (done + skipped >= LIMIT) break;
    const name = key.replace(/\.mp4$/i, "");

    if (DRY) {
      console.log(`~ ${key}`);
      done++;
      continue;
    }

    const orig = path.join(tmp, `${name}_dl.mp4`);
    const out  = path.join(tmp, key);
    const t0 = Date.now();

    try {
      // Skip files below the size threshold without downloading them.
      if (MIN_SIZE_BYTES > 0) {
        let remoteSize = 0;
        try {
          const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
          remoteSize = head.ContentLength ?? 0;
        } catch { remoteSize = 0; }
        if (remoteSize < MIN_SIZE_BYTES) {
          process.stdout.write(`[${done + skipped + 1}/${sources.length}] ${name}  ${Math.round(remoteSize/1024/1024)}MB < ${Math.round(MIN_SIZE_BYTES/1024/1024)}MB threshold — skip\n`);
          skipped++;
          continue;
        }
      }

      process.stdout.write(`[${done + skipped + 1}/${sources.length}] ${name}  downloading… `);
      await download(client, key, orig);
      const dlMs = Date.now() - t0;

      const origKB = Math.round(fs.statSync(orig).size / 1024);
      process.stdout.write(`${origKB}KB  encoding… `);

      const encStart = Date.now();
      reencodeSource(orig, out);
      const encMs = Date.now() - encStart;

      const outKB = Math.round(fs.statSync(out).size / 1024);
      const pct = Math.round((1 - outKB / origKB) * 100);
      process.stdout.write(`${outKB}KB (−${pct}%)  uploading… `);

      await upload(client, key, out, "video/mp4", true);
      console.log(`done  [dl:${(dlMs/1000).toFixed(1)}s enc:${(encMs/1000).toFixed(1)}s]`);
      done++;
    } catch (e) {
      console.error(`\n  ✗ ${name}: ${e.message}`);
      failed++;
    } finally {
      for (const f of [orig, out]) {
        try { fs.rmSync(f, { force: true }); } catch {}
      }
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nDone. Re-encoded ${done}, failed ${failed}, skipped ${skipped}.`);
}

async function main() {
  requireEnv();
  const client = s3();

  if (flag("--cors-only")) return setCors(client);
  if (flag("--manifest-only")) return buildManifest(client);
  if (REENCODE_SOURCES) return reencodeAllSources(client);

  if (!DRY && !flag("--no-cors")) await setCors(client);

  const keys = await listAll(client);
  // --posters-only: iterate normalized source files (name.mp4) only — no originals needed.
  // Normal run: iterate all video files that aren't generated previews.
  const inputs = POSTERS_ONLY
    ? keys.filter((k) => /^\d+\.mp4$/i.test(k))
    : keys.filter((k) => VIDEO_EXT.test(k) && !PREVIEW.test(k));
  console.log(`Found ${keys.length} objects, ${inputs.length} ${POSTERS_ONLY ? "normalized source" : "video"} candidates.`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daysofshiva-"));
  const seen = new Set();
  let done = 0;

  for (const key of inputs) {
    if (done >= LIMIT) break;
    const base = path.basename(key);
    const m = base.match(/^(\d+)/);
    if (!m) {
      console.warn(`- skip (no leading number): ${key}`);
      continue;
    }
    const name = m[1];
    if (seen.has(name)) {
      console.warn(`- skip (duplicate number ${name}): ${key}`);
      continue;
    }
    seen.add(name);

    const srcKey = `${name}.mp4`;
    const prevKey = `${name}-480.mp4`;
    const posterKey = `${name}.jpg`;

    if (!FORCE && !POSTERS_ONLY && (await isNormalized(client, srcKey))) {
      console.log(`= ${name}: already normalized, skipping`);
      done++;
      continue;
    }

    if (DRY) {
      const targets = POSTERS_ONLY ? posterKey : `${srcKey} + ${prevKey} + ${posterKey}`;
      console.log(`~ ${key}  ->  ${targets}`);
      done++;
      continue;
    }

    const orig = path.join(tmp, base === srcKey ? `${name}_orig.mp4` : base);
    const outSrc = path.join(tmp, srcKey);
    const outPrev = path.join(tmp, prevKey);
    const outPoster = path.join(tmp, posterKey);

    try {
      console.log(`\n[${done + 1}] ${name}  (${key})`);
      process.stdout.write("  downloading… ");
      await download(client, key, orig);
      console.log("done");

      if (POSTERS_ONLY) {
        // Skip video transcode — just re-generate the poster at the correct size.
        makePoster(orig, outPoster);
        process.stdout.write("  uploading poster… ");
        await upload(client, posterKey, outPoster, "image/jpeg");
        console.log("done");
      } else {
        const info = makeSource(orig, outSrc);
        console.log(`  source: ${info.webReady ? "remux (copy)" : `transcode from ${info.codec || "?"}/${info.pix || "?"}`}`);
        makePreview(orig, outPrev);
        makePoster(orig, outPoster);

        process.stdout.write("  uploading… ");
        await upload(client, srcKey, outSrc, "video/mp4", true);
        await upload(client, prevKey, outPrev, "video/mp4");
        await upload(client, posterKey, outPoster, "image/jpeg");
        console.log("done");
      }

      if (DELETE_ORIGINALS && key !== srcKey) {
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        console.log(`  deleted original ${key}`);
      }
    } catch (e) {
      console.error(`  ✗ ${name} failed: ${e.message}`);
    } finally {
      for (const f of [orig, outSrc, outPrev, outPoster]) {
        try { fs.rmSync(f, { force: true }); } catch {}
      }
    }
    done++;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  if (!DRY) await buildManifest(client);
  console.log(`\nProcessed ${done} clip(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
