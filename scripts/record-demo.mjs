// Records a scripted tour of the gallery to an MP4 for social posts.
//
//   npm run build && npx vite preview --port 4173      # or point --url at the live site
//   node scripts/record-demo.mjs [--url http://localhost:4173] [--out demo/daysofshiva-demo.mp4]
//                                [--width 1920 --height 1080] [--light]
//
// Drives a real headed Chromium (GPU WebGL), captures compositor frames over CDP with their
// timestamps, then encodes them with ffmpeg at a constant 60fps, H.264 yuv420p + faststart
// (what X/Twitter accepts). A soft cursor is drawn in the page so viewers can follow each action.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const URL = arg("url", "http://localhost:4173").replace(/\/$/, "");
const OUT = path.resolve(arg("out", "demo/daysofshiva-demo.mp4"));
const W = Number(arg("width", 1920));
const H = Number(arg("height", 1080));
const LIGHT = args.includes("--light");

const FRAMES = fs.mkdtempSync(path.join(os.tmpdir(), "dos-demo-"));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// A soft ring that follows the (synthetic) mouse and dips on press.
const CURSOR = () => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    Object.assign(c.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "22px",
      height: "22px",
      margin: "-11px 0 0 -11px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.9)",
      boxShadow: "0 0 0 1.5px rgba(0,0,0,0.35), 0 4px 14px rgba(0,0,0,0.35)",
      pointerEvents: "none",
      zIndex: "2147483647",
      transition: "scale 140ms ease-out, opacity 200ms ease-out",
      opacity: "0",
    });
    document.body.appendChild(c);
    addEventListener("pointermove", (e) => {
      c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      c.style.opacity = "1";
    }, true);
    addEventListener("pointerdown", () => { c.style.scale = "0.72"; }, true);
    addEventListener("pointerup", () => { c.style.scale = "1"; }, true);
  });
};

const browser = await chromium.launch({
  headless: false,
  args: [
    `--window-size=${W + 40},${H + 160}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: LIGHT ? "light" : "dark" });
await ctx.addInitScript(() => localStorage.setItem("daysofshiva:welcome-seen", "1"));
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

// Warm everything up off camera so the recording starts on a settled, fully loaded field.
await page.goto(`${URL}/`);
await page.waitForTimeout(6000);

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = path.join(FRAMES, `${String(frames.length).padStart(6, "0")}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

// ---- choreography helpers ----
let mx = W * 0.62;
let my = H * 0.52;
const wait = (ms) => page.waitForTimeout(ms);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function glide(x, y, ms = 700) {
  const x0 = mx;
  const y0 = my;
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const e = ease(i / n);
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    await wait(16);
  }
  mx = x;
  my = y;
}
async function drag(dx, dy, ms = 1400) {
  await page.mouse.down();
  await glide(mx + dx, my + dy, ms);
  await page.mouse.up();
}
async function notches(n, delta, gap = 140) {
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, delta);
    await wait(gap);
  }
}
async function clickOn(locator, ms = 650) {
  const b = await locator.boundingBox();
  if (!b) return;
  await glide(b.x + b.width / 2, b.y + b.height / 2, ms);
  await wait(120);
  await page.mouse.down();
  await wait(70);
  await page.mouse.up();
}
const dock = (label) => page.locator(`[aria-label="Gallery controls"] [aria-label="${label}"]`).first();

await page.mouse.move(mx, my);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await wait(900);

// 1. Field: pan so new tiles wipe in from the edges.
await drag(-420, -160, 1500);
await wait(250);
await drag(520, -200, 1600);
await wait(350);

// 2. Zoom out to see the whole practice, then back in.
await glide(W * 0.5, H * 0.5, 450);
await notches(5, 100, 90);
await wait(800);
await drag(-280, 110, 1200);
await notches(5, -100, 90);
await wait(700);

// 3. Hover a tile: its preview plays.
await glide(W * 0.5 + 40, H * 0.5 - 20, 600);
await wait(2000);

// 4. Open it, let it play, close.
await page.mouse.down();
await wait(70);
await page.mouse.up();
await wait(3400);
await clickOn(page.locator('[role="dialog"] button[aria-label="Close"]').first(), 600);
await wait(900);

// 5. Sort by style, then similarity: every tile on screen morphs to its new place.
await clickOn(page.locator('[aria-label^="Sort:"]').first());
await wait(350);
await clickOn(page.getByRole("button", { name: "Style", exact: true }).first(), 400);
await wait(1500);
await clickOn(page.getByRole("button", { name: "Similarity", exact: true }).first(), 400);
await wait(1500);
await page.keyboard.press("Escape");
await wait(200);

// 6. Flow: Cover Flow rail, flip through it.
await clickOn(dock("Flow"));
await wait(1200);
await glide(W * 0.5, H * 0.45, 450);
await notches(6, 100, 200);
await wait(1300);

// 7. Stack: the card file.
await clickOn(dock("Stack"));
await wait(1200);
await glide(W * 0.5, H * 0.45, 450);
await notches(5, 100, 260);
await wait(1300);

// 8. Back to the field and drift away.
await clickOn(dock("Field"));
await wait(1500);
await glide(W * 0.55, H * 0.55, 400);
await drag(-360, -140, 1800);
await wait(1000);

await cdp.send("Page.stopScreencast");
await browser.close();

// ---- encode: variable-rate frames -> constant 60fps H.264 ----
if (frames.length < 10) throw new Error(`only ${frames.length} frames captured`);
const list = path.join(FRAMES, "list.txt");
let txt = "";
for (let i = 0; i < frames.length; i++) {
  const dur = i + 1 < frames.length ? Math.max(1 / 240, frames[i + 1].t - frames[i].t) : 1 / 30;
  txt += `file '${frames[i].file.replace(/\\/g, "/")}'\nduration ${dur.toFixed(5)}\n`;
}
txt += `file '${frames.at(-1).file.replace(/\\/g, "/")}'\n`;
fs.writeFileSync(list, txt);
const span = frames.at(-1).t - frames[0].t;
console.log(`${frames.length} frames over ${span.toFixed(1)}s (~${(frames.length / span).toFixed(0)} fps captured)`);
const r = spawnSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `fps=60,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-level", "4.2",
    "-movflags", "+faststart",
    OUT,
  ],
  { stdio: "inherit" }
);
if (r.status !== 0) process.exit(r.status ?? 1);
fs.rmSync(FRAMES, { recursive: true, force: true });
console.log(`wrote ${OUT}`);
