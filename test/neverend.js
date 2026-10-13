/* Stress probe for battles that never resolve. Replays suspicious levels many
   times and dumps the full wave/enemy state the moment a fight refuses to end.
   Run: node test/neverend.js */
const { boot } = require('./boot');
const { window, frame, GAME } = boot();
const OPF = window.OPF;
const { setCharLevel, fight, EXPECT } = require('./bot');

function dump(w, label) {
  console.log(`\n  === ${label} ===`);
  console.log(`  over=${w.over} result=${w.result} waveIndex=${w.waveIndex}/${w.waves.length} clearTimer=${w.clearTimer}`);
  console.log(`  player: hp ${Math.round(w.player.hp)}/${w.player.maxHp} x=${Math.round(w.player.x)} state=${w.player.state} stateTime=${(w.player.stateTime || 0).toFixed(2)} invuln=${(w.player.invuln || 0).toFixed(2)} dead=${w.player.dead}`);
  console.log(`  enemies(${w.enemies.length}):`);
  w.enemies.forEach((e, i) => {
    console.log(`    [${i}] ${e.typeId} hp=${Math.round(e.hp)}/${e.maxHp} dead=${e.dead} static=${!!e.static} hazard=${!!e.hazard} x=${Math.round(e.x)} state=${e.state} stateTime=${(e.stateTime || 0).toFixed(2)} spawnT=${(e.spawnTime || 0).toFixed(2)} ai=${e.ai ? e.ai.profile : '-'}`);
  });
  console.log(`  projectiles=${(w.projectiles || []).length} hazards=${(w.hazards || []).length}`);
}

const cases = [[3, 1], [3, 5], [0, 29], [5 - 1, 25], [2, 15]];
const REPS = 3;
let bad = 0, runs = 0;
for (const [a, l] of cases) {
  for (let rep = 0; rep < REPS; rep++) {
    const char = OPF.CHARACTERS[(a + l + rep) % 6].id;
    setCharLevel(GAME, OPF, char, EXPECT[a]);
    const r = fight(GAME, OPF, frame, a, l, char, 120);
    runs++;
    if (!r.over) {
      bad++;
      console.log(`arc${a + 1} lv${l} ${char.padEnd(6)} rep${rep} DID NOT END (120s, hp ${r.hp}/${r.maxHp})`);
      dump(GAME.world, `arc${a + 1} lv${l} ${char} rep${rep}`);
    } else {
      console.log(`arc${a + 1} lv${l} ${char.padEnd(6)} rep${rep} ${r.won ? 'win ' : 'LOSS'} ${r.secs}s hp ${r.hp}/${r.maxHp}`);
    }
    window.closeResult();
  }
}
console.log(`\n${runs - bad}/${runs} resolved; ${bad} never ended`);
process.exit(0);
