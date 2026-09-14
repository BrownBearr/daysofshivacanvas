// Frame-time benchmark for the infinite canvas.
//
// Drives a real Chromium against a built+served copy of the site and samples
// requestAnimationFrame deltas during scripted interactions, so pan/zoom/fling
// performance is a number instead of a feeling.
//
//   node scripts/bench.mjs                      # http://localhost:4173
//   node scripts/bench.mjs --url http://... --label after --out bench/after.json
//
// WebGL draw calls are counted by patching the GL prototypes before app code
// runs, so no instrumentation is needed in src/.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const URL = arg("url", "http://localhost:4173");
const LABEL = arg("label", "baseline");
const OUT = arg("out", null);
const WIDTH = Number(arg("width", 1920));
const HEIGHT = Number(arg("height", 1080));
// CPU throttle multiplier. This machine renders the canvas at a locked 60fps, which hides
// everything; throttling stands in for the slower hardware the stutter was reported on.
const CPU = Number(arg("cpu", 1));

// Patched into the page before any app script. Counts GL draw calls and exposes
// a frame sampler the harness starts/stops around each scripted interaction.
const INSTRUMENT = () => {
  window.__bench = { draws: 0, samples: null };

  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const fn of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const original = proto[fn];
      if (!original) continue;
      proto[fn] = function (...a) {
        window.__bench.draws++;
        return original.apply(this, a);
      };
    }
  }

  window.__benchStart = () => {
    const s = { frames: [], draws: [], last: performance.now(), stop: false };
    window.__bench.samples = s;
    const tick = (now) => {
      if (s.stop) return;
      s.frames.push(now - s.last);
      s.draws.push(window.__bench.draws);
      window.__bench.draws = 0;
      s.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  window.__benchStop = () => {
    const s = window.__bench.samples;
    if (!s) return null;
    s.stop = true;
    // Drop the first frame: it contains the gap since the sampler was installed.
    return { frames: s.frames.slice(1), draws: s.draws.slice(1) };
  };
};

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

function summarize(name, { frames, draws }) {
  const sorted = [...frames].sort((a, b) => a - b);
  const sum = frames.reduce((a, b) => a + b, 0);
  const rendered = draws.filter((d) => d > 0);
  return {
    interaction: name,
    frames: frames.length,
    // Mean fps over the window, not 1000/mean-frame-time: idle frames skew the latter.
    fps: sum > 0 ? +((frames.length / sum) * 1000).toFixed(1) : 0,
    frameMs: {
      p50: +pct(sorted, 0.5).toFixed(2),
      p95: +pct(sorted, 0.95).toFixed(2),
      worst: +(sorted.at(-1) ?? 0).toFixed(2),
    },
    // A frame over 20ms missed a 60Hz vsync; over 50ms is a visible hitch.
    janky: frames.filter((f) => f > 20).length,
    hitches: frames.filter((f) => f > 50).length,
    drawCallsPerRenderedFrame: rendered.length ? +(rendered.reduce((a, b) => a + b, 0) / rendered.length).toFixed(0) : 0,
    renderedFrames: rendered.length,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One scripted interaction: sample frames while `body` runs.
async function measure(page, name, body) {
  await page.evaluate("window.__benchStart()");
  await body();
  const raw = await page.evaluate("window.__benchStop()");
  const result = summarize(name, raw);
  console.log(
    `  ${name.padEnd(22)} ${String(result.fps).padStart(6)} fps` +
      `   p50 ${String(result.frameMs.p50).padStart(6)}ms` +
      `   p95 ${String(result.frameMs.p95).padStart(7)}ms` +
      `   worst ${String(result.frameMs.worst).padStart(7)}ms` +
      `   janky ${String(result.janky).padStart(4)}` +
      `   hitch ${String(result.hitches).padStart(3)}` +
      `   draws/frame ${result.drawCallsPerRenderedFrame}`
  );
  return result;
}

// Zoom out to MAX_CAM_Z so the tile count is at its worst case.
async function zoomOut(page) {
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 240);
    await sleep(16);
  }
  await sleep(1200);
}

// A hard fling: large mouse deltas in few steps, then release and let inertia run.
async function fling(page, reps) {
  for (let i = 0; i < reps; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    await page.mouse.move(WIDTH / 2, HEIGHT / 2);
    await page.mouse.down();
    for (let s = 1; s <= 6; s++) {
      await page.mouse.move(WIDTH / 2 - dir * s * 140, HEIGHT / 2 - dir * s * 70);
      await sleep(8);
    }
    await page.mouse.up();
    await sleep(700);
  }
}

// A sustained hard drag: keeps targetVel pinned at MAX_VEL for many consecutive frames, which
// is the case that can cross a full TILE_SPACING per frame and rebuild the cell list every frame.
async function sustainedDrag(page, steps) {
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  await page.mouse.down();
  let x = WIDTH / 2;
  let y = HEIGHT / 2;
  for (let s = 0; s < steps; s++) {
    // Bounce inside the viewport so the pointer never leaves the canvas.
    const dx = s % 40 < 20 ? 120 : -120;
    x = Math.max(60, Math.min(WIDTH - 60, x + dx));
    y = Math.max(60, Math.min(HEIGHT - 60, y + (s % 80 < 40 ? 40 : -40)));
    await page.mouse.move(x, y);
    await sleep(8);
  }
  await page.mouse.up();
  await sleep(1500);
}

async function slowPan(page, reps) {
  for (let i = 0; i < reps; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    await page.mouse.move(WIDTH / 2, HEIGHT / 2);
    await page.mouse.down();
    for (let s = 1; s <= 30; s++) {
      await page.mouse.move(WIDTH / 2 - dir * s * 18, HEIGHT / 2 - dir * s * 9);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(300);
  }
}

const run = async () => {
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--enable-gpu-rasterization",
      "--ignore-gpu-blocklist",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.addInitScript(INSTRUMENT);

  if (CPU > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  }

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  const canvasMs = Date.now() - t0;

  // Wait out the loading screen (it fades then unmounts), plus the welcome modal.
  await page
    .waitForFunction(() => !document.body.innerText.includes("%") || document.body.innerText.includes("on site"), null, {
      timeout: 40_000,
    })
    .catch(() => {});
  const readyMs = Date.now() - t0;
  await sleep(1500);
  // Dismiss any modal that gates interaction.
  await page.keyboard.press("Escape");
  await sleep(400);
  await page.mouse.click(WIDTH / 2, 30); // click the top bar, harmless, focuses the doc
  await sleep(400);

  console.log(`\n[${LABEL}] ${URL}  ${WIDTH}x${HEIGHT}  cpu throttle ${CPU}x`);
  console.log(`  canvas in ${canvasMs}ms, interactive in ${readyMs}ms\n`);

  const results = [];
  results.push(await measure(page, "idle", () => sleep(2000)));
  results.push(await measure(page, "slow pan", () => slowPan(page, 2)));
  results.push(await measure(page, "fling", () => fling(page, 4)));
  results.push(await measure(page, "sustained drag", () => sustainedDrag(page, 160)));

  await zoomOut(page);
  results.push(await measure(page, "maxzoom idle", () => sleep(2000)));
  results.push(await measure(page, "maxzoom slow pan", () => slowPan(page, 2)));
  results.push(await measure(page, "maxzoom fling", () => fling(page, 4)));
  results.push(await measure(page, "maxzoom sustained", () => sustainedDrag(page, 200)));

  // Steady state: everything loaded, nothing happening, and crucially the cursor is off any tile
  // so no hover preview is playing. Under a working demand frameloop this renders ~zero frames.
  await page.evaluate(() => document.querySelector("canvas")?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })));
  await sleep(6000);
  results.push(await measure(page, "settled idle", () => sleep(3000)));

  results.push(
    await measure(page, "hover preview", async () => {
      // Rest on a tile long enough to pass HOVER_PLAY_DELAY and decode video.
      await page.mouse.move(WIDTH / 2, HEIGHT / 2);
      await sleep(1200);
      await page.mouse.move(WIDTH / 2 + 4, HEIGHT / 2 + 4);
      await sleep(2500);
    })
  );

  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  console.log(`\n  JS heap ${(heap / 1e6).toFixed(1)} MB`);
  if (consoleErrors.length) {
    console.log(`  console errors (${consoleErrors.length}):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 8)) console.log(`    ${e}`);
  } else {
    console.log("  no console errors");
  }

  const report = {
    label: LABEL,
    url: URL,
    viewport: [WIDTH, HEIGHT],
    cpu: CPU,
    canvasMs,
    readyMs,
    heap,
    results,
    consoleErrors: [...new Set(consoleErrors)],
  };
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`  wrote ${OUT}`);
  }
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
