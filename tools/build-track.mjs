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

const DESIGN = {
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
  const outIndex = args.indexOf('--out');
  const outPath = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(HERE, '..', 'data', 'track.json'));

  const smooth = catmullRom(DESIGN.control, 24);
  const centre = resample(smooth, DESIGN.sampleSpacingM);
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
  console.log(`wrote ${outPath}: ${centreline.length} centre-line points, ${Math.round(length)} m lap, ${patches.length} patches, ${decor.length} scenery items`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
