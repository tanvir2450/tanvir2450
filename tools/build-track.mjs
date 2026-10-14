#!/usr/bin/env node
/**
 * build-track.mjs - authors data/track.json.
 *
 * The circuit is described by a handful of control points; this tool smooths
 * them with a closed Catmull-Rom spline, samples the centre line, and writes:
 *   - the sampled centre line (what physics AND the renderer both use)
 *   - surface patches layered on top of the road (wet section, oil slick,
 *     painted kerb strips, a gravel trap on the outside of the fast corner)
 *   - scenery (cones / tyre stacks)
 *   - the start pose
 *
 * Everything else (road width, run-off, walls, checkpoint gates) is derived at
 * load time by src/track.js, so this file stays readable and hand-editable.
 *
 * Usage: node tools/build-track.mjs [--out data/track.json]
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DESIGNS = {};

DESIGNS.apex = {
  name: 'Apex Loop',
  widthM: 15,
  runoffM: 4.5,
  grassM: 5,
  wallThicknessM: 1.1,
  sampleSpacingM: 6,
  startIndex: 0,
  // Control points of the centre line, in metres. The loop must be convex-enough
  // for the spline not to cross itself; tune by eye with tools/render-track.mjs.
  control: [
    [0, 0],
    [150, -6],
    [246, 14],
    [300, 78],
    [330, 168],
    [296, 252],
    [214, 296],
    [152, 316],
    [88, 286],
    [44, 220],
    [-16, 186],
    [-56, 120],
    [-44, 44]
  ],
  // Patches are placed in track-space and keep the road's local direction.
  patches: [
    // A long wet section across the fast right hander at the top of the circuit.
    { at: [318, 120], surface: 'wet', lengthM: 70, widthM: 17 },
    { at: [305, 232], surface: 'wet', lengthM: 60, widthM: 17 },
    // Oil dumped on the exit of the hairpin: low grip, no warning.
    { at: [128, 300], surface: 'oil', lengthM: 14, widthM: 9 }
  ]
};

/**
 * SECTION 9.12 - the tuning ground. One lap that holds every situation a car
 * can be tuned in, in a known order:
 *
 *   start/finish straight (240 m) -> fast right -> S-curves (three linked
 *   changes of direction) -> hairpin -> back straight -> oval turn (a long
 *   constant radius 180) -> closing straight.
 *
 * The off-road patch is a wide gravel apron on the outside of the hairpin (so
 * you can put two wheels on it, or all four), plus a dirt crossing on the back
 * straight to test surface changes at speed. The wet/oil patches are for
 * consistency checks - the same corner, less grip.
 */
DESIGNS.grounds = {
  name: 'Tuning Grounds',
  widthM: 16,
  runoffM: 5,
  grassM: 6,
  wallThicknessM: 1.1,
  sampleSpacingM: 5,
  startIndex: 0,
  // Deliberately tighter than the race circuit (which bottoms out at r40): the
  // hairpin is the tightest corner a car is ever asked to take.
  minRadiusM: 34,
  control: [
    // start/finish straight, running east
    [0, 0],
    [70, 0],
    [140, 0],
    [200, 0],
    // fast right hander onto the top section
    [252, 12],
    [288, 52],
    [296, 100],
    // S-curves: two linked changes of direction, 70 m between the legs
    [266, 150],
    [352, 188],
    [272, 230],
    [356, 268],
    // hairpin: a clear 180 back to the west
    [302, 312],
    [258, 350],
    [204, 356],
    [158, 330],
    // back straight, heading west
    [118, 288],
    [55, 278],
    [-10, 270],
    [-70, 256],
    // oval turn: long constant radius 180 around the west end
    [-126, 234],
    [-160, 194],
    [-175, 144],
    [-165, 92],
    [-132, 48],
    [-85, 20],
    // closing straight back to the start
    [-30, 5]
  ],
  patches: [
    // the off-road apron: wide gravel beside the hairpin exit
    { at: [206, 348], surface: 'dirt', lengthM: 60, widthM: 28, offsetM: 15 },
    // a gravel trap on the outside of the fast right hander
    { at: [286, 74], surface: 'dirt', lengthM: 50, widthM: 24, offsetM: 13 },
    // a dirt crossing on the back straight: the surface changes under you
    { at: [30, 274], surface: 'dirt', lengthM: 24, widthM: 15 },
    // wet on the exit of the oval turn, oil mid-ess
    { at: [-158, 190], surface: 'wet', lengthM: 55, widthM: 17 },
    { at: [300, 192], surface: 'oil', lengthM: 12, widthM: 8 }
  ]
};

function catmullRom(points, samplesPerSegment) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  return out;
}

/** Curvature radius at a vertex of a closed polyline (Infinity when straight). */
function radiusAt(points, index) {
  const n = points.length;
  const a = points[(index - 1 + n) % n];
  const b = points[index];
  const d = points[(index + 1) % n];
  const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const a2 = Math.atan2(d[1] - b[1], d[0] - b[0]);
  let da = a2 - a1;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const length = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(d[0] - b[0], d[1] - b[1])) / 2;
  return Math.abs(da) < 1e-6 ? Infinity : length / Math.abs(da);
}

/** The tightest corner on a polyline, as {radiusM, x, y}. */
export function tightestCorner(points) {
  let best = { radiusM: Infinity, x: 0, y: 0 };
  for (let i = 0; i < points.length; i++) {
    const r = radiusAt(points, i);
    if (r < best.radiusM) best = { radiusM: r, x: points[i][0], y: points[i][1] };
  }
  return best;
}

/**
 * Relax a closed polyline until no vertex is tighter than `minRadiusM`.
 *
 * A road is wider than it is thin: if the centre line curves tighter than the
 * half width, the inside of the bend folds over itself and the builder would
 * place a wall across the road (a car gets wedged in it, and no amount of
 * tuning fixes that). Relaxing only the offending vertices - moving each one a
 * fraction of the way toward the midpoint of its neighbours - keeps the design
 * intent (the shape, the straights, the sequence of corners) while guaranteeing
 * the geometry can carry the road.
 */
function hypot2(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function relaxForMinRadius(points, minRadiusM, iterations = 4000) {
  const out = points.map((p) => [...p]);
  let relaxed = 0;
  for (let iter = 0; iter < iterations; iter++) {
    let worst = Infinity;
    const moves = [];
    for (let i = 0; i < out.length; i++) {
      const r = radiusAt(out, i);
      if (r < worst) worst = r;
      if (r >= minRadiusM) {
        moves.push(null);
        continue;
      }
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[(i + 1) % out.length];
      const blend = Math.min(0.55, 0.45 + ((minRadiusM - r) / minRadiusM) * 0.35);
      const nx = out[i][0] + ((a[0] + b[0]) / 2 - out[i][0]) * blend;
      const ny = out[i][1] + ((a[1] + b[1]) / 2 - out[i][1]) * blend;
      // never let the relaxation collapse the sampling into a clump
      const staysSpaced = Math.hypot(nx - a[0], ny - a[1]) > 0.55 * hypot2(a, out[i]) && Math.hypot(b[0] - nx, b[1] - ny) > 0.55 * hypot2(out[i], b);
      moves.push(staysSpaced ? [nx, ny] : null);
    }
    for (let i = 0; i < out.length; i++) if (moves[i]) out[i] = moves[i];
    relaxed += moves.filter(Boolean).length;
    if (worst >= minRadiusM) break;
  }
  return { points: out, relaxations: relaxed };
}

function resample(points, spacing) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1];
    const b = points[i % points.length];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t + spacing <= dist) {
      t += spacing;
      out.push([a[0] + ((b[0] - a[0]) * t) / dist, a[1] + ((b[1] - a[1]) * t) / dist]);
    }
    carry = t - dist;
  }
  return out;
}

function directionAt(points, index) {
  const a = points[index];
  const b = points[(index + 1) % points.length];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** Nearest centre-line point to a track-space position (brute force, tool only). */
function nearestIndex(points, x, y) {
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all') || args.length === 0) {
    // default: build every design the game can load
    await build(DESIGNS.apex, path.join(HERE, '..', 'data', 'track.json'));
    await build(DESIGNS.grounds, path.join(HERE, '..', 'data', 'test-track.json'));
    return;
  }
  const designIndex = args.indexOf('--design');
  const key = designIndex >= 0 ? args[designIndex + 1] : 'apex';
  const design = DESIGNS[key];
  if (!design) throw new Error(`unknown design "${key}" (have: ${Object.keys(DESIGNS).join(', ')})`);
  const outIndex = args.indexOf('--out');
  const outPath = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(HERE, '..', 'data', `${key === 'apex' ? 'track' : key}.json`));
  await build(design, outPath);
}

async function build(DESIGN, outPath) {
  const smooth = catmullRom(DESIGN.control, 24);
  // A road cannot turn tighter than its own half width (the inside of the bend
  // folds and the walls land on the tarmac), so the sampled centre line is
  // relaxed to `minRadiusM` before anything is derived from it.
  const minRadiusM = DESIGN.minRadiusM ?? DESIGN.widthM * 2.5;
  // Relax at the sampling resolution the world builder will actually use: the
  // polyline it derives walls and gates from is the one that has to be legal.
  const sampled = resample(smooth, DESIGN.sampleSpacingM);
  const relaxation = relaxForMinRadius(sampled, minRadiusM);
  const centre = relaxation.points;
  const tightest = tightestCorner(centre);
  const centreline = centre.map(([x, y]) => ({ x: +x.toFixed(3), y: +y.toFixed(3) }));

  const patches = DESIGN.patches.map((patch) => {
    const index = nearestIndex(centre, patch.at[0], patch.at[1]);
    const angle = directionAt(centre, index);
    const point = centre[index];
    const offset = patch.offsetM ?? 0;
    // offset is measured along the track's right-hand normal
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    return {
      x: +(point[0] + nx * offset).toFixed(2),
      y: +(point[1] + ny * offset).toFixed(2),
      widthM: patch.widthM,
      lengthM: patch.lengthM,
      angleDeg: +((angle * 180) / Math.PI).toFixed(2),
      surface: patch.surface,
      role: 'patch'
    };
  });

  // Scenery: cones on the outside of tight corners, tyre stacks on the straights.
  const decor = [];
  for (let i = 0; i < centre.length; i += Math.max(3, Math.round(24 / DESIGN.sampleSpacingM))) {
    const angle = directionAt(centre, i);
    const next = directionAt(centre, (i + 1) % centre.length);
    const curvature = Math.abs(((next - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const side = curvature > 0.12 ? 1 : -1;
    const nx = -Math.sin(angle) * side;
    const ny = Math.cos(angle) * side;
    const distance = DESIGN.widthM / 2 + DESIGN.runoffM + 1.2;
    decor.push({
      type: curvature > 0.12 ? 'cone' : 'tyres',
      x: +(centre[i][0] + nx * distance).toFixed(2),
      y: +(centre[i][1] + ny * distance).toFixed(2)
    });
  }

  const startAngle = directionAt(centre, DESIGN.startIndex);
  const track = {
    $comment:
      'Generated by tools/build-track.mjs - edit the DESIGN block in that tool, not this file, then re-run it.',
    name: DESIGN.name,
    widthM: DESIGN.widthM,
    runoffM: DESIGN.runoffM,
    grassM: DESIGN.grassM,
    wallThicknessM: DESIGN.wallThicknessM,
    baseSurface: 'asphalt',
    runoffSurface: 'dirt',
    vergeSurface: 'grass',
    start: {
      x: +centre[DESIGN.startIndex][0].toFixed(2),
      y: +centre[DESIGN.startIndex][1].toFixed(2),
      headingDeg: +((startAngle * 180) / Math.PI).toFixed(2)
    },
    centreline,
    patches,
    decor
  };

  await writeFile(outPath, JSON.stringify(track, null, 2) + '\n');
  const length = centre.reduce((sum, p, i) => {
    const q = centre[(i + 1) % centre.length];
    return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
  }, 0);
  console.log(
    `wrote ${outPath}: ${DESIGN.name} - ${centreline.length} centre-line points, ${Math.round(length)} m lap, ` +
      `${patches.length} patches, ${decor.length} scenery items | tightest corner r${tightest.radiusM.toFixed(0)} m ` +
      `at ${tightest.x.toFixed(0)},${tightest.y.toFixed(0)} (target ${minRadiusM.toFixed(0)} m, road half width ${(DESIGN.widthM / 2).toFixed(1)} m, ` +
      `${relaxation.relaxations} relaxations)`
  );
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
