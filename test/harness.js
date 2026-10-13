/* Headless test harness: loads the game in jsdom with a stubbed canvas 2D
   context and simulates gameplay to catch runtime errors.
   Run: node test/harness.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const files = ['js/data.js', 'js/audio.js', 'js/art.js', 'js/fx.js', 'js/fighter.js', 'js/ai.js', 'js/battle.js', 'js/ui.js', 'js/game.js'];

function makeCtx() {
  const grad = { addColorStop() { } };
  const ctx = {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', filter: 'none',
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null,
    measureText: (t) => ({ width: String(t).length * 6 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    save() { }, restore() { }, translate() { }, scale() { }, rotate() { }, transform() { }, setTransform() { }, resetTransform() { },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, quadraticCurveTo() { }, bezierCurveTo() { },
    arc() { }, arcTo() { }, ellipse() { }, rect() { }, roundRect() { }, fill() { }, stroke() { }, clip() { },
    fillRect() { }, strokeRect() { }, clearRect() { }, fillText() { }, strokeText() { },
    drawImage() { }, setLineDash() { }, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    isPointInPath: () => false,
  };
  return ctx;
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script src="[^"]+"><\/script>/g, '');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  resources: undefined,
  url: 'https://example.test/',
});
const { window } = dom;

// stub canvas
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.__ctx) { this.__ctx = makeCtx(); this.__ctx.canvas = this; }
  return this.__ctx;
};

// stub AudioContext (no-op synth)
class FakeParam { constructor() { this.value = 0; } setValueAtTime() { } linearRampToValueAtTime() { } exponentialRampToValueAtTime() { } cancelScheduledValues() { } }
class FakeNode {
  constructor() { this.gain = new FakeParam(); this.frequency = new FakeParam(); this.detune = new FakeParam(); this.Q = new FakeParam(); this.pan = new FakeParam(); }
  connect() { } disconnect() { } start() { } stop() { } setPointerCapture() { }
}
window.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = new FakeNode(); }
  resume() { } createGain() { return new FakeNode(); } createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); } createBufferSource() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
};

// stubbed rAF: capture callbacks so we can step frames deterministically
const rafQueue = [];
window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
window.cancelAnimationFrame = () => { };

// minimal pointer event support
if (!window.PointerEvent) {
  window.PointerEvent = class extends window.MouseEvent {
    constructor(type, opts = {}) { super(type, opts); this.pointerId = opts.pointerId || 1; this.pointerType = opts.pointerType || 'touch'; }
  };
}

// load game scripts in order, in window scope
for (const f of files) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    window.eval(code);
  } catch (e) {
    console.error('FAIL loading ' + f + ': ' + e.message + '\n' + e.stack);
    process.exit(1);
  }
}

let errors = [];
window.addEventListener('error', (e) => errors.push('window error: ' + e.message));
const oldErr = console.error;
window.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); oldErr(...a); };

// boot
try { window.dispatchEvent(new window.Event('load')); } catch (e) { console.error('boot failed', e); process.exit(1); }
const GAME = window.GAME;
if (!GAME) { console.error('GAME not created'); process.exit(1); }

function frame(n = 1, dtms = 16.7) {
  let t = window.__t || 0;
  for (let i = 0; i < n; i++) {
    t += dtms;
    const q = rafQueue.splice(0, rafQueue.length);
    for (const cb of q) {
      try { cb(t); } catch (e) { errors.push('frame error: ' + e.message + '\n' + e.stack); throw e; }
    }
  }
  window.__t = t;
  return t;
}

function step(name, fn) {
  try { fn(); } catch (e) { errors.push(name + ': ' + e.message + '\n' + (e.stack || '')); }
}

const log = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---------------------------------------------------------------- tests
step('initial frame', () => frame(3));

step('menu screens', () => {
  ['main-menu', 'character-select', 'level-select', 'shop-screen', 'codex-screen'].forEach(id => window.showScreen(id));
  window.switchShopTab('consumables');
  window.switchShopTab('upgrades');
  ['luffy', 'zoro', 'sanji', 'usopp', 'franky', 'brook'].forEach(c => { GAME.selectedChar = c; window.OPF.Menus.charGrid(GAME); });
});

step('economy', () => {
  GAME.save.coins = 999999;
  let n = 0;
  window.OPF.CHARACTERS.forEach(C => window.OPF.UPGRADE_TRACKS.forEach(T => {
    for (let i = 0; i < 10; i++) if (GAME.buyUpgrade(C.id, T.id)) n++;
  }));
  log('  upgrades purchased:', n);
  window.OPF.CONSUMABLES.forEach(c => GAME.buyConsumable(c.id));
  log('  coins left:', GAME.save.coins, 'bag:', JSON.stringify(GAME.save.bag));
});

const startLvl = (a, l, char) => {
  GAME.selectedChar = char || 'luffy';
  GAME.startBattle(a, l);
  return GAME.world;
};

step('battle luffy lvl1', () => {
  const w = startLvl(0, 1);
  frame(30);
  log('  enemies:', w.enemies.length, 'player hp', w.player.hp);
});

step('special powers all chars', () => {
  window.OPF.CHARACTERS.forEach(C => {
    const w = startLvl(0, 3, C.id);
    w.player.level = 10;
    w.player.mana = 999;
    frame(6);
    for (let i = 0; i < 4; i++) {
      w.player.mana = 999;
      w.playerSpecial(i);
      frame(45);
      w.player.mana = 999;
    }
    log('  ' + C.name + ' specials ok; hp', Math.round(w.player.hp));
  });
});

step('long fight simulation', () => {
  const w = startLvl(0, 5, 'luffy');
  w.player.hp = 99999; w.player.maxHp = 99999;
  let attacks = 0;
  for (let i = 0; i < 900; i++) {
    // auto play: chase nearest enemy and attack
    const e = w.nearestEnemy(w.player);
    if (e) {
      const dx = e.x - w.player.x;
      if (Math.abs(dx) > 70) w.player.x += Math.sign(dx) * 4;
      if (i % 12 === 0) { w.playerAttack(); attacks++; }
      if (i % 90 === 0) { w.player.mana = 999; w.playerSpecial(Math.floor(Math.random() * 4)); }
      if (i % 140 === 0) w.playerSpecial(0);
    }
    frame(1, 16.7);
  }
  log('  attacks:', attacks, 'kills:', w.stats.kills, 'waves done:', w.waveIndex, 'over:', w.over, 'result:', w.result);
});

step('every arc boss fight', () => {
  [0, 1, 2, 3, 4].forEach(arc => {
    [10, 20, 30].forEach(lvl => {
      const w = startLvl(arc, lvl, 'zoro');
      w.player.hp = 99999; w.player.maxHp = 99999;
      w.player.mana = 9999; w.player.maxMana = 9999;
      for (let i = 0; i < 600; i++) {
        const b = w.boss;
        if (b && !b.dead) {
          const dx = b.x - w.player.x;
          if (Math.abs(dx) > 90) w.player.x += Math.sign(dx) * 5;
          if (i % 10 === 0) w.playerAttack();
          if (i % 120 === 0) { w.player.mana = 9999; w.playerSpecial(i % 4); }
        }
        frame(1, 16.7);
        if (w.over) break;
      }
      log(`  arc${arc + 1} lvl${lvl} ${w.boss.name}: hp ${Math.round(w.boss.hp)}/${w.boss.maxHp} over=${w.over} result=${w.result} playerHP=${Math.round(w.player.hp)}`);
    });
  });
});

step('defeat path', () => {
  const w = startLvl(2, 12, 'usopp');
  w.player.hp = 1;
  for (let i = 0; i < 400 && !w.over; i++) { w.player.invuln = 0; frame(1, 16.7); }
  log('  over:', w.over, 'result:', w.result);
  window.closeResult();
  frame(2);
});

step('pause / restart / exit', () => {
  startLvl(0, 2);
  frame(5);
  window.togglePause(); frame(5);
  window.togglePause(); frame(5);
  window.restartLevel(); frame(5);
  window.exitToMenu(); frame(5);
  window.showScreen('main-menu'); frame(5);
});

step('touch controls', () => {
  const w = startLvl(1, 3, 'sanji');
  frame(10);
  const hud = window.document.getElementById('hud');
  const stick = window.document.getElementById('stick-wrap');
  const rect = { left: 0, top: 0, width: 150, height: 150 };
  stick.getBoundingClientRect = () => rect;
  const pd = new window.PointerEvent('pointerdown', { clientX: 120, clientY: 75, pointerId: 5, bubbles: true });
  stick.dispatchEvent(pd);
  frame(20);
  const pm = new window.PointerEvent('pointermove', { clientX: 140, clientY: 60, pointerId: 5, bubbles: true });
  stick.dispatchEvent(pm);
  frame(20);
  stick.dispatchEvent(new window.PointerEvent('pointerup', { clientX: 140, clientY: 60, pointerId: 5, bubbles: true }));
  frame(5);
  // buttons
  hud.querySelectorAll('.abtn').forEach(b => {
    b.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    frame(8);
    b.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
  });
  // item buttons
  hud.querySelectorAll('.item-btn').forEach(b => {
    b.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 8 }));
    frame(4);
  });
  log('  controls exercised; player state:', GAME.world && GAME.world.player.state);
});

step('keyboard', () => {
  const w = startLvl(0, 4, 'brook');
  const keys = ['KeyD', 'KeyJ', 'KeyK', 'KeyL', 'KeyS', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyE', 'KeyW'];
  keys.forEach(k => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: k, bubbles: true }));
    frame(10);
    window.dispatchEvent(new window.KeyboardEvent('keyup', { code: k, bubbles: true }));
  });
  log('  keyboard ok, hp', Math.round(w.player.hp));
});

step('boss levels across all arcs', () => {
  let ok = 0;
  for (let a = 0; a < 5; a++) {
    for (const l of [10, 20, 30]) {
      const w = startLvl(a, l, window.OPF.CHARACTERS[(a + l) % 6].id);
      w.player.hp = 1e6; w.player.maxHp = 1e6; w.player.mana = 1e6; w.player.maxMana = 1e6;
      let guard = 0;
      while (!w.over && guard < 2400) {
        const e = w.nearestEnemy(w.player);
        if (e) {
          const dx = e.x - w.player.x;
          if (Math.abs(dx) > 70) w.player.x += Math.sign(dx) * 6;
          if (guard % 8 === 0) w.playerAttack();
          if (guard % 70 === 0) { w.player.mana = 1e6; w.playerSpecial(0); }
        }
        frame(1, 16.7);
        guard++;
      }
      if (w.over && w.result === 'victory') ok++;
      else errors.push(`boss arc${a + 1} lv${l} not won (over=${w.over} result=${w.result})`);
      window.closeResult();
    }
  }
  log('  boss levels won:', ok + '/15');
});

step('sampled grunt levels', () => {
  let fails = 0, cleared = 0;
  for (let a = 0; a < 5; a++) {
    for (const l of [1, 5, 9, 15, 25, 29]) {
      const w = startLvl(a, l, window.OPF.CHARACTERS[(a + l) % 6].id);
      w.player.hp = 1e6; w.player.maxHp = 1e6; w.player.mana = 1e6; w.player.maxMana = 1e6;
      let guard = 0;
      while (!w.over && guard < 3000) {
        const e = w.nearestEnemy(w.player);
        if (e) {
          const dx = e.x - w.player.x;
          if (Math.abs(dx) > 70) w.player.x += Math.sign(dx) * 6;
          if (guard % 8 === 0) w.playerAttack();
          if (guard % 60 === 0) { w.player.mana = 1e6; w.playerSpecial(0); }
        }
        frame(1, 16.7);
        guard++;
      }
      if (!w.over) fails++;
      else cleared++;
      window.closeResult();
    }
  }
  log('  battles finished:', cleared, 'stuck:', fails);
  if (fails) errors.push(fails + ' grunt levels did not resolve');
});

step('save/load roundtrip', () => {
  GAME.persist();
  const raw = window.localStorage.getItem('opf_save_v1');
  log('  save size:', raw.length, 'bytes; coins', GAME.save.coins, 'progress entries', Object.keys(GAME.save.progress).length);
});

frame(3);

if (errors.length) {
  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 12).forEach(e => console.log('- ' + e));
  process.exit(1);
}
console.log('\nALL CHECKS PASSED — no runtime errors.');
