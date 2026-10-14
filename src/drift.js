/**
 * drift.js - SECTION 9.6.
 *
 * A drift begins when the slip angle passes `drift.minSlipAngleDeg` (15 deg)
 * while the car is moving, and while it lasts it:
 *
 *   - charges nitro (the banked points are converted at `nitroPerPoint`),
 *   - builds a score and a combo multiplier (a sustained slide chains),
 *   - throws tyre smoke and lays skid marks (fed by the effects layer),
 *   - earns style points and coins for the challenges (9.9's economy sink).
 *
 * Ending it well pays a "drift boost": a short bump of extra engine force and
 * top speed, scaled by how many points the drift banked. Ending it badly - a
 * spin, or a crash inside `crashCancelWindowSeconds` of the drift - cancels the
 * pending points and the combo instead.
 *
 * This was `DriftScore` in fx.js; it moved here because scoring is a mechanic,
 * not an effect, and the effects layer only consumes its events.
 */

import { clamp01 } from './mathx.js';

export class DriftScore {
  constructor(config) {
    this.config = config;
    this.tuning = config.tuning.drift;
    this.nitroTuning = config.tuning.nitro;
    this.economy = config.tuning.economy;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.pending = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.angleDeg = 0;
    this.lastGain = 0;
    this.events = [];
    // 9.6 rewards / 9.7 charge
    this.boostTimer = 0;
    this.boostPct = 0;
    this.lastBankPoints = 0;
    this.lastBankCombo = 1;
    this.style = 0;
    this.coins = 0;
    this.crashTimer = 0;
    this.bestBank = 0;
    this.chargeRequest = 0;
  }

  get total() {
    return Math.round(this.score + this.pending);
  }

  /** Is the drift boost currently being paid out? */
  get boosting() {
    return this.boostTimer > 0;
  }

  /** 1 + a fraction of the boost, for the drivetrain / gearing to scale. */
  get boostMultiplier() {
    return this.boostTimer > 0 ? 1 + this.boostPct : 1;
  }

  /**
   * A crash happened: cancels the pending points, the combo and any drift boost
   * if it lands inside the cancel window (9.6 - "crashing during a drift
   * cancels the combo"). Returns true when something was actually cancelled.
   */
  crash(severity = 1) {
    this.crashTimer = this.tuning.crashCancelWindowSeconds;
    const had = this.pending > this.tuning.cancelMinPoints || this.combo > 1 || this.drifting || this.boostTimer > 0;
    if (!had) return false;
    if (this.pending > this.tuning.cancelMinPoints) {
      this.events.push({ type: 'crashCancel', lost: Math.round(this.pending), severity });
    }
    this.pending = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.boostTimer = 0;
    this.boostPct = 0;
    return true;
  }

  /**
   * @param {number} dt
   * @param {import('./car.js').Car} car
   * @returns {{nitroCharge:number, coins:number, style:number}} what to hand to
   *   the nitro tank / the wallet this tick
   */
  update(dt, car) {
    const t = this.tuning;
    this.events.length = 0;
    this.angleDeg = Math.abs(car.slipAngleBodyDeg);
    const fastEnough = car.speedMs > t.minSpeedMs;
    const sideways = this.angleDeg > t.minSlipAngleDeg;
    const active = fastEnough && sideways && !car.airborne;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.crashTimer = Math.max(0, this.crashTimer - dt);
    let nitroCharge = 0;
    let coins = 0;

    if (this.boostTimer > 0) this.boostTimer = Math.max(0, this.boostTimer - dt);

    if (active) {
      if (!this.drifting) {
        this.drifting = true;
        this.driftTime = 0;
        this.events.push({ type: 'start', angleDeg: this.angleDeg });
      }
      this.driftTime += dt;
      const angleFactor = clamp01((this.angleDeg - t.minSlipAngleDeg) / t.fullSlideAngleSpanDeg);
      const speedFactor = clamp01(car.speedMs / t.fullScoreSpeedMs);
      const gain =
        t.scorePerSecondAtFullSlide *
        angleFactor *
        (t.minSpeedFactor + (1 - t.minSpeedFactor) * speedFactor) *
        this.combo *
        dt;
      this.pending += gain;
      this.lastGain = gain / Math.max(dt, 1e-3);
      // 9.6: nitro charges FASTER while drifting - a live trickle plus the bank.
      nitroCharge += gain * t.nitroPerPoint;
    } else if (this.drifting) {
      const banked = this.pending;
      const wasCrashing = this.crashTimer > 0;
      if (this.driftTime > t.minBankSeconds) {
        if (wasCrashing) {
          this.events.push({ type: 'crashCancel', lost: Math.round(banked), severity: 1 });
        } else {
          this.score += banked;
          this.combo = Math.min(t.comboMax, this.combo + t.comboStep * Math.min(t.comboRampSeconds, this.driftTime));
          this.comboTimer = t.comboWindowSeconds;
          this.events.push({ type: 'bank', points: Math.round(banked), combo: this.combo, angleDeg: this.angleDeg });
          this.lastBankPoints = Math.round(banked);
          this.lastBankCombo = this.combo;
          this.bestBank = Math.max(this.bestBank, Math.round(banked));
          // A clean exit: a short boost, the longer the bigger the drift.
          if (banked >= t.cleanExitMinPoints && Math.abs(car.slipAngleBodyDeg) < t.minSlipAngleDeg) {
            this.boostPct = t.cleanExitBoostPct;
            this.boostTimer = t.cleanExitBoostSeconds;
            this.events.push({ type: 'cleanExit', points: Math.round(banked), boost: this.boostPct });
          }
          nitroCharge += banked * t.nitroPerPoint;
          coins += banked * t.coinsPerPoint;
          this.style += banked * t.stylePerPoint;
        }
      } else {
        this.score += banked;
      }
      this.pending = 0;
      this.drifting = false;
      this.driftTime = 0;
    }

    if (!this.drifting && this.comboTimer <= 0 && this.combo > 1) this.combo = 1;

    // Spin out: the car is rotating much faster than the track can follow.
    const spinning = Math.abs(car.yawRate) > t.spinOutYawRateRadS && car.speedMs > t.spinMinSpeedMs;
    if (spinning && this.pending > t.cancelMinPoints) {
      this.events.push({ type: 'spin', lost: Math.round(this.pending) });
      this.pending = 0;
      this.combo = 1;
      this.comboTimer = 0;
      this.drifting = false;
    }

    return { nitroCharge, coins, style: 0 };
  }
}
