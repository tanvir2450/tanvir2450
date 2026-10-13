// Validates the maze layout used by src/game.js
// Usage: node tools/maze-check.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');

const m = src.match(/const MAZE = \[([\s\S]*?)\];/);
if (!m) {
  console.error('Could not find MAZE array in src/game.js');
  process.exit(1);
}
const maze = m[1]
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('"') || l.startsWith("'") || l.startsWith('`'))
  .map((l) => {
    const q = l[0];
    return l.slice(1, l.lastIndexOf(q));
  });

const ROWS = maze.length;
const COLS = maze[0].length;
const errors = [];
const warnings = [];

maze.forEach((r, i) => {
  if (r.length !== COLS) errors.push(`row ${i} has length ${r.length}, expected ${COLS}`);
});

// allowed characters
const allowed = new Set(['#', '.', 'o', ' ', '-']);
maze.forEach((r, y) =>
  [...r].forEach((ch, x) => {
    if (!allowed.has(ch)) errors.push(`bad char "${ch}" at (${x},${y})`);
  })
);

// horizontal symmetry (col c must equal col COLS-1-c)
maze.forEach((r, y) => {
  for (let x = 0; x < COLS; x++) {
    if (r[x] !== r[COLS - 1 - x]) {
      errors.push(`row ${y} not horizontally symmetric at x=${x} ("${r[x]}" vs "${r[COLS - 1 - x]}")`);
      break;
    }
  }
});

const isWall = (x, y) => {
  if (y < 0 || y >= ROWS) return true;
  if (x < 0 || x >= COLS) return false; // off-grid horizontally = tunnel space (only open rows allow it)
  return maze[y][x] === '#';
};
const walkable = (x, y, ghost = false) => {
  if (y < 0 || y >= ROWS) return false;
  if (x < 0 || x >= COLS) return false;
  const ch = maze[y][x];
  if (ch === '#') return false;
  if (ch === '-' && !ghost) return false;
  return true;
};

// flood fill from the player spawn tile, through non-wall tiles (door counts as wall for the player)
const start = [13, 23];
if (isWall(start[0], start[1])) errors.push(`player spawn (${start}) is inside a wall`);
const seen = new Set();
const q = [start];
seen.add(start.join(','));
const dirs = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
while (q.length) {
  const [x, y] = q.shift();
  for (const [dx, dy] of dirs) {
    let nx = x + dx;
    const ny = y + dy;
    if (nx < 0) nx = COLS - 1;
    if (nx >= COLS) nx = 0;
    if (ny < 0 || ny >= ROWS) continue;
    if (!walkable(nx, ny)) continue;
    const k = nx + ',' + ny;
    if (seen.has(k)) continue;
    seen.add(k);
    q.push([nx, ny]);
  }
}

let pellets = 0;
let orbs = 0;
let openTiles = 0;
maze.forEach((r, y) =>
  [...r].forEach((ch, x) => {
    if (ch === '.') pellets++;
    if (ch === 'o') orbs++;
    if (ch !== '#') openTiles++;
  })
);

// every pellet/orb must be reachable by the player
maze.forEach((r, y) =>
  [...r].forEach((ch, x) => {
    if ((ch === '.' || ch === 'o') && !seen.has(x + ',' + y)) errors.push(`unreachable pellet at (${x},${y})`);
  })
);

// count unreachable walkable tiles (the ghost pen interior is meant to be sealed off)
let unreachable = [];
maze.forEach((r, y) =>
  [...r].forEach((ch, x) => {
    if (ch === '#' || ch === '-') return;
    if (x >= 10 && x <= 17 && y >= 12 && y <= 16) return; // pen interior + mouth
    if (!seen.has(x + ',' + y)) unreachable.push(`${x},${y}`);
  })
);
if (unreachable.length > 6) warnings.push(`${unreachable.length} tiles not reachable by the player: ${unreachable.slice(0, 12).join(' ')}`);

// dead ends (tiles with exactly one open neighbour) - a maze with none plays better for chase games.
// Horizontal neighbours wrap around the tunnel, and the pen interior is ignored.
const penBox = (x, y) => x >= 10 && x <= 17 && y >= 12 && y <= 16;
let deadEnds = [];
maze.forEach((r, y) =>
  [...r].forEach((ch, x) => {
    if (ch === '#' || ch === '-') return;
    if (penBox(x, y)) return;
    let n = 0;
    for (const [dx, dy] of dirs) {
      const nx = x + dx < 0 ? COLS - 1 : x + dx >= COLS ? 0 : x + dx;
      if (walkable(nx, y + dy, true)) n++;
    }
    if (n <= 1) deadEnds.push(`${x},${y}`);
  })
);
if (deadEnds.length) warnings.push(`${deadEnds.length} dead-end tiles: ${deadEnds.slice(0, 12).join(' ')}`);

// ghost house checks
const house = { x0: 10, x1: 17, y0: 12, y1: 16 };
for (let y = house.y0; y <= house.y1; y++) {
  for (let x = house.x0; x <= house.x1; x++) {
    const onEdge = x === house.x0 || x === house.x1 || y === house.y0 || y === house.y1;
    const ch = maze[y][x];
    if (onEdge && ch !== '#' && ch !== '-' && onEdge) {
      if (!(y === house.y0 + 0 && (x === 13 || x === 14))) warnings.push(`house edge tile (${x},${y}) is "${ch}" (expected wall or door)`);
    }
  }
}

console.log(maze.join('\n'));
console.log('\n--- stats ---');
console.log({ COLS, ROWS, pellets, orbs, openTiles, reachable: seen.size });
if (warnings.length) {
  console.log('\nWARNINGS:');
  warnings.forEach((w) => console.log(' - ' + w));
}
if (errors.length) {
  console.log('\nERRORS:');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
console.log('\nOK: maze is valid and fully connected.');
