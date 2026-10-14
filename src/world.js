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
      wall: hit.wall
    };
    if (body.impactEvents) body.impactEvents.push(event);
    this.impacts.push(event);
    if (this.impacts.length > 64) this.impacts.splice(0, this.impacts.length - 64);
    return event;
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
