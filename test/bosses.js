/* Boss-clearance probe: can a reasonably played, correctly levelled character
   beat every boss within a sane time budget?  Run: node test/bosses.js */
const { boot } = require('./boot');
const { window, frame, GAME } = boot();
const OPF = window.OPF;

function setCharLevel(char, lvl) {
  const total = Math.round((lvl - 1) * 2.9);
  const up = { vitality: 0, power: 0, spirit: 0 };
  const order = ['power', 'vitality', 'spirit'];
  for (let i = 0; i < total; i++) { const t = order[i % 3]; if (up[t] < 10) up[t]++; else up[order[(i + 1) % 3]]++; }
  GAME.save.upgrades[char] = up;
  return OPF.charLevelFrom(up);
}

// expected character level when a player first reaches each arc's bosses
const EXPECT = { 0: 4, 1: 6, 2: 8, 3: 9, 4: 10 };

function fight(arc, lvl, char, maxSecs) {
  GAME.selectedChar = char;
  GAME.save.bag.health_potion = 5;
  GAME.startBattle(arc, lvl);
  const w = GAME.world, p = w.player, C = OPF.CHAR_BY_ID[char];
  let f = 0, retreat = 0;
  const cap = maxSecs * 60;
  while (!w.over && f < cap) {
    const foe = w.boss && !w.boss.dead ? w.boss : w.nearestEnemy(p);
    if (foe) {
      const dx = foe.x - p.x, adx = Math.abs(dx), face = dx > 0 ? 1 : -1;
      const danger = foe.attacking || (foe.move && foe.move.beam);
      if (p.hp < p.maxHp * 0.32 && f % 25 === 0) w.useItem('health_potion');
      if (retreat > 0) { retreat--; p.moveInput(-face, w); }
      else if (danger && adx < 170 && Math.random() < 0.12) { p.setState('block', 1); }
      else if (danger && adx < 200 && f % 30 === 0) { p.dash(-face); }
      else if (adx > 70) p.moveInput(face, w);
      else if (adx < 42) p.moveInput(-face, w);
      else {
        p.moveInput(0, w);
        w.playerAttack();
        if (p.move && p.move.idx >= 2) retreat = 5;
      }
      if (f % 18 === 0 && p.mana > 26) {
        const u = C.specials.map((sp, i) => ({ sp, i })).filter(x => p.level >= x.sp.unlock && p.mana >= x.sp.cost);
        if (u.length) w.playerSpecial(u[(f / 18 | 0) % u.length].i);
      }
    }
    frame(1);
    f++;
  }
  return { won: w.result === 'victory', secs: +(f / 60).toFixed(1), hp: Math.round(p.hp), maxHp: p.maxHp };
}

let wins = 0, total = 0;
for (let arc = 0; arc < 5; arc++) {
  for (const lvl of [10, 20, 30]) {
    const char = OPF.CHARACTERS[(arc + lvl) % 6].id;
    const cl = setCharLevel(char, EXPECT[arc]);
    const r = fight(arc, lvl, char, 110);
    total++; if (r.won) wins++;
    console.log(`  arc${arc + 1} lv${String(lvl).padStart(2)} ${char.padEnd(6)} charLv${cl}  ${r.won ? 'WIN ' : 'LOSS'} ${String(r.secs).padStart(6)}s  hp ${r.hp}/${r.maxHp}`);
  }
}
console.log(`\n${wins}/${total} boss fights won`);
process.exit(wins === total ? 0 : 1);
