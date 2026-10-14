/**
 * engine.js - SECTION 9.2 "Engine, RPM and gears (simplified drivetrain)".
 *
 * - engine torque comes from the car's 5-point lookup table (low / mid / peak /
 *   high / redline), interpolated linearly in rpm,
 * - rpm is derived from wheel speed and the current gear ratio,
 * - 5 automatic gears, shifting up near 90% of redline, with a short torque cut
 *   (tuning.drivetrain.shiftTorqueCutMs) on every shift,
 * - a rev limiter bounces off redline and cuts torque in short cycles,
 * - everything the audio layer needs (rpm, gear, shift dip, limiter gate) is
 *   reported in the telemetry object.
 *
 * The module owns no rendering, audio or canvas code - it only mutates its own
 * state and returns numbers. Every constant it uses comes from tuning.json.
 */

import { clamp, clamp01, expApproach, lerp } from './mathx.js';

/** Piecewise-linear sample of the 5-point torque curve, in Nm. */
export function sampleTorqueCurve(curve, rpm) {
  const first = curve[0];
  if (rpm <= first.rpm) {
    // Below the first data point the engine only makes what that point makes:
    // clamping (instead of extrapolating) avoids fantasy launch torque.
    return first.nm;
  }
  const last = curve[curve.length - 1];
  if (rpm >= last.rpm) return last.nm;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (rpm <= b.rpm) {
      const t = (rpm - a.rpm) / (b.rpm - a.rpm);
      return lerp(a.nm, b.nm, t);
    }
  }
  return last.nm;
}

export const GEAR_NEUTRAL = 0;
export const GEAR_REVERSE = -1;

export class Drivetrain {
  /**
   * @param {object} car resolved car from config.cars
   * @param {object} tuning resolved tuning.json
   */
  constructor(car, tuning) {
    this.car = car;
    this.tuning = tuning;
    this.gearCount = tuning.drivetrain.gearCount;
    this.reset();
  }

  reset() {
    const e = this.car.engine;
    this.gear = 1;
    this.rpm = e.idleRpm;
    this.rpmDisplay = e.idleRpm;
    this.shiftTimer = Number.POSITIVE_INFINITY;
    this.shiftCooldown = 0;
    this.limiterTimer = 0;
    this.limiterCut = false;
    this.limiterActive = false;
    this.torqueCut = 0;
    this.lastShiftDirection = 0;
    this.gearChangeEvent = null;
    this.rpmBounce = 0;
    this.clutchLock = 0;
    this.torqueNm = 0;
    this.powerKw = 0;
    this.engineBrakeForceN = 0;
    this.driveForceN = 0;
    this.throttleIn = 0;
    this.brakeIn = 0;
    this.stoppedTimer = 0;
  }

  get inGear() {
    return this.gear !== GEAR_NEUTRAL;
  }

  get ratioTotal() {
    const d = this.car.drivetrain;
    if (this.gear === GEAR_REVERSE) return d.reverseRatioTotal;
    if (this.gear === GEAR_NEUTRAL) return 0;
    return d.ratioTotals[this.gear - 1];
  }

  get wheelForcePerNm() {
    const d = this.car.drivetrain;
    if (this.gear === GEAR_REVERSE) return d.reverseWheelForcePerNm;
    if (this.gear === GEAR_NEUTRAL) return 0;
    return d.wheelForcePerNm[this.gear - 1];
  }

  /** rpm the wheels are asking for, given the current gear. */
  rpmFromWheelSpeed(speedMs) {
    const ratio = this.ratioTotal;
    if (!ratio) return this.car.engine.idleRpm;
    const wheelAngularRadS = Math.abs(speedMs) / this.car.tires.radiusM;
    return (wheelAngularRadS * ratio * 60) / (2 * Math.PI);
  }

  shiftTo(gear, direction) {
    const previous = this.gear;
    this.gear = gear;
    this.shiftTimer = 0;
    this.shiftCooldown = this.tuning.drivetrain.shiftCooldownMs;
    this.lastShiftDirection = direction;
    this.gearChangeEvent = { from: previous, to: gear, direction };
  }

  /** Automatic gear selection (reverse, kickdown and the 5 forward gears). */
  updateGearSelection(input, forwardSpeedMs, throttle, brake) {
    const t = this.tuning.drivetrain;
    const wheelRpm = this.rpmFromWheelSpeed(forwardSpeedMs);
    const upShiftRpm = this.car.engine.redlineRpm * t.shiftUpAtRedlinePct;
    const downShiftRpm = this.car.engine.redlineRpm * t.shiftDownAtRedlinePct;

    if (this.gear === GEAR_REVERSE) {
      // Pressing forward drive takes the car out of reverse once it has stopped
      // travelling backwards.
      if (throttle > 0.25 && forwardSpeedMs >= -t.reverseEngageSpeedMs) this.shiftTo(1, 1);
      return;
    }
    // Reverse only engages once the car has actually been sitting still with the
    // brake held (reverseEngageDwellMs), never while braking through a stop.
    if (Math.abs(forwardSpeedMs) <= t.reverseEngageSpeedMs * 0.16) this.stoppedTimer += this.lastDtMs ?? 0;
    else this.stoppedTimer = 0;
    if (brake > 0.35 && this.stoppedTimer >= t.reverseEngageDwellMs && this.shiftCooldown <= 0) {
      this.shiftTo(GEAR_REVERSE, -1);
      return;
    }
    if (this.shiftCooldown > 0) return;

    if (wheelRpm > upShiftRpm && this.gear < this.gearCount) {
      this.shiftTo(this.gear + 1, 1);
    } else if (this.gear > 1 && wheelRpm > 0 && wheelRpm < downShiftRpm) {
      this.shiftTo(this.gear - 1, -1);
    } else if (this.gear > 1 && Math.abs(forwardSpeedMs) < t.kickdownSpeedMs) {
      this.shiftTo(1, -1); // first gear is the only one we launch in
    }
  }

  /**
   * Advance the drivetrain by dt and return this frame's telemetry.
   *
   * @param {number} dt seconds (the fixed physics step)
   * @param {{throttle:number, brake:number, handbrake:number}} input
   * @param {{speedMs:number, forwardSpeedMs:number, wheelSpin:number, grounded:boolean}} state
   */
  update(dt, input, state) {
    const t = this.tuning.drivetrain;
    const e = this.car.engine;
    const ms = dt * 1000;
    this.lastDtMs = ms;
    this.gearChangeEvent = null;
    this.shiftTimer += ms;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - ms);

    const forwardSpeedMs = state.forwardSpeedMs;
    const inReverse = this.gear === GEAR_REVERSE;
    // Forward/back input is remapped per gear, so "back" reverses at a standstill
    // and "forward" brakes while rolling backwards.
    const throttleIn = clamp01(input.throttle);
    const brakeIn = clamp01(input.brake);
    this.throttleIn = inReverse ? brakeIn : throttleIn;
    this.brakeIn = inReverse ? throttleIn : brakeIn;

    this.updateGearSelection(input, forwardSpeedMs, throttleIn, brakeIn);
    const inGear = this.inGear;

    /* ---- clutch + rpm ------------------------------------------ */
    const idle = e.idleRpm;
    const lockRpm = idle + t.clutchLockRpmPct * (e.redlineRpm - idle);
    const clutchFloor = idle * t.clutchLockIdlePct;
    const wheelRpm = this.rpmFromWheelSpeed(forwardSpeedMs);
    const clutchLockRaw = inGear ? clamp01((wheelRpm - clutchFloor) / Math.max(1, lockRpm - clutchFloor)) : 0;
    this.clutchLock = expApproach(this.clutchLock, clutchLockRaw, t.clutchLockRatePerSecond, dt);

    // While the clutch slips the engine is free to sit at the launch rpm; once it
    // locks, engine speed is wheel speed through the gearing.
    const freeRpm = idle + this.throttleIn * (this.car.drivetrain.launchRpm - idle);
    const targetRpm = inGear ? lerp(freeRpm, wheelRpm, this.clutchLock) : freeRpm;
    this.rpm = expApproach(this.rpm, clamp(targetRpm, idle, e.revLimiterRpm), t.rpmResponsePerSecond, dt);

    /* ---- rev limiter ------------------------------------------- */
    if (this.rpm >= e.revLimiterRpm - t.revLimiterRpmMargin && this.throttleIn > 0.05 && inGear) {
      this.limiterActive = true;
      this.limiterTimer += ms;
      const cycle = this.limiterCut ? t.revLimiterCutMs : t.revLimiterRecoverMs;
      if (this.limiterTimer >= cycle) {
        this.limiterTimer = 0;
        this.limiterCut = !this.limiterCut;
      }
    } else {
      this.limiterActive = false;
      this.limiterCut = false;
      this.limiterTimer = 0;
    }

    /* ---- torque ------------------------------------------------ */
    const shifting = this.shiftTimer < t.shiftTotalMs;
    const cutFromShift = this.shiftTimer < t.shiftTorqueCutMs ? 1 : 0;
    const cutFromLimiter = this.limiterCut ? 1 : 0;
    this.torqueCut = Math.max(cutFromShift, cutFromLimiter);

    let torqueNm = sampleTorqueCurve(e.torqueCurve, this.rpm) * this.throttleIn;
    // Downshift blip: brief extra torque makes a downshift feel mechanical.
    if (this.shiftTimer < t.shiftBlipMs && this.lastShiftDirection < 0) {
      torqueNm *= 1 + t.throttleBlipDownshift;
    }
    this.torqueNm = torqueNm * (1 - this.torqueCut);

    // Reverse is speed limited, and the clutch only transmits a fraction of
    // engine torque before it is fully locked (that is what lets the car leave
    // the line instead of stalling).
    if (inReverse && forwardSpeedMs < -t.reverseTopSpeedMs) this.torqueNm = 0;
    const clutchScale = inGear ? lerp(t.launchTorqueScale, 1, this.clutchLock) : 0;
    const wheelForcePerNm = this.wheelForcePerNm;
    this.driveForceN = this.torqueNm * wheelForcePerNm * clutchScale;

    // Engine braking / overrun: only while the engine is connected and the car
    // is actually rolling (otherwise it fights the handbrake at rest).
    const rolling = Math.abs(forwardSpeedMs) > t.engineBrakeWheelCutoffMs;
    const overrunTorque = (t.engineBrakeTorqueNm + t.engineBrakePerRpm * this.rpm) * (1 - this.throttleIn) * clutchScale;
    this.engineBrakeForceN = inGear && rolling ? overrunTorque * wheelForcePerNm : 0;

    this.powerKw = (this.torqueNm * this.rpm * Math.PI) / 30000;

    /* ---- displayed rpm (wheelspin makes the engine scream) ------ */
    const wheelSpin = Number.isFinite(state.wheelSpin) ? state.wheelSpin : 0;
    const wheelspinBoost = t.wheelspinRpmBoostPct * clamp01(wheelSpin) * (e.redlineRpm - idle);
    const bounceAmp = this.limiterActive ? e.revLimiterRpm * t.limiterBouncePct : 0;
    const bouncePeriod = (t.revLimiterCutMs + t.revLimiterRecoverMs) / 1000;
    this.rpmBounce = bounceAmp * Math.sin((this.limiterTimer / 1000 / Math.max(0.016, bouncePeriod)) * Math.PI * 2);
    this.rpmDisplay = clamp(this.rpm + wheelspinBoost + this.rpmBounce, idle, e.revLimiterRpm);

    return {
      rpm: this.rpm,
      rpmDisplay: this.rpmDisplay,
      rpmPct: clamp01((this.rpmDisplay - idle) / Math.max(1, e.redlineRpm - idle)),
      gear: this.gear,
      gearCount: this.gearCount,
      inGear,
      shifting,
      torqueCut: this.torqueCut,
      limiterActive: this.limiterActive,
      limiterCut: this.limiterActive && this.limiterCut,
      clutchLock: this.clutchLock,
      torqueNm: this.torqueNm,
      powerKw: this.powerKw,
      driveForceN: this.driveForceN,
      engineBrakeForceN: this.engineBrakeForceN,
      wheelspinBoostRpm: wheelspinBoost,
      gearChange: this.gearChangeEvent
    };
  }
}
