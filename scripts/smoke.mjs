// Functional smoke test. The benchmark only proves the canvas is fast; this proves it still works.
//
//   node scripts/smoke.mjs [--url http://localhost:4173]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const argOf = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const URL = argOf("url", "http://localhost:4173");
const W = 1440;
const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
};

// Reads live renderer state out of the page. Exposed by patching GL, so it needs no app hooks.
const PROBE = () => {
  window.__probe = { draws: 0, frames: 0 };
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const fn of ["drawArrays", "drawElements"]) {
      const orig = proto[fn];
      if (!orig) continue;
      proto[fn] = function (...a) {
        window.__probe.draws++;
        return orig.apply(this, a);
      };
    }
  }
};

const run = async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.addInitScript(PROBE);

  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));

  console.log(`\nSmoke test: ${URL}\n`);

  // --- load ---------------------------------------------------------------------------------
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  check("canvas mounts", true);

  await page.waitForFunction(() => document.body.innerText.includes("on site"), null, { timeout: 40_000 });
  check("chrome bars render (clip count visible)", true);

  // --- welcome modal ------------------------------------------------------------------------
  const welcome = await page.locator("text=Welcome to the gallery").count();
  check("welcome modal shows on first visit", welcome > 0);
  if (welcome > 0) {
    await page.locator("text=Enter the gallery").click();
    await sleep(500);
  }
  check("welcome modal dismisses", (await page.locator("text=Welcome to the gallery").count()) === 0);

  // --- tiles actually draw ------------------------------------------------------------------
  await sleep(1500);
  await page.evaluate(() => (window.__probe.draws = 0));
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.wheel(0, 120);
  await sleep(800);
  const drawsAfterZoom = await page.evaluate(() => window.__probe.draws);
  check("tiles draw during zoom", drawsAfterZoom > 20, `${drawsAfterZoom} draw calls`);

  // --- hover: scale + video preview ---------------------------------------------------------
  await page.mouse.move(W / 2, H / 2);
  await sleep(2000);
  const hoverName = await page.evaluate(() => {
    const bars = document.body.innerText;
    return bars.length;
  });
  const videoPlaying = await page.evaluate(() =>
    Array.from(document.querySelectorAll("video")).some((v) => !v.paused && v.readyState >= 2)
  );
  check("hover starts a preview video", videoPlaying, `${hoverName} chars of chrome text`);

  // --- demand frameloop goes quiet -----------------------------------------------------------
  await page.evaluate(() => document.querySelector("canvas")?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })));
  await sleep(4000);
  await page.evaluate(() => (window.__probe.draws = 0));
  await sleep(2500);
  const idleDraws = await page.evaluate(() => window.__probe.draws);
  check("demand frameloop idles at zero draws", idleDraws === 0, `${idleDraws} draws while idle`);

  // --- click to focus -----------------------------------------------------------------------
  await page.mouse.move(W / 2, H / 2);
  await sleep(300);
  await page.mouse.click(W / 2, H / 2);
  await sleep(1200);
  const overlayVideo = await page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll("video"));
    // The overlay video is the one actually laid out on screen; pool elements are 1px.
    return vids.some((v) => v.getBoundingClientRect().width > 200);
  });
  check("click opens the focus overlay", overlayVideo);

  // --- escape closes ------------------------------------------------------------------------
  await page.keyboard.press("Escape");
  await sleep(800);
  const overlayGone = await page.evaluate(
    () => !Array.from(document.querySelectorAll("video")).some((v) => v.getBoundingClientRect().width > 200)
  );
  check("Escape closes the focus overlay", overlayGone);

  // --- pan changes what is on screen ---------------------------------------------------------
  const before = await page.screenshot();
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(W / 2 - i * 40, H / 2 - i * 20);
  await page.mouse.up();
  await sleep(1500);
  const after = await page.screenshot();
  check("drag pans the canvas", !before.equals(after));

  // --- dark mode ----------------------------------------------------------------------------
  await page.locator('button[aria-label="Dark mode"]').click();
  await sleep(600);
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("dark mode switches the background", darkBg.includes("18, 18, 18"), darkBg);

  // --- similarity view ----------------------------------------------------------------------
  // Reset the counter *before* the switch: regrouping resets the view and reassigns every slot,
  // so it must produce a redraw on its own.
  await page.evaluate(() => (window.__probe.draws = 0));
  await page.selectOption('select[aria-label="Arrange tiles"]', { index: 1 });
  await sleep(2500);
  const drawsAfterView = await page.evaluate(() => window.__probe.draws);
  check("similarity view re-renders the grid", drawsAfterView > 10, `${drawsAfterView} draws`);

  // --- reload: welcome modal stays dismissed -------------------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas");
  await sleep(2500);
  check("welcome modal does not reappear on revisit", (await page.locator("text=Welcome to the gallery").count()) === 0);

  // --- kiosk mode boots ----------------------------------------------------------------------
  await page.goto(`${URL}/?kiosk=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas");
  await sleep(3000);
  const kioskDraws = await page.evaluate(() => {
    window.__probe.draws = 0;
    return true;
  });
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.wheel(0, 120);
  await sleep(800);
  const kd = await page.evaluate(() => window.__probe.draws);
  check("kiosk mode renders", kioskDraws && kd > 10, `${kd} draws`);
  check("kiosk mode suppresses the welcome modal", (await page.locator("text=Welcome to the gallery").count()) === 0);

  const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
