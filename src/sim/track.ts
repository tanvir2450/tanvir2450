import { clamp, distance, dot, forward, lerp, mul, right, sub, vec, type Vec2 } from './math';
import type { SurfaceId } from './types';

export interface Patch { x: number; y: number; rx: number; ry: number; surface: SurfaceId; label: string }
export interface Marker { x: number; y: number; text: string }
export interface TrackConfig {
  id: string;
  code: string;
  name: string;
  subtitle: string;
  roadWidth: number;
  start: Vec2;
  points?: [number, number][];
  oval?: { cx: number; cy: number; rx: number; ry: number; segments: number };
  patches: Patch[];
  barriers: [number, number, number, number][];
  repair: Vec2;
  markers: Marker[];
}

export interface TrackSample { point: Vec2; heading: number; s: number }
export interface NearestPoint extends TrackSample { distance: number; index: number }

// The simulation, AI, surface query and renderer all use this ONE sampled centerline.
export class Track {
  readonly config: TrackConfig;
  readonly points: Vec2[];
  readonly cumulative: number[];
  readonly length: number;
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(config: TrackConfig) {
    this.config = config;
    const controls: Vec2[] = config.points
      ? config.points.map(([x, y]) => vec(x, y))
      : this.ovalControls(config);
    if (controls.length < 4) throw new Error(`Track ${config.id} needs at least four control points`);
    // 8 subdivisions per control segment: smooth curves without a per-frame spline solve.
    this.points = controls.flatMap((p1, i) => {
      const count = controls.length;
      const p0 = controls[(i - 1 + count) % count];
      const p2 = controls[(i + 1) % count];
      const p3 = controls[(i + 2) % count];
      return Array.from({ length: 8 }, (_, j) => {
        const t = j / 8, t2 = t * t, t3 = t2 * t;
        const interpolate = (a: number, b: number, c: number, d: number) =>
          0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        return vec(interpolate(p0.x, p1.x, p2.x, p3.x), interpolate(p0.y, p1.y, p2.y, p3.y));
      });
    });
    this.cumulative = [0];
    for (let i = 0; i < this.points.length; i++) {
      this.cumulative.push(this.cumulative[i] + distance(this.points[i], this.points[(i + 1) % this.points.length]));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
    const margin = config.roadWidth + 15;
    this.bounds = {
      minX: Math.min(...this.points.map(p => p.x)) - margin,
      minY: Math.min(...this.points.map(p => p.y)) - margin,
      maxX: Math.max(...this.points.map(p => p.x)) + margin,
      maxY: Math.max(...this.points.map(p => p.y)) + margin,
    };
  }

  private ovalControls(config: TrackConfig): Vec2[] {
    if (!config.oval) throw new Error(`Track ${config.id} has neither points nor oval data`);
    const { cx, cy, rx, ry, segments } = config.oval;
    // Start at the bottom of the oval, facing right.
    return Array.from({ length: segments }, (_, i) => {
      const angle = Math.PI / 2 - i * 2 * Math.PI / segments;
      return vec(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
    });
  }

  at(progress: number): TrackSample {
    const s = ((progress % this.length) + this.length) % this.length;
    let low = 0, high = this.points.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.cumulative[mid] <= s) low = mid;
      else high = mid - 1;
    }
    const i = low;
    const a = this.points[i], b = this.points[(i + 1) % this.points.length];
    const t = (s - this.cumulative[i]) / (this.cumulative[i + 1] - this.cumulative[i] || 1);
    return { point: vec(lerp(a.x, b.x, t), lerp(a.y, b.y, t)), heading: Math.atan2(b.y - a.y, b.x - a.x), s };
  }

  nearest(point: Vec2): NearestPoint {
    let bestDistSq = Infinity;
    let best: NearestPoint = { point: this.points[0], heading: 0, s: 0, distance: Infinity, index: 0 };
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i], b = this.points[(i + 1) % this.points.length];
      const ab = sub(b, a), ap = sub(point, a);
      const t = clamp(dot(ap, ab) / (dot(ab, ab) || 1), 0, 1);
      const q = vec(a.x + t * ab.x, a.y + t * ab.y);
      const dx = q.x - point.x, dy = q.y - point.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { point: q, heading: Math.atan2(ab.y, ab.x), s: this.cumulative[i] + t * (this.cumulative[i + 1] - this.cumulative[i]), distance: Math.sqrt(distSq), index: i };
      }
    }
    return best;
  }

  surfaceAt(point: Vec2, nearest = this.nearest(point)): SurfaceId {
    const patch = this.config.patches.find(p => ((point.x - p.x) / p.rx) ** 2 + ((point.y - p.y) / p.ry) ** 2 < 1);
    if (nearest.distance <= this.config.roadWidth / 2) return patch?.surface ?? 'asphalt';
    return patch?.surface === 'dirt' ? 'dirt' : 'grass';
  }

  // A candidate lane position for AI, including its forward heading.
  lane(progress: number, offset: number): TrackSample {
    const sample = this.at(progress);
    const normal = right(sample.heading);
    return { ...sample, point: sub(sample.point, mul(normal, -offset)) };
  }

  // Useful to indicate heading of the upcoming road for touch/novice assist.
  aheadOf(point: Vec2, meters: number): Vec2 {
    return this.at(this.nearest(point).s + meters).point;
  }

  roadDirectionAt(point: Vec2): Vec2 {
    return forward(this.nearest(point).heading);
  }
}
