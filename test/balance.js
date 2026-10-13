/* Balance probe: how long does a competent player take per level?
   Run: node test/balance.js */
const path = require('path');
const { boot } = require('./boot');

const { window, frame, GAME } = boot();

function fight(arc, lvl, char, maxFrames = 60 * 75) {
  GAME.selectedChar = char;
  GAME.startBattle(arc, lvl);
  const w = GAME.world;
  const p = w.player;
  const C = window.OPF.CHAR_BY_ID[char];
  let f = 0, retreat = 0, hits = 0, prevDmg = 0;
  while (!w.over && f < maxFrames) {
    const foe = w.boss && !w.boss.dead ? w.boss : w.nearestEnemy(p);
    if (foe) {
      const dx = foe.x - p.x, adx = Math.abs(dx), face = dx > 0 ? 1 : -1;
      const threat = foe.attacking && adx < 150;
      if (retreat > 0) { retreat--; p.moveInput(-face, w); }
      else if (threat && Math.random() < 0.05) { p.setState('block', 1); }
      else if (adx > 66) p.moveInput(face, w);
      else if (adx < 40) p.moveInput(-face, w);
      else {
        p.moveInput(0, w);
        w.playerAttack();
        if (p.state === 'attack' && p.move && p.move.idx >= 2) retreat = 6;
      }
      if (f % 16 === 0 && p.mana > 24) {
        const usable = C.specials.map((s2, i2) => ({ s: s2, i: i2 })).filter(x => p.level >= x.s.unlock && p.mana >= x.s.cost);
        if (usable.length) w.playerSpecial(usable[(f / 16 | 0) % usable.length].i);
      }
      if (p.hp < p.maxHp * 0.35 && f % 24 === 0) w.useItem('health_potion');
    }
    frame(1, 16.7);
    f++;
    if (w.stats.damageDealt > prevDmg) { prevDmg = w.stats.damageDealt; }
  }
  return { won: w.result === 'victory', secs: +(f / 60).toFixed(1), hpLeft: Math.round(p.hp),
           maxHp: p.maxHp, dmg: Math.round(w.stats.damageDealt), combo: w.maxCombo };
}

function setCharLevel(char, lvl) {
  // spread upgrade points to reach ~charLevel
  const total = Math.round((lvl - 1) * 2.9);
  const up = { vitality: 0, power: 0, spirit: 0 };
  const order = ['power', 'vitality', 'spirit'];
  for (let i = 0; i < total; i++) { const t = order[i % 3]; if (up[t] < 10) up[t]++; else up[order[(i + 1) % 3]]++; }
  GAME.save.upgrades[char] = up;
  return window.OPF.charLevelFrom(up);
}

const rows = [];
// [arc, level, char, expected character level for that point in the game]
const sample = process.env.SAMPLE === 'full' ? [
  [0, 1, 'luffy', 1], [0, 5, 'luffy', 2], [0, 9, 'luffy', 3], [0, 10, 'luffy', 3],
  [0, 20, 'zoro', 4], [0, 30, 'sanji', 5],
  [1, 10, 'usopp', 6], [1, 20, 'usopp', 6], [1, 30, 'franky', 7],
  [2, 10, 'brook', 8], [2, 20, 'brook', 8], [2, 30, 'luffy', 9],
  [3, 10, 'zoro', 9], [3, 20, 'sanji', 9], [3, 30, 'franky', 10],
  [4, 10, 'brook', 10], [4, 20, 'luffy', 10], [4, 30, 'franky', 10],
] : [
  [0, 9, 'luffy', 3], [0, 30, 'sanji', 5],
  [1, 30, 'franky', 7],
  [2, 30, 'luffy', 9],
  [3, 30, 'franky', 10],
  [4, 30, 'franky', 10],
];

for (const [a, l, c, wantLvl] of sample) {
  Object.keys(GAME.save.upgrades).forEach(k => GAME.save.upgrades[k] = { vitality: 0, power: 0, spirit: 0 });
  const gotLvl = setCharLevel(c, wantLvl);
  GAME.save.bag.health_potion = 5; GAME.save.bag.mana_potion = 3;
  GAME.save.bag.revive_scroll = 0; GAME.save.bag.attack_tonic = 0; GAME.save.bag.iron_draught = 0;
  const r = fight(a, l, c);
  rows.push(`arc${a + 1} lv${String(l).padStart(2)} ${c.padEnd(6)} charLv${String(gotLvl).padStart(2)}  ` +
    `${r.won ? 'WIN ' : 'LOSS'} ${String(r.secs).padStart(5)}s  hp ${r.hpLeft}/${r.maxHp}  kills ${String(r.kills).padStart(2)}  combo ${r.maxCombo}`);
  console.log(rows[rows.length - 1]);
}

const wins = rows.filter(r => r.includes('WIN')).length;
console.log(`\n${wins}/${rows.length} won`);

process.exit(0);
