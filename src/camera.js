/**
 * camera.js - chase camera: follows the car with a speed-dependent zoom and a
 * little lead in the direction of travel, and shakes on impacts.
 *
 * The camera works in metres; the renderer converts to pixels once, and the
 * zoom is fitted to the screen (`camera.fitWidthPx`) so a phone in portrait
 * sees a useful width of road instead of a keyhole.
 */

import { clamp, expApproach, lerp, mulberry32, smoothstep } from './mathx.js';

export class Camera {
  constructor(config) {
    this.tuning = config.tuning.camera;
    this.units = config.units;
    this.rng = mulberry32(0xbeef);
    this.x = 0;
    this.y = 0;
    this.zoom = this.tuning.baseZoom;
    // Player preference from the camera key (V), in three steps: normal, close,
    // wide. It multiplies the speed zoom instead of replacing it.
    this.zoomSteps = [1, 1.3, 0.75];
    this.zoomStepIndex = 0;
    this.zoomPreference = 1;
    // 9.7: nitro pulls the camera back a little (the "FOV" cue).
    this.boostZoom = 1;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.viewport = { width: 1280, height: 720 };
  }

  setViewport(width, height) {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  /**
   * Screen fit (phone): on a narrow canvas the authored world scale shows far
   * less road - a 390 px screen in portrait would show ~17 m, under a second of
   * warning at 120 kph. Screens at least `camera.fitWidthPx` wide are untouched
   * (this is exactly 1). Read every frame rather than cached, so the tuning
   * panel's slider takes effect while you drag it.
   */
  get fitZoom() {
    const t = this.tuning;
    const factor = t.fitWidthPx > 0 ? this.viewport.width / t.fitWidthPx : 1;
    const minFit = t.minFitZoom > 0 ? t.minFitZoom : 1;
    return clamp(factor, minFit, 1);
  }

  reset(car) {
    this.x = car.x;
    this.y = car.y;
    this.shake = 0;
  }

  /** @param {number} dt @param {import('./car.js').Car} car */
  update(dt, car) {
    const t = this.tuning;
    const lead = t.leadDistanceM * car.speedMs;
    const targetX = car.x + Math.cos(car.heading) * lead;
    const targetY = car.y + Math.sin(car.heading) * lead;
    this.x = expApproach(this.x, targetX, t.followLerpPerSecond, dt);
    this.y = expApproach(this.y, targetY, t.followLerpPerSecond, dt);

    // Zoom out with speed so fast sections stay readable.
    const speedPct = smoothstep(0, 70, car.speedMs);
    const targetZoom = lerp(t.baseZoom, t.baseZoom * (1 - t.speedZoomPct), speedPct) * this.zoomPreference * this.boostZoom;
    // clamped in the authored range first, then fitted to the screen, so a
    // phone's zoom-out is not swallowed by minZoom
    const shipped = clamp(targetZoom, t.minZoom, t.maxZoom);
    this.zoom = expApproach(this.zoom, shipped * this.fitZoom, 2.5, dt);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - t.shakeDecayPerSecond * dt);
      const amount = this.shake * this.shake;
      this.shakeX = (this.rng() - 0.5) * 2 * amount;
      this.shakeY = (this.rng() - 0.5) * 2 * amount;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** Cycle the player's zoom preference; returns the new multiplier. */
  cycleZoom() {
    this.zoomStepIndex = (this.zoomStepIndex + 1) % this.zoomSteps.length;
    this.zoomPreference = this.zoomSteps[this.zoomStepIndex];
    return this.zoomPreference;
  }

  addShake(amount) {
    this.shake = Math.min(1.5, this.shake + Math.max(0, amount));
  }

  get viewWidthM() {
    return this.viewport.width / (this.units.pxPerMeter * this.zoom);
  }

  get viewHeightM() {
    return this.viewport.height / (this.units.pxPerMeter * this.zoom);
  }

  /** World metres -> screen pixels (CSS pixels, before devicePixelRatio). */
  toScreen(x, y, out = { x: 0, y: 0 }) {
    const scale = this.units.pxPerMeter * this.zoom;
    out.x = (x - this.x) * scale + this.viewport.width / 2 + this.shakeX;
    out.y = (y - this.y) * scale + this.viewport.height / 2 + this.shakeY;
    return out;
  }

  /** Screen pixels -> world metres. */
  toWorld(px, py, out = { x: 0, y: 0 }) {
    const scale = this.units.pxPerMeter * this.zoom;
    out.x = (px - this.viewport.width / 2 - this.shakeX) / scale + this.x;
    out.y = (py - this.viewport.height / 2 - this.shakeY) / scale + this.y;
    return out;
  }
}
