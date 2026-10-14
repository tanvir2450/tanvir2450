import { add, clamp, dot, forward, mul, right, sub, vec, type Vec2 } from './math';
import type { CarState, HitZone, Tuning } from './types';

export interface Box { center: Vec2; heading: number; halfLength: number; halfWidth: number }
export interface Contact { normal: Vec2; penetration: number; point: Vec2 }

export function carBox(car: CarState): Box {
  return { center: car.position, heading: car.heading, halfLength: car.art.length / 2, halfWidth: car.art.width / 2 };
}

export function segmentBox(segment: [number, number, number, number], thickness = 0.6): Box {
  const [ax, ay, bx, by] = segment;
  return { center: vec((ax + bx) / 2, (ay + by) / 2), heading: Math.atan2(by - ay, bx - ax), halfLength: Math.hypot(bx - ax, by - ay) / 2, halfWidth: thickness / 2 };
}

function radiusOnAxis(box: Box, axis: Vec2): number {
  return box.halfLength * Math.abs(dot(axis, forward(box.heading))) + box.halfWidth * Math.abs(dot(axis, right(box.heading)));
}

// Separating Axis Theorem, for two truly rotated rectangles (not axis-aligned approximations).
export function intersectBoxes(a: Box, b: Box): Contact | null {
  const delta = sub(b.center, a.center);
  const axes = [forward(a.heading), right(a.heading), forward(b.heading), right(b.heading)];
  let minOverlap = Infinity;
  let bestAxis = axes[0];
  for (const axis of axes) {
    const overlap = radiusOnAxis(a, axis) + radiusOnAxis(b, axis) - Math.abs(dot(delta, axis));
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestAxis = dot(delta, axis) < 0 ? mul(axis, -1) : axis;
    }
  }
  const surfaceA = add(a.center, mul(bestAxis, radiusOnAxis(a, bestAxis)));
  const surfaceB = sub(b.center, mul(bestAxis, radiusOnAxis(b, bestAxis)));
  return { normal: bestAxis, penetration: minOverlap, point: mul(add(surfaceA, surfaceB), 0.5) };
}

export function hitZone(car: CarState, outwardNormal: Vec2): HitZone {
  const longitudinal = dot(outwardNormal, forward(car.heading));
  const lateral = dot(outwardNormal, right(car.heading));
  if (Math.abs(longitudinal) > Math.abs(lateral)) return longitudinal >= 0 ? 'front' : 'rear';
  return lateral >= 0 ? 'right' : 'left';
}

export interface CollisionResult { closingSpeed: number; impactEnergy: number; point: Vec2 }

// b=null denotes an immovable wall. Impulses respect inverse mass; walls also bleed
// tangent speed (scraping) without setting the car velocity to zero.
export function resolveCollision(a: CarState, b: CarState | null, contact: Contact, tuning: Tuning): CollisionResult {
  const invA = 1 / a.profile.mass;
  const invB = b ? 1 / b.profile.mass : 0;
  const invTotal = invA + invB;
  const { normal, penetration, point } = contact;
  const correction = Math.max(0, penetration - tuning.collision.penetrationSlop) * tuning.collision.positionalCorrection / invTotal;
  a.position = sub(a.position, mul(normal, correction * invA));
  if (b) b.position = add(b.position, mul(normal, correction * invB));

  const relative = sub(b?.velocity ?? vec(), a.velocity);
  const normalVelocity = dot(relative, normal);
  const closingSpeed = Math.max(0, -normalVelocity);
  if (normalVelocity < 0) {
    const restitution = b ? tuning.collision.restitution : tuning.collision.wallRestitution;
    const impulse = -(1 + restitution) * normalVelocity / invTotal;
    a.velocity = sub(a.velocity, mul(normal, impulse * invA));
    if (b) b.velocity = add(b.velocity, mul(normal, impulse * invB));

    // A restrained angular kick at the contact point; the main yaw response
    // still comes from the bicycle tire forces, not arbitrary sprite rotation.
    const addSpin = (car: CarState, direction: Vec2, sign: number) => {
      const r = sub(point, car.position);
      const moment = r.x * direction.y - r.y * direction.x;
      const inertia = car.profile.mass * (car.art.length ** 2 + car.art.width ** 2) / 12 * tuning.tires.yawInertiaScale;
      car.angularVelocity += clamp(sign * moment * impulse / inertia * tuning.collision.spinTransfer, -tuning.collision.maxSpinKick, tuning.collision.maxSpinKick);
    };
    addSpin(a, normal, -1);
    if (b) addSpin(b, normal, 1);
  }
  if (!b) {
    const tangent = right(Math.atan2(normal.y, normal.x));
    const tangentSpeed = dot(a.velocity, tangent);
    a.velocity = sub(a.velocity, mul(tangent, tangentSpeed * tuning.collision.wallFriction));
  }
  return { closingSpeed, impactEnergy: 0.5 * (1 / invTotal) * closingSpeed ** 2, point };
}
