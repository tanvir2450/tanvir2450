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

  /* Every random draw goes through here, so a test can seed the whole game. */
  const defaultRng = Math.random;
  let rand = defaultRng;
  const setRng = (fn) => { rand = typeof fn === 'function' ? fn : defaultRng; };

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

  /* Where up to four discs park before a race, and what colour each one is. */
  const SPAWNS = [
    { x: 13, y: 23 }, { x: 14, y: 23 }, { x: 12, y: 23 }, { x: 15, y: 23 },
  ];
  const PLAYER_COLORS = ['#ffe14d', '#7cf6a0', '#ff9de0', '#8fd0ff'];
  const MAX_PLAYERS = 4;

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
    high: 0,
    level: 1,
    dotsLeft: totalDots,
    dotsEaten: 0,
    combo: 0,
    frightTimer: 0,
    frightTotal: 0,
    mode: 'scatter',
    modeIndex: 0,
    modeTimer: MODE_PLAN[0][1],
    bonus: null,
    bonusGiven: 0,
    shake: 0,
    flash: 0,
    manual: false,
    players: [],
    localIndex: 0,
    ghosts: [],
    particles: [],
    floats: [],
    frame: 0,
    /* multiplayer */
    mode2: 'solo',         // solo | host | guest
    net: null,             // the NeonNet session, when online
    netStatus: 'offline',  // offline | connecting | lobby | live | lost
    netPing: 0,
    netName: '',
    roomCode: null,
    race: false,           // more than one disc on the board
    lastSnapAt: 0,
    startedAt: 0,
  };

  /** The disc this client steers. In solo it is the only one. */
  const local = () => game.players[game.localIndex] || game.players[0] || { score: 0, lives: 0 };

  // Solo code (and the tests) read game.score / game.lives as the local
  // player's numbers; keep that working now that every player keeps its own.
  Object.defineProperty(game, 'score', {
    get: () => local().score,
    set: (v) => { local().score = v; },
    enumerable: true,
  });
  Object.defineProperty(game, 'lives', {
    get: () => local().lives,
    set: (v) => { local().lives = v; },
    enumerable: true,
  });
  Object.defineProperty(game, 'wantDir', {
    get: () => (local().wantDir || 'left'),
    set: (v) => { local().wantDir = v; },
    enumerable: true,
  });
  Object.defineProperty(game, 'player', {
    // the old single-player name for "the disc you steer"
    get: () => local(),
    enumerable: false,
  });

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
    scores: document.getElementById('scores'),
    net: document.getElementById('net-badge'),
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

  function makePlayer(index, opts) {
    const o = opts || {};
    const spawn = o.spawn || SPAWNS[index % SPAWNS.length];
    return {
      id: o.id || 'local',
      name: o.name || 'You',
      color: o.color || PLAYER_COLORS[index % PLAYER_COLORS.length],
      tx: spawn.x, ty: spawn.y, dir: 'left', p: 0,
      anim: 0, moving: true, isPlayer: true,
      isLocal: !!o.isLocal,
      score: 0, lives: 3, extraLife: false,
      out: false, dead: false, respawnT: 0, invuln: 0,
      wantDir: 'left',
      /* guest-side smoothing of the host's snapshots */
      rx: null, ry: null, netDir: 'left',
    };
  }

  /* Which disc is this object? (used by the net layer and the renderer) */
  const playerById = (id) => game.players.find((p) => p.id === id) || null;

  function makeHunter(def) {
    return {
      def, name: def.name, color: def.color, glow: def.glow,
      tx: def.start.x, ty: def.start.y, dir: 'left', p: 0,
      state: def.inside ? 'pen' : 'roam',
      releaseTimer: def.release,
      frightened: false, pendingReverse: false,
      bounce: rand() * Math.PI * 2, anim: 0,
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
  function updatePlayer(P, dt, canEat) {
    const want = P.wantDir;

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
      // Guests only predict movement; the host owns pellets and points.
      if (canEat !== false) eatAt(m.tx, m.ty, P);
      const w = P.wantDir;
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

  /** Move every disc on the board. Dead and finished discs stay put. */
  function updatePlayers(dt) {
    for (const P of game.players) {
      if (P.out || P.dead) continue;
      updatePlayer(P, dt);
    }
  }

  /* ==================================================================
     7. UPDATE — the hunters
     ================================================================== */
  /** Who is closest to this hunter? (dead discs do not count) */
  function nearestPlayer(from) {
    let best = null;
    let bestD = Infinity;
    for (const P of game.players) {
      if (P.out || P.dead) continue;
      const d = Math.hypot(P.tx - from.tx, P.ty - from.ty);
      if (d < bestD) { bestD = d; best = P; }
    }
    return best || game.players[0] || null;
  }

  function anyPlayerAlive() {
    return game.players.some((p) => !p.out);
  }

  function hunterTarget(h) {
    const P = nearestPlayer(h) || game.players[0];
    if (!P) return h.def.corner;
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
      return options[(rand() * options.length) | 0];
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
  /** Points go to the disc that earned them. */
  function addScore(n, who) {
    const P = who || local();
    const before = P.score;
    P.score += n;
    if (!P.extraLife && before < 10000 && P.score >= 10000) {
      P.extraLife = true;
      P.lives++;
      if (P.isLocal) Sound.extraLife();
      if (P.isLocal) floatText(W / 2, 8 * TILE, 'EXTRA LIFE!', '#8ef7a0', 22);
    }
    if (P.isLocal && P.score > game.high) {
      game.high = P.score;
      saveHigh();
    }
    if (P.isLocal) paintHud();
    if (game.mode2 === 'host') netSend({ t: 'score', id: P.id, s: P.score, lives: P.lives });
  }

  function eatAt(x, y, who) {
    const P = who || local();
    const i = idx(x, y);
    if (dots[i] === DOT) {
      dots[i] = NO_DOT;
      game.dotsLeft--;
      game.dotsEaten++;
      addScore(10, P);
      if (P.isLocal) Sound.waka();
      if (game.dotsEaten % 7 === 0) sparkle((x + 0.5) * TILE, (y + 0.5) * TILE, '#ffd9a0', 3);
      maybeBonus();
    } else if (dots[i] === ORB) {
      dots[i] = NO_DOT;
      game.dotsLeft--;
      game.dotsEaten++;
      addScore(50, P);
      if (P.isLocal) Sound.power();
      startFright();
      burst((x + 0.5) * TILE, (y + 0.5) * TILE, '#bff3ff', 22);
      game.flash = 0.35;
      game.shake = 0.35;
      maybeBonus();
    }

    if (game.bonus && game.bonus.x === x && game.bonus.y === y) {
      addScore(game.bonus.value, P);
      floatText((x + 0.5) * TILE, (y + 0.5) * TILE, '+' + game.bonus.value, '#ffe14d', 20);
      burst((x + 0.5) * TILE, (y + 0.5) * TILE, '#ffe14d', 20);
      if (P.isLocal) Sound.eatHunter(1);
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

  function eatHunter(h, who) {
    const P = who || local();
    const value = 200 * Math.pow(2, game.combo);
    game.combo = Math.min(game.combo + 1, 3);
    h.frightened = false;
    h.state = 'dead';
    h.p = 0;
    const pos = moverPos(h);
    addScore(value, P);
    floatText(pos.x, pos.y, String(value), '#8ef0ff', 21);
    burst(pos.x, pos.y, h.color, 26);
    game.shake = 0.3;
    if (P.isLocal) Sound.eatHunter(game.combo);
    if (game.mode2 === 'host') netSend({ t: 'fx', kind: 'eatHunter', x: pos.x, y: pos.y, v: value, name: P.name });
  }

  function catchPlayer(P) {
    if (game.state !== 'playing' || P.out || P.dead || P.invuln > 0) return;
    P.lives--;
    const pos = moverPos(P);
    burst(pos.x, pos.y, P.color, 30);
    if (P.isLocal) {
      game.shake = 0.8;
      Sound.death();
      paintHud();
    } else if (game.mode2 === 'host') {
      netSend({ t: 'fx', kind: 'caught', x: pos.x, y: pos.y, id: P.id, name: P.name });
    }

    if (!game.race && game.players.length === 1) {
      // Solo keeps the classic beat: the board freezes for the death jingle
      // and afterDeath() decides between respawn and game over.
      game.state = 'dying';
      game.deathT = 0;
      game.frightTimer = 0;
      game.combo = 0;
      for (const h of game.ghosts) h.frightened = false;
      return;
    }

    // A race cannot pause for one disc: it puffs out and comes back — unless
    // that was its last life, in which case it spectates.
    if (P.lives <= 0) {
      P.out = true;
      P.dead = false;
      if (P.isLocal) paintHud();
      if (!anyPlayerAlive()) endRound('all-out');
    } else {
      P.dead = true;
      P.respawnT = 2.2;
      P.p = 0;
    }
  }

  function checkCatch() {
    for (const P of game.players) {
      if (P.out || P.dead || P.invuln > 0) continue;
      const pp = moverPos(P);
      for (const h of game.ghosts) {
        if (h.state === 'dead' || h.state === 'entering' || h.state === 'pen') continue;
        const hp = moverPos(h);
        if (Math.hypot(hp.x - pp.x, hp.y - pp.y) < TILE * 0.62) {
          if (h.frightened) eatHunter(h, P);
          else { catchPlayer(P); }
          break;
        }
      }
      if (game.state !== 'playing') return;
    }
  }

  function clearLevel() {
    game.state = 'levelclear';
    game.stateTimer = game.race ? 3.6 : 2.6;
    game.flash = 0.5;
    addScore(250 + 50 * game.level, local());
    if (game.mode2 !== 'guest') Sound.levelUp();
    if (game.race) showScreen('standings');
  }

  /** The race is over: everyone is out, or the board is clear and we stop. */
  function endRound(why) {
    game.state = 'gameover';
    game.roundWhy = why;
    if (game.mode2 === 'host') netSend({ t: 'over', why: why });
    Sound.gameOver();
    showScreen('standings');
  }

  function afterDeath() {
    if (game.lives <= 0) {
      game.state = 'gameover';
      if (game.players[0]) game.players[0].out = true;
      Sound.gameOver();
      showScreen('gameover');
      return;
    }
    // Keep the disc (and its score): only the positions are reset.
    resetActors(true);
    game.state = 'ready';
    game.stateTimer = 1.9;
  }

  /* ==================================================================
     9. MODE TIMER (scatter ⇄ chase) + per-frame systems
     ================================================================== */
  /** Bring dead racers back after their puff of smoke. */
  function updateRespawns(dt) {
    for (const P of game.players) {
      if (!P.dead) continue;
      P.respawnT -= dt;
      if (P.respawnT > 0) continue;
      const spawn = SPAWNS[game.players.indexOf(P) % SPAWNS.length];
      P.dead = false;
      P.tx = spawn.x;
      P.ty = spawn.y;
      P.p = 0;
      P.dir = 'left';
      P.invuln = 1.4;
      P.rx = null;
      P.ry = null;
    }
  }

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
      const a = rand() * Math.PI * 2;
      const s = 60 + rand() * 190;
      game.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.35 + rand() * 0.5, max: 0.85,
        size: 1.6 + rand() * 2.6, color,
      });
    }
  }

  function sparkle(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
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
    game.frame++;
    for (const P of game.players) if (P.invuln > 0) P.invuln -= dt;

    switch (game.state) {
      case 'ready':
        game.stateTimer -= dt;
        for (const h of game.ghosts) if (h.state === 'pen') h.bounce += dt * 5.5;
        if (game.stateTimer <= 0) game.state = 'playing';
        break;

      case 'playing':
        if (isGuest()) {
          updateGuest(dt);
          break;
        }
        if (game.race && !anyPlayerAlive()) { endRound('all-out'); break; }
        updateMode(dt);
        if (game.frightTimer > 0) {
          game.frightTimer -= dt;
          if (local().isLocal || game.mode2 !== 'guest') Sound.fright();
          if (game.frightTimer <= 0) endFright();
        }
        updatePlayers(dt);
        for (const h of game.ghosts) updateHunter(h, dt);
        checkCatch();
        updateBonus(dt);
        updateRespawns(dt);
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

    if (isHost()) {
      const changed = game.state !== game.lastState;
      game.lastState = game.state;
      broadcastSnapshot(changed);
    }
  }

  /** A guest does not simulate: it predicts its own disc and smooths the rest. */
  function updateGuest(dt) {
    const P = local();
    if (P && P.isLocal && !P.dead && !P.out) updatePlayer(P, dt, false);
    updateNetSmoothing(dt);
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

  /** Where this entity should be drawn right now. */
  function drawPos(e, time) {
    if (e.rx != null && e.ry != null) return { x: e.rx, y: e.ry };
    void time;
    return moverPos(e);
  }

  function drawPlayer(P, time) {
    if (P.out) return;
    const isLocal = P.isLocal;
    const pos = drawPos(P, time);
    const r = TILE * 0.46;
    const dir = P.rx != null ? (P.netDir || P.dir) : P.dir;
    const [dx, dy] = DIRS[dir] || [0, 0];
    const angle = Math.atan2(dy, dx);
    const colour = P.color || '#ffe14d';

    let half; // mouth half-angle in radians
    let alpha = 1;
    const dyingSolo = isLocal && game.state === 'dying';
    if (dyingSolo) {
      const k = Math.min(1, game.deathT / 1.35);
      half = k * Math.PI;
      alpha = 1 - Math.max(0, (game.deathT - 1.35) / 0.4);
      if (alpha <= 0) return;
    } else if (P.dead) {
      // puffed out on the spot, about to respawn
      const k = Math.min(1, 1 - P.respawnT / 2.2);
      half = k * Math.PI * 0.5;
      alpha = 0.85;
    } else if (game.state === 'ready' && isLocal) {
      half = 0.22;
    } else if (!P.moving && P.rx == null) {
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
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    // inner shine
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    ctx.restore();

    // name tags for the other discs in a race
    if (game.race && !isLocal) {
      const label = String(P.name || '').slice(0, 10);
      const tagX = Math.max(24, Math.min(W - 24, pos.x));
      const tagY = Math.max(12, pos.y - TILE * 0.6);
      ctx.save();
      ctx.font = '700 10px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4,5,12,0.85)';
      ctx.strokeText(label, tagX, tagY);
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.95;
      ctx.fillText(label, tagX, tagY);
      ctx.restore();
    }
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
    let pos;
    if (h.rx != null && h.ry != null) {
      // a guest renders the host's positions, smoothed
      pos = { x: h.rx, y: h.ry };
      if (h.state === 'pen') pos.y += Math.sin(h.bounce) * 4;
    } else if (h.state === 'pen') {
      pos = { x: (h.tx + 0.5) * TILE, y: (h.ty + 0.5) * TILE + Math.sin(h.bounce) * 4 };
    } else {
      pos = moverPos(h);
    }
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
      ctx.translate((rand() - 0.5) * s, (rand() - 0.5) * s);
    }

    if (mazeLayer) ctx.drawImage(mazeLayer, 0, 0, W, H);
    drawDots(time);
    drawBonus();

    const hideActors = game.state === 'title' || game.state === 'gameover';
    if (!hideActors) {
      for (const h of game.ghosts) drawHunter(h, time);
      for (const P of game.players) drawPlayer(P, time);
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
  /** Rebuild the discs for a fresh round, keeping names/colours/online ids. */
  function resetActors(preservePlayers) {
    const keep = preservePlayers ? game.players : null;
    if (keep && keep.length) {
      keep.forEach((P, i) => {
        const spawn = SPAWNS[i % SPAWNS.length];
        P.tx = spawn.x;
        P.ty = spawn.y;
        P.p = 0;
        P.dir = 'left';
        P.wantDir = 'left';
        P.dead = false;
        P.out = false;
        P.invuln = game.race ? 1 : 0;   // spawn protection is a race courtesy
        P.respawnT = 0;
        P.rx = null;
        P.ry = null;
        P.anim = 0;
      });
      game.players = keep;
    } else {
      game.players = [makePlayer(0, { id: 'local', name: game.netName || 'You', isLocal: true })];
      game.localIndex = 0;
    }
    game.ghosts = HUNTERS.map(makeHunter);
    game.bonus = null;
    game.particles.length = 0;
    game.floats.length = 0;
    endFright();
  }

  function newLevel(keepPlayers) {
    dots.set(baseDots);
    game.dotsLeft = totalDots;
    game.dotsEaten = 0;
    game.bonusGiven = 0;
    game.mode = 'scatter';
    game.modeIndex = 0;
    game.modeTimer = Math.max(3, MODE_PLAN[0][1] * (1 - (game.level - 1) * 0.09));
    game.roundWhy = null;
    resetActors(keepPlayers);
    buildMazeLayer();
    game.state = 'ready';
    game.stateTimer = 2.1;
    game.flash = 0.25;
    paintHud();
  }

  /** Solo game (and the tests): one disc, three lives, score from zero. */
  function startGame() {
    game.mode2 = 'solo';
    game.race = false;
    game.roomCode = null;
    game.players = [];
    game.localIndex = 0;
    resetActors(false);
    game.score = 0;
    game.level = 1;
    game.lives = 3;
    local().extraLife = false;
    game.combo = 0;
    game.high = Math.max(game.high, 0);
    hideOverlay();
    newLevel(false);
  }

  /** Multiplayer round: every connected disc, fresh scores. */
  function startRace(level) {
    game.race = game.players.length > 1;
    game.level = level || 1;
    game.combo = 0;
    for (const P of game.players) {
      P.score = 0;
      P.lives = 3;
      P.extraLife = false;
      P.out = false;
      P.dead = false;
    }
    game.localIndex = Math.max(0, game.players.findIndex((P) => P.isLocal));
    hideOverlay();
    newLevel(true);
    if (game.mode2 === 'host') {
      netSend({ t: 'start', level: game.level, players: playerRoster() });
      netSend(snapshot());
    }
  }

  function togglePause() {
    if (online()) {
      // Nobody can pause a live race: this is a local menu instead.
      if (overlay.classList.contains('show')) hideOverlay();
      else showScreen('menu');
      return;
    }
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
     12b. NETWORK PLAY
     ------------------------------------------------------------------
     The host's browser owns the truth: it simulates the maze, the
     hunters and every disc, and streams snapshots ~12 times a second.
     Guests send their input and smooth the host's positions, predicting
     their own disc so the controls feel local.

     The server only relays messages between the players in a room; see
     src/net.js for the wire protocol and server.js for the relay.
     ================================================================== */
  const HSTATE = ['pen', 'leaving', 'roam', 'dead', 'entering'];
  const round10 = (n) => Math.round(n * 10) / 10;
  const round20 = (n) => Math.round(n * 20) / 20;

  const netAvailable = () => !!(typeof window !== 'undefined' && window.NeonNet);
  const online = () => game.mode2 === 'host' || game.mode2 === 'guest';
  const isHost = () => game.mode2 === 'host';
  const isGuest = () => game.mode2 === 'guest';

  /* ---------------- sending ---------------- */
  function netSend(data) {
    if (!game.net) return;
    game.net.send(Object.assign({ t: 'relay' }, { data }));
  }

  /* ---------------- the dot grid as a bitmask ---------------- */
  function dotMask() {
    const bytes = new Uint8Array(Math.ceil((COLS * ROWS) / 8));
    for (let i = 0; i < COLS * ROWS; i++) {
      if (dots[i]) bytes[i >> 3] |= 1 << (i & 7);
    }
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }

  function applyDotMask(b64) {
    let raw;
    try { raw = atob(b64); } catch (err) { return; }
    let left = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      const on = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
      dots[i] = on ? (baseDots[i] || DOT) : NO_DOT;
      if (on) left++;
    }
    game.dotsLeft = left;
  }

  function playerRoster() {
    return game.players.map((P, i) => ({
      id: P.id,
      name: P.name,
      color: P.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
      index: i,
    }));
  }

  /* ---------------- host: build a snapshot ---------------- */
  function snapshot() {
    return {
      t: 's',
      f: game.frame,
      st: game.state,
      stt: round20(game.stateTimer),
      lv: game.level,
      ft: round20(game.frightTimer),
      mo: game.mode,
      rs: game.race ? 1 : 0,
      p: game.players.map((P) => {
        const pos = moverPos(P);
        return [
          P.id, round10(pos.x), round10(pos.y), DIR_LIST.indexOf(P.dir) < 0 ? 0 : DIR_LIST.indexOf(P.dir),
          Math.round(P.anim * 20) % 1000, P.score, P.lives,
          (P.out ? 4 : 0) | (P.dead ? 2 : 0) | (P.invuln > 0 ? 1 : 0),
          P.name,
        ];
      }),
      g: game.ghosts.map((h) => {
        const pos = moverPos(h);
        return [round10(pos.x), round10(pos.y), Math.max(0, DIR_LIST.indexOf(h.dir)), Math.max(0, HSTATE.indexOf(h.state)), h.frightened ? 1 : 0];
      }),
      d: dotMask(),
      b: game.bonus ? [game.bonus.x, game.bonus.y] : 0,
    };
  }

  function broadcastSnapshot(force) {
    if (!isHost() || !game.net) return;
    const now = game.time;
    if (!force && now - game.lastSnapAt < 1 / 12) return;
    game.lastSnapAt = now;
    netSend(snapshot());
  }

  /* ---------------- guest: apply a snapshot ---------------- */
  function applySnapshot(S) {
    if (!S || !S.p) return;
    game.frame = S.f || game.frame;

    // the host drives the state machine (never override a local pause)
    if (S.st && S.st !== game.state && game.state !== 'paused') {
      const prev = game.state;
      game.state = S.st;
      if (S.st === 'playing' && prev !== 'playing') hideOverlay();
      if (S.st === 'levelclear' || S.st === 'gameover') showScreen('standings');
    }
    if (typeof S.stt === 'number') game.stateTimer = S.stt;
    if (S.lv) game.level = S.lv;
    game.mode = S.mo || game.mode;
    const hadFright = game.frightTimer > 0;
    game.frightTimer = typeof S.ft === 'number' ? S.ft : 0;
    if (!hadFright && game.frightTimer > 0) {
      // a power orb went off somewhere: flash for everyone
      game.flash = 0.3;
      Sound.power();
    }
    game.race = !!S.rs;

    // discs
    const seen = [];
    for (const row of S.p) {
      const [id, x, y, dirIdx, anim, score, lives, flags, name] = row;
      seen.push(id);
      let P = playerById(id);
      if (!P) {
        P = makePlayer(game.players.length, { id, name: name || 'Disc', isLocal: id === game.net.selfId });
        P.score = score;
        P.lives = lives;
        game.players.push(P);
        game.localIndex = Math.max(0, game.players.findIndex((q) => q.isLocal));
      }
      P.name = name || P.name;
      P.score = score;
      P.lives = lives;
      if (P.isLocal && score > game.high) { game.high = score; saveHigh(); }
      P.out = !!(flags & 4);
      P.dead = !!(flags & 2);
      P.invuln = (flags & 1) ? 0.5 : 0;
      const dir = DIR_LIST[dirIdx] || P.dir;
      P.netDir = dir;
      if (P.isLocal) {
        // I simulate my own disc; only correct it when we have drifted apart
        const mine = moverPos(P);
        const dist = Math.hypot(mine.x - x, mine.y - y);
        if (dist > TILE * 1.2 || P.dead || P.out) {
          snapTo(P, x, y, dir);
        }
      } else {
        P.tgtX = x;
        P.tgtY = y;
        if (P.rx == null) { P.rx = x; P.ry = y; }
        P.dir = dir;
        P.anim += anim * 0.0001;
      }
    }
    // drop discs the host no longer knows about
    if (seen.length) game.players = game.players.filter((P) => seen.includes(P.id));

    // hunters
    S.g.forEach((row, i) => {
      const h = game.ghosts[i];
      if (!h) return;
      const [x, y, dirIdx, stateIdx, frightened] = row;
      h.tgtX = x;
      h.tgtY = y;
      if (h.rx == null) { h.rx = x; h.ry = y; }
      h.dir = DIR_LIST[dirIdx] || h.dir;
      h.state = HSTATE[stateIdx] || h.state;
      h.frightened = !!frightened;
    });

    applyDotMask(S.d);
    game.bonus = S.b && S.b.length ? { x: S.b[0], y: S.b[1], life: 6, value: 100, spin: game.time * 2 } : null;
    paintHud();
  }

  /**
   * Hard-place a guest's disc (spawn, death, or a big correction).
   * moverPos() is (tile + 0.5 + dir * p) * TILE, so invert that exactly:
   * for a rightward mover p is how far past the centre we are, and so on.
   */
  function snapTo(P, x, y, dir) {
    const d = DIRS[dir] ? dir : P.dir;
    const fx = x / TILE;
    const fy = y / TILE;
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    P.tx = wrapX(tx);
    P.ty = Math.max(0, Math.min(ROWS - 1, ty));
    let prog;
    if (d === 'right') prog = fx - tx - 0.5;
    else if (d === 'left') prog = tx + 0.5 - fx;
    else if (d === 'down') prog = fy - ty - 0.5;
    else prog = ty + 0.5 - fy;
    P.p = Math.max(0, Math.min(1, prog));
    P.dir = d;
    P.rx = null;
    P.ry = null;
    P.moving = true;
  }

  /* ---------------- guest: smooth everyone else ---------------- */
  function updateNetSmoothing(dt) {
    const k = Math.min(1, dt * 14);
    for (const P of game.players) {
      if (P.rx == null || P.tgtX == null) continue;
      P.rx += (P.tgtX - P.rx) * k;
      P.ry += (P.tgtY - P.ry) * k;
      P.moving = true;
      P.anim += dt;
    }
    for (const h of game.ghosts) {
      if (h.rx != null && h.tgtX != null) {
        h.rx += (h.tgtX - h.rx) * k;
        h.ry += (h.tgtY - h.ry) * k;
      }
      h.anim += dt;
      if (h.state === 'pen') h.bounce += dt * 5.5;
    }
  }

  /* ---------------- guest: effects from the host ---------------- */
  function applyFx(m) {
    switch (m.kind) {
      case 'eatHunter':
        floatText(m.x, m.y, String(m.v), '#8ef0ff', 21);
        burst(m.x, m.y, '#9fe9ff', 24);
        Sound.eatHunter(1);
        break;
      case 'caught':
        burst(m.x, m.y, '#ffdf7a', 26);
        game.shake = 0.5;
        if (m.id !== game.net.selfId) Sound.pen();
        break;
      case 'bonus':
        floatText(m.x, m.y, '+' + m.v, '#ffe14d', 20);
        burst(m.x, m.y, '#ffe14d', 20);
        break;
      case 'clear':
        Sound.levelUp();
        break;
      default:
        break;
    }
  }

  /* ---------------- session plumbing ---------------- */
  function netStatusText() {
    switch (game.netStatus) {
      case 'connecting': return 'connecting…';
      case 'lobby': return 'in lobby';
      case 'live': return 'live';
      case 'lost': return 'disconnected';
      default: return 'offline';
    }
  }

  /** Open a session to the relay and run `then` once we are welcome. */
  function openSession(url, then) {
    if (!netAvailable()) {
      game.netStatus = 'offline';
      showScreen('online', 'This browser has no WebSocket support, so online play is unavailable.');
      return;
    }
    if (game.net) game.net.shutdown();
    game.netStatus = 'connecting';
    const name = (game.netName || window.NeonNet.randomName()).slice(0, 14);
    game.netName = name;
    saveName(name);
    game.net = window.NeonNet.createSession({
      url,
      name,
      onEvent: handleNetEvent,
    });
    game.pendingAction = then || null;
    if (!game.net.open()) {
      game.netStatus = 'offline';
      showScreen('online', 'Could not reach that server.');
    } else if (onlineScreenVisible()) {
      showScreen('online');
    }
  }

  function onlineScreenVisible() {
    return overlay.classList.contains('show') && /Play online|Host a game/i.test(overlay.innerHTML || '');
  }

  function handleNetEvent(ev) {
    switch (ev.type) {
      case 'open':
        game.netOpened = true;
        game.netStatus = 'lobby';
        paintHud();
        if (game.pendingAction === 'host') { game.pendingAction = null; game.net.host(); }
        else if (game.pendingAction === 'join') {
          const code = game.pendingCode;
          game.pendingAction = null;
          game.net.join(code);
        }
        break;

      case 'room': {
        game.roomCode = ev.code;
        game.netStatus = 'lobby';
        game.mode2 = ev.host ? 'host' : 'guest';
        game.hostId = (ev.peers.find((p) => p.host) || {}).id || (ev.host ? game.net.selfId : null);
        if (!ev.host) netSend({ t: 'hello', name: game.netName });
        if (ev.host) {
          // the host's own disc, then a seat for each guest
          game.players = [makePlayer(0, { id: game.net.selfId, name: game.netName || 'Host', isLocal: true })];
          game.localIndex = 0;
          syncPlayersToPeers(ev.peers);
        }
        paintHud();
        showScreen('lobby');
        break;
      }

      case 'peers':
        game.hostId = (ev.peers.find((p) => p.host) || {}).id || game.hostId;
        if (isHost()) syncPlayersToPeers(ev.peers);
        if (game.state === 'title' || overlay.classList.contains('show')) showScreen('lobby');
        paintHud();
        break;

      case 'data': {
        const m = ev.data || {};
        if (isHost()) hostHandleData(ev.from, m);
        else guestHandleData(m);
        break;
      }

      case 'ping':
        game.netPing = ev.ms;
        paintHud();
        break;

      case 'error':
        game.netStatus = 'offline';
        game.mode2 = 'solo';
        showScreen('online', errorText(ev.why));
        break;

      case 'ended':
        game.netStatus = 'lost';
        game.mode2 = 'solo';
        game.race = false;
        if (game.state === 'playing' || game.state === 'ready') {
          game.state = 'paused';
          showScreen('lost', ev.why === 'host-left' ? 'The host left the race.' : 'The room closed.');
        } else {
          showScreen('lost', ev.why === 'host-left' ? 'The host left the room.' : 'The room closed.');
        }
        paintHud();
        break;

      case 'closed':
        if (game.netStatus === 'lost') break;
        if (!game.netOpened) {
          // never connected at all: that is a connect failure, not a drop
          game.netStatus = 'offline';
          game.mode2 = 'solo';
          showScreen('online', connectHelp());
          break;
        }
        game.netStatus = 'lost';
        game.mode2 = 'solo';
        game.race = false;
        game.state = game.state === 'playing' ? 'paused' : game.state;
        showScreen('lost', 'Lost the connection to the server.');
        paintHud();
        break;

      default:
        break;
    }
  }

  /** Why a connection failed, and the shortest route to fixing it. */
  function connectHelp() {
    const here = typeof location !== 'undefined' ? location : null;
    const https = here && here.protocol === 'https:';
    if (https) {
      return 'Could not open a live connection here. A page served over https:// can only reach ' +
        'a secure server: run <code>node server.js</code> behind a tunnel that terminates TLS ' +
        '(Cloudflare Tunnel, ngrok, Caddy…) and paste its wss:// address below.';
    }
    return 'Could not reach a game server. Start one with <code>node server.js</code> on any ' +
      'machine, then enter its address below (for example ws://192.168.1.20:3000).';
  }

  function errorText(why) {
    switch (why) {
      case 'no-room': return 'No room with that code. Check the letters and try again.';
      case 'full': return 'That room is full (four discs is the limit).';
      case 'already': return 'You are already in that room.';
      case 'connect': return connectHelp();
      case 'no-server': return 'Enter the address of a game server first.';
      default: return 'Something went wrong talking to the server.';
    }
  }

  /** Host: make sure every peer has a disc, and every disc has a peer. */
  function syncPlayersToPeers(peers) {
    const ids = peers.map((p) => p.id);
    for (const peer of peers) {
      if (peer.id === game.net.selfId) continue;
      if (playerById(peer.id)) {
        playerById(peer.id).name = peer.name;
        continue;
      }
      if (game.players.length >= MAX_PLAYERS) continue;
      const P = makePlayer(game.players.length, { id: peer.id, name: peer.name });
      game.players.push(P);
      if (game.state === 'playing' || game.state === 'ready') {
        // dropped in mid-race: fresh disc, no score
        P.score = 0;
        P.lives = 3;
        netSend({ t: 'start', level: game.level, players: playerRoster(), midJoin: true });
        netSend(snapshot());
      } else {
        netSend({ t: 'roster', players: playerRoster() });
      }
    }
    if (game.race) game.players = game.players.filter((P) => P.isLocal || ids.includes(P.id));
    else game.players = game.players.filter((P) => P.isLocal || ids.includes(P.id));
    game.players.forEach((P, i) => {
      if (P.isLocal) return;
      const peer = peers.find((q) => q.id === P.id);
      if (peer) P.name = peer.name;
      void i;
    });
    paintHud();
  }

  /** Host: a message from a guest. */
  function hostHandleData(from, m) {
    const P = playerById(from);
    switch (m.t) {
      case 'input':
        if (P && DIRS[m.d]) P.wantDir = m.d;
        break;
      case 'hello':
        if (P && m.name) P.name = m.name;
        if (game.state === 'playing' || game.state === 'ready') {
          netSend({ t: 'start', level: game.level, players: playerRoster(), midJoin: true });
          netSend(snapshot());
        } else {
          netSend({ t: 'roster', players: playerRoster() });
        }
        break;
      case 'bye':
        if (P) P.out = true;
        break;
      default:
        break;
    }
  }

  /** Guest: a message from the host. */
  function guestHandleData(m) {
    switch (m.t) {
      case 's':
        applySnapshot(m);
        break;
      case 'start': {
        buildPlayersFromRoster(m.players);
        game.mode2 = 'guest';
        game.race = true;
        game.level = m.level || 1;
        hideOverlay();
        game.state = 'ready';
        game.stateTimer = 2.1;
        buildMazeLayer();
        paintHud();
        Sound.levelUp();
        break;
      }
      case 'roster':
        buildPlayersFromRoster(m.players);
        showScreen('lobby');
        break;
      case 'fx':
        applyFx(m);
        break;
      case 'over':
        game.state = 'gameover';
        game.roundWhy = m.why;
        showScreen('standings');
        break;
      default:
        break;
    }
  }

  /** Guest: mirror the host's player list. */
  function buildPlayersFromRoster(roster) {
    if (!roster || !roster.length) return;
    const existing = new Map(game.players.map((P) => [P.id, P]));
    game.players = roster.map((r, i) => {
      const old = existing.get(r.id);
      const P = old || makePlayer(r.index != null ? r.index : i, { id: r.id, name: r.name, isLocal: r.id === game.net.selfId });
      P.name = r.name;
      P.isLocal = r.id === game.net.selfId;
      P.color = r.color || P.color;
      if (!old) {
        P.tx = SPAWNS[i % SPAWNS.length].x;
        P.ty = SPAWNS[i % SPAWNS.length].y;
        P.p = 0;
        P.rx = null;
        P.ry = null;
      }
      return P;
    });
    game.localIndex = Math.max(0, game.players.findIndex((P) => P.isLocal));
  }

  /* ---------------- lobby actions (called by the buttons) ---------------- */
  function hostOnline() {
    game.netName = readName();
    game.pendingAction = 'host';
    const url = resolveServerUrl();
    if (!url) { showScreen('online', 'Enter the address of a game server first.'); return; }
    if (game.net && game.net.connected) { game.pendingAction = null; game.net.host(); return; }
    openSession(url, 'host');
  }

  function joinOnline(code) {
    game.netName = readName();
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (clean.length < 4) { showScreen('online', 'Room codes are four letters.'); return; }
    game.pendingCode = clean;
    game.pendingAction = 'join';
    const url = resolveServerUrl();
    if (!url) { showScreen('online', 'Enter the address of a game server first.'); return; }
    if (game.net && game.net.connected) { game.pendingAction = null; game.net.join(clean); return; }
    openSession(url, 'join');
  }

  function leaveOnline() {
    if (game.net) game.net.shutdown();
    game.net = null;
    game.netStatus = 'offline';
    game.netPing = 0;
    game.mode2 = 'solo';
    game.race = false;
    game.roomCode = null;
    resetActors(false);
    game.state = 'title';
    showScreen('title');
    paintHud();
  }

  function resolveServerUrl() {
    if (!netAvailable()) return '';
    const fromQuery = queryParam('server');
    if (fromQuery) { window.NeonNet.saveUrl(fromQuery); return fromQuery; }
    const saved = loadServerUrl();
    const dflt = window.NeonNet.defaultUrl();
    return saved || dflt || '';
  }

  function queryParam(key) {
    try {
      return new URLSearchParams(location.search).get(key);
    } catch (err) {
      return null;
    }
  }

  function saveName(name) {
    try { localStorage.setItem('neonchase.name', name); } catch (err) { /* ignore */ }
  }
  function readName() {
    const el = overlay.querySelector('#net-name');
    const typed = el && el.value ? el.value.trim().slice(0, 14) : '';
    const name = typed || game.netName || (netAvailable() ? window.NeonNet.randomName() : 'Player');
    game.netName = name;
    saveName(name);
    return name;
  }
  function loadName() {
    try {
      const n = localStorage.getItem('neonchase.name');
      if (n) game.netName = n;
    } catch (err) { /* ignore */ }
    return game.netName;
  }
  function loadServerUrl() {
    try { return localStorage.getItem('neonchase.server') || ''; } catch (err) { return ''; }
  }

  /* ==================================================================
     13. HUD + SCREENS (plain DOM so the text stays crisp)
     ================================================================== */
  function paintHud() {
    ui.score.textContent = game.score.toLocaleString();
    ui.high.textContent = game.high.toLocaleString();
    ui.level.textContent = String(game.level);
    paintScores();
    paintNetBadge();
    if (ui.lives.children.length !== Math.max(0, Math.min(6, game.lives))) {
      ui.lives.innerHTML = '';
      for (let i = 0; i < Math.min(6, Math.max(0, game.lives)); i++) ui.lives.appendChild(document.createElement('i'));
    }
    const paused = game.state === 'paused';
    ui.pause.textContent = paused ? '▶' : '❚❚';
    ui.pause.title = paused ? 'Resume (P)' : 'Pause (P)';
  }

  /** The mini scoreboard that appears once a race has more than one disc. */
  function paintScores() {
    if (!ui.scores) return;
    if (!game.race || game.players.length < 2) {
      ui.scores.hidden = true;
      ui.scores.innerHTML = '';
      return;
    }
    const sorted = game.players.slice().sort((a, b) => b.score - a.score);
    ui.scores.hidden = false;
    ui.scores.innerHTML = sorted.map((P, i) => {
      const cls = [P.isLocal ? 'me' : '', P.out ? 'out' : ''].filter(Boolean).join(' ');
      return `<span class="chip ${cls}"><i style="background:${P.color}"></i>` +
        `<b>${escapeHtml(P.name)}</b><em>${P.score.toLocaleString()}</em>` +
        `<u>${P.out ? '✖' : P.lives}</u>${i === 0 ? '<s>★</s>' : ''}</span>`;
    }).join('');
  }

  function paintNetBadge() {
    if (!ui.net) return;
    if (!online()) {
      ui.net.hidden = true;
      return;
    }
    ui.net.hidden = false;
    const role = isHost() ? 'HOST' : 'GUEST';
    const ping = game.netPing ? `${game.netPing}ms` : '—';
    ui.net.innerHTML = `<b>${game.roomCode || '····'}</b> ${role} · ${game.players.length}/4 · ${ping}` +
      ` <em>${netStatusText()}</em>`;
    ui.net.className = 'badge ' + (game.netStatus === 'live' || game.netStatus === 'lobby' ? 'ok' : 'warn');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** Ranked scoreboard markup, used by the race overlays. */
  function scoreboardMarkup(title, note) {
    const sorted = game.players.slice().sort((a, b) => b.score - a.score);
    const rows = sorted.map((P, i) => {
      const medal = ['🥇', '🥈', '🥉', '4th'][i] || '';
      return `<li class="${P.isLocal ? 'me' : ''}${P.out ? ' out' : ''}">` +
        `<span class="medal">${medal}</span>` +
        `<i style="background:${P.color}"></i>` +
        `<b>${escapeHtml(P.name)}${P.isLocal ? ' (you)' : ''}</b>` +
        `<em>${P.score.toLocaleString()}</em>` +
        `<u>${P.out ? 'spectating' : P.lives + ' ♥'}</u></li>`;
    }).join('');
    return `<div class="scoreboard"><h3>${title}</h3>${note ? `<p class="note">${note}</p>` : ''}<ol>${rows}</ol></div>`;
  }

  function hunterRoster() {
    return HUNTERS.map((h) => `<span><i style="background:${h.color}"></i>${h.name} ${h.note}</span>`).join('');
  }

  function showScreen(kind, note) {
    let html = '';
    if (kind === 'title') {
      const hint = note ? `<p class="note warn">${escapeHtml(note)}</p>` : '';
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
        ${hint}
        <div class="actions">
          <button class="btn" data-act="start">Play solo</button>
          <button class="btn alt" data-act="online">Play online · 1–4 players</button>
        </div>
      </div>`;
    } else if (kind === 'online') {
      const url = resolveServerUrl();
      const fromDisk = !/^https?:$/.test((typeof location !== 'undefined' && location.protocol) || '');
      const saved = loadServerUrl();
      const code = game.pendingCode || queryParam('room') || '';
      html = `<div class="card">
        <h2>PLAY ONLINE</h2>
        <p class="tagline">one maze · up to four discs · race for the top score</p>
        ${note ? `<p class="note warn">${note}</p>` : ''}
        <label class="field"><span>Your name</span>
          <input id="net-name" maxlength="14" autocomplete="off" spellcheck="false"
                 value="${escapeHtml(game.netName || '')}" placeholder="Disc" /></label>
        ${(fromDisk || !url) ? `<label class="field"><span>Game server</span>
          <input id="net-server" autocomplete="off" spellcheck="false"
                 value="${escapeHtml(saved || url || '')}" placeholder="wss://your-server.example" />
          <small>You are playing from a file, so type the address of a Neon Chase server
          (run <code>node server.js</code> on any machine and use its address).</small></label>` : ''}
        <p class="status">${netStatusText()}${url && !fromDisk ? ` · ${escapeHtml(url)}` : ''}</p>
        <div class="actions">
          <button class="btn" data-act="host">Host a room</button>
          <div class="joinrow">
            <input id="join-code" maxlength="4" autocomplete="off" spellcheck="false"
                   placeholder="CODE" value="${escapeHtml(code)}" />
            <button class="btn small" data-act="join">Join</button>
          </div>
          <button class="btn ghost" data-act="title">Back</button>
        </div>
      </div>`;
    } else if (kind === 'lobby') {
      const isHostNow = isHost();
      const link = game.roomCode && window.NeonNet ? window.NeonNet.inviteLink(game.roomCode) : '';
      const list = game.players.map((P) => `<li><i style="background:${P.color}"></i>` +
        `<b>${escapeHtml(P.name)}</b>${P.isLocal ? '<em>you</em>' : ''}` +
        `${P.id === game.hostId ? '<u>host</u>' : ''}</li>`).join('');
      html = `<div class="card">
        <h2>LOBBY</h2>
        <p class="tagline">${isHostNow ? 'you are the host' : 'waiting for the host to start'}</p>
        <div class="codebox">
          <span>ROOM CODE</span>
          <b id="room-code">${escapeHtml(game.roomCode || '····')}</b>
          <button class="btn ghost tiny" data-act="copy">copy invite link</button>
          <p class="link">${escapeHtml(link)}</p>
        </div>
        <ul class="lobbylist">${list}</ul>
        ${note ? `<p class="note warn">${escapeHtml(note)}</p>` : ''}
        <p class="status">${netStatusText()} · ${game.players.length}/4 discs${game.netPing ? ` · ${game.netPing}ms` : ''}</p>
        <div class="actions">
          ${isHostNow ? '<button class="btn" data-act="race">Start race</button>' : '<button class="btn" data-act="start-solo">Play solo instead</button>'}
          <button class="btn ghost" data-act="leave">Leave room</button>
        </div>
      </div>`;
    } else if (kind === 'standings') {
      const justCleared = game.state === 'levelclear';
      const title = justCleared ? `LEVEL ${game.level} CLEAR` : (game.roundWhy === 'all-out' ? 'RACE OVER — EVERYONE WAS CAUGHT' : 'RACE OVER');
      const canContinue = isHost();
      html = `<div class="card wide">
        ${scoreboardMarkup(title, justCleared ? `next level starts in a moment…` : `level ${game.level} · ${game.players.length} discs`)}
        <div class="actions">
          ${justCleared
            ? `<button class="btn" data-act="again">Next level now</button>`
            : (canContinue ? '<button class="btn" data-act="again">Race again</button>'
                           : '<button class="btn ghost" data-act="leave">Leave room</button>')}
          <button class="btn ghost" data-act="leave">Quit to title</button>
        </div>
        <p class="status">${isHost() ? 'you are the host — you drive the race' : 'waiting for the host…'}</p>
      </div>`;
    } else if (kind === 'menu') {
      html = `<div class="card">
        <h2>MENU</h2>
        <p class="tagline">the race keeps running</p>
        <p>Online rounds cannot be paused for everyone — your disc keeps its heading.</p>
        <div class="actions">
          <button class="btn" data-act="resume">Back to the race</button>
          <button class="btn ghost" data-act="leave">Leave room</button>
        </div>
      </div>`;
    } else if (kind === 'lost') {
      html = `<div class="card">
        <h2>DISCONNECTED</h2>
        <p class="tagline">the race is over</p>
        <p>${escapeHtml(note || 'Lost the connection.')}</p>
        <div class="actions">
          <button class="btn" data-act="online">Back to online</button>
          <button class="btn ghost" data-act="title">Title screen</button>
        </div>
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
    const P = local();
    if (P) P.wantDir = d;
    game.wantDir = d;                                  // legacy alias
    if (isGuest()) netSend({ t: 'input', d });         // tell the host
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
    if (k === ' ' || k === 'enter') {
      if (overlay.classList.contains('show') && !/Play solo|race again|next level/i.test(overlay.innerHTML || '')) return;
      e.preventDefault();
      primaryAction();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !online() && (game.state === 'playing' || game.state === 'ready')) togglePause();
  });
  window.addEventListener('blur', () => {
    if (!online() && (game.state === 'playing' || game.state === 'ready')) togglePause();
  });

  overlay.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'start') startGame();
    else if (act === 'resume') { hideOverlay(); if (game.state === 'paused') togglePause(); }
    else if (act === 'title') { game.state = 'title'; game.mode2 = 'solo'; game.race = false; showScreen('title'); resetActors(false); }
    else if (act === 'online') { game.pendingCode = null; showScreen('online'); }
    else if (act === 'host') hostOnline();
    else if (act === 'join') {
      const box = overlay.querySelector('#join-code');
      joinOnline(box ? box.value : '');
    }
    else if (act === 'copy') {
      const link = game.roomCode && window.NeonNet ? window.NeonNet.inviteLink(game.roomCode) : '';
      if (link && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(
          () => showScreen('lobby', 'Invite link copied.'),
          () => showScreen('lobby', 'Copy failed — the link is shown above.'));
      } else {
        showScreen('lobby', 'Copy the link shown above.');
      }
    }
    else if (act === 'race' || act === 'again') {
      if (!isHost()) return;
      startRace(game.state === 'levelclear' ? game.level + 1 : 1);
    }
    else if (act === 'start-solo') { startGame(); }
    else if (act === 'leave') { leaveOnline(); }
  });

  // typing a room code and hitting enter should just join
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t && t.id === 'join-code') joinOnline(t.value);
    else if (t && t.id === 'net-server') {
      if (window.NeonNet) window.NeonNet.saveUrl(t.value.trim());
      showScreen('online');
    }
  });
  overlay.addEventListener('input', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'net-server' && window.NeonNet) window.NeonNet.saveUrl(t.value.trim());
    if (t.id === 'net-name') { game.netName = t.value.trim().slice(0, 14); }
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
    loadName();
    resetActors(false);
    layout();
    paintHud();
    showScreen('title');
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) dpad.hidden = false;

    // ?room=CODE — the link a host shares should drop you straight into the lobby
    const room = netAvailable() && window.NeonNet.roomFromUrl();
    if (room) {
      game.pendingCode = room;
      showScreen('online', `Joining room ${room}…`);
      joinOnline(room);
    }
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
    /* multiplayer, for tests and tooling */
    online,
    isHost,
    isGuest,
    hostOnline,
    joinOnline,
    leaveOnline,
    startRace,
    snapshot,
    applySnapshot,
    handleNetEvent,
    netSend,
    playerById,
    screen: showScreen,
    setRng,
  };

  boot();
})();
