// Functional smoke test. The benchmark proves the stage is fast; this proves it still works.
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

// Counts GL draw calls by patching the prototypes, so it needs no app hooks.
const PROBE = () => {
  window.__probe = { draws: 0 };
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

  const draws = () => page.evaluate(() => window.__probe.draws);
  const resetDraws = () => page.evaluate(() => (window.__probe.draws = 0));
  const search = () => page.evaluate(() => location.search);
  const readout = () => page.evaluate(() => document.querySelector(".z-20.h-11")?.textContent ?? "");
  const playerOpen = () => page.locator('[role="dialog"][aria-modal="true"][aria-label^="Day "]').count();

  console.log(`\nSmoke test: ${URL}\n`);

  // --- load ---------------------------------------------------------------------------------
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  check("canvas mounts", true);
  await page.waitForFunction(() => document.body.innerText.includes("on site"), null, { timeout: 40_000 });
  check("readout shows the clip count", true);

  // --- welcome ------------------------------------------------------------------------------
  const welcome = await page.locator("text=Welcome to the gallery").count();
  check("welcome modal shows on first visit", welcome > 0);
  if (welcome) {
    await page.locator("text=Enter the gallery").click();
    await sleep(600);
  }
  check("welcome modal dismisses", (await page.locator("text=Welcome to the gallery").count()) === 0);

  // --- field draws + zoom --------------------------------------------------------------------
  await sleep(1200);
  await resetDraws();
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.wheel(0, 120);
  await sleep(800);
  const dz = await draws();
  check("tiles draw during zoom", dz > 20, `${dz} draw calls`);

  // --- hover preview -------------------------------------------------------------------------
  await page.mouse.move(W / 2 + 3, H / 2 + 3);
  await sleep(2000);
  const previewing = await page.evaluate(() =>
    Array.from(document.querySelectorAll("video")).some((v) => !v.paused && v.readyState >= 2)
  );
  check("hover starts a preview video", previewing);
  check("hover shows the clip in the readout", (await readout()).startsWith("Day "), await readout());

  // --- idle ----------------------------------------------------------------------------------
  await page.mouse.move(W / 2, 30);
  await page.evaluate(() => document.querySelector("canvas")?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })));
  await sleep(3000);
  await resetDraws();
  await sleep(2500);
  const idle = await draws();
  check("demand frameloop idles at zero draws", idle === 0, `${idle} draws while idle`);

  // --- player --------------------------------------------------------------------------------
  await page.mouse.move(W / 2, H / 2);
  await sleep(300);
  await page.mouse.click(W / 2, H / 2);
  await sleep(1200);
  check("click opens the player", (await playerOpen()) === 1);
  check("player puts the clip in the URL", /[?&]c=\d+/.test(await search()), await search());
  const first = await page.locator('[role="dialog"][aria-label^="Day "]').getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  await sleep(700);
  const second = await page.locator('[role="dialog"][aria-label^="Day "]').getAttribute("aria-label");
  check("arrow key steps to the next clip", first !== second, `${first} -> ${second}`);
  await page.keyboard.press("Escape");
  await sleep(1200);
  check("Escape closes the player", (await playerOpen()) === 0);
  check("closing clears the URL", !/[?&]c=/.test(await search()), await search());

  await page.mouse.click(W / 2, H / 2);
  await sleep(1000);
  await page.goBack();
  await sleep(1200);
  check("browser Back closes the player", (await playerOpen()) === 0);

  // --- pan -----------------------------------------------------------------------------------
  const before = await page.screenshot();
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(W / 2 - i * 40, H / 2 - i * 20);
  await page.mouse.up();
  await sleep(1500);
  check("drag pans the field", !before.equals(await page.screenshot()));

  // --- flow ----------------------------------------------------------------------------------
  await resetDraws();
  await page.keyboard.press("2");
  await sleep(1600);
  check("key 2 switches to Flow", (await search()).includes("v=flow"), await search());
  check("switching view animates the stage", (await draws()) > 30, `${await draws()} draws`);
  const flowA = await readout();
  await page.mouse.move(W / 2, H / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 100);
    await sleep(30);
  }
  await sleep(900);
  check("wheel scrolls the Flow rail", (await readout()) !== flowA, `${flowA} -> ${await readout()}`);

  // --- stack + index ---------------------------------------------------------------------------
  await page.locator('[role="radio"][aria-label="Stack"]').click();
  await sleep(1400);
  check("dock switches to Stack", (await search()).includes("v=stack"));
  await page.keyboard.press("4");
  await sleep(1200);
  const cells = await page.locator("[data-clip]").count();
  check("Index view lists clips", cells > 20, `${cells} cells`);

  // --- sort ----------------------------------------------------------------------------------
  await page.locator('button[aria-label^="Sort"]').click();
  await sleep(300);
  await page.locator('[role="dialog"][aria-label="Sort"] button', { hasText: "Day" }).click();
  await sleep(800);
  const days = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-clip]"))
      .slice(0, 12)
      .map((e) => Number(e.getAttribute("data-clip")))
  );
  check(
    "sort by day orders oldest first",
    days.every((d, i) => i === 0 || d > days[i - 1]),
    days.join(",")
  );
  check("sort goes into the URL", (await search()).includes("s=day"));
  await page.keyboard.press("Escape");

  // --- filter + go to day ------------------------------------------------------------------------
  await page.locator('button[aria-label^="Filter"]').click();
  await sleep(300);
  await page.locator('[role="dialog"][aria-label="Filter and find"] button[aria-pressed]').first().click();
  await sleep(800);
  const filtered = await page.locator("[data-clip]").count();
  check("style filter narrows the list", filtered > 0 && filtered < cells, `${filtered} of ${cells}`);
  check("filter goes into the URL", /[?&]st=/.test(await search()));
  const target = await page.locator("[data-clip]").nth(2).getAttribute("data-clip");
  await page.fill("#goto-day", target ?? "");
  await page.keyboard.press("Enter");
  await sleep(1200);
  check("Go to day opens that clip", (await page.locator(`[role="dialog"][aria-label="Day ${target}"]`).count()) === 1);
  await page.keyboard.press("Escape");
  await sleep(900);

  // --- theme -----------------------------------------------------------------------------------
  const toggle = page.locator('button[aria-label="Dark mode"], button[aria-label="Light mode"]');
  const wasDark = (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark";
  await toggle.click();
  await sleep(500);
  const nowTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  check("theme toggle flips the theme", nowTheme === (wasDark ? "light" : "dark"), nowTheme);

  // --- deep link + revisit -------------------------------------------------------------------------
  await page.goto(`${URL}/?v=flow&s=day&c=${target}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas");
  await sleep(2500);
  check("deep link opens the player", (await page.locator(`[role="dialog"][aria-label="Day ${target}"]`).count()) === 1);
  check("welcome modal does not reappear on revisit", (await page.locator("text=Welcome to the gallery").count()) === 0);

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
