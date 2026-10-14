#!/usr/bin/env node
/**
 * Mobile smoke test for the production build.
 *
 *   npm run build && npm run test:mobile              # serves dist/ itself
 *   npm run test:mobile -- --url https://my.site/     # test an already-deployed build instead
 *   npm run test:mobile -- --only=iphone              # just the scenarios whose name contains "iphone"
 *
 * Drives headless Chromium with phone emulation (screen size, pixel ratio, touch events, user
 * agent) and checks, per device: it boots without errors, the canvas matches the screen at the
 * right resolution, the car is really drawn, taps and two-finger touch arrive with correct
 * coordinates, text fits on screen, and rotating the phone re-fits everything. Three extra cases:
 * a missing asset and a game bundle that fails to download must each show an on-screen error
 * (never an endless "Loading"), and with WebGL unavailable the game must fall back to the Canvas
 * renderer.
 *
 * WHAT THIS IS NOT: a real phone. It is Chromium pretending to be one, with software WebGL, so
 * it says nothing about iOS Safari (WebKit), real touch hardware, GPU speed or heat. It catches
 * "obviously broken" cheaply; the real-phone check in docs/MILESTONES.md is still the gate.
 *
 * Browser: set CHROME_PATH to a Chrome/Chromium binary, or install one with
 *   npx playwright-core install chromium
 * Extra launch flags (e.g. for containers): CHROME_ARGS="--no-sandbox ..."
 *
 * Each milestone replaces the "milestone-specific checks" section below with checks for what the
 * milestone added; the device-independent checks stay.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';
import { preview } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = join(root, 'test-results', 'mobile');

const MAX_RENDER_SCALE = 2; // keep in sync with src/core/display.ts
const READY_TIMEOUT_MS = 20_000;
const SCENE_KEY = 'Placeholder';

const DEVICES = [
  { slug: 'iphone-13-portrait', profile: 'iPhone 13' },
  { slug: 'iphone-13-landscape', profile: 'iPhone 13 landscape' },
  { slug: 'iphone-se-small-portrait', profile: 'iPhone SE' },
  { slug: 'pixel-7-portrait', profile: 'Pixel 7' },
  { slug: 'galaxy-s9plus-dpr4.5', profile: 'Galaxy S9+' },
  { slug: 'ipad-mini-landscape', profile: 'iPad Mini landscape' },
  { slug: 'desktop-1280x720', options: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
];

// ───────────────────────────── tiny reporting helpers ─────────────────────────────

const results = { passed: 0, failed: [] };
let currentGroup = '';

function group(title) {
  currentGroup = title;
  console.log(`\n${title}`);
}
function pass(name, detail) {
  results.passed++;
  console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
}
function fail(name, detail) {
  results.failed.push(`${currentGroup}: ${name} — ${detail}`);
  console.log(`  ✗ ${name}\n      ${detail}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
/** Run one named check; a thrown error is a failure. A returned string is shown as measured detail. */
async function check(name, fn) {
  try {
    pass(name, await fn());
  } catch (error) {
    fail(name, String(error?.message ?? error).split('\n')[0]);
  }
}

// ───────────────────────────── page helpers ─────────────────────────────

/** Collect anything that would be a bug report from a user: errors, failed or 4xx/5xx requests. */
function collectProblems(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console.error: ${msg.text()}`));
  page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()}`));
  page.on('response', (res) => res.status() >= 400 && problems.push(`HTTP ${res.status()}: ${res.url()}`));
  return problems;
}

const withDebug = (baseUrl) => new URL('?debug=1', baseUrl).href;
const sceneFn = (body) => `(() => { const scene = window.__game.scene.getScene('${SCENE_KEY}'); ${body} })()`;
const evalScene = (page, body) => page.evaluate(sceneFn(body));

async function openGame(page, baseUrl) {
  await page.goto(withDebug(baseUrl), { waitUntil: 'load' });
  await page.waitForSelector('#game[data-state="ready"]', { timeout: READY_TIMEOUT_MS });
  await page.waitForTimeout(500); // let a few frames render
}

// ───────────────────────────── device-independent checks ─────────────────────────────

async function checkCanvasFitsScreen(page) {
  const m = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas');
    const rect = canvas.getBoundingClientRect();
    return { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, rect, pxW: canvas.width, pxH: canvas.height };
  });
  assert(
    Math.abs(m.rect.width - m.vw) <= 1 && Math.abs(m.rect.height - m.vh) <= 1 && m.rect.left === 0 && m.rect.top === 0,
    `canvas is ${m.rect.width}x${m.rect.height} css at (${m.rect.left},${m.rect.top}), screen is ${m.vw}x${m.vh}`,
  );
  const scale = Math.min(Math.max(m.dpr, 0.5), MAX_RENDER_SCALE);
  const [wantW, wantH] = [Math.round(m.vw * scale), Math.round(m.vh * scale)];
  assert(
    Math.abs(m.pxW - wantW) <= 1 && Math.abs(m.pxH - wantH) <= 1,
    `backing store is ${m.pxW}x${m.pxH}px, expected ${wantW}x${wantH} (dpr ${m.dpr} capped at ${MAX_RENDER_SCALE})`,
  );
  return `${m.vw}x${m.vh} css @${m.dpr}x -> canvas ${m.pxW}x${m.pxH}px`;
}

/**
 * Looks at the real composited screenshot: dark background in the corners, and the car's
 * magenta body + cyan stripe present where the car should be.
 */
async function checkPicture(page, file) {
  const png = await page.screenshot({ path: file });
  const stats = await page.evaluate(
    async ({ b64, carBox, titleBox }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const k = bitmap.width / innerWidth; // screenshot pixels per css pixel
      const read = (x, y, w, h) => ctx.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;

      const luma = (d) => {
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return sum / (d.length / 4);
      };
      const corners = [
        luma(read(0, 0, 8, 8)),
        luma(read(innerWidth - 8, 0, 8, 8)),
        luma(read(innerWidth - 8, innerHeight - 8, 8, 8)),
      ];

      // inner 70% of the car sprite's rectangle
      const [cx, cy, cw, ch] = carBox;
      const d = read(cx - cw * 0.35, cy - ch * 0.35, cw * 0.7, ch * 0.7);
      let magenta = 0;
      let cyan = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (r > 200 && g < 140 && b > 70 && b < 220) magenta++;
        if (r < 120 && g > 190 && b > 220) cyan++;
      }
      const total = d.length / 4;

      // Title ink: the white pixels above the car (the only white thing there). Their extent must
      // match the title's layout box; a mismatch means text is drawn at the wrong scale.
      const band = read(0, 0, innerWidth, Math.max(1, cy - ch / 2));
      const bandW = Math.round(innerWidth * k);
      let [minX, maxX] = [Infinity, -Infinity];
      for (let i = 0; i < band.length; i += 4) {
        if (Math.min(band[i], band[i + 1], band[i + 2]) > 235) {
          const x = (i / 4) % bandW;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      const ink = maxX >= minX ? { width: (maxX - minX + 1) / k, centerX: (minX + maxX) / 2 / k } : null;

      return { corners, magenta: magenta / total, cyan: cyan / total, ink, titleBox };
    },
    {
      b64: png.toString('base64'),
      carBox: await evalScene(page, 'return [scene.car.x, scene.car.y, scene.car.displayWidth, scene.car.displayHeight];'),
      titleBox: await evalScene(page, 'const b = scene.title.getBounds(); return [b.x, b.width];'),
    },
  );
  assert(stats.corners.every((l) => l < 45), `screen corners should be dark, got luma ${stats.corners.map(Math.round)}`);
  assert(stats.magenta > 0.15, `car body not drawn where expected (magenta share ${(stats.magenta * 100).toFixed(1)}%)`);
  assert(stats.cyan > 0.03, `car stripe not drawn where expected (cyan share ${(stats.cyan * 100).toFixed(1)}%)`);

  assert(stats.ink, 'title text is not visible above the car');
  const [titleX, titleW] = stats.titleBox;
  const inkRatio = stats.ink.width / titleW;
  assert(
    inkRatio > 0.75 && inkRatio < 1.08 && Math.abs(stats.ink.centerX - (titleX + titleW / 2)) <= 6,
    `title is drawn ${stats.ink.width.toFixed(0)}px wide around x=${stats.ink.centerX.toFixed(0)}, but its layout box is ${titleW.toFixed(0)}px around x=${(titleX + titleW / 2).toFixed(0)} (text rendered at the wrong scale?)`,
  );
  return `car: magenta ${(stats.magenta * 100).toFixed(0)}% cyan ${(stats.cyan * 100).toFixed(0)}%; title ink/box ${inkRatio.toFixed(2)}`;
}

async function checkRotation(page, shotFile) {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.setViewportSize({ width: h, height: w });
  await page.waitForFunction(
    ([nw, nh]) => {
      const rect = document.querySelector('#game canvas').getBoundingClientRect();
      return Math.abs(rect.width - nw) < 1 && Math.abs(rect.height - nh) < 1;
    },
    [h, w],
    { timeout: 4000 },
  );
  await page.waitForTimeout(400);
  await checkCanvasFitsScreen(page);
  const car = await evalScene(page, 'return [scene.car.x, scene.car.y];');
  assert(
    Math.abs(car[0] - h / 2) <= 2 && Math.abs(car[1] - w / 2) <= 6,
    `car at (${car.map(Math.round)}) after rotating, expected about (${h / 2},${w / 2})`,
  );
  await checkPicture(page, shotFile);
}

// ───────────────────── milestone-specific checks (Milestone 1: placeholder scene) ─────────────────────

async function checkTap(page, touch) {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const before = await evalScene(page, 'return scene.taps;');
  if (touch) await page.touchscreen.tap(w / 2, h / 2);
  else await page.mouse.click(w / 2, h / 2);
  await page.waitForTimeout(250);
  const after = await evalScene(page, 'return { taps: scene.taps, spin: scene.pose.spin };');
  assert(after.taps === before + 1, `tap counter went ${before} -> ${after.taps}`);
  assert(after.spin > 0, 'the car did not start spinning after the tap');
  await page.waitForTimeout(800); // let the spin finish before the next check
}

/** Two fingers at once (steer + nitro later) and exact coordinate mapping through the DPR scaling. */
async function checkTwoFingers(context, page) {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const a = { x: Math.round(w * 0.25), y: Math.round(h * 0.3) };
  const b = { x: Math.round(w * 0.75), y: Math.round(h * 0.7) };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...a, id: 1 }, { ...b, id: 2 }],
  });
  await page.waitForTimeout(150);
  const down = await page.evaluate(() =>
    window.__game.input.pointers.filter((p) => p.isDown).map((p) => ({ x: p.worldX, y: p.worldY })),
  );
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__game.input.pointers.filter((p) => p.isDown).length);

  assert(down.length === 2, `${down.length} finger(s) registered, expected 2`);
  for (const want of [a, b]) {
    const hit = down.find((p) => Math.abs(p.x - want.x) <= 1.5 && Math.abs(p.y - want.y) <= 1.5);
    assert(hit, `no pointer near (${want.x},${want.y}); got ${JSON.stringify(down.map((p) => [Math.round(p.x), Math.round(p.y)]))}`);
  }
  assert(after === 0, `${after} finger(s) still down after release`);
}

/** Every label is fully on screen and nothing overlaps the car or other labels. */
async function checkLayout(page) {
  const boxes = await evalScene(
    page,
    `const rect = (o) => { const b = o.getBounds(); return { l: b.x, t: b.y, r: b.right, b: b.bottom }; };
     const carW = scene.car.displayWidth, carH = scene.car.displayHeight;
     return {
       title: rect(scene.title), subtitle: rect(scene.subtitle), hint: rect(scene.hint),
       ...(scene.panel ? { panel: rect(scene.panel) } : {}),
       car: { l: scene.centerX - carW / 2, t: scene.centerY - carH / 2, r: scene.centerX + carW / 2, b: scene.centerY + carH / 2 },
     };`,
  );
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  for (const [name, b] of Object.entries(boxes)) {
    assert(b.l >= -1 && b.t >= -1 && b.r <= w + 1 && b.b <= h + 1, `"${name}" leaves the screen: x ${Math.round(b.l)}..${Math.round(b.r)}, y ${Math.round(b.t)}..${Math.round(b.b)} on ${w}x${h}`);
  }
  const names = Object.keys(boxes);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = boxes[names[i]];
      const c = boxes[names[j]];
      const overlap = a.l < c.r - 2 && c.l < a.r - 2 && a.t < c.b - 2 && c.t < a.b - 2;
      assert(!overlap, `"${names[i]}" overlaps "${names[j]}"`);
    }
  }
}

// ───────────────────────────── scenarios ─────────────────────────────

/**
 * Every scenario gets a fresh browser: launching is cheap (~0.1 s), it isolates scenarios from
 * each other, and it keeps working in containers that need single-process Chromium, where
 * closing one browser context would otherwise take the whole browser down.
 */
async function withBrowser(launchOptions, extraArgs, fn) {
  const browser = await chromium.launch({ ...launchOptions, args: [...launchOptions.args, ...extraArgs] });
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** An unexpected crash in one scenario is reported as a failure; the run carries on. */
async function guarded(name, fn) {
  try {
    await fn();
  } catch (error) {
    fail(`${name} crashed`, String(error?.message ?? error).split('\n')[0]);
  }
}

async function runDevice(launchOptions, baseUrl, scenario) {
  const options = scenario.profile ? devices[scenario.profile] : scenario.options;
  assert(options, `Unknown Playwright device profile "${scenario.profile}"`);
  const touch = Boolean(options.hasTouch);
  const v = options.viewport;
  group(`${scenario.slug}  (${v.width}x${v.height} @${options.deviceScaleFactor ?? 1}x, ${touch ? 'touch' : 'mouse'})`);

  await withBrowser(launchOptions, [], async (browser) => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const problems = collectProblems(page);

    try {
      await openGame(page, baseUrl);
    } catch (error) {
      fail('boots to the ready state', String(error.message).split('\n')[0]);
      return;
    }
    pass('boots to the ready state');

    await check('canvas fills the screen at device resolution (capped at 2x)', () => checkCanvasFitsScreen(page));
    await check('picture: dark scene, car body + stripe drawn', () => checkPicture(page, join(shotsDir, `${scenario.slug}.png`)));
    await check('labels fit on screen and do not overlap', () => checkLayout(page));
    await check(touch ? 'a tap is received and the car spins' : 'a click is received and the car spins', () => checkTap(page, touch));
    if (touch) await check('two fingers at once, with exact coordinates', () => checkTwoFingers(context, page));
    await check('rotating / resizing re-fits the canvas and re-centres the car', () =>
      checkRotation(page, join(shotsDir, `${scenario.slug}-rotated.png`)),
    );
    await check('no console errors, page errors or failed requests', () => {
      assert(problems.length === 0, problems.slice(0, 3).join(' | '));
    });
  });
}

async function runMissingAsset(launchOptions, baseUrl) {
  group('missing asset (car PNG returns 404)');
  await withBrowser(launchOptions, [], async (browser) => {
    const context = await browser.newContext(devices['Pixel 7']);
    await context.route(/\/assets\/cars\/starter\.png/, (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }),
    );
    const page = await context.newPage();
    await page.goto(withDebug(baseUrl), { waitUntil: 'load' });
    await check('an on-screen error is shown instead of a blank screen', async () => {
      await page.waitForSelector('#boot.failed', { timeout: 10_000 });
      const text = await page.textContent('#boot-msg');
      assert(text.includes('car-starter'), `unexpected message: "${text}"`);
      assert((await page.getAttribute('#game', 'data-state')) === 'error', 'data-state should be "error"');
    });
    await page.screenshot({ path: join(shotsDir, 'missing-asset.png') });
  });
}

async function runBlockedBundle(launchOptions, baseUrl) {
  group('game bundle fails to download (flaky network / blocker)');
  await withBrowser(launchOptions, [], async (browser) => {
    const context = await browser.newContext(devices['Pixel 7']);
    await context.route(/\/bundle\/phaser-/, (route) => route.abort('failed'));
    const page = await context.newPage();
    await page.goto(withDebug(baseUrl), { waitUntil: 'load' });
    await check('an on-screen error is shown instead of an endless "Loading"', async () => {
      await page.waitForSelector('#boot.failed', { timeout: 10_000 });
      const text = await page.textContent('#boot-msg');
      assert(/could not be downloaded/i.test(text), `unexpected message: "${text}"`);
    });
    await page.screenshot({ path: join(shotsDir, 'bundle-blocked.png') });
  });
}

async function runNoWebGL(launchOptions, baseUrl) {
  group('WebGL unavailable (old / blocked GPU)');
  await withBrowser(launchOptions, ['--disable-webgl', '--disable-3d-apis', '--disable-gpu'], async (browser) => {
    const context = await browser.newContext(devices['Pixel 7']);
    const page = await context.newPage();
    const problems = collectProblems(page);
    await openGame(page, baseUrl);
    await check('falls back to the Canvas renderer and still boots', async () => {
      const type = await page.evaluate(() => window.__game.renderer.type);
      assert(type === 1, `renderer type ${type}, expected 1 (Phaser.CANVAS)`);
    });
    await check('picture: car and labels drawn correctly with Canvas', async () => {
      await checkPicture(page, join(shotsDir, 'no-webgl-canvas-fallback.png'));
      await checkLayout(page);
    });
    await check('no console errors, page errors or failed requests', () => {
      assert(problems.length === 0, problems.slice(0, 3).join(' | '));
    });
  });
}

// ───────────────────────────── main ─────────────────────────────

/** `--name value` or `--name=value` from the command line. */
function argument(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  await mkdir(shotsDir, { recursive: true });

  let server;
  let baseUrl = argument('url');
  const only = argument('only'); // e.g. --only=iphone  (substring of a scenario name)
  const wanted = (name) => !only || name.includes(only);
  if (!baseUrl) {
    if (!existsSync(join(root, 'dist', 'index.html'))) {
      console.error('No build found. Run `npm run build` first (or pass --url <deployed address>).');
      process.exit(2);
    }
    server = await preview({
      root,
      logLevel: 'error',
      preview: { host: '127.0.0.1', port: 4173, strictPort: false, open: false },
    });
    baseUrl = server.resolvedUrls.local[0];
  }
  console.log(`Testing ${baseUrl}`);

  const launchOptions = {
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: [
      '--enable-unsafe-swiftshader', // allow software WebGL on machines without a GPU
      '--ignore-gpu-blocklist',
      ...(process.env.CHROME_ARGS?.split(/\s+/).filter(Boolean) ?? []),
    ],
  };

  const started = Date.now();
  try {
    try {
      await withBrowser(launchOptions, [], async () => {}); // is a browser available at all?
    } catch (error) {
      console.error(
        `\nCould not start a browser: ${String(error.message).split('\n')[0]}\n` +
          'Install one with `npx playwright-core install chromium`, or set CHROME_PATH to a Chrome/Chromium binary.',
      );
      process.exit(2);
    }
    for (const scenario of DEVICES.filter((d) => wanted(d.slug))) {
      await guarded(scenario.slug, () => runDevice(launchOptions, baseUrl, scenario));
    }
    if (wanted('missing-asset')) await guarded('missing-asset scenario', () => runMissingAsset(launchOptions, baseUrl));
    if (wanted('bundle')) await guarded('blocked-bundle scenario', () => runBlockedBundle(launchOptions, baseUrl));
    if (wanted('webgl')) await guarded('no-WebGL scenario', () => runNoWebGL(launchOptions, baseUrl));
  } finally {
    await server?.close();
  }

  const total = results.passed + results.failed.length;
  console.log(`\n${results.passed}/${total} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`Screenshots: ${join('test-results', 'mobile')}/`);
  console.log('Reminder: this was emulation (Chromium, software WebGL). Confirm on a real phone before moving on.');
  if (results.failed.length) {
    console.log('\nFAILED:');
    for (const line of results.failed) console.log(`  - ${line}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
