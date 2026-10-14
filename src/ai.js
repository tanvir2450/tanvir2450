/**
 * ai.js - a pure-pursuit autopilot with car control (trail-braking,
 * counter-steering, spin recovery and un-sticking). It is used by the tooling
 * (lap-time benchmarks, track validation), by the tests, and by the in-game
 * demo mode (press O).
 *
 * It drives through the same input object a player would use, so it exercises
 * exactly the same physics path - which is what makes it useful as a test.
 *
 * Two things matter for it to be a good test rather than a fantasy:
 *   1. the speed plan is a REAL backward pass down the road that uses the grip
 *      of the surface under each point (wet patches and dirt need braking for,
 *      exactly like a human would);
 *   2. a closed loop trims the plan from what the tires report, so an
 *      optimistic plan cannot end in the gravel.
 */

import { clamp, clamp01, lerp, wrapAngle } from './mathx.js';

export class Autopilot {
  /**
   * @param {object} track built track (needs centreline + world)
   * @param {object} config resolved config
   */
  constructor(track, config) {
    this.track = track;
    this.config = config;
    // The AI deliberately drives inside the limit: the tire model loses grip
    // progressively, so cornering AT the limit means running wide.
    this.maxLateralG = 0.62;
    this.brakingG = 0.62;
    this.maxBrakeInput = 0.62;
    this.brakeGain = 0.35;
    this.throttleGain = 0.5;
    this.steerGain = 1.3;
    this.crossTrackGain = 0.02;
    this.slideAssist = 0.4;
    this.lookaheadBaseM = 10;
    this.lookaheadSpeedS = 0.45;
    this.scanM = 260;
    this.maxSpeedMs = 70;
    this.minSpeedMs = 7;
    this.counterSteerStartDeg = 4;
    this.counterSteerSpanDeg = 16;
    this.lineToleranceM = 3;
    this.offLinePenalty = 0.02;
    // Closed-loop pace: the AI trims its speed from what the TIRES are actually
    // doing, so an optimistic corner-speed estimate cannot put it in the gravel.
    this.paceFactor = 0.9;
    this.paceMax = 1;
    this.paceMin = 0.45;
    // Traffic (9.10) drives the same autopilot with a lane offset and a pace
    // ceiling; the player's demo driver leaves both at the defaults.
    this.laneOffsetM = 0;
    this.obstacleLookaheadM = 46;
    this.paceTrimPerSecond = 0.55;
    this.paceRecoverPerSecond = 0.12;
    this.usageTrim = 0.95;
    this.index = 0;
    this.crossTrackM = 0;
    this.targetSpeedMs = 0;
    this.stuckTimer = 0;
    this.recoverTimer = 0;
  }

  reset() {
    this.stuckTimer = 0;
    this.recoverTimer = 0;
    this.paceFactor = this.paceMax;
    this.index = 0;
    this.crossTrackM = 0;
    this.avoidOffsetM = 0;
    this.avoidSpeedMs = Infinity;
  }

  /** Track curvature sampled from the centreline, 1/m. */
  curvatureAt(index, span = 3) {
    const c = this.track.centreline;
    const n = c.length;
    const a = c[(index - span + n) % n];
    const b = c[index % n];
    const d = c[(index + span) % n];
    const ab = Math.atan2(b.y - a.y, b.x - a.x);
    const bd = Math.atan2(d.y - b.y, d.x - b.x);
    const angle = Math.abs(wrapAngle(bd - ab));
    // Arc length between the two tangent samples (chords are close enough at a
    // 6 m sample spacing). curvature = d(theta)/ds.
    const length = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(d.x - b.x, d.y - b.y);
    if (angle < 1e-4 || length < 1e-3) return 0;
    return angle / length;
  }

  nearestIndex(x, y) {
    const c = this.track.centreline;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < c.length; i++) {
      const d = (c[i].x - x) ** 2 + (c[i].y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Speed (m/s) that may be carried through `index` on `surface`, if it were a
   *  constant-radius corner. */
  cornerSpeedAt(index, surface) {
    const curvature = this.curvatureAt(index);
    if (curvature <= 1e-5) return Infinity;
    const mu = this.axleGrip * surface.grip;
    const maxLat = this.maxLateralG * this.gravity * mu;
    return Math.sqrt(maxLat / curvature);
  }

  /**
   * Simple traffic awareness: anything close and roughly ahead is passed on the
   * side with more room, and the speed target is capped to the slower car's so
   * the autopilot does not simply rear-end it.
   *
   * @param {object} car
   * @param {Array<{x:number,y:number,speedMs:number}>} obstacles
   */
  scanObstacles(car, obstacles) {
    this.avoidOffsetM = 0;
    this.avoidSpeedMs = Infinity;
    if (!obstacles?.length) return;
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    let worst = null;
    for (const other of obstacles) {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const ahead = dx * cos + dy * sin;
      const lateral = -dx * sin + dy * cos;
      if (ahead < 1 || ahead > this.obstacleLookaheadM) continue;
      if (Math.abs(lateral) > 3.4) continue;
      const closeness = 1 - ahead / this.obstacleLookaheadM;
      if (!worst || closeness > worst.closeness) worst = { closest: other, ahead, lateral, closeness };
    }
    if (!worst) return;
    // Pull to the side the obstacle is NOT on, by a car and a half.
    const side = worst.lateral >= 0 ? -1 : 1;
    this.avoidOffsetM = side * 2.6 * (0.4 + 0.6 * worst.closeness);
    this.avoidOffsetM += this.laneOffsetM * 0.2;
    this.avoidSpeedMs = Math.max(4, worst.closest.speedMs * 0.92);
  }

  /** @returns {{steer:number, throttle:number, brake:number, handbrake:boolean}} */
  update(dt, car, context = {}) {
    const c = this.track.centreline;
    const n = c.length;
    const index = this.nearestIndex(car.x, car.y);
    this.index = index;
    this.car = car;

    /* ---- un-sticking and spin recovery ------------------------- */
    const desiredHeadingToTrack = Math.atan2(c[(index + 2) % n].y - car.y, c[(index + 2) % n].x - car.x);
    if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      // Reverse out: holding the brake at a standstill selects reverse, and in
      // reverse the brake input becomes the reverse throttle. In reverse a
      // positive steer swings the nose to the left, so the sign is flipped to
      // aim the nose back along the track while the car backs away from
      // whatever it is leaning on.
      return { steer: Math.sign(wrapAngle(desiredHeadingToTrack - car.heading)) * 0.8, throttle: 0, brake: 1, handbrake: false };
    }
    if (car.speedMs < 1.5) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }
    if (this.stuckTimer > 0.8) {
      this.recoverTimer = Math.max(this.recoverTimer, 1.8);
      this.stuckTimer = 0;
    }

    /* ---- 9.10: traffic ------------------------------------------ */
    this.scanObstacles(car, context.obstacles);

    /* ---- how far off the racing line are we? -------------------- */
    // Positive means the car is to the RIGHT of the centreline (in the
    // direction of travel).
    const p = c[index];
    const q = c[(index + 1) % n];
    const tangent = Math.atan2(q.y - p.y, q.x - p.x);
    const crossTrack = (car.x - p.x) * -Math.sin(tangent) + (car.y - p.y) * Math.cos(tangent);
    this.crossTrackM = crossTrack;

    /* ---- speed plan: a backward pass down the road --------------- */
    this.axleGrip = Math.min(car.def.tires.axleGripFront, car.def.tires.axleGripRear);
    this.gravity = this.config.tuning.simulation.gravity;
    const gearTop =
      ((car.def.engine.redlineRpm / 60) * 2 * Math.PI * car.def.tires.radiusM) / car.def.drivetrain.ratioTotals[4];
    let targetSpeed = Math.min(gearTop, this.maxSpeedMs);

    let distance = 0;
    for (let i = 1; i < n && distance < this.scanM; i++) {
      const idx = (index + i) % n;
      const a = c[idx];
      const b = c[(idx + 1) % n];
      distance += Math.hypot(b.x - a.x, b.y - a.y);
      // Grip differs corner by corner: the wet patches and the dirt run-off are
      // part of the plan, not a surprise.
      const surface = this.track.world.surfaceAt(a.x, a.y);
      const mu = this.axleGrip * surface.grip;
      const maxLat = this.maxLateralG * this.gravity * mu;
      const maxBrake = this.brakingG * this.gravity * mu;
      const curvature = this.curvatureAt(idx);
      const cornerSpeed = curvature > 1e-5 ? Math.sqrt(maxLat / curvature) : Infinity;
      const allowed = Math.sqrt(Math.max(0, cornerSpeed * cornerSpeed + 2 * maxBrake * distance));
      if (allowed < targetSpeed) targetSpeed = allowed;
    }
    targetSpeed *= this.paceFactor;
    // A lane offset (traffic) and a car in the way both reduce what we ask for.
    targetSpeed = Math.min(targetSpeed, this.avoidSpeedMs + this.laneOffsetM * 0.05);
    // Running wide is a symptom, not a cure: if the line is already lost, slow
    // down and let the steering bring the nose back rather than ploughing on.
    const offLine = Math.max(0, Math.abs(crossTrack) - this.lineToleranceM);
    if (offLine > 0) targetSpeed *= clamp01(1 - offLine * this.offLinePenalty);
    targetSpeed = Math.max(this.minSpeedMs, targetSpeed);
    this.targetSpeedMs = targetSpeed;

    /* ---- pace feedback from what the tires are doing ------------ */
    const stressed =
      car.frontAxle.sliding ||
      car.rearAxle.sliding ||
      car.frontAxle.usageLimit > this.usageTrim ||
      car.rearAxle.usageLimit > this.usageTrim ||
      Math.abs(car.slipAngleBodyDeg) > 10;
    if (stressed) {
      this.paceFactor = Math.max(this.paceMin, this.paceFactor - this.paceTrimPerSecond * dt);
    } else if (car.frontAxle.usageLimit < 0.6 && car.rearAxle.usageLimit < 0.6 && Math.abs(car.slipAngleBodyDeg) < 5) {
      this.paceFactor = Math.min(this.paceMax, this.paceFactor + this.paceRecoverPerSecond * dt);
    }

    /* ---- steering: pure pursuit + a cross-track term ------------ */
    const lookahead = this.lookaheadBaseM + car.speedMs * this.lookaheadSpeedS;
    let ahead = index;
    let aheadDistance = 0;
    while (aheadDistance < lookahead) {
      const a = c[ahead % n];
      const b = c[(ahead + 1) % n];
      aheadDistance += Math.hypot(b.x - a.x, b.y - a.y);
      ahead = (ahead + 1) % n;
    }
    const target = c[ahead % n];
    // Aim a little to the side of the centre line when the car has a lane to
    // hold (traffic) or someone to pass.
    const aheadTangent = Math.atan2(c[(ahead + 1) % n].y - c[ahead % n].y, c[(ahead + 1) % n].x - c[ahead % n].x);
    const offsetM = this.laneOffsetM + this.avoidOffsetM;
    const aimX = target.x + -Math.sin(aheadTangent) * offsetM;
    const aimY = target.y + Math.cos(aheadTangent) * offsetM;
    const desired = Math.atan2(aimY - car.y, aimX - car.x);
    const error = wrapAngle(desired - car.heading);
    const slip = car.slipAngleBodyDeg;
    let steer = clamp(
      error * this.steerGain - crossTrack * this.crossTrackGain + clamp(slip / 45, -1, 1) * this.slideAssist,
      -1,
      1
    );

    /* ---- pedals + counter-steer --------------------------------- */
    // A slide is caught by blending the line-following steering into opposite
    // lock and lifting off, smoothly as the slip angle grows. A hard on/off
    // "slide mode" reacts too late on a rear-drive car and spins.
    const slipUse = Math.abs(slip);
    const spinBlend = clamp01((slipUse - this.counterSteerStartDeg) / this.counterSteerSpanDeg);
    const speedError = targetSpeed - car.speedMs;
    let throttle = speedError > 0 ? clamp01(speedError * this.throttleGain) : 0;
    let brake = speedError < 0 ? clamp01(-speedError * this.brakeGain) : 0;
    // Trail braking: as steering lock goes in, come off the brake.
    brake = Math.min(brake, this.maxBrakeInput) * (1 - 0.7 * Math.min(1, Math.abs(steer)));
    if (spinBlend > 0) {
      // Point the front wheels the way the car is sliding: slip < 0 means the
      // car is yawing right, so the catch is left (negative) steering.
      const counterSteer = (slip > 0 ? 1 : -1) * Math.min(1, 0.3 + slipUse / 30);
      steer = clamp(lerp(steer, counterSteer, Math.pow(spinBlend, 1.5)), -1, 1);
      brake *= 1 - spinBlend;
      throttle *= 1 - 0.85 * spinBlend;
    }
    if (Math.abs(steer) > 0.55) throttle *= 0.6;

    return { steer, throttle, brake, handbrake: false };
  }
}
