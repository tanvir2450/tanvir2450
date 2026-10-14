/**
 * fx.js - the presentation layer's physics listeners: skid marks, tyre smoke,
 * dust, and the drift score. It only READS car telemetry, never changes it, so
 * the simulation stays reproducible with the effects switched off.
 */

import { clamp, clamp01, mulberry32 } from './mathx.js';

export class Effects {
  constructor(config) {
    this.config = config;
    this.tuning = config.tuning;
    this.rng = mulberry32(0x5eed);
    this.marks = [];
    this.particles = [];
    this.reset();
  }

  reset() {
    this.marks.length = 0;
    this.particles.length = 0;
    this.lastMark = new Map();
  }

  /**
   * @param {number} dt
   * @param {import('./car.js').Car} car
   */
  update(dt, car) {
    const skid = this.tuning.skid;
    const fade = skid.markFadeSeconds > 0 ? dt / skid.markFadeSeconds : 0;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      this.marks[i].life -= fade;
      if (this.marks[i].life <= 0) this.marks.splice(i, 1);
    }

    for (const wheel of car.wheels) {
      const surface = wheel.surface ?? this.config.surfaces.get(this.config.baseSurfaceId);
      const usage = wheel.usage;
      const spinning = wheel.wheelspin > 0.12;
      const marksOk = car.speedMs > skid.markMinSpeedMs && (usage > skid.markUsageThreshold || spinning);
      const previous = this.lastMark.get(wheel.id);
      if (marksOk && previous) {
        this.marks.push({
          x1: previous.x,
          y1: previous.y,
          x2: wheel.x,
          y2: wheel.y,
          widthM: skid.markWidthM,
          life: 1,
          alpha: skid.markAlpha,
          surfaceId: surface.id,
          intensity: clamp01((usage - skid.markUsageThreshold) / 0.8 + wheel.wheelspin)
        });
        this.lastMark.set(wheel.id, { x: wheel.x, y: wheel.y });
      } else if (marksOk) {
        this.lastMark.set(wheel.id, { x: wheel.x, y: wheel.y });
      } else {
        this.lastMark.set(wheel.id, { x: wheel.x, y: wheel.y });
      }
      if (this.marks.length > skid.maxMarkSegments) this.marks.splice(0, this.marks.length - skid.maxMarkSegments);

      /* ---- smoke / dust ---------------------------------------- */
      const particle = surface.particle;
      const wantSmoke = spinning ? skid.smokeUsageThreshold - 0.35 : skid.smokeUsageThreshold;
      const wantDust = skid.dustUsageThreshold;
      const spawning = (surface.id === 'asphalt' || surface.id === 'wet') && usage > wantSmoke - wheel.wheelspin * 0.4;
      const dusting = particle === 'dust' && usage > wantDust;
      if ((spawning || dusting) && this.particles.length < skid.maxParticles) {
        const strength = clamp01(usage - 0.6 + wheel.wheelspin);
        const count = Math.round(strength * 2 * (dusting ? 1.4 : 1));
        for (let i = 0; i < count; i++) {
          this.particles.push(this.spawnParticle(wheel, surface, strength, dusting));
        }
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
      p.radiusM += p.growth * dt;
    }
  }

  spawnParticle(wheel, surface, strength, dusting) {
    const rng = this.rng;
    const angle = rng() * Math.PI * 2;
    const speed = 1.2 + rng() * 2.6 * (0.4 + strength);
    return {
      x: wheel.x + (rng() - 0.5) * 0.3,
      y: wheel.y + (rng() - 0.5) * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radiusM: 0.25 + rng() * 0.35,
      growth: 1.1 + rng() * 1.4,
      life: 1,
      maxLife: 0.5 + rng() * 0.9,
      kind: dusting ? 'dust' : surface.id === 'wet' ? 'spray' : 'smoke',
      alpha: 0.16 + 0.32 * strength
    };
  }
}

/**
 * Drift scoring: points accrue while the car is genuinely sideways, and a
 * sustained drift chains into a combo multiplier. Spinning out loses the
 * un-banked points (the banked total is safe), which is what makes drifting a
 * risk/reward skill instead of a way to farm points by spinning.
 */
export class DriftScore {
  constructor(config) {
    this.config = config;
    this.tuning = config.tuning.drift;
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
  }

  get total() {
    return Math.round(this.score + this.pending);
  }

  /**
   * @param {number} dt
   * @param {import('./car.js').Car} car
   */
  update(dt, car) {
    const t = this.tuning;
    this.events.length = 0;
    this.angleDeg = Math.abs(car.slipAngleBodyDeg);
    const fastEnough = car.speedMs > t.minSpeedMs;
    const sideways = this.angleDeg > t.minSlipAngleDeg;
    const active = fastEnough && sideways && !car.isAirborne;
    this.comboTimer = Math.max(0, this.comboTimer - dt);

    if (active) {
      if (!this.drifting) {
        this.drifting = true;
        this.driftTime = 0;
      }
      this.driftTime += dt;
      const angleFactor = clamp01((this.angleDeg - t.minSlipAngleDeg) / 40);
      const speedFactor = clamp01(car.speedMs / 35);
      const gain = t.scorePerSecondAtFullSlide * angleFactor * (0.35 + 0.65 * speedFactor) * this.combo * dt;
      this.pending += gain;
      this.lastGain = gain / Math.max(dt, 1e-3);
    } else if (this.drifting) {
      if (this.driftTime > 0.35) {
        this.score += this.pending;
        this.combo = Math.min(t.comboMax, this.combo + t.comboStep * Math.min(2, this.driftTime));
        this.comboTimer = t.comboWindowSeconds;
        this.events.push({ type: 'bank', points: Math.round(this.pending), combo: this.combo, angleDeg: this.angleDeg });
      } else {
        this.score += this.pending;
      }
      this.pending = 0;
      this.drifting = false;
      this.driftTime = 0;
    }

    if (!this.drifting && this.comboTimer <= 0 && this.combo > 1) this.combo = 1;
    if (!this.drifting && !active && this.comboTimer > 0 && this.combo > 1) {
      // combo timer counts down; when it expires the multiplier resets
    }

    // Spin out: the car is rotating much faster than the track can follow.
    const spinning = Math.abs(car.yawRate) > t.spinOutYawRateRadS && car.speedMs > 3;
    if (spinning && this.pending > 5) {
      this.events.push({ type: 'spin', lost: Math.round(this.pending) });
      this.pending = 0;
      this.combo = 1;
      this.comboTimer = 0;
      this.drifting = false;
    }
  }
}

export { clamp };
