/**
 * The single-file build (`apex-2d.html`) is the artifact that gets opened on a
 * phone with no server, so it has to be tested like one:
 *
 *   - the committed file must be exactly what the current source produces (a
 *     stale bundle is a bug: the player would run old code);
 *   - the embedded script must boot the real game with no module syntax and no
 *     reference to any local file;
 *   - and it must drive, switch circuits (offline, from the embedded data) and
 *     open the tuning panel, all with the only "network" being the in-memory
 *     data shim.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '../tools/bundle.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'apex-2d.html');
const DT = 1 / 60;

/** Pull the inline bundle script out of the HTML. */
function extractScript(html) {
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  assert.ok(start >= 0 && end > start, 'the bundle must contain one inline script');
  return html.slice(start + '<script>'.length, end).replace(/<\\\/script/gi, '</script');
}

test('9.12 the single-file build is up to date and self-contained', async () => {
  const built = await buildBundle({ write: false });
  const onDisk = readFileSync(BUNDLE, 'utf8');
  assert.equal(
    built.html.length,
    onDisk.length,
    `apex-2d.html is stale (${onDisk.length} bytes on disk, ${built.html.length} from source) - run: npm run bundle`
  );
  assert.ok(built.html === onDisk, 'apex-2d.html must be byte-identical to a fresh build (run: npm run bundle)');

  // nothing outside the file: no module syntax, no local src/href, no imports
  const html = onDisk;
  const script = extractScript(html);
  assert.ok(!/^\s*(import|export)\b/m.test(script), 'the bundle must have no module statements left');
  assert.ok(!/\bfrom\s*'\.\//.test(script), 'no relative imports left');
  assert.ok(!/import\.meta/.test(script), 'no module-only syntax left (a classic script must parse everywhere)');
  assert.ok(!/(?:src|href)="(?!https?:|data:|#)/.test(html), 'no references to local files');
  assert.ok(!/type="module"/.test(html), 'a classic script, so file:// is not a problem');
  assert.ok(html.includes('<style>'), 'styles are inlined');
  for (const file of ['cars', 'surfaces', 'tuning', 'audio', 'tracks', 'track', 'test-track']) {
    assert.ok(script.includes(`"data/${file}.json"`), `data/${file}.json must be embedded`);
  }
  // and it is a sane size to open on a phone
  assert.ok(Buffer.byteLength(html) < 1_500_000, `the bundle should stay small, got ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
});

test('9.12 the single-file build boots and drives with no server', async () => {
  const { setupDom } = await import('./dom-stub.mjs');
  const html = readFileSync(BUNDLE, 'utf8');
  const script = extractScript(html);

  const dom = setupDom();
  const offlineRequests = [];
  const nativeFetch = globalThis.fetch;
  const consoleErrors = [];
  const nativeError = console.error;
  console.error = (...args) => consoleErrors.push(args.map(String).join(' ').slice(0, 300));
  // If the shim ever misses a data file the bundle would try to hit the
  // network; a file:// page cannot, so treat it as a failure.
  globalThis.fetch = (url, init) => {
    offlineRequests.push(String(url));
    return nativeFetch(url, init);
  };
  try {
    vm.runInThisContext(script, { filename: 'apex-2d.html' });
    // The entry point boots asynchronously (it loads the data, then builds the
    // world), exactly like the dev build - wait for it rather than racing it.
    const deadline = Date.now() + 5000;
    while (!globalThis.window.__apex && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const apex = globalThis.window.__apex;
    assert.ok(
      apex,
      `the bundle must expose window.__apex like the dev build${consoleErrors.length ? ` (boot errors: ${consoleErrors.join(' | ')})` : ''}`
    );
    const game = apex.game;
    assert.ok(game && game.car, 'the bundle must boot a game with a car');
    assert.equal(game.track.name, 'Apex Loop', 'and load the default circuit from the embedded data');
    assert.equal(offlineRequests.length, 0, `the bundle must not reach the network (tried: ${offlineRequests.join(', ')})`);

    // drive it: 2 s of autopilot, on real physics
    let clock = 1000;
    game.handleActions(['autopilot']);
    for (let i = 0; i < Math.round(2 / DT); i++) {
      clock += 16.7;
      game.frame(clock);
    }
    assert.ok(game.car.speedMs > 5, `the car should be moving, got ${game.car.speedMs.toFixed(1)} m/s`);

    // the second circuit is embedded too, so C works offline
    await apex.switchCircuit(1);
    assert.equal(apex.game.track.name, 'Tuning Grounds', 'the tuning grounds ship inside the same file');
    assert.equal(offlineRequests.length, 0, 'switching circuits must not need the network either');

    // and the 9.12 panel is part of the bundle
    apex.game.handleActions(['tuner']);
    apex.game.frame((clock += 16.7));
    assert.equal(apex.tuner.visible, true);
    assert.ok(apex.tuner.rows.length > 20, 'the tuning sliders are in the bundle');

    apex.game.stop();
    apex.tuner.dispose();
  } finally {
    globalThis.fetch = nativeFetch;
    console.error = nativeError;
    dom.restore();
  }
});

test('9.12 the single file is built for a phone, not just a desktop', async () => {
  const { setupDom } = await import('./dom-stub.mjs');
  const html = readFileSync(BUNDLE, 'utf8');
  const script = extractScript(html);

  // 1 m = 32 px and a 390 px-wide screen is a phone: the page has to scale, and
  // the controls a touch player needs have to be in the file. A desktop keeps
  // the keyboard - the CSS hands the buttons to a coarse pointer only.
  assert.match(html, /<meta[^>]+name="viewport"[^>]+width=device-width/, 'the page must fit a phone viewport');
  assert.match(html, /@media \(hover: none\) and \(pointer: coarse\)/, 'touch controls are for touch devices');
  for (const id of ['touch-steer-pad', 'touch-left-btn', 'touch-right-btn', 'touch-throttle', 'touch-brake', 'touch-nitro', 'touch-handbrake', 'touch-tilt']) {
    assert.ok(html.includes(`id="${id}"`), `${id} must ship in the single file`);
  }
  // and the build says so, so a boot failure is not blamed on a missing server
  assert.ok(script.includes('__APEX_SINGLE_FILE'), 'the build marks itself as the single file');

  // boot it in a portrait phone canvas and drive
  const dom = setupDom({ canvasWidth: 390, canvasHeight: 844 });
  try {
    // The previous test already ran the same script in this context, and the
    // loader declares `__modules`/`__cache` at the top level (a browser runs
    // the file once, so it never collides there). A function scope is the same
    // program with its own bindings.
    vm.runInThisContext(`(function () {\n${script}\n})();`, { filename: 'apex-2d.html' });
    const deadline = Date.now() + 5000;
    while (!globalThis.window.__apex && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const apex = globalThis.window.__apex;
    assert.ok(apex, 'the bundle must boot at phone size');
    const game = apex.game;
    assert.ok(game && game.car, 'and with a car');

    let clock = 1000;
    game.handleActions(['autopilot']);
    for (let i = 0; i < Math.round(3 / DT); i++) {
      clock += 16.7;
      game.frame(clock);
    }
    assert.ok(game.car.speedMs > 5, `the car should drive at phone size, got ${game.car.speedMs.toFixed(1)} m/s`);
    assert.ok(apex.hud, 'the HUD is wired up at phone size');
    assert.ok(Number.isFinite(game.car.speedMs * 3.6), 'and reports a finite speed');

    // 3. the camera is fitted to the screen, because the authored world scale on
    // a 390 px screen shows ~17 m of road - under a second of warning at 120 kph
    const { Camera } = await import('../src/camera.js');
    assert.ok(game.camera.fitZoom < 1, 'a phone-sized canvas must zoom out to keep the road readable');
    const probe = { x: 0, y: 0, heading: 0, speedMs: 120 / 3.6 };
    const authored = apex.config.tuning.camera;
    const withoutFit = {
      ...apex.config,
      tuning: { ...apex.config.tuning, camera: { ...authored, fitWidthPx: 0 } }
    };
    const settle = (width, height, config = apex.config) => {
      const cam = new Camera(config);
      cam.setViewport(width, height);
      cam.zoom = 1;
      cam.boostZoom = 1;
      for (let i = 0; i < 300; i++) cam.update(DT, probe);
      const lead = authored.leadDistanceM * probe.speedMs;
      return { zoom: cam.zoom, widthM: cam.viewWidthM, aheadM: lead + cam.viewWidthM / 2, fitZoom: cam.fitZoom };
    };
    const desktop = settle(1280, 720);
    const phone = settle(390, 844);
    const unfitted = settle(390, 844, withoutFit);
    assert.ok(Math.abs(desktop.fitZoom - 1) < 1e-9, 'the fit must be exactly 1 on a desktop-sized screen');
    assert.ok(
      phone.widthM > unfitted.widthM * 1.8,
      `a portrait phone must see far more road than the authored scale gives (${phone.widthM.toFixed(1)} m vs ${unfitted.widthM.toFixed(1)} m)`
    );
    assert.ok(phone.aheadM > 25, `and enough warning at 120 kph: ${phone.aheadM.toFixed(1)} m ahead`);
    assert.ok(phone.zoom < desktop.zoom, 'a phone is never more zoomed in than a desktop');

    game.stop();
    apex.tuner.dispose();
  } finally {
    dom.restore();
  }
});

test('9.12 the bundle tool is importable and can build without data', async () => {
  const built = await buildBundle({ write: false, withData: false });
  assert.ok(built.modules > 20, 'every module is bundled');
  assert.equal(built.dataFiles, 0, 'data can be left out (used when testing the transform)');
  assert.ok(built.html.includes('__define('), 'the registry is emitted');
  assert.ok(!built.html.includes('const __FILES ='), 'and the data shim is skipped with the data');
  assert.ok(existsSync(BUNDLE), 'the committed bundle exists');
});
