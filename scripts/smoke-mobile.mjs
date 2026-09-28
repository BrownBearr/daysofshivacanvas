// Mobile smoke test: a 390x844 touch device driving the site with real touch events (via CDP),
// not mouse emulation, because the stage's gestures are Pointer Events with pointerType "touch".
//
//   node scripts/smoke-mobile.mjs [--url http://localhost:4173] [--shots dir]
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const args = process.argv.slice(2);
const argOf = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const URL = argOf("url", "http://localhost:4173");
const SHOTS = argOf("shots", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
};

const run = async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ ...devices["iPhone 13"], defaultBrowserType: undefined });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const { width: W, height: H } = page.viewportSize();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  let n = 0;
  const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${String(n++).padStart(2, "0")}-${name}.png` });

  if (process.env.TRACE)
    await page.addInitScript(() => {
      window.__ev = [];
      for (const t of ["pointerdown", "pointerup", "pointercancel", "click"])
        window.addEventListener(
          t,
          (e) => window.__ev.push(`${Math.round(performance.now())} ${t} id=${e.pointerId} prim=${e.isPrimary} ${e.target?.tagName}`),
          true
        );
    });
  const trace = async () => process.env.TRACE && console.log(await page.evaluate(() => window.__ev.slice(-14).join(" | ")));
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));

  const touch = (type, pts) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const swipe = async (x0, y0, x1, y1, steps = 12, ms = 12) => {
    await touch("touchStart", [[x0, y0]]);
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
      await sleep(ms);
    }
    await touch("touchEnd", []);
  };
  const tap = async (x, y) => {
    await touch("touchStart", [[x, y]]);
    await sleep(40);
    await touch("touchEnd", []);
  };
  const pinch = async (cx, cy, from, to) => {
    await touch("touchStart", [
      [cx - from, cy],
      [cx + from, cy],
    ]);
    for (let i = 1; i <= 10; i++) {
      const d = from + ((to - from) * i) / 10;
      await touch("touchMove", [
        [cx - d, cy],
        [cx + d, cy],
      ]);
      await sleep(16);
    }
    await touch("touchEnd", []);
  };
  // Headless Chrome drops the click of the first tap after an emulated touch swipe (reproduced on a
  // blank page with no app code: 0/8 clicks). Where a swipe is followed by DOM controls, a tap on
  // empty stage absorbs that dropped click so the controls under test get real taps.
  const primeAfterSwipe = async (x, y) => {
    await tap(x, y);
    await sleep(600);
  };
  const readout = () => page.evaluate(() => document.querySelector(".z-20.h-11")?.textContent ?? "");
  const search = () => page.evaluate(() => location.search);
  const playerOpen = () => page.locator('[role="dialog"][aria-modal="true"][aria-label^="Day "]').count();
  const inViewport = (loc) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
    });
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  console.log(`\nMobile smoke test (${W}x${H}, touch): ${URL}\n`);

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.includes("on site"), null, { timeout: 40_000 });
  if (await page.locator("text=Enter the gallery").count()) {
    await shot("welcome");
    check("welcome modal fits the screen", await inViewport(page.locator('[role="dialog"][aria-label="Welcome"] > div').last()));
    await page.locator("text=Enter the gallery").tap();
    await sleep(600);
  }
  await sleep(1200);
  await shot("field");
  check("dock fits the screen", await inViewport(page.locator('nav[aria-label="Gallery controls"]')));
  check("no horizontal page scroll", await noHScroll());

  // --- field: swipe pans, pinch zooms, tap opens --------------------------------------------------
  let before = await page.screenshot();
  await swipe(W * 0.7, H * 0.5, W * 0.2, H * 0.35);
  await sleep(1200);
  check("swipe pans the field", !before.equals(await page.screenshot()));

  before = await page.screenshot();
  await pinch(W / 2, H / 2, 40, 140);
  await sleep(1200);
  check("pinch zooms the field", !before.equals(await page.screenshot()));
  check("a swipe does not open a clip", (await playerOpen()) === 0);

  await tap(W / 2, H / 2);
  await sleep(1300);
  await shot("player");
  check("tap opens the player", (await playerOpen()) === 1);
  if (!(await playerOpen())) await trace();
  const closeBtn = page.locator('button[aria-label="Close"]');
  check("player controls fit the screen", await inViewport(closeBtn));
  check("player next button fits the screen", await inViewport(page.locator('button[aria-label="Next clip"]')));
  await page.locator('button[aria-label="Next clip"]').tap();
  await sleep(700);
  check("next button steps clips", /c=\d+/.test(await search()));
  await closeBtn.tap();
  await sleep(1200);
  check("close button closes the player", (await playerOpen()) === 0);

  // --- flow: swipe scrubs, tap side card centres it, tap centre opens ------------------------------
  await page.locator('[role="radio"][aria-label="Flow"]').tap();
  await sleep(1700);
  await shot("flow");
  const f0 = await readout();
  await swipe(W * 0.8, H * 0.4, W * 0.2, H * 0.4, 10, 10);
  await sleep(1400);
  const f1 = await readout();
  check("swipe scrubs the Flow rail", f1 !== f0, `${f0} -> ${f1}`);
  await tap(W * 0.9, H * 0.38);
  await sleep(1300);
  const f2 = await readout();
  check("tapping a side card brings it to the front", f2 !== f1 && (await playerOpen()) === 0, `${f1} -> ${f2}`);
  await tap(W / 2, H * 0.38);
  await sleep(1300);
  check("tapping the front card opens it", (await playerOpen()) === 1);
  await shot("flow-player");
  await page.goBack();
  await sleep(1200);

  // --- stack: vertical swipe flips cards --------------------------------------------------------------
  await page.locator('[role="radio"][aria-label="Stack"]').tap();
  await sleep(1700);
  await shot("stack");
  const s0 = await readout();
  await swipe(W / 2, H * 0.7, W / 2, H * 0.3, 10, 10);
  await sleep(1400);
  check("swipe flips through the Stack", (await readout()) !== s0, `${s0} -> ${await readout()}`);
  await primeAfterSwipe(6, H * 0.6);
  check("tapping empty space beside the stack opens nothing", (await playerOpen()) === 0);

  // --- index + panels --------------------------------------------------------------------------------
  await page.locator('[role="radio"][aria-label="Index"]').tap();
  await sleep(1300);
  await shot("index");
  if (!(await page.locator("[data-clip]").count())) await trace();
  check("Index view lists clips", (await page.locator("[data-clip]").count()) > 20, `url ${await search()}`);
  check("Index has no horizontal scroll", await noHScroll());
  await page.locator("[data-clip] button").nth(3).tap();
  await sleep(1300);
  check("tapping an index cell opens it", (await playerOpen()) === 1);
  await page.locator('button[aria-label="Close"]').tap();
  await sleep(1100);

  await page.locator('button[aria-label^="Filter"]').tap();
  await sleep(500);
  await shot("filter");
  check("filter panel fits the screen", await inViewport(page.locator('[role="dialog"][aria-label="Filter and find"]')));
  await page.locator('[role="dialog"][aria-label="Filter and find"] button[aria-pressed]').first().tap();
  await sleep(800);
  check("filter chip applies on tap", /[?&]st=/.test(await search()));
  await tap(W / 2, 90);
  await sleep(500);
  check("tapping outside closes the panel", (await page.locator('[role="dialog"][aria-label="Filter and find"]').count()) === 0);

  await page.locator('button[aria-label^="Sort"]').tap();
  await sleep(500);
  await shot("sort");
  check("sort menu fits the screen", await inViewport(page.locator('[role="dialog"][aria-label="Sort"]')));
  await page.locator('[role="dialog"][aria-label="Sort"] button', { hasText: "Day" }).tap();
  await sleep(600);
  check("sort applies on tap", (await search()).includes("s=day"));

  const realErrors = errors.filter((e) => !/favicon|Failed to load resource|GL Driver/i.test(e));
  check("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
