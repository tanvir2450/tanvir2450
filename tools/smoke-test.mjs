/* Headless smoke test for Neon Chase.
   Stubs just enough DOM/canvas for src/game.js, then plays the game
   programmatically and asserts the rules behave.

   Usage: node tools/smoke-test.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const code = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');

/* ---------- fake 2d context ---------- */
const calls = new Map();
function fakeCtx() {
  const record = (name) => (...args) => {
    calls.set(name, (calls.get(name) || 0) + 1);
    if (name.startsWith('create') && name.endsWith('Gradient')) return { addColorStop() {} };
    return undefined;
  };
  const names = [
    'save', 'restore', 'setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect',
    'beginPath', 'moveTo', 'lineTo', 'arc', 'quadraticCurveTo', 'closePath', 'fill', 'stroke',
    'drawImage', 'createLinearGradient', 'createRadialGradient', 'fillText', 'strokeText',
    'measureText', 'ellipse', 'rect',
  ];
  const ctx = {};
  for (const n of names) ctx[n] = record(n);
  ctx.measureText = () => ({ width: 10 });
  ctx.filter = 'none';
  return ctx;
}

function fakeElement(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [],
    innerHTML: '', textContent: '', hidden: false, title: '',
    width: 672, height: 744,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    getContext() { return fakeCtx(); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    getAttribute() { return null; }, setAttribute() {},
    getBoundingClientRect() { return { width: 660, height: 700, left: 0, top: 0 }; },
    closest() { return null; },
  };
}

const registry = new Map([
  ['game', fakeElement('canvas')], ['stage', fakeElement('main')], ['overlay', fakeElement('div')],
  ['dpad', fakeElement('div')], ['score', fakeElement('b')], ['high', fakeElement('b')],
  ['level', fakeElement('b')], ['lives', fakeElement('div')],
  ['btn-sound', fakeElement('button')], ['btn-pause', fakeElement('button')],
]);

const sandbox = {
  console, Date, Math, JSON, Number, parseInt, parseFloat, isNaN,
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  setTimeout: () => 0, clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
  matchMedia: () => ({ matches: false }),
  devicePixelRatio: 1,
  document: {
    getElementById: (id) => registry.get(id) || fakeElement('div'),
    createElement: (tag) => fakeElement(tag),
    addEventListener() {}, hidden: false,
  },
  addEventListener() {}, innerWidth: 900, innerHeight: 900,
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.globalThis = sandbox;

vm.runInContext(code, vm.createContext(sandbox), { filename: 'src/game.js' });

const api = sandbox.window.NeonChase;
if (!api) throw new Error('NeonChase hook was not exposed');
api.game.manual = true;

const game = api.game;
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const DT = 1 / 60;

function run(seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) api.step(DT);
}

function parkHunters() {
  for (const h of game.ghosts) {
    h.state = 'pen';
    h.releaseTimer = 999;
    h.frightened = false;
    h.p = 0;
  }
}

function assertSane(label) {
  for (const a of [game.player, ...game.ghosts]) {
    const who = a.name || 'player';
    ok(a.tx >= 0 && a.tx < 28, `${label}: ${who} left the grid horizontally (${a.tx},${a.ty})`);
    ok(a.ty >= 0 && a.ty < 31, `${label}: ${who} left the grid vertically (${a.tx},${a.ty})`);
    ok(a.p >= -1e-6 && a.p <= 1 + 1e-6, `${label}: ${who} overshot a tile (p=${a.p})`);
  }
}

/* ---------------- 1. boot ---------------- */
ok(game.state === 'title' || game.state === 'ready', `unexpected boot state: ${game.state}`);

/* ---------------- 2. start + long self-driving run ---------------- */
api.start();
ok(game.state === 'ready', `start() should give a READY countdown, got ${game.state}`);
run(2.5);
ok(game.state === 'playing', `expected playing after countdown, got ${game.state}`);

const dirs = ['left', 'up', 'right', 'down'];
for (let i = 0; i < 9000; i++) {
  if (i % 45 === 0) api.setDir(dirs[(i / 45) % 4]);
  api.step(DT);
  if (i % 500 === 0) assertSane('roam');
}
console.log('after ~150s of unattended play:', {
  score: game.score, dotsEaten: game.dotsEaten, state: game.state,
  level: game.level, lives: game.lives,
});
ok(game.dotsEaten > 0, 'the disc ate nothing in 150s');
ok(game.state !== 'title', 'game fell back to the title state');

/* ---------------- 3. hunters leave the pen ---------------- */
api.start();
run(2.5);
const escaped = new Set();
for (let i = 0; i < 60 * 20 && escaped.size < 4; i++) {
  api.step(DT);
  for (const h of game.ghosts) if (h.state === 'roam') escaped.add(h.name);
}
console.log('hunters that reached the maze within 20s:', [...escaped].join(', ') || 'none');
ok(escaped.has('Blinky'), 'Blinky never left the pen');
ok(escaped.has('Pinky'), 'Pinky never left the pen');
ok(escaped.has('Inky'), 'Inky never left the pen');
ok(escaped.has('Clyde'), 'Clyde never left the pen');

/* ---------------- 4. power orb -> frightened ---------------- */
parkHunters();
game.state = 'playing';
const P = game.player;
P.tx = 1; P.ty = 2; P.p = 0; P.dir = 'down';   // (1,2) is a corridor tile, orb sits at (1,3)
api.setDir('down');
run(0.3);
ok(game.frightTimer > 0, 'eating an orb did not start the frightened timer');
ok(game.ghosts.every((h) => h.frightened || h.state === 'pen'), 'some hunter did not turn frightened');

/* ---------------- 5. eating a frightened hunter ---------------- */
const victim = game.ghosts[0];
victim.state = 'roam';
victim.tx = P.tx; victim.ty = P.ty;
victim.p = P.p; victim.dir = P.dir;
victim.frightened = true;
const before = game.score;
run(0.05);
ok(game.score > before, 'eating a frightened hunter gave no points');
ok(victim.state === 'dead' || victim.frightened === false, 'eaten hunter did not go home');
const wasDead = victim.state === 'dead';
run(8);
ok(!wasDead || victim.state !== 'dead', 'the eaten hunter never made it back to the pen');

/* ---------------- 6. getting caught costs a life ---------------- */
parkHunters();
game.state = 'playing';
game.frightTimer = 0;
for (const h of game.ghosts) h.frightened = false;
const livesBefore = game.lives;
const attacker = game.ghosts[0];
attacker.state = 'roam';
attacker.tx = P.tx; attacker.ty = P.ty;
attacker.p = P.p; attacker.dir = P.dir;
api.step(DT);
ok(game.state === 'dying', `expected dying after being caught, got ${game.state}`);
ok(game.lives === livesBefore - 1, `life was not deducted (${livesBefore} -> ${game.lives})`);
run(2.2);
ok(game.state === 'ready' || game.state === 'playing', `expected respawn, got ${game.state}`);
ok(game.player.tx === 13 && game.player.ty === 23, 'the disc did not respawn at its start tile');

/* ---------------- 7. losing every life ends the game ---------------- */
game.lives = 1;
run(2.5); // finish respawn countdown
parkHunters();
game.state = 'playing';
const last = game.ghosts[0];
last.state = 'roam';
// land exactly on the disc (tile *and* progress across the tile)
last.tx = game.player.tx; last.ty = game.player.ty;
last.p = game.player.p; last.dir = game.player.dir;
run(0.1);
ok(game.state === 'dying', `expected dying on the last life, got ${game.state}`);
run(2.4);
ok(game.state === 'gameover', `expected game over at zero lives, got ${game.state}`);

/* ---------------- 8. clearing the board advances the level ---------------- */
api.start();
run(2.5);
parkHunters();
game.state = 'playing';
const levelBefore = game.level;
game.player.tx = 26; game.player.ty = 22; game.player.p = 0; game.player.dir = 'down';
api.setDir('down');
game.dotsLeft = 1;                       // final orb sits at (26,23)
run(0.5);
ok(game.state === 'levelclear' || game.level > levelBefore, `board clear did not register (state=${game.state})`);
run(3.5);
ok(game.level === levelBefore + 1, `level did not advance (${levelBefore} -> ${game.level})`);
ok(game.state === 'playing' || game.state === 'ready', `unexpected state after level up: ${game.state}`);

/* ---------------- 9. pause / resume ---------------- */
run(2.5);
api.pause();
ok(game.state === 'paused', 'pause did not stick');
api.pause();
ok(game.state === 'playing', 'unpause did not resume');

/* ---------------- 10. determinism: 4 more unbroken minutes ---------------- */
let crashes = 0;
for (let i = 0; i < 14400; i++) {
  if (i % 37 === 0) api.setDir(dirs[((i / 37) | 0) % 4]);
  try { api.step(DT); } catch (err) { crashes++; if (crashes < 4) console.error('step error:', err.message); }
  if (i % 1200 === 0) assertSane('endurance');
}
ok(crashes === 0, `${crashes} exceptions during a 240s run`);
console.log('after the endurance run:', {
  state: game.state, level: game.level, lives: game.lives,
  score: game.score, dotsLeft: game.dotsLeft,
});

/* ---------------- 11. renderer really ran ---------------- */
ok((calls.get('drawImage') || 0) > 0, 'nothing was ever drawn');
ok((calls.get('fillText') || 0) > 0, 'no text was ever rendered');
ok((calls.get('arc') || 0) > 100, 'shapes were barely drawn — suspicious');

console.log('render calls:', Object.fromEntries([...calls].slice(0, 8)));

if (fails.length) {
  console.error('\nFAILURES:');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nOK: all smoke tests passed.');
