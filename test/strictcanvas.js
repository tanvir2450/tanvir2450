/* Browser-fidelity audit.
 *
 * The rest of the suite runs on @napi-rs/canvas, which quietly accepts several
 * things every real browser throws on (negative arc radii, negative radial
 * gradient radii, non-finite gradients/transforms, out-of-range colour stops,
 * unknown pattern repetitions, invalid colours).  A throw inside the render loop
 * aborts the frame and, on a phone, looks like a frozen or black game.
 *
 * This probe plays the whole game through a validating context and reports every
 * call that would have thrown in Chrome or Safari.
 *
 * Run: node test/strictcanvas.js
 */
const { boot } = require('./boot');

const violations = [];
const { window, frame, GAME } = boot({
  strict: true,
  onViolation: v => violations.push(v),
});
const OPF = window.OPF;

function where(stack) {
  // first stack frame that is inside a js/*.js file
  const line = String(stack || '').split('\n').slice(1).find(l => /js[\\/][a-z]+\.js/.test(l));
  if (!line) return '';
  const m = line.match(/js[\\/]([a-z]+\.js):(\d+):(\d+)/);
  return m ? ` <${m[1]}:${m[2]}>` : '';
}

function clearOut() { violations.length = 0; }

function run(label, fn) {
  const before = violations.length;
  fn();
  const found = violations.length - before;
  if (found) console.log(`  ${found} browser-fatal call(s) during: ${label}`);
  return found;
}

let total = 0;

/* ---- menu backdrop + every menu screen ---------------------------------- */
total += run('menu backdrop + all screens', () => {
  frame(4);
  ['character-select', 'shop-screen', 'codex-screen', 'main-menu'].forEach(scr => {
    window.showScreen(scr);
    frame(2);
  });
  if (window.OPF.Menus.arcList) { window.OPF.Menus.arcList(GAME); frame(1); }
  GAME.openLevels(4); frame(1);
  GAME.openArcs(); frame(1);
});

/* ---- every character, every level-1 wave, every special ----------------- */
const CHARS = OPF.CHARACTERS.map(c => c.id);
for (const id of CHARS) {
  total += run(`fighting as ${id}`, () => {
    GAME.selectedChar = id;
    GAME.startBattle(0, 1);
    const w = GAME.world;
    for (let f = 0; f < 140; f++) {
      if (f % 20 === 0) w.playerAttack();
      if (f % 35 === 0) { w.player.mana = w.player.maxMana; w.playerSpecial((f / 45) % 4); }
      if (f % 60 === 0) w.playerDash ? w.playerDash(1) : null;
      frame(1);
    }
    window.closeResult();
  });
}

/* ---- every arc's background/stage art, plus a boss fight per arc -------- */
for (let a = 0; a < 5; a++) {
  total += run(`arc ${a + 1} grunt stage art`, () => {
    GAME.selectedChar = CHARS[a % CHARS.length];
    GAME.startBattle(a, 26);
    for (let f = 0; f < 60; f++) {
      if (f % 10 === 0) GAME.world.playerAttack();
      frame(1);
    }
    window.closeResult();
  });
  for (const lvl of [10, 20, 30]) {
    total += run(`arc ${a + 1} boss lv${lvl} (telegraphs, phase 2, beams)`, () => {
      GAME.selectedChar = CHARS[(a + lvl) % CHARS.length];
      GAME.startBattle(a, lvl);
      const w = GAME.world;
      w.player.hp = 1e6; w.player.maxHp = 1e6;
      for (let f = 0; f < 150; f++) {
        if (f % 12 === 0) GAME.world.playerAttack();
        if (f % 38 === 0) { w.player.mana = 1e6; w.playerSpecial((f / 38) % 4); }
        if (f === 75 && w.boss) w.boss.hp = w.boss.maxHp * 0.3;   // force phase 2
        frame(1);
      }
      window.closeResult();
    });
  }
}

/* ---- defeat / victory overlays, hazards, items -------------------------- */
total += run('defeat overlay + revive + items', () => {
  GAME.selectedChar = 'luffy';
  GAME.save.bag.revive_scroll = 1;
  GAME.startBattle(2, 4);
  const w = GAME.world;
  w.useItem('health_potion');
  w.useItem('attack_tonic');
  w.player.hp = 1; w.player.dead = true;   // triggers the revive path
  frame(30);
  window.closeResult();
});

/* ---- report ------------------------------------------------------------- */
if (violations.length) {
  const groups = new Map();
  for (const v of violations) {
    const key = v.method + ' :: ' + v.msg.replace(/[-\d.,]+$/, '').slice(0, 80);
    if (!groups.has(key)) groups.set(key, { n: 0, v });
    groups.get(key).n++;
  }
  console.log(`\n${violations.length} browser-fatal canvas call(s) in ${groups.size} distinct form(s):\n`);
  [...groups.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([key, g]) => {
    console.log(`  x${g.n}  ${g.v.method}  ${g.v.msg}${where(g.v.stack)}`);
  });
  console.log('\nEach of these throws in a real browser and would kill the render frame.');
  process.exit(1);
}
console.log('\nNO browser-fatal canvas calls — the game draws only what Chrome/Safari accept.');
process.exit(0);
