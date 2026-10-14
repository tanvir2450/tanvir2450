/**
 * damage.js - SECTION 9.9.
 *
 * Every impact is sorted into a HIT ZONE (front / rear / left / right) by the
 * angle of the impact normal against the car's own heading, and turned into
 * damage from the impact ENERGY that the collision solver measured:
 *
 *     damage = energy * armorScale / armor
 *
 * Armor comes from the car (cars.json), so a 1900 kg muscle car shrugs off what
 * bends a 1090 kg hypercar. Damage is tracked per zone and as a total health
 * value, and then turned into performance penalties the physics can use:
 *
 *   - front damage  -> engine smoke and a lower top speed,
 *   - side damage   -> the wheel pulls to that side,
 *   - rear damage   -> less acceleration (drive and traction both suffer),
 *   - total health  -> smoke at 50 %, fire at 20 %, a wreck at 0.
 *
 * Repairing costs coins (an economy sink); every car carries
 * `economy.freeQuickRepairs` free quick repairs, which restore the car to
 * `quickRepairHealthPct` without paying.
 */

import { clamp, clamp01 } from './mathx.js';

export const ZONES = ['front', 'rear', 'left', 'right'];

export class DamageModel {
  constructor(config, carDef) {
    this.tuning = config.tuning.damage;
    this.economy = config.tuning.economy;
    this.armor = Math.max(0.05, carDef?.armor ?? 1);
    this.maxHealth = this.tuning.healthMax;
    this.zoneMax = this.maxHealth / ZONES.length;
    this.reset();
  }

  reset() {
    this.health = this.maxHealth;
    this.zones = { front: 0, rear: 0, left: 0, right: 0 };
    this.lastImpact = null;
    this.wrecked = false;
    this.wreckTimer = 0;
    this.scrapeTimer = 0;
    this.smoke = 0;
    this.fire = 0;
    this.steerPullRad = 0;
    this.accelScale = 1;
    this.topSpeedScale = 1;
    this.totalZones = 0;
  }

  /** Which hit zone did an impact with this normal (world space) land on? */
  zoneFor(normalX, normalY, heading, localX = 0) {
    const dir = Math.atan2(normalY, normalX); // where the impact came FROM
    const relative = Math.atan2(Math.sin(dir - heading), Math.cos(dir - heading));
    const deg = (relative * 180) / Math.PI;
    if (deg > -45 && deg <= 45) return 'front';
    if (deg > 45 && deg <= 135) return 'right';
    if (deg > 135 || deg <= -135) return 'rear';
    void localX;
    return 'left';
  }

  /**
   * Apply an impact.
   *
   * @param {{speedMs:number, energy:number, normalX:number, normalY:number,
   *          kind?:'wall'|'car', x?:number, y?:number}} impact
   * @param {object} car the car being hit (for heading + position)
   * @returns {{damage:number, zone:string, heavy:boolean, wrecked:boolean}|null}
   */
  applyImpact(impact, car) {
    if (!this.tuning.enabled || this.wrecked) return null;
    const speed = impact.speedMs ?? 0;
    const energy = Math.max(0, impact.energy ?? 0);
    if (speed < this.tuning.minImpactSpeedMs || energy < this.tuning.minImpactEnergyJ) {
      // A light touch: still counts as a scrape if the car is sliding along.
      if (speed > 0.4) this.scrapeTimer = 0.12;
      return null;
    }
    const zone = this.zoneFor(impact.normalX ?? 0, impact.normalY ?? 0, car.heading);
    const bias = this.tuning.zoneBias[zone] ?? 1;
    const damage = Math.min(
      this.maxHealth,
      ((energy * this.tuning.armorScale) / this.armor) * bias
    );
    this.zones[zone] = Math.min(this.zoneMax, this.zones[zone] + damage);
    this.health = Math.max(0, this.health - damage);
    this.recompute(car);
    const result = { damage, zone, heavy: speed > 5, wrecked: this.wrecked, speedMs: speed };
    this.lastImpact = { ...result, x: impact.x, y: impact.y };
    return result;
  }

  /** Rubbing a wall: continuous, gentle damage while the body is against it. */
  applyScrape(dt, contactSpeedMs) {
    if (!this.tuning.enabled || this.wrecked) return 0;
    if (contactSpeedMs < 1.5) return 0;
    const damage = this.tuning.scrapeDamagePerSecond * dt;
    this.zones.left = Math.min(this.zoneMax, this.zones.left + damage * 0.5);
    this.zones.right = Math.min(this.zoneMax, this.zones.right + damage * 0.5);
    this.health = Math.max(0, this.health - damage);
    this.scrapeTimer = 0.1;
    return damage;
  }

  /** Recompute health-derived scales after any change. */
  recompute(car) {
    const d = this.tuning;
    const zones = this.zones;
    this.totalZones = zones.front + zones.rear + zones.left + zones.right;

    // 9.9 front damage lowers the top speed (and makes the engine smoke).
    const frontPct = (zones.front / this.zoneMax) * 100;
    const frontEffect = clamp01((frontPct - d.frontEffectAtZonePct) / (100 - d.frontEffectAtZonePct));
    this.topSpeedScale = 1 - Math.min(d.topSpeedLossMaxPct, frontEffect * d.topSpeedLossPctPerDamage * frontPct);

    // 9.9 rear damage lowers acceleration.
    const rearPct = (zones.rear / this.zoneMax) * 100;
    const rearEffect = clamp01((rearPct - d.rearEffectAtZonePct) / (100 - d.rearEffectAtZonePct));
    this.accelScale = 1 - Math.min(d.accelLossMaxPct, rearEffect * d.accelLossPctPerDamage * rearPct);

    // 9.9 side damage pulls the steering toward the damaged side: the pull scales
    // with the WORST flank (a bent left corner does not care how clean the right
    // one is) up to steerPullMaxDeg.
    const worstSidePct = (Math.max(zones.left, zones.right) / this.zoneMax) * 100;
    const sideEffect = clamp01((worstSidePct - d.sideEffectAtZonePct) / (100 - d.sideEffectAtZonePct));
    const pullDeg = sideEffect * d.steerPullMaxDeg;
    const pullDirection = zones.left + zones.right === 0 ? 0 : zones.left >= zones.right ? 1 : -1;
    this.steerPullRad = (pullDeg * Math.PI) / 180 * pullDirection;

    // These thresholds are percentages (50 / 20), so compare like with like.
    const healthPct = this.healthPct * 100;
    this.smoke = clamp01((d.smokeAtHealthPct - healthPct) / Math.max(1, d.smokeAtHealthPct - d.fireAtHealthPct));
    this.fire = clamp01((d.fireAtHealthPct - healthPct) / Math.max(1, d.fireAtHealthPct));
    if (this.health <= 0 && !this.wrecked) {
      this.wrecked = true;
      this.wreckTimer = 0;
    }
    if (car) car.damage = this;
  }

  /** 0..1 */
  get healthPct() {
    return clamp01(this.health / this.maxHealth);
  }

  /** Zone fill 0..1 for the HUD. */
  zonePct(zone) {
    return clamp01(this.zones[zone] / this.zoneMax);
  }

  /** The cost of repairing the current damage, in coins. */
  repairCost() {
    const damage = this.maxHealth - this.health;
    if (damage <= 0.5) return 0;
    return Math.round(Math.max(this.economy.repairCostMin, damage * this.economy.repairCostPerDamage));
  }

  /**
   * @param {number} coins
   * @param {boolean} freeQuickRepair use the mission's free fix instead of paying
   * @returns {{ok:boolean, reason?:string, cost:number, restored:number}}
   */
  repair(coins, freeQuickRepair = false) {
    const cost = this.repairCost();
    if (cost === 0) return { ok: true, cost: 0, restored: 0 };
    if (freeQuickRepair) {
      const restored = this._restoreTo(this.maxHealth * (this.economy.quickRepairHealthPct / 100));
      return { ok: true, cost: 0, restored };
    }
    if (coins < cost) return { ok: false, reason: 'not enough coins', cost, restored: 0 };
    const restored = this._restoreTo(this.maxHealth);
    return { ok: true, cost, restored };
  }

  _restoreTo(health) {
    const before = this.health;
    const ratio = health / this.maxHealth;
    for (const zone of ZONES) this.zones[zone] = this.zoneMax * (1 - ratio);
    this.health = Math.max(before, health);
    this.wrecked = this.health <= 0;
    this.recompute();
    return this.health - before;
  }

  /** Damage from an explosion/wreck so the effects layer can react. */
  wreck() {
    this.health = 0;
    for (const zone of ZONES) this.zones[zone] = this.zoneMax;
    this.recompute();
    return this.wrecked;
  }

  /** Advance the wreck timer; returns true on the frame the wreck happened. */
  update(dt) {
    const wasWrecked = this.wrecked;
    if (this.wrecked && wasWrecked) this.wreckTimer += dt;
    this.scrapeTimer = Math.max(0, this.scrapeTimer - dt);
    void clamp;
    return this.wrecked && this.wreckTimer < dt * 1.5;
  }
}
