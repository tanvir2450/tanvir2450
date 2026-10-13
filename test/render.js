/* Renders real frames to PNG using @napi-rs/canvas so the procedural art can be
   eyeballed.  Run: node test/render.js   (output: test/out/*.png) */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createCanvas } = require('@napi-rs/canvas');

const root = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const files = ['js/data.js', 'js/audio.js', 'js/art.js', 'js/fx.js', 'js/fighter.js', 'js/ai.js', 'js/battle.js', 'js/ui.js', 'js/game.js'];

const W = 1280, H = 720;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' });
const { window } = dom;

// back every canvas element with a real napi-rs surface
const DW = W, DH = H;
const backing = new Map();
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind !== '2d') return null;
  if (!backing.has(this)) {
    const bw = this.__w || DW, bh = this.__h || DH;
    const c = createCanvas(Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
    backing.set(this, { canvas: c, ctx: c.getContext('2d') });
  }
  return backing.get(this).ctx;
};
['width', 'height'].forEach(prop => {
  const key = '__' + prop[0];
  Object.defineProperty(window.HTMLCanvasElement.prototype, prop, {
    get() { return this[key] || (prop === 'width' ? DW : DH); },
    set(v) { this[key] = v; },
  });
});

// audio + rAF stubs
class P { constructor() { this.value = 0; } setValueAtTime() { } linearRampToValueAtTime() { } exponentialRampToValueAtTime() { } cancelScheduledValues() { } }
class N { constructor() { this.gain = new P(); this.frequency = new P(); this.detune = new P(); this.Q = new P(); this.pan = new P(); } connect() { } disconnect() { } start() { } stop() { } }
window.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = new N(); }
  resume() { } createGain() { return new N(); } createOscillator() { return new N(); }
  createBiquadFilter() { return new N(); } createBufferSource() { return new N(); } createStereoPanner() { return new N(); }
  createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }
};
const raf = [];
window.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
window.Object.defineProperty(window, 'innerWidth', { value: W, writable: true });
window.Object.defineProperty(window, 'innerHeight', { value: H, writable: true });
window.devicePixelRatio = 1;

for (const f of files) window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
window.dispatchEvent(new window.Event('load'));
const GAME = window.GAME;

let t = 0;
function frame(n = 1) {
  for (let i = 0; i < n; i++) {
    t += 16.7;
    const q = raf.splice(0, raf.length);
    for (const cb of q) cb(t);
  }
}
const canvas = window.document.getElementById('game-canvas');

function save(name) {
  const b = backing.get(canvas);
  fs.writeFileSync(path.join(outDir, name), b.canvas.toBuffer('image/png'));
  console.log('  wrote', name);
}

// --- helper: idle the player, park a foe in front, then render -------------
function scene({ arc, level, char, charLevel, pose, special, seconds, foeKind, camera }) {
  GAME.selectedChar = char;
  const total = Math.round((charLevel - 1) * 2.9);
  const up = { vitality: 0, power: 0, spirit: 0 };
  const order = ['power', 'vitality', 'spirit'];
  for (let i = 0; i < total; i++) { const k = order[i % 3]; if (up[k] < 10) up[k]++; }
  GAME.save.upgrades[char] = up;
  GAME.startBattle(arc, level);
  const w = GAME.world, p = w.player;
  w.introTimer = 0;
  w.enemies.forEach(e => { e.ai = null; });
  frame(2);
  // park fighters where we want them
  p.x = 520; p.y = 452; p.facing = 1; p.vx = 0;
  const foe = w.boss || w.enemies[0];
  if (foe) { foe.x = 700; foe.y = 452; foe.facing = -1; foe.vx = 0; }
  if (w.enemies[1]) { w.enemies[1].x = 860; w.enemies[1].y = 452; w.enemies[1].facing = -1; }
  if (camera) w.camera.x = camera;
  frame(seconds ? seconds * 60 : 30);
  if (special !== undefined) { w.player.mana = 9999; w.playerSpecial(special); frame(Math.round(0.5 * 60)); }
  if (pose) { p.setState(pose, 1); frame(24); }
  // keep everything pinned for the shot
  p.x = 520; p.facing = 1; p.vx = 0;
  if (foe) { foe.x = 700; foe.facing = -1; foe.state = 'idle'; foe.pose = window.OPF.Art.pose.idle(foe, 0.4); }
  GAME.render();
}

// --- 1. character portraits (art gallery) ---------------------------------
function portraits() {
  const cols = 6, cw = 190, chh = 190;
  const sheet = createCanvas(cols * cw, 3 * chh);
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#0b0f18';
  sctx.fillRect(0, 0, sheet.width, sheet.height);
  const chars = window.OPF.CHARACTERS.map(c => ['char', c.id]);
  const enemies = ['marine_swordsman', 'buggy_pirate', 'fishman_fighter', 'millions', 'desert_bandit', 'shipwright',
    'cp9_initiate', 'zombie_soldier', 'spider_monkey', 'blugori', 'demon_guard', 'blackbeard_pirate'].map(e => ['enemy', e]);
  const bosses = ['buggy', 'krieg', 'arlong', 'mr3', 'mr1', 'crocodile', 'blueno', 'jabra', 'lucci', 'absalom', 'ryuma', 'moria',
    'hannyabal', 'magellan', 'teach'].map(b => ['boss', b]);
  const rows = [chars, enemies, bosses];
  rows.forEach((row, r) => {
    row.forEach(([kind, id], i) => {
      const tile = createCanvas(cw, chh);
      window.OPF.Art.drawPortrait(tile, kind, id);
      sctx.drawImage(tile, i * cw, r * chh);
      sctx.strokeStyle = '#223'; sctx.strokeRect(i * cw, r * chh, cw, chh);
    });
  });
  fs.writeFileSync(path.join(outDir, 'portraits.png'), sheet.toBuffer('image/png'));
  console.log('  wrote portraits.png');
}

// --- 2. fighting poses ----------------------------------------------------
function poses() {
  const chars = ['luffy', 'zoro', 'sanji', 'usopp', 'franky', 'brook'];
  const states = ['idle', 'walk', 'run', 'jump', 'crouch', 'block', 'dash', 'hurt', 'ko', 'victory'];
  const cw = 170, chh = 230;
  const sheet = createCanvas(chars.length * cw, states.length * chh);
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#141a26'; sctx.fillRect(0, 0, sheet.width, sheet.height);
  chars.forEach((cid, ci) => {
    states.forEach((st, si) => {
      const tile = createCanvas(cw, chh);
      const ctx = tile.getContext('2d');
      ctx.fillStyle = '#141a26'; ctx.fillRect(0, 0, cw, chh);
      const v = window.OPF.Art.charVisual(cid);
      const P = window.OPF.Art.pose;
      let pose;
      if (st === 'idle') pose = P.idle(null, 0.3);
      else if (st === 'walk') pose = P.walk(null, 0.25);
      else if (st === 'run') pose = P.run(null, 0.6);
      else if (st === 'jump') pose = P.jump(null, 0.2);
      else if (st === 'crouch') pose = P.crouch(null, 0.2);
      else if (st === 'block') pose = P.block(null, 0.2);
      else if (st === 'dash') pose = P.dash(null, 0.2);
      else if (st === 'hurt') pose = P.hit(null, 0.4);
      else if (st === 'ko') pose = P.ko(null, 1);
      else pose = P.victory(null, 0.5);
      window.OPF.Art.drawFighter(ctx, {
        x: cw / 2, y: chh - 12, facing: 1, pose, colors: v.colors, faceOpts: v.faceOpts,
        bodyType: v.bodyType, weapon: v.weapon, weapon2: v.weapon2, extras: v.extras,
        bulk: v.bulk, headScale: v.headScale, scale: 1, sizeScale: 1, animTime: 0.5,
      }, 0.5);
      ctx.fillStyle = '#8fa3c4'; ctx.font = '11px sans-serif';
      ctx.fillText(cid + ' · ' + st, 8, 14);
      sctx.drawImage(tile, ci * cw, si * chh);
      sctx.strokeStyle = '#223'; sctx.strokeRect(ci * cw, si * chh, cw, chh);
    });
  });
  fs.writeFileSync(path.join(outDir, 'poses.png'), sheet.toBuffer('image/png'));
  console.log('  wrote poses.png');
}

// --- 3. attack frames -----------------------------------------------------
function attacks() {
  const sets = [['luffy', 'stretch_punch'], ['zoro', 'big_slash'], ['sanji', 'spin_kick'], ['usopp', 'jab'],
    ['franky', 'heavy'], ['brook', 'thrust']];
  const steps = 6, cw = 170, chh = 210;
  const sheet = createCanvas(steps * cw, sets.length * chh);
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#141a26'; sctx.fillRect(0, 0, sheet.width, sheet.height);
  sets.forEach(([cid, anim], ri) => {
    for (let i = 0; i < steps; i++) {
      const tile = createCanvas(cw, chh);
      const ctx = tile.getContext('2d');
      ctx.fillStyle = '#141a26'; ctx.fillRect(0, 0, cw, chh);
      const v = window.OPF.Art.charVisual(cid);
      const P = window.OPF.Art.pose;
      const pose = P.kfe(P.attacks[anim], i / (steps - 1));
      if (anim === 'stretch_punch') pose.extF = 2.6;
      window.OPF.Art.drawFighter(ctx, {
        x: cw * 0.42, y: chh - 12, facing: 1, pose, colors: v.colors, faceOpts: v.faceOpts,
        bodyType: v.bodyType, weapon: v.weapon, weapon2: v.weapon2, extras: v.extras,
        bulk: v.bulk, headScale: v.headScale, scale: 1, sizeScale: 1, animTime: 0.5,
      }, 0.5);
      ctx.fillStyle = '#8fa3c4'; ctx.font = '11px sans-serif';
      ctx.fillText(cid + ' · ' + anim + ' ' + i + '/' + (steps - 1), 8, 14);
      sctx.drawImage(tile, i * cw, ri * chh);
      sctx.strokeStyle = '#223'; sctx.strokeRect(i * cw, ri * chh, cw, chh);
    }
  });
  fs.writeFileSync(path.join(outDir, 'attacks.png'), sheet.toBuffer('image/png'));
  console.log('  wrote attacks.png');
}

console.log('rendering…');
poses();
attacks();
portraits();

scene({ arc: 0, level: 1, char: 'luffy', charLevel: 1, seconds: 4 });
save('scene-eastblue.png');
scene({ arc: 0, level: 10, char: 'zoro', charLevel: 3, seconds: 3 });
save('scene-buggy.png');
scene({ arc: 0, level: 30, char: 'luffy', charLevel: 5, seconds: 3 });
save('scene-arlong.png');
scene({ arc: 1, level: 15, char: 'sanji', charLevel: 6, seconds: 4 });
save('scene-alabasta.png');
scene({ arc: 2, level: 20, char: 'brook', charLevel: 8, seconds: 3 });
save('scene-jabra.png');
scene({ arc: 3, level: 30, char: 'usopp', charLevel: 9, seconds: 3 });
save('scene-moria.png');
scene({ arc: 4, level: 20, char: 'franky', charLevel: 10, seconds: 3 });
save('scene-magellan.png');
scene({ arc: 4, level: 30, char: 'luffy', charLevel: 10, seconds: 3 });
save('scene-teach.png');

// specials / transforms gallery
GAME.selectedChar = 'luffy';
(function () {
  const shots = [
    ['luffy', 2, 'gear2'], ['luffy', 3, 'gear3'], ['zoro', 1, 'tatsumaki'], ['sanji', 2, 'hell_memories'],
    ['usopp', 3, 'impact_dial'], ['franky', 3, 'radical_beam'], ['brook', 3, 'hueco_mundo'], ['zoro', 3, 'sanzen_sekai'],
  ];
  const cw = 640, chh = 360;
  const sheet = createCanvas(cw * 2, chh * 4);
  const sctx = sheet.getContext('2d');
  shots.forEach(([char, idx, name], i) => {
    scene({ arc: 2, level: 15, char, charLevel: 10, seconds: 2, special: idx });
    const b = backing.get(canvas);
    sctx.drawImage(b.canvas, (i % 2) * cw, Math.floor(i / 2) * chh, cw, chh);
  });
  fs.writeFileSync(path.join(outDir, 'specials.png'), sheet.toBuffer('image/png'));
  console.log('  wrote specials.png');
})();

// light stage per arc (no fighters) for background review
(function () {
  const cw = 640, chh = 360;
  const sheet = createCanvas(cw * 2, chh * 3);
  const sctx = sheet.getContext('2d');
  for (let a = 0; a < 5; a++) {
    GAME.selectedChar = 'luffy';
    window.OPF.Art; // noop
    GAME.startBattle(a, 15);
    const w = GAME.world;
    w.enemies.forEach(e => { e.dead = true; });
    w.enemies.length = 0;
    w.player.x = 400;
    frame(40);
    GAME.render();
    const b = backing.get(canvas);
    sctx.drawImage(b.canvas, (a % 2) * cw, Math.floor(a / 2) * chh, cw, chh);
  }
  fs.writeFileSync(path.join(outDir, 'stages.png'), sheet.toBuffer('image/png'));
  console.log('  wrote stages.png');
})();

console.log('done');
process.exit(0);
