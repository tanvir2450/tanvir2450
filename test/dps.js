/* DPS probe: measures player damage output against a passive target so boss
   HP can be tuned to sensible fight lengths.  Run: node test/dps.js */
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

// returns {dps, ttk, hits}
function measure(char, arc, lvl, seconds = 40) {
  GAME.selectedChar = char;
  GAME.startBattle(arc, lvl);
  const w = GAME.world;
  const p = w.player;
  const C = OPF.CHAR_BY_ID[char];
  // neutralise all hostile AI so we only measure our own output
  w.enemies.forEach(e => { e.ai = null; e.defensive = true; });
  const startHp = (w.boss || { hp: 0 }).hp;
  let f = 0;
  const cap = seconds * 60;
  while (f < cap) {
    const foe = w.boss && !w.boss.dead ? w.boss : w.nearestEnemy(p);
    if (!foe || w.over) break;
    const dx = foe.x - p.x;
    if (Math.abs(dx) > 76) p.moveInput(dx > 0 ? 1 : -1, w);
    else { p.moveInput(0, w); if (f % 7 === 0) w.playerAttack(); }
    if (f % 18 === 0) {
      const usable = C.specials.map((s, i) => ({ s, i })).filter(x => p.level >= x.s.unlock && p.mana >= x.s.cost);
      if (usable.length) w.playerSpecial(usable[(f / 18 | 0) % usable.length].i);
    }
    frame(1, 16.7);
    f++;
  }
  const dealt = w.stats.damageDealt;
  const secs = f / 60;
  const targetHp = w.boss ? w.boss.hp : 0;
  return { dps: +(dealt / secs).toFixed(1), dealt, secs: +secs.toFixed(1), killedTarget: targetHp <= 0, ttk: targetHp <= 0 ? +secs.toFixed(1) : null };
}

console.log('PLAYER DAMAGE OUTPUT (vs passive target, 40s window)');
for (const lvl of [1, 3, 5, 7, 10]) {
  for (const char of ['luffy', 'zoro', 'sanji', 'usopp', 'franky', 'brook']) {
    setCharLevel(char, lvl);
    const r = measure(char, 0, 10);
    console.log(`  charLv ${String(lvl).padStart(2)} ${char.padEnd(6)} dps ${String(r.dps).padStart(6)}  damage in 40s ${String(r.dealt).padStart(6)}`);
  }
}

console.log('\nBOSS TIME-TO-KILL (expected character level for that arc)');
const expect = { 0: 4, 1: 6, 2: 8, 3: 9, 4: 10 };
for (let arc = 0; arc < 5; arc++) {
  for (const lvl of [10, 20, 30]) {
    const char = ['luffy', 'zoro', 'sanji', 'usopp', 'franky', 'brook'][(arc + lvl) % 6];
    setCharLevel(char, expect[arc]);
    GAME.selectedChar = char;
    GAME.startBattle(arc, lvl);
    const w = GAME.world;
    const bossHp = w.boss.maxHp;
    const r = measure(char, arc, lvl, 90);
    console.log(`  arc${arc + 1} lvl${lvl} ${w.boss.name.padEnd(20)} hp ${String(bossHp).padStart(5)} @charLv${expect[arc]} ${char.padEnd(6)} dps ${String(r.dps).padStart(6)} ttk ${r.ttk ? r.ttk + 's' : '>' + r.secs + 's'}`);
  }
}

console.log('\nGRUNT LEVEL CLEAR ESTIMATE');
for (let arc = 0; arc < 5; arc++) {
  const lvl = 5 + arc * 0;
  const char = 'luffy';
  setCharLevel(char, [2, 4, 6, 8, 10][arc]);
  GAME.selectedChar = char;
  // avg grunt HP for a mid level in each arc
  const level = [5, 15, 25][arc % 3] || 5;
  const waves = OPF.buildWaves(arc, level);
  const sc = OPF.levelScaling(arc, level);
  let totalHp = 0, count = 0;
  waves.forEach(wv => wv.forEach(t => { totalHp += OPF.ENEMY_TYPES[t].hp * sc.hp; count++; }));
  const r = measure(char, arc, level, 40);
  const est = (totalHp / Math.max(1, r.dps)).toFixed(0);
  console.log(`  arc${arc + 1} lvl${level} grunts ${String(count).padStart(2)} totalHp ${String(Math.round(totalHp)).padStart(5)} playerDPS ${String(r.dps).padStart(5)} -> ~${est}s combat`);
}

process.exit(0);
