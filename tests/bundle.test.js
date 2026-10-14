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

test('9.12 the bundle tool is importable and can build without data', async () => {
  const built = await buildBundle({ write: false, withData: false });
  assert.ok(built.modules > 20, 'every module is bundled');
  assert.equal(built.dataFiles, 0, 'data can be left out (used when testing the transform)');
  assert.ok(built.html.includes('__define('), 'the registry is emitted');
  assert.ok(!built.html.includes('const __FILES ='), 'and the data shim is skipped with the data');
  assert.ok(existsSync(BUNDLE), 'the committed bundle exists');
});
