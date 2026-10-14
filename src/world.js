/**
 * world.js - the collision + surface-query engine.
 *
 * The world is a set of rotated rectangles:
 *   - SURFACE rectangles carry a surface id (asphalt / wet / dirt / grass / oil),
 *     anything not covered by a surface rectangle uses tuning.baseSurface,
 *   - WALL rectangles are solid: the car is a rotated rectangle too and is
 *     resolved against them with SAT (minimum translation vector) plus a proper
 *     2D rigid-body impulse at the contact point, so scrapes spin the car and
 *     hard hits cost real speed.
 *
 * A uniform grid keeps the queries O(1) instead of O(rects).
 */

import { clamp } from './mathx.js';

export const SURFACE = 'surface';
export const WALL = 'wall';

/** Axis-aligned-in-local-space rectangle, optionally rotated about its centre. */
export class Box {
  constructor({ x, y, widthM, heightM, angle = 0, type = SURFACE, surface = null, id = null, tag = null }) {
    this.x = x;
    this.y = y;
    this.widthM = widthM;
    this.heightM = heightM;
    this.halfW = widthM / 2;
    this.halfH = heightM / 2;
    this.angle = angle;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.type = type;
    this.surface = surface;
    this.id = id;
    this.tag = tag;
    this.radius = Math.hypot(this.halfW, this.halfH);
    this.minX = x - this.radius;
    this.maxX = x + this.radius;
    this.minY = y - this.radius;
    this.maxY = y + this.radius;
  }

  /** True when the point (world metres) is inside the rectangle. */
  contains(px, py) {
    const dx = px - this.x;
    const dy = py - this.y;
    const localX = dx * this.cos + dy * this.sin;
    const localY = -dx * this.sin + dy * this.cos;
    return Math.abs(localX) <= this.halfW && Math.abs(localY) <= this.halfH;
  }

  /** The rotated rectangle's four corners in world space. */
  corners() {
    const out = [];
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1]
    ]) {
      const lx = sx * this.halfW;
      const ly = sy * this.halfH;
      out.push({ x: this.x + lx * this.cos - ly * this.sin, y: this.y + lx * this.sin + ly * this.cos });
    }
    return out;
  }
}

/**
 * Oriented bounding box for a body: centre offset from the centre of mass plus
 * half extents, so the impulse that gets applied at a corner also generates yaw.
 */
export function bodyBox(x, y, heading, offsetForwardM, halfLengthM, halfWidthM) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    x: x + cos * offsetForwardM,
    y: y + sin * offsetForwardM,
    cos,
    sin,
    halfW: halfLengthM,
    halfH: halfWidthM
  };
}

/** SAT between two oriented boxes: returns the minimum translation axis. */
export function satLeastPenetration(a, b) {
  const axes = [
    { x: a.cos, y: a.sin },
    { x: -a.sin, y: a.cos },
    { x: b.cos, y: b.sin },
    { x: -b.sin, y: b.cos }
  ];
  let best = null;
  for (const axis of axes) {
    const pa = projectBox(a, axis);
    const pb = projectBox(b, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null; // separated on this axis
    if (!best || overlap < best.overlap) {
      best = { overlap, axis: { x: axis.x, y: axis.y }, pa, pb };
    }
  }
  if (best) {
    // Point the axis from the wall towards the body so the caller can push out.
    const sign = (best.pa.min + best.pa.max) - (best.pb.min + best.pb.max) > 0 ? 1 : -1;
    best.axis.x *= sign;
    best.axis.y *= sign;
  }
  return best;
}

function projectBox(box, axis) {
  const ex = Math.abs((box.cos * axis.x + box.sin * axis.y) * box.halfW);
  const ey = Math.abs((-box.sin * axis.x + box.cos * axis.y) * box.halfH);
  const centre = box.x * axis.x + box.y * axis.y;
  const r = ex + ey;
  return { min: centre - r, max: centre + r };
}

export class World {
  /**
   * @param {object} config resolved config (surfaces, tuning, units)
   * @param {{boxes?:Box[], name?:string}} [options]
   */
  constructor(config, options = {}) {
    this.config = config;
    this.tuning = config.tuning;
    this.name = options.name ?? 'world';
    this.boxes = options.boxes ?? [];
    this.cellSizeM = this.tuning.world.gridCellM;
    this.grid = new Map();
    this.surfaceBoxes = [];
    this.wallBoxes = [];
    this.index();
    this.bounds = this.computeBounds();
    this.impacts = [];
  }

  index() {
    this.grid.clear();
    this.surfaceBoxes = [];
    this.wallBoxes = [];
    for (const box of this.boxes) {
      const minCellX = Math.floor((box.x - box.radius) / this.cellSizeM);
      const maxCellX = Math.floor((box.x + box.radius) / this.cellSizeM);
      const minCellY = Math.floor((box.y - box.radius) / this.cellSizeM);
      const maxCellY = Math.floor((box.y + box.radius) / this.cellSizeM);
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        for (let cy = minCellY; cy <= maxCellY; cy++) {
          const key = `${cx}:${cy}`;
          let bucket = this.grid.get(key);
          if (!bucket) this.grid.set(key, (bucket = []));
          bucket.push(box);
        }
      }
      if (box.type === SURFACE) this.surfaceBoxes.push(box);
      else if (box.type === WALL) this.wallBoxes.push(box);
    }
  }

  computeBounds() {
    if (!this.boxes.length) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of this.boxes) {
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX);
      maxY = Math.max(maxY, box.maxY);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Boxes that could contain the point (broad phase). */
  candidates(x, y) {
    return this.grid.get(`${Math.floor(x / this.cellSizeM)}:${Math.floor(y / this.cellSizeM)}`) ?? EMPTY;
  }

  /** Surface at a world position. Later boxes win, so patches can be layered. */
  surfaceAt(x, y) {
    const candidates = this.candidates(x, y);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const box = candidates[i];
      if (box.type === SURFACE && box.contains(x, y)) return box.surface;
    }
    return this.config.surfaces.get(this.config.baseSurfaceId);
  }

  /**
   * Resolve the body against every wall it overlaps.
   *
   * `body` is a Car-like object exposing x, y, heading, vx, vy, yawRate, massKg,
   * body.yawInertiaKgM2, body.lengthM/widthM and the cg offsets. The response is
   * an impulse at the deepest corner, so hitting a wall with one corner spins the
   * car the way a real one would.
   */
  resolveCollision(body, dt = 0) {
    const tuning = this.tuning.collision;
    const carBody = body.def.body;
    const halfLength = carBody.lengthM / 2;
    const halfWidth = carBody.widthM / 2;
    const offsetForward = (carBody.cgToFrontM - carBody.cgToRearM) / 2;
    const box = bodyBox(body.x, body.y, body.heading, offsetForward, halfLength, halfWidth);

    const candidates = this.candidates(box.x, box.y);
    let hit = null;
    for (const wall of candidates) {
      if (wall.type !== WALL) continue;
      if (Math.abs(wall.x - box.x) > wall.radius + halfLength + halfWidth) continue;
      if (Math.abs(wall.y - box.y) > wall.radius + halfLength + halfWidth) continue;
      const contact = satLeastPenetration(box, wall);
      if (contact && (!hit || contact.overlap > hit.overlap)) hit = { ...contact, wall };
    }
    if (!hit) return null;

    const n = hit.axis;
    const push = hit.overlap + tuning.skinM;
    body.x += n.x * push;
    body.y += n.y * push;

    /* contact point: the corner of the car deepest into the wall */
    const corners = [
      [halfLength, halfWidth],
      [halfLength, -halfWidth],
      [-halfLength, -halfWidth],
      [-halfLength, halfWidth]
    ].map(([lx, ly]) => ({
      x: box.x + lx * box.cos - ly * box.sin,
      y: box.y + lx * box.sin + ly * box.cos
    }));
    let contactPoint = corners[0];
    let bestDot = Infinity;
    for (const corner of corners) {
      const dot = (corner.x - box.x) * n.x + (corner.y - box.y) * n.y;
      if (dot < bestDot) {
        bestDot = dot;
        contactPoint = corner;
      }
    }

    const rx = contactPoint.x - body.x;
    const ry = contactPoint.y - body.y;
    const tx = -n.y;
    const ty = n.x;

    // Velocity of the contact point (body velocity + rotation about the CoM).
    const vcx = body.vx - body.yawRate * ry;
    const vcy = body.vy + body.yawRate * rx;
    const vn = vcx * n.x + vcy * n.y;
    const vt = vcx * tx + vcy * ty;

    const invMass = 1 / carBody.massKg;
    const invInertia = 1 / carBody.yawInertiaKgM2;
    const rnCross = rx * n.y - ry * n.x;
    const rtCross = rx * ty - ry * tx;

    const impactSpeed = Math.max(0, -vn);
    let jn = 0;
    if (vn < 0) {
      const restitution = impactSpeed > tuning.hardImpactSpeedMs ? 0 : tuning.wallRestitution;
      jn = (-(1 + restitution) * vn) / (invMass + (rnCross * rnCross) * invInertia);
      jn = Math.min(jn, tuning.maxImpactSpeedMs / invMass);
    }
    const jt = clamp(-vt / (invMass + rtCross * rtCross * invInertia), -tuning.wallFriction * jn, tuning.wallFriction * jn);

    const impulseX = jn * n.x + jt * tx;
    const impulseY = jn * n.y + jt * ty;

    body.vx += impulseX * invMass;
    body.vy += impulseY * invMass;
    body.yawRate += (rx * impulseY - ry * impulseX) * invInertia;

    // Scratch loss: sliding along a wall scrubs speed, hard hits cost a lot.
    if (impactSpeed > 0.3) {
      const loss = 1 - clamp(impactSpeed * tuning.impactSpeedLossPct * 0.12, 0, tuning.impactSpeedLossPct);
      body.vx *= loss;
      body.vy *= loss;
      body.yawRate *= tuning.wallScrapeSpeedLoss > 0 ? Math.max(0, 1 - impactSpeed * 0.05) : 1;
    }
    void dt;

    const event = {
      x: contactPoint.x,
      y: contactPoint.y,
      speedMs: impactSpeed,
      normalX: n.x,
      normalY: n.y,
      energy: impactSpeed * Math.sqrt(invMass),
      wall: hit.wall,
      kind: 'wall'
    };
    if (body.impactEvents) body.impactEvents.push(event);
    this.impacts.push(event);
    if (this.impacts.length > 64) this.impacts.splice(0, this.impacts.length - 64);
    return event;
  }

  /**
   * SECTION 9.8 - two cars, one impulse.
   *
   * Momentum is exchanged through the classic two-body impulse with the
   * rotational terms included, so a light car hit on a corner spins and a heavy
   * car hit square-on just shoves the other one. The positional correction is
   * split by inverse mass, which is what makes the heavier car "push" the
   * lighter one instead of the pair meeting in the middle.
   *
   * The bounce depends on the relative speed, the mass ratio (through the
   * reduced mass in the denominator) and the angle of the contact (through the
   * normal, which comes from the SAT axis).
   *
   * @param {object} a Car-like (x, y, heading, vx, vy, yawRate, def.body)
   * @param {object} b Car-like
   * @returns {object|null} the contact event, or null when they are not touching
   */
  resolveCarCollision(a, b, dt = 0) {
    const tuning = this.tuning.collision;
    const aBody = a.def.body;
    const bBody = b.def.body;
    const boxA = bodyBox(a.x, a.y, a.heading, (aBody.cgToFrontM - aBody.cgToRearM) / 2, aBody.lengthM / 2, aBody.widthM / 2);
    const boxB = bodyBox(b.x, b.y, b.heading, (bBody.cgToFrontM - bBody.cgToRearM) / 2, bBody.lengthM / 2, bBody.widthM / 2);
    if (Math.abs(boxA.x - boxB.x) > boxA.halfW + boxB.halfW + boxA.halfH + boxB.halfH) return null;
    if (Math.abs(boxA.y - boxB.y) > boxA.halfW + boxB.halfW + boxA.halfH + boxB.halfH) return null;
    const contact = satLeastPenetration(boxA, boxB);
    if (!contact) return null;

    // n points from B towards A, so A is separated along +n and B along -n.
    const n = contact.axis;
    const push = contact.overlap + tuning.skinM;
    const invMassA = 1 / aBody.massKg;
    const invMassB = 1 / bBody.massKg;
    const invMassTotal = invMassA + invMassB;
    a.x += n.x * push * (invMassA / invMassTotal);
    a.y += n.y * push * (invMassA / invMassTotal);
    b.x -= n.x * push * (invMassB / invMassTotal);
    b.y -= n.y * push * (invMassB / invMassTotal);

    // Contact point: the deepest corner of A inside B (good enough for a car).
    const corners = [
      [boxA.halfW, boxA.halfH],
      [boxA.halfW, -boxA.halfH],
      [-boxA.halfW, -boxA.halfH],
      [-boxA.halfW, boxA.halfH]
    ].map(([lx, ly]) => ({ x: boxA.x + lx * boxA.cos - ly * boxA.sin, y: boxA.y + lx * boxA.sin + ly * boxA.cos }));
    let contactPoint = corners[0];
    let bestDot = Infinity;
    for (const corner of corners) {
      const dot = (corner.x - boxB.x) * -n.x + (corner.y - boxB.y) * -n.y;
      if (dot < bestDot) {
        bestDot = dot;
        contactPoint = corner;
      }
    }

    const rax = contactPoint.x - a.x;
    const ray = contactPoint.y - a.y;
    const rbx = contactPoint.x - b.x;
    const rby = contactPoint.y - b.y;
    const invInertiaA = 1 / aBody.yawInertiaKgM2;
    const invInertiaB = 1 / bBody.yawInertiaKgM2;

    const vaX = a.vx - a.yawRate * ray;
    const vaY = a.vy + a.yawRate * rax;
    const vbX = b.vx - b.yawRate * rby;
    const vbY = b.vy + b.yawRate * rbx;

    const tx = -n.y;
    const ty = n.x;
    const vRelN = (vaX - vbX) * n.x + (vaY - vbY) * n.y;
    const vRelT = (vaX - vbX) * tx + (vaY - vbY) * ty;

    const rnA = rax * n.y - ray * n.x;
    const rnB = rbx * n.y - rby * n.x;
    const rtA = rax * ty - ray * tx;
    const rtB = rbx * ty - rby * tx;
    const denomN = invMassA + invMassB + rnA * rnA * invInertiaA + rnB * rnB * invInertiaB;
    const denomT = invMassA + invMassB + rtA * rtA * invInertiaA + rtB * rtB * invInertiaB;

    const impactSpeed = Math.max(0, -vRelN);
    let jn = 0;
    if (vRelN < 0) {
      const restitution = impactSpeed > tuning.hardImpactSpeedMs ? 0 : tuning.carRestitution;
      jn = Math.min((-(1 + restitution) * vRelN) / denomN, tuning.carImpulseMaxSpeedMs / Math.max(invMassA, invMassB) * 0.5);
    }
    const jt = clamp(-vRelT / denomT, -tuning.carFriction * jn, tuning.carFriction * jn);

    const impulseX = jn * n.x + jt * tx;
    const impulseY = jn * n.y + jt * ty;
    a.vx += impulseX * invMassA;
    a.vy += impulseY * invMassA;
    a.yawRate += (rax * impulseY - ray * impulseX) * invInertiaA;
    b.vx -= impulseX * invMassB;
    b.vy -= impulseY * invMassB;
    b.yawRate -= (rbx * impulseY - rby * impulseX) * invInertiaB;

    if (impactSpeed > 0.3) {
      const loss = 1 - clamp(impactSpeed * tuning.impactSpeedLossPct * 0.08, 0, tuning.impactSpeedLossPct * 0.6);
      a.vx *= loss;
      a.vy *= loss;
      b.vx *= loss;
      b.vy *= loss;
    }
    void dt;

    // Damage energy uses the REDUCED mass of the pair: a 1900 kg car hitting a
    // 1090 kg one delivers more energy than two equal cars at the same closing
    // speed, which is exactly what section 9.8 asks for.
    const reducedMass = 1 / invMassTotal;
    const energy = 0.5 * reducedMass * impactSpeed * impactSpeed;
    const base = {
      x: contactPoint.x,
      y: contactPoint.y,
      speedMs: impactSpeed,
      energy,
      closingSpeedMs: impactSpeed,
      other: b.id,
      kind: 'car'
    };
    const eventA = { ...base, normalX: n.x, normalY: n.y };
    const eventB = { ...base, normalX: -n.x, normalY: -n.y, other: a.id };
    if (a.impactEvents) a.impactEvents.push(eventA);
    if (b.impactEvents) b.impactEvents.push(eventB);
    this.impacts.push(eventA);
    if (this.impacts.length > 64) this.impacts.splice(0, this.impacts.length - 64);
    return eventA;
  }
}

const EMPTY = [];

/** A world with no geometry at all: used by tests, benches and the tuning tools. */
export function createFlatWorld(config, surfaceId = null) {
  const world = new World(config, { name: 'flat' });
  const wanted = surfaceId ?? config.defaultSurfaceId;
  const surface = config.surfaces.get(wanted) ?? config.surfaces.get(config.baseSurfaceId);
  world.surfaceAt = () => surface;
  world.resolveCollision = () => null;
  world.bounds = { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 };
  return world;
}
