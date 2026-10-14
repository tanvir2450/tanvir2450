/**
 * nitro.js - SECTION 9.7.
 *
 * One tank per car (`cars.json` -> `nitro.capacity`), filled by driving well:
 * drifting (9.6), slipstreaming and near misses (9.10). While it is active:
 *
 *   - +40 % engine force and +20 % top speed (tuning.nitro.forceMultiplier /
 *     topSpeedMultiplier),
 *   - slightly less steering lock (steerAnglePct) so the extra speed still has
 *     to be driven,
 *   - flame trail, speed lines, a camera pull-back and an engine audio layer -
 *     all driven from the `active` flag and `pct` this module reports.
 *
 * Held to empty it overheats: a `overheatLockoutMs` (1.5 s) lockout before it
 * can be used again, and until then it cannot be activated even if it has
 * refilled a little.
 */

import { clamp, clamp01 } from './mathx.js';

export class Nitro {
  constructor(config, carDef) {
    this.tuning = config.tuning.nitro;
    this.economy = config.tuning.economy;
    this.capacity = Math.max(1, carDef?.nitro?.capacity ?? 100);
    this.power = Math.max(0.1, carDef?.nitro?.power ?? 1);
    this.reset();
  }

  reset() {
    this.amount = this.capacity;
    this.active = false;
    this.lockout = 0;
    this.overheated = false;
    this.usedThisSession = 0;
    this.emptyAt = null;
    this.slipstream = 0;
  }

  /** 0..1 for the HUD gauge. */
  get pct() {
    return clamp01(this.amount / this.capacity);
  }

  get ready() {
    return this.lockout <= 0 && this.amount > 0;
  }

  /** Add nitro. Returns the amount actually added. */
  fill(amount) {
    if (amount <= 0) return 0;
    const before = this.amount;
    this.amount = clamp(this.amount + amount, 0, this.capacity);
    return this.amount - before;
  }

  /** Fill from a drift bank: `points` of drift score (9.6). */
  fillFromDrift(points) {
    return this.fill(points * this.tuning.fillFromDriftPerPoint);
  }

  /** Fill from a near miss (9.10). */
  fillFromNearMiss() {
    return this.fill((this.capacity * this.tuning.fillFromNearMissPct) / 100);
  }

  /**
   * Fill while slipstreaming. Capped at `fillFromSlipstreamMaxPct` so sitting in
   * someone's tow forever cannot fill an empty tank to the brim instantly.
   */
  fillFromSlipstream(dt, strength = 1) {
    const cap = (this.capacity * this.tuning.fillFromSlipstreamMaxPct) / 100;
    if (this.amount >= cap) return 0;
    this.slipstream = Math.min(cap, this.slipstream + this.tuning.fillFromSlipstreamPerSecond * dt * strength);
    const want = this.tuning.fillFromSlipstreamPerSecond * dt * strength;
    return Math.min(this.fill(want), Math.max(0, cap - this.amount));
  }

  /**
   * @param {number} dt
   * @param {{throttle?:number, brake?:number, handbrake?:boolean, nitro?:boolean}} input
   * @returns {{active:boolean, pct:number, forceMultiplier:number, topSpeedMultiplier:number,
   *            overheated:boolean, lockoutPct:number, justEmptied:boolean}}
   */
  update(dt, input = {}) {
    const t = this.tuning;
    if (this.lockout > 0) {
      this.lockout = Math.max(0, this.lockout - dt * 1000);
      this.active = false;
      if (this.lockout === 0) this.overheated = false;
    } else {
      const wants = Boolean(input.nitro) && Boolean(input.throttle) && !input.handbrake;
      this.active = wants && this.amount > 0;
      if (this.active) {
        this.amount = Math.max(0, this.amount - t.drainPerSecond * dt);
        this.usedThisSession += t.drainPerSecond * dt;
        if (this.amount <= 0) {
          this.active = false;
          this.lockout = t.overheatLockoutMs;
          this.overheated = true;
          this.emptyAt = true;
        }
      }
    }

    const boost = this.active ? this.power : 0;
    return {
      active: this.active,
      pct: this.pct,
      // The multipliers are what the drivetrain and the aero/steering read.
      forceMultiplier: this.active ? 1 + (t.forceMultiplier - 1) * boost : 1,
      topSpeedMultiplier: this.active ? 1 + (t.topSpeedMultiplier - 1) * boost : 1,
      overheated: this.overheated,
      lockoutPct: clamp(this.lockout / Math.max(1, t.overheatLockoutMs), 0, 1),
      justEmptied: false
    };
  }
}
