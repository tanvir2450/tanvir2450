/**
 * track.js - turns the authored track description (data/track.json) into
 * geometry: road / run-off / verge surface rectangles, solid walls, checkpoint
 * gates for lap timing, scenery, and the renderer's road polyline.
 *
 * All geometry is in metres; the renderer is the only layer that knows about
 * pixels.
 */

import { Box, SURFACE, WALL, World } from './world.js';
import { wrapAngle } from './mathx.js';

/**
 * @param {object} data parsed data/track.json
 * @param {object} config resolved config
 */
export function buildTrack(data, config) {
  const width = data.widthM;
  const { runoffM, grassM, wallThicknessM } = data;
  const centre = data.centreline;
  const n = centre.length;
  if (n < 8) throw new Error('data/track.json: centreline needs at least 8 points');

  const roadSurface = config.surfaces.get(data.baseSurface ?? config.defaultSurfaceId);
  const runoffSurface = config.surfaces.get(data.runoffSurface ?? 'dirt');
  const vergeSurface = config.surfaces.get(data.vergeSurface ?? config.baseSurfaceId);

  const boxes = [];
  const segmentLengths = [];
  const segmentAngles = [];
  for (let i = 0; i < n; i++) {
    const a = centre[i];
    const b = centre[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    segmentLengths.push(length);
    segmentAngles.push(Math.atan2(dy, dx));
  }

  // Layered strips: road, then run-off on both sides, then the verge, then wall.
  for (let i = 0; i < n; i++) {
    const a = centre[i];
    const b = centre[(i + 1) % n];
    const length = segmentLengths[i];
    const angle = segmentAngles[i];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    // Extend each box a little so corners never show a seam.
    const boxLength = length + width * 0.35;

    boxes.push(new Box({ x: midX, y: midY, widthM: boxLength, heightM: width, angle, type: SURFACE, surface: roadSurface, id: `road${i}` }));

    for (const side of [-1, 1]) {
      const offset = side * (width / 2 + runoffM / 2);
      boxes.push(
        new Box({
          x: midX + nx * offset,
          y: midY + ny * offset,
          widthM: boxLength,
          heightM: runoffM,
          angle,
          type: SURFACE,
          surface: runoffSurface,
          id: `runoff${i}${side}`
        })
      );
      const vergeOffset = side * (width / 2 + runoffM + grassM / 2);
      boxes.push(
        new Box({
          x: midX + nx * vergeOffset,
          y: midY + ny * vergeOffset,
          widthM: boxLength,
          heightM: grassM,
          angle,
          type: SURFACE,
          surface: vergeSurface,
          id: `verge${i}${side}`
        })
      );
    }

    // Walls on EVERY segment: consecutive boxes overlap by more than a car
    // length, so there is no gap for a car to squeeze through, and because they
    // are thicker than one physics sub-step of travel the car can never be
    // resolved out of the far side.
    for (const side of [-1, 1]) {
      const wallOffset = side * (width / 2 + runoffM + grassM + wallThicknessM / 2);
      const wallLength = Math.max(boxLength, wallThicknessM * 3);
      boxes.push(
        new Box({
          x: midX + nx * wallOffset,
          y: midY + ny * wallOffset,
          widthM: wallLength,
          heightM: wallThicknessM,
          angle,
          type: WALL,
          tag: 'barrier',
          id: `wall${i}${side}`
        })
      );
    }
  }

  // Authored patches (wet sections, oil slicks) sit on top of the road.
  for (const [i, patch] of (data.patches ?? []).entries()) {
    const surface = config.surfaces.get(patch.surface);
    if (!surface) continue;
    boxes.push(
      new Box({
        x: patch.x,
        y: patch.y,
        widthM: patch.lengthM,
        heightM: patch.widthM,
        angle: (patch.angleDeg * Math.PI) / 180,
        type: SURFACE,
        surface,
        id: `patch${i}`,
        tag: 'patch'
      })
    );
  }

  const world = new World(config, { boxes, name: data.name });

  /* ---- checkpoint gates for lap timing ----------------------------- */
  const spacing = config.tuning.world.gateSpacingM;
  const gates = [];
  let travelled = 0;
  for (let i = 0; i < n; i++) {
    const length = segmentLengths[i];
    const isStart = gates.length === 0;
    if (travelled >= spacing || isStart) {
      const a = centre[i];
      const angle = segmentAngles[i];
      gates.push({
        x: a.x,
        y: a.y,
        // Gate normal points along the direction of travel.
        nx: Math.cos(angle),
        ny: Math.sin(angle),
        // Generous: a gate counts if the car crosses its plane in the direction
        // of travel anywhere across the road and its run-off. The direction test
        // (behind -> ahead) is what makes the sequence meaningful, not the width.
        halfWidthM: Math.max(config.tuning.world.minGateWidthM, width / 2 + runoffM),
        index: gates.length,
        distanceM: travelled
      });
      travelled = 0;
    }
    travelled += length;
  }

  const startHeading = (data.start.headingDeg * Math.PI) / 180;
  const startPose = { x: data.start.x, y: data.start.y, heading: startHeading };

  const decor = (data.decor ?? []).map((item) => ({ ...item }));

  // 9.12: the road must be wider than the corner it is asked to take. A hand
  // edited or generated centre line that turns tighter than its own half width
  // folds the inside of the bend (and the walls end up on the tarmac), so it is
  // reported instead of shipping a track nobody can drive.
  let minRadiusM = Infinity;
  for (let i = 0; i < centre.length; i++) {
    const a = centre[(i - 1 + centre.length) % centre.length];
    const b = centre[i];
    const c = centre[(i + 1) % centre.length];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const step = (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)) / 2;
    if (Math.abs(da) < 1e-6) continue;
    minRadiusM = Math.min(minRadiusM, step / Math.abs(da));
  }
  const minRadiusFactor = config.tuning.world?.minRadiusToWidth ?? 1.6;
  if (Number.isFinite(minRadiusM) && minRadiusM < width * minRadiusFactor) {
    config.warnings.push(
      `${data.name ?? 'track'}: tightest corner is r${minRadiusM.toFixed(0)} m on a ${width} m road ` +
        `(below ${minRadiusFactor}x the width) - the inside of the bend will fold`
    );
  }

  return {
    name: data.name,
    baseSurfaceId: data.baseSurface ?? config.defaultSurfaceId,
    minRadiusM,
    gateResyncWindow: config.tuning.world.gateResyncWindow ?? 4,
    widthM: width,
    runoffM,
    grassM,
    world,
    gates,
    startPose,
    centreline: centre.map((p) => ({ x: p.x, y: p.y })),
    lapLengthM: segmentLengths.reduce((a, b) => a + b, 0),
    decor,
    patchList: (data.patches ?? []).map((patch) => ({ ...patch, surface: config.surfaces.get(patch.surface) }))
  };
}

/**
 * Lap + sector timing. Gates must be passed in order; crossing the last gate
 * completes a lap and the next lap starts immediately.
 */
export class LapTimer {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.nextGate = 1 % this.track.gates.length;
    this.missedGates = 0;
    this.lapTime = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.lapCount = 0;
    this.splits = [];
    this.lapStartTime = 0;
    this.totalDistanceM = 0;
    this.completed = false;
    this.wrongWay = false;
    this.wrongWayTimer = 0;
  }

  /**
   * @param {import('./car.js').Car} car
   *
   * Gate rules: a gate counts when the car crosses its plane in the direction of
   * travel anywhere across the road and its run-off (a segment test, so it works
   * at any speed and never tunnels). Any gate may be the one that counts - if a
   * car runs wide and misses one, hitting a later gate re-synchronises the lap
   * counter instead of stranding the driver on a lap that can never be
   * completed. That is a recovery, not a shortcut: the re-sync only jumps
   * forward, only within `gateResyncWindow` gates, and the car still has to be
   * on the road to cross a gate at all.
   */
  update(dt, car, prevX, prevY) {
    this.lapTime += dt;
    const gates = this.track.gates;
    const count = gates.length;
    for (let k = 0; k < count; k++) {
      const gate = gates[k];
      const d0 = (prevX - gate.x) * gate.nx + (prevY - gate.y) * gate.ny;
      const d1 = (car.x - gate.x) * gate.nx + (car.y - gate.y) * gate.ny;
      if (d0 >= 0 || d1 < 0) continue;
      const lateral = (car.x - gate.x) * -gate.ny + (car.y - gate.y) * gate.nx;
      if (Math.abs(lateral) > gate.halfWidthM) continue;
      const ahead = (k - this.nextGate + count) % count;
      if (ahead === 0) {
        this.splits.push(this.lapTime);
        if (k === 0) this.completeLap();
        this.nextGate = (k + 1) % count;
      } else if (ahead <= this.track.gateResyncWindow) {
        // Missed the gate(s) in between (a wide moment, a spin, a trip through
        // the run-off): take the lap on from here and note it.
        this.missedGates += ahead;
        if (k === 0) this.completeLap();
        this.nextGate = (k + 1) % count;
      }
    }

    // Wrong-way detection: is the car heading against the track direction?
    const travel = segmentAnglesAhead(this.track, car.x, car.y);
    if (travel !== null) {
      const headingError = Math.abs(wrapAngle(car.heading - travel));
      this.wrongWay = headingError > (150 * Math.PI) / 180 && car.speedMs > 4;
      this.wrongWayTimer = this.wrongWay ? this.wrongWayTimer + dt : 0;
    }
  }

  completeLap() {
    this.lastLap = this.lapTime;
    if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
    this.lapCount += 1;
    this.splits = [];
    this.lapTime = 0;
  }
}

/** Direction of travel of the track at the nearest centre-line segment (rad). */
export function headingAt(track, x, y) {
  return segmentAnglesAhead(track, x, y) ?? 0;
}

/** Direction of the track at the nearest centre-line segment. */
function segmentAnglesAhead(track, x, y) {
  const centre = track.centreline;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centre.length; i++) {
    const dx = centre[i].x - x;
    const dy = centre[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const a = centre[best];
  const b = centre[(best + 1) % centre.length];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export { wrapAngle };
