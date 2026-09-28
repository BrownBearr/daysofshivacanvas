// Thumbnail atlas: every clip's poster packed into a few WebP sheets.
//
// The stage paints every tile from these sheets first, so any view, zoom level or fling shows a
// picture immediately. Full posters only upgrade tiles that are large on screen (see stage/lod).
//
//   node scripts/make-atlas.mjs            # downloads posters (cached), writes sheets + map
//   node scripts/make-atlas.mjs --offline  # rebuild from the cache only
//
// Outputs:
//   public/atlas/atlas-{n}.webp   SHEET x SHEET, CELL-px square cells, row-major
//   src/data/atlas.json           { cell, sheet, perRow, sheets, items: { [name]: [sheet, col, row] } }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "scripts/.cache/posters");
const OUT_DIR = join(ROOT, "public/atlas");
const MAP_OUT = join(ROOT, "src/data/atlas.json");

// 96px cells cover a tile up to ~96 device px; above that the stage swaps in the real poster.
// 2016 = 21 x 96, just under 2048, the largest size every mobile GPU accepts.
const CELL = Number(process.env.ATLAS_CELL ?? 96);
const SHEET = 2016;
const PER_ROW = Math.floor(SHEET / CELL);
const PER_SHEET = PER_ROW * PER_ROW;
const CONCURRENCY = 12;

const offline = process.argv.includes("--offline");

function readEnvBase() {
  if (process.env.VITE_CDN_BASE) return process.env.VITE_CDN_BASE;
  for (const f of [".env.local", ".env"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^VITE_CDN_BASE=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("VITE_CDN_BASE not set (env or .env)");
}

async function fetchPoster(base, name) {
  const file = join(CACHE, `${name}.jpg`);
  if (existsSync(file)) return readFileSync(file);
  if (offline) return null;
  const res = await fetch(`${base.replace(/\/$/, "")}/${name}.jpg`);
  if (!res.ok) {
    console.warn(`  skip ${name}: HTTP ${res.status}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

async function main() {
  const { clips } = JSON.parse(readFileSync(join(ROOT, "src/data/clips.json"), "utf8"));
  const names = clips.map((c) => c.name);
  const base = offline ? "" : readEnvBase();
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`${names.length} clips, ${Math.ceil(names.length / PER_SHEET)} sheets of ${PER_SHEET}`);

  // Square "cover" crop to match how the stage crops tiles.
  const cells = new Array(names.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < names.length) {
      const i = next++;
      const buf = await fetchPoster(base, names[i]).catch((e) => {
        console.warn(`  skip ${names[i]}: ${e.message}`);
        return null;
      });
      cells[i] = buf ? await sharp(buf).resize(CELL, CELL, { fit: "cover", position: "centre" }).toBuffer() : null;
      if (++done % 100 === 0) console.log(`  ${done}/${names.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const items = {};
  const placed = names.map((n, i) => ({ n, buf: cells[i] })).filter((c) => c.buf);
  const sheetCount = Math.ceil(placed.length / PER_SHEET);
  let total = 0;

  for (let s = 0; s < sheetCount; s++) {
    const slice = placed.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
    const composites = slice.map((c, k) => {
      const col = k % PER_ROW;
      const row = Math.floor(k / PER_ROW);
      items[c.n] = [s, col, row];
      return { input: c.buf, left: col * CELL, top: row * CELL };
    });
    // Only as tall as the rows actually used, so the last sheet isn't mostly empty pixels.
    const rows = Math.ceil(slice.length / PER_ROW);
    const out = await sharp({ create: { width: SHEET, height: rows * CELL, channels: 3, background: "#808080" } })
      .composite(composites)
      .webp({ quality: Number(process.env.ATLAS_Q ?? 62), effort: 6 })
      .toBuffer();
    writeFileSync(join(OUT_DIR, `atlas-${s}.webp`), out);
    total += out.length;
    console.log(`  atlas-${s}.webp  ${slice.length} cells  ${(out.length / 1024).toFixed(0)}KB`);
  }

  const heights = [];
  for (let s = 0; s < sheetCount; s++) {
    const n = Math.min(PER_SHEET, placed.length - s * PER_SHEET);
    heights.push(Math.ceil(n / PER_ROW) * CELL);
  }

  writeFileSync(
    MAP_OUT,
    `${JSON.stringify({ cell: CELL, width: SHEET, heights, perRow: PER_ROW, sheets: sheetCount, items })}\n`
  );
  console.log(`done: ${placed.length} cells, ${(total / 1024).toFixed(0)}KB total -> public/atlas, src/data/atlas.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
