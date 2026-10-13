/* Validation of the built single-file build (index.html).
   ---------------------------------------------------------------------
   Four things must hold for "open it on any phone or PC, anywhere":

     1. the build is not stale — index.html is exactly what the current
        sources produce, so nobody plays an old file
     2. the build is truly self-contained — no external src=, href=, url()
        or import, so it opens from a file:// path with no server and no
        network (which is how a phone will open it)
     3. the inlined build boots and plays a solo game
     4. online play needs no extra files either — the multiplayer layer is
        inlined too, and the solo game still works when WebSockets are
        unavailable (some in-app browsers prohibit them)

   Usage: node tools/validate.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from './build.mjs';
import { makeHarness } from './harness.mjs';
import { makeBot } from './bot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ---------------- 1. not stale ---------------- */
ok(built === buildHtml(root), 'index.html is out of date — run: node tools/build.mjs');

/* ---------------- 2. self-contained ---------------- */
const refs = [];
for (const m of built.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
  if (!/^(data:|#|javascript:)/i.test(m[1])) refs.push(m[1]);
}
// CSS url(...) references, but only inside <style> blocks — JavaScript is
// full of `new URL(...)` calls that are not resource references.
for (const styleBlock of built.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
  for (const m of styleBlock[1].matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    if (!/^(data:|#)/i.test(m[1])) refs.push(`css url(${m[1]})`);
  }
}
for (const m of built.matchAll(/style\s*=\s*["'][^"']*url\(\s*['"]?([^'")]+)/gi)) {
  if (!/^(data:|#)/i.test(m[1])) refs.push(`inline style url(${m[1]})`);
}
if (/\bimport\s*\(/.test(built)) refs.push('dynamic import()');
if (/\brequire\s*\(/.test(built)) refs.push('require()');
for (const r of refs) ok(false, `the built file references an external resource: ${r}`);

ok(built.includes('apple-touch-icon'), 'no home-screen icon is inlined');
ok(built.includes('viewport-fit=cover'), 'no safe-area viewport meta for phones');
ok(built.includes('mobile-web-app-capable'), 'no mobile web-app meta');

/* ---------------- 3. both scripts are inlined ---------------- */
const scripts = [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok(scripts.length === 2, `expected 2 inlined scripts (net + game), found ${scripts.length}`);

const netIdx = scripts.findIndex((s) => s.includes('window.NeonNet'));
const gameIdx = scripts.findIndex((s) => s.includes('window.NeonChase'));
ok(netIdx >= 0, 'the multiplayer layer (src/net.js) is not inlined');
ok(gameIdx >= 0, 'the game (src/game.js) is not inlined');
ok(netIdx >= 0 && gameIdx >= 0 && netIdx < gameIdx, 'src/net.js must be inlined before src/game.js');

/* ---------------- 4. it boots, plays solo, and answers the online UI ---------------- */
if (scripts.length === 2) {
  const api = makeHarness(scripts);
  api.game.manual = true;
  const bot = makeBot(api, { seed: 2024 });
  const DT = 1 / 60;
  let crashes = 0;

  api.start();
  for (let i = 0; i < 60 * 120; i++) {
    bot.think();
    try { api.step(DT); } catch (err) { crashes++; if (crashes < 3) console.error('  step error:', err.message); }
  }
  const g = api.game;
  ok(crashes === 0, `${crashes} exceptions while playing the inlined build`);
  ok(g.dotsEaten > 0, 'the inlined build never ate a dot');
  ok(g.score > 0, 'the inlined build never scored');
  console.log(`played the inlined build for 2 simulated minutes: score ${g.score}, level ${g.level}, lives ${g.lives}, ${g.dotsEaten} dots eaten`);

  // WebSockets are absent in this harness — that must not break solo play,
  // and the online screen must say so rather than throwing.
  ok(typeof api.__net === 'object', 'the net layer did not install itself');
  let onlineThrew = null;
  try { api.screen('online'); } catch (err) { onlineThrew = err; }
  ok(!onlineThrew, `opening the online screen without WebSockets threw: ${onlineThrew && onlineThrew.message}`);
  ok(api.game.mode2 === 'solo', 'the game left solo mode when the online screen opened');

  // the lobby screens render even with no room (they are also the share UI)
  for (const screen of ['lobby', 'standings', 'menu', 'lost']) {
    let threw = null;
    try { api.screen(screen); } catch (err) { threw = err; }
    ok(!threw, `the ${screen} screen threw: ${threw && threw.message}`);
  }
}

/* ---------------- 5. the build carries every feature ---------------- */
const needles = [
  'NEON CHASE', 'Blinky', 'Pinky', 'Inky', 'Clyde', 'dpad', 'localStorage', 'AudioContext',
  'window.NeonNet', 'Play online', 'Host a room', 'room code', 'apple-touch-icon',
];
for (const needle of needles) {
  ok(built.toLowerCase().includes(needle.toLowerCase()), `the built file is missing "${needle}"`);
}

console.log(`index.html: ${(Buffer.byteLength(built) / 1024).toFixed(1)} KB · ${refs.length} external references · ${scripts.length} inlined scripts`);

if (fails.length) {
  console.error('\nFAILURES:');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('OK: the single file is current, self-contained, playable, and online-capable.');
