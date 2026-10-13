/* Shared test bot: a "reasonably played" character used by test/harness.js and
   test/bosses.js so both suites judge the game the same way.
   Not part of the game itself — test/ only. */
/** Spend upgrade points so a character sits at roughly `lvl` (the level a player
    would plausibly have when first reaching a given arc). */
function setCharLevel(GAME, OPFx, char, lvl) {
  const total = Math.round((lvl - 1) * 2.9);
  const up = { vitality: 0, power: 0, spirit: 0 };
  const order = ['power', 'vitality', 'spirit'];
  for (let i = 0; i < total; i++) { const t = order[i % 3]; if (up[t] < 10) up[t]++; else up[order[(i + 1) % 3]]++; }
  GAME.save.upgrades[char] = up;
  return OPFx.charLevelFrom(up);
}

/** Fight one level with the bot. Returns {won, secs, hp, maxHp, over}. */
function fight(GAME, OPF, frame, arc, lvl, char, maxSecs, opts) {
  const o = opts || {};
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
      else if (adx < 42 && p.x > w.arenaLeft + 34 && p.x < w.arenaRight - 34) p.moveInput(-face, w);   // only back off when there is room, or we wedge ourselves against the arena wall forever
      else if (adx < 42) { p.moveInput(0, w); w.playerAttack(); }
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
  return { won: w.result === 'victory', over: w.over, secs: +(f / 60).toFixed(1), hp: Math.round(p.hp), maxHp: p.maxHp };
}

// expected character level when a player first reaches each arc's bosses
const EXPECT = { 0: 4, 1: 6, 2: 8, 3: 9, 4: 10 };

module.exports = { setCharLevel, fight, EXPECT };
