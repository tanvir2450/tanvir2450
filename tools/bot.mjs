/* A small scripted "player" used by the balance test.
   It is deliberately simple, but it does what a human does:
     - sees hunters coming and yields ground early
     - looks one junction ahead when choosing an escape
     - otherwise clears the nearest pellet
   Deterministic except for a seeded tie-break jitter. */
export function makeBot(api, opts = {}) {
  const COLS = 28, ROWS = 31;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const wrapX = (x) => (x < 0 ? COLS - 1 : x >= COLS ? 0 : x);
  const walkable = (x, y) => y >= 0 && y < ROWS && api.tile(x, y) === 0;
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  const SURVIVOR = opts.mode === 'survivor'; // ignore pellets, just stay alive
  const PANIC_R = SURVIVOR ? 99 : (opts.panicRadius ?? 6);
  const HARD = opts.hardBlock ?? 2;
  const WANDER = opts.wander ?? 0.15;
  let seed = opts.seed ?? 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  function bfs(sources) {
    const dist = new Int16Array(COLS * ROWS).fill(32767);
    const q = [];
    for (const [sx, sy] of sources) {
      const x = wrapX(sx);
      if (!walkable(x, sy)) continue;
      const i = sy * COLS + x;
      if (dist[i] === 0) continue;
      dist[i] = 0;
      q.push([x, sy]);
    }
    for (let head = 0; head < q.length; head++) {
      const [x, y] = q[head];
      const d = dist[y * COLS + x];
      for (const k in DIRS) {
        const nx = wrapX(x + DIRS[k][0]);
        const ny = y + DIRS[k][1];
        if (!walkable(nx, ny)) continue;
        const i = ny * COLS + nx;
        if (dist[i] <= d + 1) continue;
        dist[i] = d + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }

  /** Distance to the nearest tile matching `want` (pellet: 1 or 2, orb: 2). */
  function fieldTo(me, want) {
    const dist = bfs([me]);
    let best = 32767;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = api.pellet(x, y);
        if (want === 'orb' ? v !== 2 : v === 0) continue;
        const d = dist[y * COLS + x];
        if (d < best) best = d;
      }
    }
    return { dist, best };
  }

  let lastDir = 'left';
  let lastReverse = '';
  let lastDecision = null;
  const at = (d, x, y) => Math.min(d[y * COLS + wrapX(x)], 15);

  function think() {
    const P = api.game.player;
    const me = [P.tx, P.ty];
    // Where hunters are *and* where they are about to be.
    const sources = [];
    for (const h of api.game.ghosts) {
      if (h.frightened || h.state === 'dead' || h.state === 'entering' || h.state === 'pen') continue;
      sources.push([h.tx, h.ty]);
      // project a few tiles along the hunter's heading: a human reads the
      // corridor a ghost is committed to, not just the tile it stands on
      const [hx, hy] = DIRS[h.dir] || [0, 0];
      let px = h.tx, py = h.ty;
      for (let s = 0; s < 4; s++) {
        px += hx; py += hy;
        if (!walkable(px, py)) break;
        sources.push([px, py]);
      }
    }
    const threat = bfs(sources);
    const here = at(threat, me[0], me[1]);
    const panic = here <= PANIC_R;

    // Mid-tile: no steering. The bot commits to a tile and decides again at
    // the next junction. (Steering the other way here produced a decision
    // loop: the tile-centre policy said "go" while a reversal rule said
    // "turn back", and the two flip-flopped forever.)
    if (P.p !== 0) return false;

    // What are we heading for? Pellets normally; a power orb when things get
    // close (it is the escape hatch); a frightened hunter when we are the
    // dangerous one.
    const frightened = api.game.frightTimer > 0;
    const orbField = frightened || panic ? fieldTo(me, 'orb') : null;
    let field = fieldTo(me, 'pellet');
    if (frightened && orbField.best === 32767) {
      // hunt the nearest scared hunter instead
      const scared = api.game.ghosts.filter((h) => h.frightened && h.state === 'roam');
      if (scared.length) field = { dist: bfs(scared.map((h) => [h.tx, h.ty])), best: 0, hunt: true };
    } else if (panic && orbField && orbField.best <= 10) {
      field = { dist: orbField.dist, best: orbField.best, orb: true };
    }

    const options = [];
    for (const k in DIRS) {
      const nx = wrapX(me[0] + DIRS[k][0]);
      const ny = me[1] + DIRS[k][1];
      if (!walkable(nx, ny)) continue;
      const danger = at(threat, nx, ny);
      let gap = Math.min(field.dist[ny * COLS + nx], 60);
      if (field.orb && orbField && orbField.dist[ny * COLS + nx] !== 32767) {
        // split the difference: orbs are worth a small detour, not any detour
        gap = Math.min(gap, orbField.dist[ny * COLS + nx] * 0.55);
      }
      // one junction of foresight: how much room is there after this tile?
      let escape = danger;
      for (const k2 in DIRS) {
        const ox = wrapX(nx + DIRS[k2][0]);
        const oy = ny + DIRS[k2][1];
        if (!walkable(ox, oy)) continue;
        if (ox === me[0] && oy === me[1]) continue; // don't count doubling back
        escape = Math.max(escape, at(threat, ox, oy));
      }
      const safety = Math.min(danger, escape + 1);
      const blocked = danger <= HARD;
      const chasing = !panic && field.hunt;
      const score = SURVIVOR
        ? safety * 10 - (blocked ? 500 : 0)
        : (chasing
          ? safety * 4 - gap * 12 - (blocked ? 500 : 0)
          : (panic ? safety * 10 - gap * 0.4 : -gap * 10 + safety * 2.4) - (blocked ? 500 : 0));
      options.push({ k, score, blocked, danger });
    }
    if (!options.length) return true;

    for (const o of options) if (o.k === lastDir) o.score += 0.5;
    for (const o of options) o.score += rnd() * WANDER;
    options.sort((a, b) => b.score - a.score);
    lastDir = options[0].k;
    api.setDir(lastDir);
    lastDecision = {
      at: me.join(','), panic, here, dir: lastDir,
      options: options.map((o) => `${o.k}:${o.danger}${o.blocked ? '!' : ''}`).join(' '),
      safe: options.filter((o) => !o.blocked).length,
    };
    return true;
  }

  return { think, get lastDir() { return lastDir; }, get lastDecision() { return lastDecision; } };
}
