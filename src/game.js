/* =====================================================================
   NEON CHASE — a maze chase arcade game
   ---------------------------------------------------------------------
   Plain browser script (no build step, no dependencies).
   You are the glowing disc. Four hunters want you. Eat every dot in the
   maze to clear the level. Power orbs make the hunters edible for a few
   seconds — that is when the chased becomes the chaser.

   Legend of the maze strings:
     #  wall            .  dot              o  power orb
     -  ghost door      (space) empty floor
   ===================================================================== */
(function () {
  'use strict';

  /* ==================================================================
     1. THE MAZE
     ================================================================== */
  const MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '######.##### ## #####.######',
    '######.##          ##.######',
    '######.## ###--### ##.######',
    '######.## #      # ##.######',
    '      .   #      #   .      ',
    '######.## #      # ##.######',
    '######.## ######## ##.######',
    '######.##          ##.######',
    '######.## ######## ##.######',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
  ];

  const COLS = MAZE[0].length;
  const ROWS = MAZE.length;
  const TILE = 24;
  const W = COLS * TILE;
  const H = ROWS * TILE;

  const OPEN = 0, WALL = 1, DOOR = 2;
  const NO_DOT = 0, DOT = 1, ORB = 2;

  // Tile bookkeeping
  const idx = (x, y) => y * COLS + x;
  const tiles = new Uint8Array(COLS * ROWS);
  const baseDots = new Uint8Array(COLS * ROWS);
  const dots = new Uint8Array(COLS * ROWS);
  let totalDots = 0;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = MAZE[y][x];
      tiles[idx(x, y)] = ch === '#' ? WALL : ch === '-' ? DOOR : OPEN;
      const d = ch === '.' ? DOT : ch === 'o' ? ORB : NO_DOT;
      baseDots[idx(x, y)] = d;
      if (d) totalDots++;
    }
  }

  const wrapX = (x) => (x < 0 ? COLS - 1 : x >= COLS ? 0 : x);

  function tileType(x, y) {
    if (y < 0 || y >= ROWS) return WALL; // above/below the maze is solid
    return tiles[idx(wrapX(x), y)];
  }

  /** Can something stand on this tile? `allowDoor` lets hunters use the pen door. */
  function canWalk(x, y, allowDoor) {
    const t = tileType(x, y);
    if (t === WALL) return false;
    if (t === DOOR) return !!allowDoor;
    return true;
  }

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_LIST = ['up', 'left', 'down', 'right'];
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  /* The pen (hunter house) and key tiles around it */
  const PEN = {
    door: { x: 13, y: 12 },
    exit: { x: 13, y: 11 },
    inside: { x: 13, y: 14 },
    left: 11,
    right: 15,
  };
  const PLAYER_START = { x: 13, y: 23 };
  const BONUS_TILE = { x: 13, y: 17 };

  /* ==================================================================
     2. TUNING
     ================================================================== */
  const SPEED = {
    // The disc keeps a real edge over the hunters — about 20% at level 1,
    // narrowing to almost nothing deep into the game.
    player: 7.7, playerStep: 0.14, playerMax: 9.6,
    hunter: 6.1, hunterStep: 0.26, hunterMax: 8.9,
    fright: 4.1, frightStep: 0.1, frightMin: 3.4,
    eyes: 13,
    pen: 4.6,
    tunnel: 0.55,
  };

  const MODE_PLAN = [
    ['scatter', 7], ['chase', 20],
    ['scatter', 7], ['chase', 20],
    ['scatter', 5], ['chase', 20],
    ['scatter', 5], ['chase', Infinity],
  ];

  const HUNTERS = [
    { name: 'Blinky', color: '#ff4b57', glow: 'rgba(255,75,87,0.75)', corner: { x: COLS - 2, y: 0 }, start: { x: PEN.exit.x, y: PEN.exit.y }, inside: false, release: 0, note: 'hunts you head-on' },
    { name: 'Pinky', color: '#ff8ad8', glow: 'rgba(255,138,216,0.7)', corner: { x: 1, y: 0 }, start: { x: PEN.inside.x, y: PEN.inside.y }, inside: true, release: 3, note: 'cuts you off' },
    { name: 'Inky', color: '#54d6ff', glow: 'rgba(84,214,255,0.7)', corner: { x: COLS - 2, y: ROWS - 1 }, start: { x: PEN.left, y: PEN.inside.y }, inside: true, release: 8, note: 'flanks from behind' },
    { name: 'Clyde', color: '#ffb347', glow: 'rgba(255,179,71,0.7)', corner: { x: 1, y: ROWS - 1 }, start: { x: PEN.right, y: PEN.inside.y }, inside: true, release: 14, note: 'wanders, then pounces' },
  ];

  /* ==================================================================
     3. GAME STATE
     ================================================================== */
  const game = {
    state: 'title',        // title | ready | playing | dying | levelclear | gameover | paused
    prevState: 'playing',
    time: 0,
    stateTimer: 0,
    deathT: 0,
    score: 0,
    high: 0,
    level: 1,
    lives: 3,
    extraLife: false,
    dotsLeft: totalDots,
    dotsEaten: 0,
    combo: 0,
    frightTimer: 0,
    frightTotal: 0,
    mode: 'scatter',
    modeIndex: 0,
    modeTimer: MODE_PLAN[0][1],
    wantDir: 'left',
    bonus: null,
    bonusGiven: 0,
    shake: 0,
    flash: 0,
    manual: false,
    player: null,
    ghosts: [],
    particles: [],
    floats: [],
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const dpad = document.getElementById('dpad');
  const ui = {
    score: document.getElementById('score'),
    high: document.getElementById('high'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    sound: document.getElementById('btn-sound'),
    pause: document.getElementById('btn-pause'),
  };

  let mazeLayer = null;   // pre-rendered walls (device pixels)
  let scaleDpr = 1;       // device pixels per logical pixel

  /* ==================================================================
     4. SOUND (tiny WebAudio synth)
     ================================================================== */
  const Sound = (() => {
    let ac = null, master = null;
    let enabled = true;
    let lastWaka = 0, wakaHigh = false, lastFright = 0;

    function node() {
      if (!enabled) return null;
      try {
        if (!ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = 0.45;
          master.connect(ac.destination);
        }
        if (ac.state === 'suspended' && ac.resume) ac.resume();
        return ac;
      } catch (err) {
        return null;
      }
    }

    function tone(freq, dur, type, vol, slideTo, delay) {
      const a = node();
      if (!a) return;
      try {
        const t0 = a.currentTime + (delay || 0);
        const osc = a.createOscillator();
        const gain = a.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol == null ? 0.22 : vol), t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.04);
      } catch (err) { /* audio is a nicety, never fatal */ }
    }

    return {
      get enabled() { return enabled; },
      setEnabled(v) {
        enabled = !!v;
        if (master) master.gain.value = enabled ? 0.45 : 0;
        if (enabled) node();
      },
      waka() {
        const t = game.time;
        if (t - lastWaka < 0.055) return;
        lastWaka = t;
        wakaHigh = !wakaHigh;
        tone(wakaHigh ? 208 : 152, 0.06, 'square', 0.17);
      },
      power() {
        tone(320, 0.09, 'square', 0.2, 700);
        tone(500, 0.14, 'square', 0.18, 980, 0.08);
      },
      eatHunter(combo) {
        const base = 340 + combo * 90;
        tone(base, 0.09, 'square', 0.22);
        tone(base * 1.5, 0.11, 'square', 0.2, null, 0.07);
      },
      fright() {
        const t = game.time;
        if (t - lastFright < 0.34) return;
        lastFright = t;
        tone(game.frightTimer % 0.7 > 0.35 ? 190 : 150, 0.1, 'sawtooth', 0.09);
      },
      death() {
        tone(520, 0.5, 'square', 0.24, 90);
        tone(300, 0.7, 'triangle', 0.18, 60, 0.22);
      },
      levelUp() {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.2, null, i * 0.11));
      },
      extraLife() {
        [784, 988, 1319].forEach((f, i) => tone(f, 0.14, 'triangle', 0.22, null, i * 0.1));
      },
      gameOver() {
        [440, 349, 262, 196].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.18, null, i * 0.16));
      },
      pen() { tone(120, 0.08, 'triangle', 0.1); },
    };
  })();

  /* ==================================================================
     5. ENTITIES & MOVEMENT
     Every mover sits on a tile and slides toward the next tile in its
     direction: `p` runs 0 → 1 across that tile. No float drift, so the
     grid is always exact.
     ================================================================== */
  function moverPos(m) {
    const [dx, dy] = DIRS[m.dir];
    return { x: (m.tx + 0.5 + dx * m.p) * TILE, y: (m.ty + 0.5 + dy * m.p) * TILE };
  }

  function stepMover(m, distance, onArrive) {
    let left = distance;
    let guard = 0;
    while (left > 1e-6 && guard++ < 48) {
      const need = (1 - m.p) * TILE;
      if (left < need) {
        m.p += left / TILE;
        break;
      }
      left -= need;
      const [dx, dy] = DIRS[m.dir];
      m.tx = wrapX(m.tx + dx);
      m.ty += dy;
      m.p = 0;
      if (onArrive(m) === false) return; // blocked: stay put
    }
  }

  /** Flip direction mid-tile (allowed for everyone). */
  function reverseMover(m) {
    if (m.p > 0) {
      const [dx, dy] = DIRS[m.dir];
      m.tx = wrapX(m.tx + dx);
      m.ty += dy;
      m.p = 1 - m.p;
    }
    m.dir = OPP[m.dir];
  }

  function makePlayer() {
    return {
      tx: PLAYER_START.x, ty: PLAYER_START.y, dir: 'left', p: 0,
      anim: 0, moving: true, isPlayer: true,
    };
  }

  function makeHunter(def) {
    return {
      def, name: def.name, color: def.color, glow: def.glow,
      tx: def.start.x, ty: def.start.y, dir: 'left', p: 0,
      state: def.inside ? 'pen' : 'roam',
      releaseTimer: def.release,
      frightened: false, pendingReverse: false,
      bounce: Math.random() * Math.PI * 2, anim: 0,
    };
  }

  function playerSpeed() {
    return Math.min(SPEED.playerMax, SPEED.player + (game.level - 1) * SPEED.playerStep);
  }
  function hunterSpeed() {
    return Math.min(SPEED.hunterMax, SPEED.hunter + (game.level - 1) * SPEED.hunterStep);
  }
  function frightSpeed() {
    return Math.max(SPEED.frightMin, SPEED.fright - (game.level - 1) * SPEED.frightStep);
  }
  function frightDuration() {
    return Math.max(2.4, 8.2 - (game.level - 1) * 0.6);
  }
  const allowDoor = (h) => h.state === 'pen' || h.state === 'leaving' || h.state === 'dead' || h.state === 'entering';
  const inTunnel = (x, y) => y === 14 && (x < 6 || x > COLS - 7);

  /* ==================================================================
     6. UPDATE — the player
     ================================================================== */
  function updatePlayer(dt) {
    const P = game.player;
    const want = game.wantDir;

    // Instant turns: reversal works mid-tile, side turns work whenever the
    // disc is parked exactly on a tile centre (or when it is blocked).
    if (want && want !== P.dir) {
      const [wx, wy] = DIRS[want];
      const open = canWalk(P.tx + wx, P.ty + wy);
      if (want === OPP[P.dir] && P.p > 0) {
        reverseMover(P);
      } else if (P.p === 0 && open) {
        P.dir = want;
      }
    }

    const before = P.tx + P.ty + P.p;
    stepMover(P, playerSpeed() * TILE * dt, (m) => {
      eatAt(m.tx, m.ty);
      const w = game.wantDir;
      if (w && canWalk(m.tx + DIRS[w][0], m.ty + DIRS[w][1])) {
        m.dir = w;
      } else {
        const [dx, dy] = DIRS[m.dir];
        if (!canWalk(m.tx + dx, m.ty + dy)) return false; // wall ahead: park here
      }
      return true;
    });
    const travelled = Math.abs(P.tx + P.ty + P.p - before);
    P.moving = travelled > 1e-6;
    if (P.moving) P.anim += dt;
  }

  /* ==================================================================
     7. UPDATE — the hunters
     ================================================================== */
  function hunterTarget(h) {
    const P = game.player;
    const [pdx, pdy] = DIRS[P.dir];
    switch (h.name) {
      case 'Blinky':
        return { x: P.tx, y: P.ty };
      case 'Pinky':
        return { x: P.tx + pdx * 4, y: P.ty + pdy * 4 };
      case 'Inky': {
        const b = game.ghosts[0];
        const ax = P.tx + pdx * 2, ay = P.ty + pdy * 2;
        return { x: ax * 2 - b.tx, y: ay * 2 - b.ty };
      }
      default: {
        const far = Math.hypot(P.tx - h.tx, P.ty - h.ty) > 8;
        return far ? { x: P.tx, y: P.ty } : h.def.corner;
      }
    }
  }

  function pickDir(h, target) {
    const allow = allowDoor(h);
    const options = [];
    for (const d of DIR_LIST) {
      if (d === OPP[h.dir]) continue;
      if (!canWalk(h.tx + DIRS[d][0], h.ty + DIRS[d][1], allow)) continue;
      options.push(d);
    }
    if (!options.length) return OPP[h.dir];

    // Scared hunters stumble around at random.
    if (h.frightened && h.state === 'roam') {
      return options[(Math.random() * options.length) | 0];
    }

    let best = options[0];
    let bestD = Infinity;
    for (const d of options) {
      const nx = h.tx + DIRS[d][0];
      const ny = h.ty + DIRS[d][1];
      const dx = nx - target.x, dy = ny - target.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestD - 1e-9) { bestD = dist; best = d; }
    }
    return best;
  }

  function hunterDecide(h) {
    if (h.state === 'leaving') {
      if (h.tx !== PEN.door.x) h.dir = PEN.door.x > h.tx ? 'right' : 'left';
      else if (h.ty > PEN.exit.y) h.dir = 'up';
      else { h.state = 'roam'; h.dir = pickDir(h, hunterTarget(h)); }
      return;
    }
    if (h.state === 'entering') {
      if (h.ty < PEN.inside.y) h.dir = 'down';
      else {
        h.state = 'pen';
        h.releaseTimer = Math.max(0.6, 2.6 - game.level * 0.15);
        h.bounce = 0;
        h.frightened = false;
      }
      return;
    }
    if (h.state === 'dead') {
      if (h.tx === PEN.exit.x && h.ty === PEN.exit.y) {
        h.state = 'entering';
        h.dir = 'down';
        return;
      }
      h.dir = pickDir(h, PEN.exit);
      return;
    }
    h.dir = pickDir(h, h.frightened ? h.def.corner : (game.mode === 'scatter' ? h.def.corner : hunterTarget(h)));
  }

  function updateHunter(h, dt) {
    if (h.state === 'pen') {
      h.bounce += dt * 5.5;
      h.releaseTimer -= dt;
      if (h.releaseTimer <= 0) {
        h.state = 'leaving';
        h.p = 0;
      }
      return;
    }

    if (h.pendingReverse) {
      h.pendingReverse = false;
      if (h.state === 'roam') reverseMover(h);
    }

    let speed;
    if (h.state === 'dead') speed = SPEED.eyes;
    else if (h.state === 'leaving' || h.state === 'entering') speed = SPEED.pen;
    else if (h.frightened) speed = frightSpeed();
    else speed = hunterSpeed();

    if (h.state === 'roam' && inTunnel(h.tx, h.ty)) speed *= SPEED.tunnel;

    h.anim += dt;
    stepMover(h, speed * TILE * dt, (m) => {
      hunterDecide(m);
      return true;
    });
  }

  /* ==================================================================
     8. RULES: eating, catching, levels
     ================================================================== */
  function addScore(n) {
    const before = game.score;
    game.score += n;
    if (!game.extraLife && before < 10000 && game.score >= 10000) {
      game.extraLife = true;
      game.lives++;
      Sound.extraLife();
      floatText(W / 2, 8 * TILE, 'EXTRA LIFE!', '#8ef7a0', 22);
    }
    if (game.score > game.high) {
      game.high = game.score;
      saveHigh();
    }
    paintHud();
  }

  function eatAt(x, y) {
    const i = idx(x, y);
    if (dots[i] === DOT) {
      dots[i] = NO_DOT;
      game.dotsLeft--;
      game.dotsEaten++;
      addScore(10);
      Sound.waka();
      if (game.dotsEaten % 7 === 0) sparkle((x + 0.5) * TILE, (y + 0.5) * TILE, '#ffd9a0', 3);
      maybeBonus();
    } else if (dots[i] === ORB) {
      dots[i] = NO_DOT;
      game.dotsLeft--;
      game.dotsEaten++;
      addScore(50);
      Sound.power();
      startFright();
      burst((x + 0.5) * TILE, (y + 0.5) * TILE, '#bff3ff', 22);
      game.flash = 0.35;
      game.shake = 0.35;
      maybeBonus();
    }

    if (game.bonus && game.bonus.x === x && game.bonus.y === y) {
      addScore(game.bonus.value);
      floatText((x + 0.5) * TILE, (y + 0.5) * TILE, '+' + game.bonus.value, '#ffe14d', 20);
      burst((x + 0.5) * TILE, (y + 0.5) * TILE, '#ffe14d', 20);
      Sound.eatHunter(1);
      game.bonus = null;
    }

    if (game.dotsLeft <= 0 && game.state === 'playing') clearLevel();
  }

  function maybeBonus() {
    if (game.bonusGiven === 0 && game.dotsEaten >= 70) spawnBonus();
    else if (game.bonusGiven === 1 && game.dotsEaten >= 170) spawnBonus();
  }

  function spawnBonus() {
    game.bonusGiven++;
    game.bonus = { x: BONUS_TILE.x, y: BONUS_TILE.y, life: 9.5, value: 100 * Math.min(5, game.level), spin: 0 };
  }

  function startFright() {
    game.frightTimer = frightDuration();
    game.frightTotal = game.frightTimer;
    game.combo = 0;
    for (const h of game.ghosts) {
      if (h.state === 'dead' || h.state === 'entering') continue;
      h.frightened = true;
      h.pendingReverse = true;
    }
  }

  function endFright() {
    game.frightTimer = 0;
    game.combo = 0;
    for (const h of game.ghosts) h.frightened = false;
  }

  function eatHunter(h) {
    const value = 200 * Math.pow(2, game.combo);
    game.combo = Math.min(game.combo + 1, 3);
    h.frightened = false;
    h.state = 'dead';
    h.p = 0;
    const pos = moverPos(h);
    addScore(value);
    floatText(pos.x, pos.y, String(value), '#8ef0ff', 21);
    burst(pos.x, pos.y, h.color, 26);
    game.shake = 0.3;
    Sound.eatHunter(game.combo);
  }

  function catchPlayer() {
    if (game.state !== 'playing') return;
    game.state = 'dying';
    game.deathT = 0;
    game.lives--;
    paintHud();
    game.shake = 0.8;
    game.frightTimer = 0;
    game.combo = 0;
    for (const h of game.ghosts) h.frightened = false;
    Sound.death();
    const pos = moverPos(game.player);
    burst(pos.x, pos.y, '#ffe14d', 30);
  }

  function checkCatch() {
    const P = game.player;
    const pp = moverPos(P);
    for (const h of game.ghosts) {
      if (h.state === 'dead' || h.state === 'entering' || h.state === 'pen') continue;
      const hp = moverPos(h);
      if (Math.hypot(hp.x - pp.x, hp.y - pp.y) < TILE * 0.62) {
        if (h.frightened) eatHunter(h);
        else { catchPlayer(); return; }
      }
    }
  }

  function clearLevel() {
    game.state = 'levelclear';
    game.stateTimer = 2.6;
    game.flash = 0.5;
    addScore(250 + 50 * game.level);
    Sound.levelUp();
  }

  function afterDeath() {
    if (game.lives <= 0) {
      game.state = 'gameover';
      Sound.gameOver();
      showScreen('gameover');
      return;
    }
    resetActors();
    game.state = 'ready';
    game.stateTimer = 1.9;
  }

  /* ==================================================================
     9. MODE TIMER (scatter ⇄ chase) + per-frame systems
     ================================================================== */
  function updateMode(dt) {
    if (game.frightTimer > 0) return; // the clock pauses while everyone is scared
    game.modeTimer -= dt;
    if (game.modeTimer > 0) return;

    game.modeIndex = Math.min(game.modeIndex + 1, MODE_PLAN.length - 1);
    const [mode, base] = MODE_PLAN[game.modeIndex];
    const scaled = mode === 'scatter' ? Math.max(2.5, base * (1 - (game.level - 1) * 0.09)) : base;
    game.mode = mode;
    game.modeTimer = scaled;
    for (const h of game.ghosts) if (h.state === 'roam') h.pendingReverse = true;
  }

  function updateBonus(dt) {
    if (!game.bonus) return;
    game.bonus.life -= dt;
    game.bonus.spin += dt * 2.4;
    if (game.bonus.life <= 0) game.bonus = null;
  }

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const q = game.particles[i];
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 1 - 2.4 * dt;
      q.vy *= 1 - 2.4 * dt;
      if (q.life <= 0) game.particles.splice(i, 1);
    }
    for (let i = game.floats.length - 1; i >= 0; i--) {
      const f = game.floats[i];
      f.life -= dt;
      f.y -= 26 * dt;
      if (f.life <= 0) game.floats.splice(i, 1);
    }
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 1.9);
    if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 1.6);
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 190;
      game.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.5, max: 0.85,
        size: 1.6 + Math.random() * 2.6, color,
      });
    }
  }

  function sparkle(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      game.particles.push({
        x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 20,
        life: 0.25, max: 0.25, size: 1.5, color,
      });
    }
  }

  function floatText(x, y, text, color, size) {
    game.floats.push({ x, y, text, color, size: size || 18, life: 1.1, max: 1.1 });
  }

  /* ==================================================================
     10. MAIN UPDATE
     ================================================================== */
  function update(dt) {
    game.time += dt;

    switch (game.state) {
      case 'ready':
        game.stateTimer -= dt;
        for (const h of game.ghosts) if (h.state === 'pen') h.bounce += dt * 5.5;
        if (game.stateTimer <= 0) game.state = 'playing';
        break;

      case 'playing':
        updateMode(dt);
        if (game.frightTimer > 0) {
          game.frightTimer -= dt;
          Sound.fright();
          if (game.frightTimer <= 0) endFright();
        }
        updatePlayer(dt);
        for (const h of game.ghosts) updateHunter(h, dt);
        checkCatch();
        updateBonus(dt);
        break;

      case 'dying':
        game.deathT += dt;
        for (const h of game.ghosts) h.anim += dt;
        if (game.deathT >= 1.9) afterDeath();
        break;

      case 'levelclear':
        game.stateTimer -= dt;
        for (const h of game.ghosts) h.anim += dt;
        if (game.stateTimer <= 0) {
          game.level++;
          newLevel();
        }
        break;

      default:
        for (const h of game.ghosts) if (h.state === 'pen') h.bounce += dt * 5.5;
        break;
    }

    updateParticles(dt);
  }

  /* ==================================================================
     11. RENDERING
     ================================================================== */
  // Each level re-lights the maze with a different neon hue.
  const THEME_HUES = [206, 172, 266, 322, 34, 138];
  function theme() {
    const hue = THEME_HUES[(game.level - 1) % THEME_HUES.length];
    return {
      inset: `hsl(${hue} 62% 13%)`,
      deep: `hsl(${hue} 70% 7%)`,
      edge: `hsl(${hue} 96% 68%)`,
      dot: '#ffd8a8',
      orb: '#fff3c9',
    };
  }

  function buildMazeLayer() {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const lc = c.getContext('2d');
    lc.setTransform(scaleDpr, 0, 0, scaleDpr, 0, 0);

    const th = theme();

    lc.fillStyle = '#04050c';
    lc.fillRect(0, 0, W, H);

    // Wall blocks: merged rectangles of dark ink
    const grad = lc.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.inset);
    grad.addColorStop(1, th.deep);
    lc.fillStyle = grad;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (tiles[idx(x, y)] !== WALL) continue;
        lc.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    // Outline pass — one line per wall/floor boundary. Off-grid counts as
    // floor so the outer border gets its neon rim.
    const line = document.createElement('canvas');
    line.width = c.width;
    line.height = c.height;
    const oc = line.getContext('2d');
    oc.setTransform(scaleDpr, 0, 0, scaleDpr, 0, 0);
    oc.strokeStyle = th.edge;
    oc.lineWidth = 2.3;
    oc.lineCap = 'round';
    oc.beginPath();
    const inset = 1.5;
    const isWallForOutline = (x, y) => (y < 0 || y >= ROWS || x < 0 || x >= COLS) ? false : tiles[idx(x, y)] === WALL;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (tiles[idx(x, y)] !== WALL) continue;
        const px = x * TILE, py = y * TILE;
        if (!isWallForOutline(x, y - 1)) { oc.moveTo(px, py + inset); oc.lineTo(px + TILE, py + inset); }
        if (!isWallForOutline(x, y + 1)) { oc.moveTo(px, py + TILE - inset); oc.lineTo(px + TILE, py + TILE - inset); }
        if (!isWallForOutline(x - 1, y)) { oc.moveTo(px + inset, py); oc.lineTo(px + inset, py + TILE); }
        if (!isWallForOutline(x + 1, y)) { oc.moveTo(px + TILE - inset, py); oc.lineTo(px + TILE - inset, py + TILE); }
      }
    }
    oc.stroke();

    // Neon bloom: blurred copies of the outline, then the crisp line on top.
    let canBlur = false;
    try {
      lc.filter = 'blur(7px)';
      canBlur = typeof lc.filter === 'string' && lc.filter !== 'none';
    } catch (err) { canBlur = false; }
    if (canBlur) {
      lc.save();
      lc.globalCompositeOperation = 'lighter';
      lc.globalAlpha = 0.85;
      lc.drawImage(line, 0, 0, W, H);
      lc.globalAlpha = 0.55;
      lc.drawImage(line, 0, 0, W, H);
      lc.filter = 'none';
      lc.restore();
    }
    lc.drawImage(line, 0, 0, W, H);

    // Pen door: a soft bar across the two door tiles
    lc.strokeStyle = 'rgba(255,180,255,0.55)';
    lc.lineWidth = 3;
    lc.lineCap = 'round';
    lc.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (tiles[idx(x, y)] !== DOOR) continue;
        lc.moveTo(x * TILE + 3, y * TILE + TILE / 2);
        lc.lineTo(x * TILE + TILE - 3, y * TILE + TILE / 2);
      }
    }
    lc.stroke();

    // Soft inner vignette so the middle of the board reads as a stage.
    const vg = lc.createRadialGradient(W / 2, H / 2, TILE * 4, W / 2, H / 2, H * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    lc.fillStyle = vg;
    lc.fillRect(0, 0, W, H);

    mazeLayer = c;
  }

  function drawDots(time) {
    // dots in one batch
    ctx.beginPath();
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const d = dots[idx(x, y)];
        if (d !== DOT) continue;
        const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
        ctx.moveTo(cx + 2.3, cy);
        ctx.arc(cx, cy, 2.3, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = theme().dot;
    ctx.fill();

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (dots[idx(x, y)] !== ORB) continue;
        const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
        const r = 4.2 + pulse * 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = theme().orb;
        ctx.shadowColor = 'rgba(255,243,201,0.9)';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawBonus() {
    const b = game.bonus;
    if (!b) return;
    if (b.life < 3 && Math.floor(b.life * 6) % 2 === 0) return; // blink out
    const x = (b.x + 0.5) * TILE, y = (b.y + 0.5) * TILE;
    const r = TILE * 0.42;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(b.spin) * 0.3);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.8, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.8, 0);
    ctx.closePath();
    ctx.fillStyle = '#ffe14d';
    ctx.shadowColor = 'rgba(255,225,77,0.95)';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(time) {
    const P = game.player;
    if (game.state === 'gameover') return;
    const pos = moverPos(P);
    const r = TILE * 0.46;
    const [dx, dy] = DIRS[P.dir];
    const angle = Math.atan2(dy, dx);

    let half; // mouth half-angle in radians
    let alpha = 1;
    if (game.state === 'dying') {
      const k = Math.min(1, game.deathT / 1.35);
      half = k * Math.PI;
      alpha = 1 - Math.max(0, (game.deathT - 1.35) / 0.4);
      if (alpha <= 0) return;
    } else if (game.state === 'ready' || !P.moving) {
      half = 0.22;
    } else {
      half = 0.05 + Math.abs(Math.sin(P.anim * 9)) * 0.38;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, half, Math.PI * 2 - half);
    ctx.closePath();
    ctx.fillStyle = '#ffe14d';
    ctx.shadowColor = 'rgba(255,225,77,0.9)';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    // inner shine
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    ctx.restore();
  }

  function drawGhostShape(x, y, r, time, wobble) {
    const bottom = y + r * 0.92;
    const seg = (r * 2) / 3;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.12, r, Math.PI, 0);
    ctx.lineTo(x + r, bottom);
    let cx = x + r;
    for (let i = 0; i < 3; i++) {
      const nx = cx - seg;
      const up = (i % 2 === 0 ? 1 : -1) + Math.sin(time * 9 + wobble) * 0.25;
      ctx.quadraticCurveTo((cx + nx) / 2, bottom + up * r * 0.3, nx, bottom);
      cx = nx;
    }
    ctx.closePath();
  }

  function drawHunter(h, time) {
    const pos = h.state === 'pen'
      ? { x: (h.tx + 0.5) * TILE, y: (h.ty + 0.5) * TILE + Math.sin(h.bounce) * 4 }
      : moverPos(h);
    const r = TILE * 0.44;
    const [dx, dy] = DIRS[h.dir];
    const dead = h.state === 'dead';
    const flashing = h.frightened && game.frightTimer > 0 && game.frightTimer < 2.2 && Math.floor(game.frightTimer * 7) % 2 === 0;

    if (!dead) {
      ctx.save();
      let body = h.color;
      let glow = h.glow;
      if (h.frightened) {
        body = flashing ? '#ffffff' : '#3f57ff';
        glow = flashing ? 'rgba(255,255,255,0.8)' : 'rgba(63,87,255,0.8)';
      }
      ctx.shadowColor = glow;
      ctx.shadowBlur = 18;
      ctx.fillStyle = body;
      drawGhostShape(pos.x, pos.y, r, time, h.bounce);
      ctx.fill();
      ctx.shadowBlur = 0;

      // dome highlight
      ctx.beginPath();
      ctx.arc(pos.x - r * 0.3, pos.y - r * 0.45, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
      ctx.restore();
    }

    // eyes (they always show, and they are all that is left when eaten)
    const eyeDX = r * 0.36, eyeY = pos.y - r * 0.16, eyeR = r * 0.3;
    const dirOff = dead ? 0 : r * 0.13;
    for (const side of [-1, 1]) {
      const ex = pos.x + side * eyeDX;
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#fdfdff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + dx * dirOff, eyeY + dy * dirOff, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = h.frightened && !dead ? (flashing ? '#dd3355' : '#1b2a8f') : '#1b1b3a';
      ctx.fill();
    }

    if (h.frightened && !dead) {
      // wavy scared mouth
      ctx.beginPath();
      const my = pos.y + r * 0.36;
      const mw = r * 0.5;
      ctx.moveTo(pos.x - mw, my);
      for (let i = 0; i < 4; i++) {
        const nx = pos.x - mw + ((i + 1) * (mw * 2)) / 4;
        ctx.lineTo(nx, my + (i % 2 === 0 ? -3 : 3));
      }
      ctx.strokeStyle = flashing ? '#cc2244' : '#dff0ff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (const q of game.particles) {
      const a = Math.max(0, q.life / q.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    for (const f of game.floats) {
      const a = Math.max(0, Math.min(1, f.life / f.max));
      ctx.globalAlpha = a;
      ctx.font = `800 ${f.size}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 12;
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function bigText(text, color, y, size) {
    ctx.save();
    ctx.font = `900 ${size || 30}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillText(text, W / 2, y);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function render() {
    const time = game.time;
    ctx.setTransform(scaleDpr, 0, 0, scaleDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#04050c';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (game.shake > 0) {
      const s = game.shake * 9;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    if (mazeLayer) ctx.drawImage(mazeLayer, 0, 0, W, H);
    drawDots(time);
    drawBonus();

    const hideActors = game.state === 'title' || game.state === 'gameover';
    if (!hideActors) {
      for (const h of game.ghosts) drawHunter(h, time);
      drawPlayer(time);
    }
    drawParticles();
    drawFloats();

    if (game.frightTimer > 0) {
      ctx.fillStyle = 'rgba(48,74,220,0.12)';
      ctx.fillRect(0, 0, W, H);
    }
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (game.state === 'ready') {
      bigText(game.stateTimer > 1.2 || Math.floor(game.stateTimer * 8) % 2 === 0 ? 'READY!' : '', '#ffe14d', 20.6 * TILE, 30);
    } else if (game.state === 'levelclear') {
      const on = Math.floor(time * 8) % 2 === 0;
      if (on) bigText('LEVEL CLEAR', '#8ef7a0', 20.6 * TILE, 28);
    }

    ctx.restore();
  }

  /* ==================================================================
     12. FLOW: title → ready → playing → …
     ================================================================== */
  function resetActors() {
    game.player = makePlayer();
    game.ghosts = HUNTERS.map(makeHunter);
    game.wantDir = 'left';
    game.bonus = null;
    game.particles.length = 0;
    game.floats.length = 0;
    endFright();
  }

  function newLevel() {
    dots.set(baseDots);
    game.dotsLeft = totalDots;
    game.dotsEaten = 0;
    game.bonusGiven = 0;
    game.mode = 'scatter';
    game.modeIndex = 0;
    game.modeTimer = Math.max(3, MODE_PLAN[0][1] * (1 - (game.level - 1) * 0.09));
    resetActors();
    buildMazeLayer();
    game.state = 'ready';
    game.stateTimer = 2.1;
    game.flash = 0.25;
    paintHud();
  }

  function startGame() {
    game.score = 0;
    game.level = 1;
    game.lives = 3;
    game.extraLife = false;
    game.combo = 0;
    hideOverlay();
    newLevel();
  }

  function togglePause() {
    if (game.state === 'playing' || game.state === 'ready') {
      game.prevState = game.state;
      game.state = 'paused';
      showScreen('paused');
    } else if (game.state === 'paused') {
      game.state = game.prevState;
      hideOverlay();
    }
  }

  function primaryAction() {
    if (game.state === 'title' || game.state === 'gameover') startGame();
    else if (game.state === 'paused') togglePause();
  }

  /* ==================================================================
     13. HUD + SCREENS (plain DOM so the text stays crisp)
     ================================================================== */
  function paintHud() {
    ui.score.textContent = game.score.toLocaleString();
    ui.high.textContent = game.high.toLocaleString();
    ui.level.textContent = String(game.level);
    if (ui.lives.children.length !== Math.max(0, Math.min(6, game.lives))) {
      ui.lives.innerHTML = '';
      for (let i = 0; i < Math.min(6, Math.max(0, game.lives)); i++) ui.lives.appendChild(document.createElement('i'));
    }
    const paused = game.state === 'paused';
    ui.pause.textContent = paused ? '▶' : '❚❚';
    ui.pause.title = paused ? 'Resume (P)' : 'Pause (P)';
  }

  function hunterRoster() {
    return HUNTERS.map((h) => `<span><i style="background:${h.color}"></i>${h.name} ${h.note}</span>`).join('');
  }

  function showScreen(kind) {
    let html = '';
    if (kind === 'title') {
      html = `<div class="card">
        <h1>NEON CHASE</h1>
        <p class="tagline">eat the maze · dodge the hunters</p>
        <p>You are the glowing disc. Four hunters want you. Clear every dot to advance —
        grab an <b>orb</b> and the chase flips: for a few seconds, <b>you</b> hunt them.</p>
        <div class="roster">${hunterRoster()}</div>
        <div class="keys">
          <div><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move</div>
          <div><kbd>P</kbd> pause · <kbd>M</kbd> sound · swipe anywhere on a phone</div>
        </div>
        <div class="actions"><button class="btn" data-act="start">Start chase</button></div>
      </div>`;
    } else if (kind === 'paused') {
      html = `<div class="card">
        <h2>PAUSED</h2>
        <p class="tagline">the maze is holding its breath</p>
        <div class="final">
          <div><strong>${game.score.toLocaleString()}</strong><small>Score</small></div>
          <div><strong>${game.level}</strong><small>Level</small></div>
          <div><strong>${game.lives}</strong><small>Lives</small></div>
        </div>
        <div class="actions">
          <button class="btn" data-act="resume">Resume</button>
          <button class="btn ghost" data-act="quit">Quit to title</button>
        </div>
      </div>`;
    } else if (kind === 'gameover') {
      const record = game.score >= game.high && game.score > 0;
      html = `<div class="card">
        <h2>CAUGHT!</h2>
        <p class="tagline">${record ? 'new personal best' : 'the hunters win this round'}</p>
        <div class="final">
          <div><strong>${game.score.toLocaleString()}</strong><small>Score</small></div>
          <div><strong>${game.high.toLocaleString()}</strong><small>Best</small></div>
          <div><strong>${game.level}</strong><small>Level reached</small></div>
        </div>
        <div class="actions">
          <button class="btn" data-act="start">Chase again</button>
          <button class="btn ghost" data-act="title">Title screen</button>
        </div>
      </div>`;
    }
    overlay.innerHTML = html;
    overlay.classList.add('show');
    paintHud();
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
  }

  /* ==================================================================
     14. PERSISTENCE
     ================================================================== */
  function saveHigh() {
    try { localStorage.setItem('neonchase.high', String(game.high)); } catch (err) { /* ignore */ }
  }
  function loadPrefs() {
    try {
      const h = parseInt(localStorage.getItem('neonchase.high') || '0', 10);
      if (!Number.isNaN(h)) game.high = h;
      const muted = localStorage.getItem('neonchase.muted');
      if (muted === '1') Sound.setEnabled(false);
    } catch (err) { /* ignore */ }
    ui.sound.textContent = Sound.enabled ? '🔊' : '🔇';
  }

  function toggleSound() {
    Sound.setEnabled(!Sound.enabled);
    ui.sound.textContent = Sound.enabled ? '🔊' : '🔇';
    try { localStorage.setItem('neonchase.muted', Sound.enabled ? '0' : '1'); } catch (err) { /* ignore */ }
  }

  /* ==================================================================
     15. INPUT
     ================================================================== */
  function setDir(d) {
    if (!DIRS[d]) return;
    game.wantDir = d;
    if (game.state === 'paused') togglePause();
  }

  const KEYMAP = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };

  window.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (KEYMAP[k]) {
      e.preventDefault();
      if (game.state === 'title' || game.state === 'gameover') { startGame(); return; }
      setDir(KEYMAP[k]);
      return;
    }
    if (k === 'p' || k === 'escape') { e.preventDefault(); togglePause(); return; }
    if (k === 'm') { toggleSound(); return; }
    if (k === ' ' || k === 'enter') { e.preventDefault(); primaryAction(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (game.state === 'playing' || game.state === 'ready')) togglePause();
  });
  window.addEventListener('blur', () => {
    if (game.state === 'playing' || game.state === 'ready') togglePause();
  });

  overlay.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'start') startGame();
    else if (act === 'resume') togglePause();
    else if (act === 'title') { game.state = 'title'; showScreen('title'); resetActors(); }
  });

  ui.pause.addEventListener('click', togglePause);
  ui.sound.addEventListener('click', toggleSound);

  // D-pad (touch)
  dpad.addEventListener('pointerdown', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
    if (!el) return;
    e.preventDefault();
    if (game.state === 'title' || game.state === 'gameover') startGame();
    setDir(el.getAttribute('data-dir'));
  });

  // Swipe anywhere on the board
  let swipe = null;
  stage.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    swipe = { x: t.clientX, y: t.clientY };
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  stage.addEventListener('touchmove', (e) => {
    if (!swipe) return;
    if (e.cancelable) e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x;
    const dy = t.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 22) return;
    if (game.state === 'title' || game.state === 'gameover') { startGame(); return; }
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe = { x: t.clientX, y: t.clientY };
  }, { passive: false });

  stage.addEventListener('touchend', () => { swipe = null; });

  /* ==================================================================
     16. LAYOUT
     ================================================================== */
  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const stageRect = stage.getBoundingClientRect ? stage.getBoundingClientRect() : { width: 400, height: 600 };
    const availW = Math.max(200, stageRect.width || 400);
    const availH = Math.max(200, stageRect.height || 560);
    const scale = Math.min(availW / W, availH / H);
    canvas.style.width = `${Math.floor(W * scale)}px`;
    canvas.style.height = `${Math.floor(H * scale)}px`;
    scaleDpr = scale * dpr;
    canvas.width = Math.round(W * scaleDpr);
    canvas.height = Math.round(H * scaleDpr);
    ctx.imageSmoothingEnabled = true;
    buildMazeLayer();
  }

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  /* ==================================================================
     17. LOOP + BOOT
     ================================================================== */
  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  let last = now();
  function frame(ts) {
    const t = typeof ts === 'number' ? ts : now();
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;
    if (!game.manual) {
      update(dt);
      render();
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    loadPrefs();
    resetActors();
    layout();
    paintHud();
    showScreen('title');
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) dpad.hidden = false;
    requestAnimationFrame(frame);
  }

  /* Small hook so the tools/smoke test can drive the game deterministically. */
  window.NeonChase = {
    game,
    sound: Sound,
    setDir,
    start: startGame,
    pause: togglePause,
    step(dt) { update(dt); render(); },
    grid: { COLS, ROWS, TILE },
    tile: (x, y) => tileType(x, y),
    pellet: (x, y) => dots[idx(wrapX(x), y)],
    canWalk,
  };

  boot();
})();
