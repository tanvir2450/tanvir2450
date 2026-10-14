/**
 * traffic.js - SECTION 9.10.
 *
 * Rival cars share the circuit with the player. They are real `Car` objects
 * driven by the same `Autopilot` the demo mode and the tests use, with a pace
 * ceiling (`traffic.pacePct`) and a lane offset, so what the player meets is
 * exactly the physics the player is driving.
 *
 * The traffic layer is also what detects the two rewards of section 9.10:
 *
 *   - SLIPSTREAM: sitting behind a rival (inside `slipstreamRangeM` and a
 *     `slipstreamHalfAngleDeg` cone) gives +`slipstreamSpeedPct` engine force
 *     and charges nitro, with air lines drawn by the renderer;
 *   - NEAR MISS: passing a rival or a track object within
 *     `nearMissDistanceM` at speed pops a "Close Call!", pays style points and
 *     charges nitro (with a per-object cooldown so one pass counts once).
 *
 * Rivals can also be hit: the collision solver handles the impulse and the
 * damage model sorts each contact into a hit zone, both ways.
 */

export class Traffic {
  /**
   * @param {object} config resolved config
   * @param {object} track built track
   * @param {{makeCar:(def:object)=>object}} deps factory for a Car (keeps this module testable)
   */
  constructor(config, track, deps = {}) {
    this.config = config;
    this.track = track;
    this.tuning = config.tuning.traffic;
    this.makeCar = deps.makeCar ?? null;
    this.rivals = [];
    this.nearMissTimer = 0;
    this.slipstream = { active: false, strength: 0, target: null };
    this.events = [];
    this.decorCooldowns = new Map();
    this.lastNearMissAt = -Infinity;
  }

  get enabled() {
    return Boolean(this.tuning.enabled) && typeof this.makeCar === 'function';
  }

  /** Place the field on the grid: behind the player start, spread out ahead. */
  spawn(defs) {
    this.rivals = [];
    if (!this.enabled) return this.rivals;
    const count = Math.min(this.tuning.count, defs?.length ?? 0);
    for (let i = 0; i < count; i++) {
      const def = defs[i % defs.length];
      const rival = this.makeCar(def);
      this.rivals.push({
        car: rival,
        ai: null,
        pace: this.tuning.pacePct[i % this.tuning.pacePct.length],
        lane: this.tuning.lateralOffsetM[i % this.tuning.lateralOffsetM.length],
        stuckTimer: 0,
        respawnTimer: 0,
        index: i
      });
    }
    this.reset();
    return this.rivals;
  }

  reset() {
    const centre = this.track.centreline;
    const start = this.track.startPose;
    const startIndex = nearestIndex(centre, start.x, start.y);
    for (const [i, rival] of this.rivals.entries()) {
      const aheadM = this.tuning.spawnAheadM + i * this.tuning.spawnSpreadM;
      const pose = poseAt(centre, startIndex, aheadM, rival.lane);
      rival.car.reset({ x: pose.x, y: pose.y, heading: pose.heading });
      rival.stuckTimer = 0;
      rival.respawnTimer = 0;
      if (rival.ai) {
        rival.ai.reset();
        rival.ai.paceMax = rival.pace;
        rival.ai.paceFactor = rival.pace;
        rival.ai.laneOffsetM = rival.lane;
      }
    }
    this.nearMissTimer = 0;
    this.decorCooldowns.clear();
    this.slipstream = { active: false, strength: 0, target: null };
  }

  /** Build the autopilots once the track/config are known. */
  attachAutopilot(factory) {
    for (const rival of this.rivals) {
      const ai = factory();
      ai.paceMax = rival.pace;
      ai.paceFactor = rival.pace;
      ai.laneOffsetM = rival.lane;
      rival.ai = ai;
    }
  }

  /** Obstacles for the player's autopilot (position + heading + speed). */
  obstacles() {
    return this.rivals.map((r) => ({
      x: r.car.x,
      y: r.car.y,
      heading: r.car.heading,
      speedMs: r.car.speedMs,
      radiusM: Math.max(r.car.def.body.lengthM, r.car.def.body.widthM) / 2
    }));
  }

  /**
   * One fixed step: drive the rivals, then work out what the player earns.
   *
   * @param {number} dt
   * @param {import('./car.js').Car} player
   * @returns {{slipstream:object, nearMisses:object[], rivalImpacts:object[]}}
   */
  update(dt, player) {
    const out = { slipstream: this.slipstream, nearMisses: [], rivalImpacts: [] };

    if (!this.enabled || !this.rivals.length) return out;
    const tuning = this.tuning;
    const world = this.track.world;

    for (const rival of this.rivals) {
      if (!rival.ai) continue;
      const input = rival.ai.update(dt, rival.car, { obstacles: this.obstacles().filter((o) => o.car !== rival) });
      const prevX = rival.car.x;
      const prevY = rival.car.y;
      rival.car.step(dt, input, world);

      // Recovery: a rival that has stopped (wall, wreck, player) is put back on
      // the road rather than left as a road block.
      if (rival.car.speedMs < tuning.stuckSpeedMs) rival.stuckTimer += dt;
      else rival.stuckTimer = 0;
      rival.respawnTimer = Math.max(0, rival.respawnTimer - dt);
      if (rival.stuckTimer > tuning.respawnSeconds && rival.respawnTimer === 0) {
        this.respawn(rival);
      }
      void prevX;
      void prevY;
    }

    /* ---- slipstream -------------------------------------------- */
    this.slipstream = { active: false, strength: 0, target: null };
    const heading = player.heading;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (const rival of this.rivals) {
      const dx = rival.car.x - player.x;
      const dy = rival.car.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > tuning.slipstreamRangeM || distance < 1e-3) continue;
      // Is it in front of us?
      const ahead = (dx * cos + dy * sin) / distance;
      const angleDeg = (Math.acos(Math.max(-1, Math.min(1, ahead))) * 180) / Math.PI;
      if (angleDeg > tuning.slipstreamHalfAngleDeg) continue;
      if (player.speedMs < tuning.slipstreamMinSpeedMs) continue;
      const strength = 1 - distance / tuning.slipstreamRangeM;
      if (strength > this.slipstream.strength) {
        this.slipstream = { active: true, strength, target: rival.car.id, angleDeg, distanceM: distance };
      }
    }

    // NOTE: `out.slipstream` must follow the freshly computed object, not the one
    // that existed when update() was entered.
    out.slipstream = this.slipstream;

    /* ---- near misses ------------------------------------------- */
    this.nearMissTimer = Math.max(0, this.nearMissTimer - dt);
    if (this.nearMissTimer <= 0 && player.speedMs > tuning.nearMissMinSpeedMs) {
      const close = this.closestPass(player);
      if (close) {
        this.nearMissTimer = tuning.nearMissCooldownSeconds;
        this.events.push({ type: 'nearMiss', x: close.x, y: close.y, distanceM: close.distanceM, what: close.what });
        out.nearMisses.push(close);
      }
    }

    /* ---- contacts: impulse + damage both ways ------------------ */
    for (const rival of this.rivals) {
      const contact = world.resolveCarCollision?.(player, rival.car, dt);
      if (contact) out.rivalImpacts.push(contact);
    }

    return out;
  }

  /** The nearest passable object the player just squeaked past. */
  closestPass(player) {
    const tuning = this.tuning;
    let best = null;
    const consider = (x, y, what, key) => {
      const distance = Math.hypot(x - player.x, y - player.y);
      if (distance > tuning.nearMissDistanceM) return;
      const cooldown = this.decorCooldowns.get(key) ?? -Infinity;
      if (player.timeSinceReset - cooldown < tuning.nearMissCooldownSeconds * tuning.decorCooldownScale) return;
      if (!best || distance < best.distanceM) best = { x, y, distanceM: distance, what, key };
    };
    for (const [i, rival] of this.rivals.entries()) consider(rival.car.x, rival.car.y, 'rival', `r${i}`);
    for (const [i, item] of (this.track.decor ?? []).entries()) consider(item.x, item.y, item.type, `d${i}`);
    if (best) this.decorCooldowns.set(best.key, player.timeSinceReset);
    return best;
  }

  /** Put a stuck rival back on the racing line, a little ahead. */
  respawn(rival) {
    const t = this.tuning;
    const pose = poseAt(this.track.centreline, nearestIndex(this.track.centreline, rival.car.x, rival.car.y), t.respawnAheadM, rival.lane);
    rival.car.reset({ x: pose.x, y: pose.y, heading: pose.heading, speedMs: t.respawnSpeedMs });
    rival.ai?.reset();
    rival.stuckTimer = 0;
    rival.respawnTimer = t.respawnLockoutSeconds;
  }
}

/** Nearest centreline index to a world point. */
export function nearestIndex(centre, x, y) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centre.length; i++) {
    const d = (centre[i].x - x) ** 2 + (centre[i].y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A point `aheadM` further along the centreline from `index`, offset `lateralM`
 * to the side of the direction of travel.
 */
export function poseAt(centre, index, aheadM, lateralM = 0) {
  const n = centre.length;
  let i = index % n;
  let travelled = 0;
  while (travelled < aheadM) {
    const a = centre[i % n];
    const b = centre[(i + 1) % n];
    travelled += Math.hypot(b.x - a.x, b.y - a.y);
    i = (i + 1) % n;
  }
  const a = centre[(i - 1 + n) % n];
  const b = centre[i % n];
  const heading = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  return { x: b.x + nx * lateralM, y: b.y + ny * lateralM, heading };
}
