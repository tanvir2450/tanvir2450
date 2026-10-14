/**
 * mathx.js - small, dependency-free math helpers shared by the car physics,
 * the track geometry and the renderer. Pure functions only.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp01((v - a) / (b - a)));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Hermite smoothstep between two edges. */
export function smoothstep(edge0, edge1, v) {
  const t = clamp01(invLerp(edge0, edge1, v));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach: approaches `target` with `ratePerSecond`. */
export function expApproach(current, target, ratePerSecond, dt) {
  const k = 1 - Math.exp(-Math.max(0, ratePerSecond) * dt);
  return current + (target - current) * k;
}

/** Linear approach limited by a max delta per second. */
export function rateApproach(current, target, maxDeltaPerSecond, dt) {
  const delta = target - current;
  const maxDelta = maxDeltaPerSecond * dt;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

export function wrapAngle(a) {
  // Bring an angle into (-PI, PI]
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(a, b) {
  return wrapAngle(a - b);
}

export function len(x, y) {
  return Math.hypot(x, y);
}

/** Rotate a body-frame vector into world frame. */
export function bodyToWorld(vxBody, vyBody, heading, out = { x: 0, y: 0 }) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.x = vxBody * c - vyBody * s;
  out.y = vxBody * s + vyBody * c;
  return out;
}

/** Rotate a world-frame vector into body frame (x = forward, y = left). */
export function worldToBody(vxWorld, vyWorld, heading, out = { x: 0, y: 0 }) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.x = vxWorld * c + vyWorld * s;
  out.y = -vxWorld * s + vyWorld * c;
  return out;
}

export function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/**
 * Deterministic PRNG - keeps particle jitter / audio jitter identical between
 * runs so the fixed-timestep simulation is reproducible.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format a duration as m:ss.mmm (or s.mmm under a minute). */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--.---';
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (m === 0) return `${sign}${rest.toFixed(3)}s`;
  return `${sign}${m}:${rest < 10 ? '0' : ''}${rest.toFixed(3)}`;
}

/** Format a signed delta (used by the lap timer). */
export function formatDelta(seconds) {
  if (!Number.isFinite(seconds)) return '';
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(3)}`;
}
