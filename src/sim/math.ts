export interface Vec2 { x: number; y: number }

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, scalar: number): Vec2 => ({ x: a.x * scalar, y: a.y * scalar });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (v: Vec2): number => Math.hypot(v.x, v.y);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const moveTowards = (v: number, target: number, amount: number): number => v + clamp(target - v, -amount, amount);
export const forward = (angle: number): Vec2 => vec(Math.cos(angle), Math.sin(angle));
export const right = (angle: number): Vec2 => vec(-Math.sin(angle), Math.cos(angle));
export const angleDiff = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const interpolateAngle = (a: number, b: number, t: number): number => a + angleDiff(b, a) * t;
export const degrees = (rad: number): number => rad * 180 / Math.PI;
export const radians = (deg: number): number => deg * Math.PI / 180;
