// Mirror the clip library from B2 to local disk for the kiosk build.
//
// A gallery's wifi is the one variable you cannot control on the day, and it sits in front of every
// poster and every hover preview. Mirroring removes it from the equation: the kiosk build points
// VITE_CDN_BASE at /clips and serve-kiosk.mjs serves this directory.
//
//   node scripts/mirror-local.mjs                # posters + 480p previews (~415MB)
//   node scripts/mirror-local.mjs --with-sources # also full-quality sources (several GB)
//   node scripts/mirror-local.mjs --out ./clips  # somewhere other than ./local-clips
//   node scripts/mirror-local.mjs --limit 3      # just the first 3 clips, to test the pipeline
//
// Reads the public bucket over plain HTTPS — no credentials, nothing is written to B2.
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = join(root, argOf("out", "local-clips"));
const WITH_SOURCES = args.includes("--with-sources");
const CONCURRENCY = Number(argOf("concurrency", 8));
// Mirror only the first N clips. For verifying the pipeline without pulling ~415MB.
const LIMIT = Number(argOf("limit", 0));

function cdnBase() {
  for (const file of [".env.local", ".env"]) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^VITE_CDN_BASE=(.+)$/m);
    if (m) return m[1].trim().replace(/["']/g, "").replace(/\/$/, "");
  }
  throw new Error("VITE_CDN_BASE not found in .env.local or .env");
}

const BASE = cdnBase();
const clips = JSON.parse(readFileSync(join(root, "src/data/clips.json"), "utf8")).clips;

const targets = [];
for (const clip of LIMIT > 0 ? clips.slice(0, LIMIT) : clips) {
  targets.push(`${clip.name}.jpg`);
  targets.push(`${clip.name}-480.mp4`);
  if (WITH_SOURCES) targets.push(`${clip.name}.mp4`);
}

mkdirSync(OUT, { recursive: true });

let done = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

async function fetchOne(name) {
  const dest = join(OUT, name);
  const url = `${BASE}/${name}`;

  // Resume-friendly: a file that already matches the remote length is left alone, so an
  // interrupted mirror can just be re-run.
  let remoteLength = 0;
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) throw new Error(`HTTP ${head.status}`);
    remoteLength = Number(head.headers.get("content-length") ?? 0);
  } catch (err) {
    failed++;
    process.stderr.write(`\n  ! ${name}: ${err.message}\n`);
    return "failed";
  }

  if (existsSync(dest) && remoteLength > 0 && statSync(dest).size === remoteLength) {
    skipped++;
    return "cached";
  }

  const tmp = `${dest}.part`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    await rename(tmp, dest);
    bytes += remoteLength;
    done++;
    return "downloaded";
  } catch (err) {
    failed++;
    await unlink(tmp).catch(() => {});
    process.stderr.write(`\n  ! ${name}: ${err.message}\n`);
    return "failed";
  }
}

function progress() {
  const total = targets.length;
  const n = done + skipped + failed;
  const pct = ((n / total) * 100).toFixed(1);
  process.stdout.write(
    `\r  ${n}/${total} (${pct}%)  downloaded ${done}  cached ${skipped}  failed ${failed}  ${(bytes / 1e6).toFixed(0)}MB   `
  );
}

async function worker(queue) {
  while (queue.length) {
    const name = queue.pop();
    if (name === undefined) return;
    await fetchOne(name);
    progress();
  }
}

console.log(`Mirroring ${targets.length} files from ${BASE}`);
console.log(`  -> ${OUT}${WITH_SOURCES ? "  (including full-quality sources)" : ""}\n`);

const queue = targets.slice().reverse();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

console.log("\n");
if (failed > 0) {
  console.log(`Finished with ${failed} failures — re-run to retry just those.`);
  process.exitCode = 1;
} else {
  console.log(`Done. Build the kiosk with:  VITE_CDN_BASE=/clips npm run build:kiosk`);
}
