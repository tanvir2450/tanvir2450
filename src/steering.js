/**
 * steering.js - SECTION 9.4.
 *
 * The steering wheel is not a switch:
 *
 *   1. the input is RAMPED. A keyboard is on/off, so it is turned into an analog
 *      value over `keyboardRampMs` (120 ms) before it reaches the wheel - that is
 *      what stops keyboard steering from being twitchy;
 *   2. the wheel itself turns toward the target at `steerRateDegPerSec` (300
 *      deg/s) and returns to centre at `returnRateDegPerSec`, both divided by the
 *      car's own lock so a car with a quicker rack (more degrees) gets the same
 *      rate in *input* space;
 *   3. the lock SHRINKS with speed, on the `speedSteerCurve` in tuning.json -
 *      full lock at a standstill, about a quarter of it at top speed - which is
 *      how speed-sensitive steering is done without a lookup hardcoded in code;
 *   4. side damage pulls the wheel to one side (9.9) and nitro reduces the lock
 *      slightly (9.7), both as additive offsets from data;
 *   5. on touch, a gentle "steering assist" nudges the car back toward the road
 *      direction, faded in only when the player has been holding a steering
 *      input for a moment (so it is help, not autopilot) and faded out while
 *      drifting (so it never fights a deliberate slide).
 *
 * Everything returns radians; the vectors (which tyre pushes where) are the
 * tire model's business, not this module's.
 */

import { clamp, rateApproach, wrapAngle } from './mathx.js';

export class Steering {
  constructor(config) {
    this.config = config;
    this.tuning = config.tuning.steering;
    this.brakes = config.tuning.brakes;
    this.nitroTuning = config.tuning.nitro;
    this.input = 0; // shaped -1..1 (what the renderer draws)
    this.wheelAngleRad = 0;
    this.assist = 0; // the assist currently applied, -1..1
    this.assistHold = 0;
    this.raw = 0;
  }

  reset() {
    this.input = 0;
    this.wheelAngleRad = 0;
    this.assist = 0;
    this.assistHold = 0;
    this.raw = 0;
  }

  /** How much of the car's lock is available at this speed (0..1). */
  lockPct(speedMs) {
    return this.config.steerLockPct(speedMs);
  }

  /**
   * Mobile/touch steering assist: blend toward the direction of travel of the
   * road under the car, but only while the player is actually steering (a held
   * input for `assistHoldSeconds`) and never mid-drift.
   *
   * @param {number} dt
   * @param {{desiredHeading?:number|null, drifting?:boolean, active?:boolean, strengthPct?:number}} context
   * @returns {number} assist to feed back into `update` as `input.assist`
   */
  updateAssist(dt, context = {}) {
    const t = this.tuning;
    const wanted = Boolean(context.active) && context.desiredHeading != null;
    if (wanted && !context.drifting && Math.abs(this.raw) > t.assistMinInput) {
      this.assistHold = Math.min(t.assistHoldSeconds, this.assistHold + dt);
    } else {
      // Released when the player lets go, and RELEASED FAST in a drift: the
      // assist must never fight a slide the player started on purpose.
      const release = context.drifting ? t.assistDriftReleasePerSecond : t.assistReleasePerSecond;
      this.assistHold = Math.max(0, this.assistHold - dt * release);
    }
    const fade = clamp01(this.assistHold / Math.max(1e-3, t.assistHoldSeconds));
    let assist = 0;
    if (wanted && fade > 0) {
      const error = wrapAngle(context.desiredHeading - (context.heading ?? context.desiredHeading));
      const authority = clamp01((context.speedMs ?? 0) / Math.max(1e-3, t.assistSpeedMs));
      // `??` is not enough here: a wrong key upstream gives NaN, which would
      // silently kill the assist, so anything non-finite falls back to data.
      const strengthPct = Number.isFinite(context.strengthPct) ? context.strengthPct : t.assistSteerPct;
      const strength = Math.min(t.assistMaxSteerPct, strengthPct * authority);
      assist = clamp(error / (t.assistFullErrorDeg * (Math.PI / 180)), -1, 1) * strength * fade;
    }
    this.assist = assist;
    return assist;
  }

  /**
   * One physics sub-step of input shaping.
   *
   * @param {number} dt seconds
   * @param {object} car
   * @param {{steer?:number, assist?:number, handbrake?:boolean, nitro?:boolean}} input
   * @returns {number} the wheel angle in radians
   */
  update(dt, car, input = {}) {
    const t = this.tuning;
    const def = car.def.steering;
    const maxSteerRad = Math.max(1e-4, def.maxSteerAngleRad);
    this.raw = clamp(input.steer ?? 0, -1, 1);

    /* ---- 1. ramp the raw input --------------------------------- */
    // The ramp is applied to the *target*, not to the wheel, so a quick tap
    // still reaches full lock in keyboardRampMs and a release centres normally.
    const rampSeconds = Math.max(1e-3, t.keyboardRampMs / 1000);
    const ramped = rateApproach(car.steerRamp ?? 0, this.raw, 1 / rampSeconds, dt);
    car.steerRamp = ramped;

    /* ---- 2/5. assist + damage pull ----------------------------- */
    const assist = clamp(input.assist ?? 0, -1, 1);
    const target = clamp(ramped + assist, -1, 1);

    const towardLock = Math.abs(target) > Math.abs(this.input) && Math.sign(target) === Math.sign(this.input || target);
    const rate = (towardLock ? t.steerRateDegPerSec : t.returnRateDegPerSec) / def.maxSteerAngleDeg;
    this.input = rateApproach(this.input, target, rate, dt);

    /* ---- 3. speed-sensitive lock ------------------------------- */
    const lockPct = this.config.steerLockPct(car.speedMs);
    const nitroScale = input.nitro ? this.nitroTuning.steerAnglePct : 1;
    const damagePull = car.damage?.steerPullRad ?? 0;
    const handbrakeBoost = input.handbrake ? (this.tuning.handbrakeSteerBoostDeg * Math.PI) / 180 : 0;
    const counterSteer = car.assistsEnabled
      ? (car.tuning.assists.counterSteerAssistPct *
          Math.atan2(car.lateralSpeedMs, Math.max(Math.abs(car.forwardSpeedMs), 1)))
      : 0;

    const lockRad = maxSteerRad * def.steerAuthority * lockPct * nitroScale;
    this.wheelAngleRad = clamp(
      this.input * lockRad + counterSteer + damagePull + handbrakeBoost,
      -maxSteerRad * t.steerOvershootScale,
      maxSteerRad * t.steerOvershootScale
    );
    car.steerAngleRad = this.wheelAngleRad;
    car.steerInput = this.input;
    car.steerLockRad = lockRad;
    return this.wheelAngleRad;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
