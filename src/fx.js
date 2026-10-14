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

    // 9.9 / 9.7: damage smoke and fire, and the nitro flame trail, are driven by
    // the car's own state rather than by wheel slip.
    this.spawnDamageFx(car, dt);
    if (car.nitroState?.active) this.spawnNitroFlame(car, 1, dt);

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

  /**
   * A generic particle. The renderer switches on `kind`, so adding a new effect
   * is a colour + a life, not a new system.
   */
  pushParticle(x, y, vx, vy, { radiusM = 0.25, growth = 0.9, maxLife = 0.6, alpha = 0.4, kind = 'smoke', color = null } = {}) {
    if (this.particles.length >= this.tuning.skid.maxParticles) return null;
    const p = { x, y, vx, vy, radiusM, growth, life: 1, maxLife, alpha, kind, color };
    this.particles.push(p);
    return p;
  }

  /** 9.8: sparks off a wall scrape, at the contact point. */
  spawnSparks(event, strength = 0.5) {
    const count = Math.round(2 + 6 * strength);
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const speed = 3 + this.rng() * 7 * (0.4 + strength);
      this.pushParticle(event.x, event.y, Math.cos(a) * speed - (event.normalX ?? 0) * 2, Math.sin(a) * speed - (event.normalY ?? 0) * 2, {
        radiusM: 0.05,
        growth: -0.05,
        maxLife: 0.18 + this.rng() * 0.22,
        alpha: 0.85,
        kind: 'spark'
      });
    }
  }

  /** 9.8: the dust/debris puff of a real hit. */
  spawnImpact(event, strength = 0.5) {
    const count = Math.round(4 + 10 * strength);
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const speed = 1 + this.rng() * 4 * (0.4 + strength);
      this.pushParticle(event.x, event.y, Math.cos(a) * speed, Math.sin(a) * speed, {
        radiusM: 0.18 + this.rng() * 0.25,
        growth: 1.4,
        maxLife: 0.5 + this.rng() * 0.7,
        alpha: 0.3 + 0.3 * strength,
        kind: 'debris'
      });
    }
  }

  /** 9.9: the wreck explosion. */
  spawnWreck(car) {
    for (let i = 0; i < 34; i++) {
      const a = this.rng() * Math.PI * 2;
      const speed = 1.5 + this.rng() * 7;
      this.pushParticle(car.x, car.y, Math.cos(a) * speed, Math.sin(a) * speed, {
        radiusM: 0.3 + this.rng() * 0.5,
        growth: 2.2,
        maxLife: 0.7 + this.rng() * 1.1,
        alpha: 0.55,
        kind: i % 3 === 0 ? 'fire' : 'debris'
      });
    }
  }

  /** 9.10: a "Close Call!" puff of air where the near miss happened. */
  spawnNearMiss(nearMiss, car) {
    for (let i = 0; i < 8; i++) {
      const a = this.rng() * Math.PI * 2;
      this.pushParticle(nearMiss.x, nearMiss.y, Math.cos(a) * 3, Math.sin(a) * 3, {
        radiusM: 0.2,
        growth: 2.6,
        maxLife: 0.35,
        alpha: 0.25,
        kind: 'air'
      });
    }
    void car;
  }

  /** 9.7: nitro flames out of the exhaust. */
  spawnNitroFlame(car, strength, dt) {
    const perSecond = this.tuning.nitro.flameParticlesPerSecond * strength;
    const count = Math.round(perSecond * dt);
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    const back = -car.def.body.lengthM / 2;
    for (let i = 0; i < count; i++) {
      const side = (this.rng() - 0.5) * car.def.body.widthM * 0.7;
      const x = car.x + c * back - s * side;
      const y = car.y + s * back + c * side;
      this.pushParticle(x, y, -c * (6 + this.rng() * 5) + car.vx * 0.4, -s * (6 + this.rng() * 5) + car.vy * 0.4, {
        radiusM: 0.12 + this.rng() * 0.16,
        growth: 0.8,
        maxLife: 0.16 + this.rng() * 0.14,
        alpha: 0.6,
        kind: i % 2 === 0 ? 'flame' : 'flameCore'
      });
    }
  }

  /** 9.9: smoke at 50 % health, fire at 20 %, out of the damaged end of the car. */
  spawnDamageFx(car, dt) {
    const damage = car.damage;
    if (!damage) return;
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    const frontHeavy = damage.zones.front >= damage.zones.rear;
    const offset = (frontHeavy ? 1 : -1) * car.def.body.lengthM * 0.35;
    const x = car.x + c * offset;
    const y = car.y + s * offset;
    if (damage.smoke > 0 && this.rng() < damage.smoke * dt * 26) {
      this.pushParticle(x, y, car.vx * 0.3, car.vy * 0.3, {
        radiusM: 0.3,
        growth: 1.5,
        maxLife: 1.1 + this.rng() * 0.8,
        alpha: 0.24 + 0.3 * damage.smoke,
        kind: 'engineSmoke'
      });
    }
    if (damage.fire > 0 && this.rng() < damage.fire * dt * 30) {
      this.pushParticle(x + (this.rng() - 0.5) * 0.4, y + (this.rng() - 0.5) * 0.4, car.vx * 0.5, car.vy * 0.5, {
        radiusM: 0.18 + this.rng() * 0.2,
        growth: 0.6,
        maxLife: 0.25 + this.rng() * 0.25,
        alpha: 0.7,
        kind: this.rng() < 0.5 ? 'fire' : 'flameCore'
      });
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

export { clamp };
export { DriftScore } from './drift.js';
