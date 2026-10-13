/* Level-length probe: plays every sampled grunt level with the shared bot and
   reports how long each one takes, so overlong levels are obvious.
   Run: node test/stuckprobe.js */
const { boot } = require('./boot');
const { window, frame, GAME } = boot();
const OPF = window.OPF;
const { setCharLevel, fight, EXPECT } = require('./bot');

const rows = [];
for (let a = 0; a < 5; a++) {
  for (const l of [1, 5, 9, 15, 25, 29]) {
    const char = OPF.CHARACTERS[(a + l) % 6].id;
    setCharLevel(GAME, OPF, char, EXPECT[a]);
    const r = fight(GAME, OPF, frame, a, l, char, 150);
    rows.push({ a: a + 1, l, char, r, enemies: GAME.world ? GAME.world.enemies.length : -1 });
    window.closeResult();
  }
}

/* --- regression guard: a grunt level must never out-tank its arc's boss -----
   Late-arc grunt levels once had 6075 HP of enemies against a 4200 HP final
   boss, which made the levels *between* bosses harder than the bosses. */
const breaches = [], ratios = [];
for (let a = 0; a < 5; a++) {
  const arc = OPF.ARCS[a];
  for (const l of [10, 20, 30]) {
    const bossId = arc.bosses[l];
    const B = OPF.BOSSES[bossId];
    const bossHp = B.hp * (1 + a * 0.07 + (l === 30 ? 0.16 : l === 20 ? 0.08 : 0));
    // healthiest grunt level in the same band (levels either side of the boss)
    let worst = 0, worstLv = 0;
    for (let g = l - 9; g <= l - 1; g++) {
      if (g < 1) continue;
      const sc = OPF.levelScaling(a, g);
      let hp = 0;
      OPF.buildWaves(a, g).forEach(wave => wave.forEach(t => { hp += OPF.ENEMY_TYPES[t].hp * sc.hp; }));
      if (hp > worst) { worst = hp; worstLv = g; }
    }
    const over = worst / bossHp;
    // Healthy levels run 1.0-1.35x the boss (grunts are weaker individually and
    // arrive in waves).  Only the pathological case — grunts so beefy the level
    // between two bosses out-tanks the boss itself — is a failure.
    ratios.push(`arc${a + 1} lv${worstLv} ${worst.toFixed(0)}HP vs boss ${bossHp.toFixed(0)}HP = ${(over * 100).toFixed(0)}%`);
    if (over > 1.4) breaches.push(`arc${a + 1} lv${worstLv} grunts have ${worst.toFixed(0)} HP vs boss ${bossHp.toFixed(0)} (${(over * 100).toFixed(0)}%)`);
  }
}
ratios.forEach(r => console.log('  weight ' + r));
if (breaches.length) {
  console.log('\n  GRUNT LEVELS FAR HEAVIER THAN THEIR BOSS:');
  breaches.forEach(b => console.log('   - ' + b));
} else {
  console.log('\n  ok   no grunt level is pathologically heavier than its boss');
}
for (const a of [0, 4]) {
  const sc = OPF.levelScaling(a, 29);
  let hp = 0;
  OPF.buildWaves(a, 29).forEach(w => w.forEach(t => { hp += OPF.ENEMY_TYPES[t].hp * sc.hp; }));
  console.log(`  arc${a + 1} lv29: ${hp.toFixed(0)} HP of grunts across ${OPF.buildWaves(a, 29).length} waves`);
}

const slow = rows.filter(x => !x.r.over || x.r.secs > 75);
for (const x of rows) {
  const flag = !x.r.over ? '  <-- NEVER ENDED' : (x.r.secs > 75 ? '  <-- SLOW' : '');
  console.log(`arc${x.a} lv${String(x.l).padStart(2)} ${x.char.padEnd(6)} ${(x.r.won ? 'win ' : x.r.over ? 'LOSS' : '??? ')} ${String(x.r.secs).padStart(5)}s hp ${x.r.hp}/${x.r.maxHp}${flag}`);
}
const secs = rows.filter(x => x.r.won).map(x => x.r.secs).sort((p, q) => p - q);
const med = secs[secs.length >> 1];
console.log(`\nmedian win ${med}s | slowest ${secs[secs.length - 1]}s | over 75s: ${slow.length}/${rows.length}`);
process.exit(breaches.length ? 1 : 0);
