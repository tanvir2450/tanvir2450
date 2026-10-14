/**
 * hud.js - the dashboard. Everything here is DOM + one small canvas for the
 * tachometer, so the numbers are crisp at any resolution and the game canvas
 * stays purely the world.
 *
 * It reads telemetry and writes text/style; it never touches the simulation.
 */

import { clamp, clamp01, formatTime } from './mathx.js';

export class Hud {
  /**
   * @param {object} els map of DOM elements
   * @param {object} config resolved config
   * @param {object} track built track
   */
  constructor(els, config, track) {
    this.els = els;
    this.config = config;
    this.track = track;
    this.tach = els.tach?.getContext('2d') ?? null;
    this.minimap = els.minimap?.getContext('2d') ?? null;
    this.messageTimer = 0;
    this.minimapPath = null;
    this.minimapBounds = null;
    this.buildMinimapPath();
    this.lastSurface = null;
    this.surfaceTimer = 0;
  }

  buildMinimapPath() {
    const centre = this.track.centreline;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of centre) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    this.minimapBounds = { minX, minY, maxX, maxY };
  }

  message(text, seconds = 2.2) {
    if (!this.els.message) return;
    this.els.message.textContent = text;
    this.els.message.classList.add('visible');
    this.messageTimer = seconds;
  }

  update(dt, telemetry, state) {
    const els = this.els;
    const engine = telemetry.engine;
    const kph = telemetry.speedKph;

    /* ---- dash ---------------------------------------------------- */
    if (els.speed) els.speed.textContent = Math.round(kph).toString();
    if (els.gear) {
      const gear = engine?.gear ?? 1;
      els.gear.textContent = gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear);
      els.gear.classList.toggle('reverse', gear === -1);
    }
    if (els.rpmDigital) els.rpmDigital.textContent = Math.round(engine?.rpmDisplay ?? 0).toString();
    if (els.power) els.power.textContent = `${Math.round(engine?.powerKw ?? 0)} kW`;
    if (els.surface) {
      const surface = this.config.surfaces.get(telemetry.surface);
      if (telemetry.surface !== this.lastSurface) {
        this.lastSurface = telemetry.surface;
        els.surface.textContent = surface?.name?.toUpperCase() ?? '';
        els.surface.dataset.surface = telemetry.surface;
        this.surfaceTimer = 1.4;
      }
      this.surfaceTimer = Math.max(0, this.surfaceTimer - dt);
      els.surface.classList.toggle('flash', this.surfaceTimer > 0 && telemetry.surface !== 'asphalt' && this.surfaceTimer > 0.2);
    }

    /* ---- grip bars ---------------------------------------------- */
    const front = telemetry.front;
    const rear = telemetry.rear;
    this.setBar(els.gripFront, front?.usageLat ?? 0, front?.sliding);
    this.setBar(els.gripRear, rear?.usageLat ?? 0, rear?.sliding);
    if (els.wheelspin) els.wheelspin.style.opacity = clamp01((rear?.wheelspin ?? 0) * 1.5).toString();

    /* ---- timers -------------------------------------------------- */
    const lap = state.lapTimer;
    if (els.lapTime) els.lapTime.textContent = formatTime(lap.lapTime);
    if (els.bestLap) els.bestLap.textContent = lap.bestLap === null ? '--:--.---' : formatTime(lap.bestLap);
    if (els.lastLap) els.lastLap.textContent = lap.lastLap === null ? '--:--.---' : formatTime(lap.lastLap);
    if (els.lapCount) els.lapCount.textContent = `LAP ${lap.lapCount + 1}`;
    if (els.lastLapRow) els.lastLapRow.classList.toggle('highlight', state.lapJustCompleted > 0);
    if (state.lapJustCompleted > 0) {
      state.lapJustCompleted -= dt;
    }

    /* ---- drift score -------------------------------------------- */
    const drift = state.drift;
    if (els.driftScore) els.driftScore.textContent = drift.total.toLocaleString();
    if (els.driftPending) els.driftPending.textContent = drift.pending > 5 ? `+${Math.round(drift.pending)}` : '';
    if (els.driftCombo) {
      els.driftCombo.textContent = `x${drift.combo.toFixed(2)}`;
      els.driftCombo.classList.toggle('active', drift.combo > 1.01);
    }
    if (els.driftPanel) els.driftPanel.classList.toggle('drifting', drift.drifting);

    /* ---- car / assists / inputs --------------------------------- */
    if (els.carName) els.carName.textContent = telemetry.name;
    if (els.carClass) els.carClass.textContent = telemetry.klass;
    if (els.assists) els.assists.textContent = state.assists ? 'ON' : 'OFF';
    if (els.mute) els.mute.textContent = state.muted ? 'MUTED' : 'SOUND ON';
    if (els.debugNote) els.debugNote.textContent = state.debug ? 'TELEMETRY ON' : '';

    this.drawTach(engine, telemetry);
    this.drawMinimap(telemetry);

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) els.message?.classList.remove('visible');
    }
  }

  setBar(element, usage, sliding) {
    if (!element) return;
    element.style.width = `${Math.round(clamp01(usage / 1.6) * 100)}%`;
    element.classList.toggle('sliding', Boolean(sliding) || usage > 1);
    element.classList.toggle('high', usage > 0.8 && usage <= 1);
  }

  drawTach(engine, telemetry) {
    const ctx = this.tach;
    if (!ctx) return;
    const canvas = ctx.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = canvas.clientWidth || 150;
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.42;
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const pct = clamp01(engine?.rpmPct ?? 0);

    // track
    ctx.lineWidth = size * 0.075;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.stroke();

    // redline zone
    const redlineStart = 0.88;
    ctx.strokeStyle = 'rgba(255,64,54,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start + sweep * redlineStart, start + sweep);
    ctx.stroke();

    // value
    const limiterFlicker = engine?.limiterActive ? 0.55 + 0.45 * Math.sin(performance.now() / 40) : 1;
    ctx.strokeStyle = pct > 0.92 ? `rgba(255,80,64,${limiterFlicker})` : pct > 0.8 ? '#ffb703' : '#31d0aa';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * Math.max(0.004, pct));
    ctx.stroke();

    // needle
    const angle = start + sweep * pct;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius * 0.82, cy + Math.sin(angle) * radius * 0.82);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.035, 0, Math.PI * 2);
    ctx.fill();

    // shift light
    if (engine?.shifting || engine?.torqueCut > 0.5) {
      ctx.fillStyle = 'rgba(255,180,60,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy - radius * 1.12, size * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    void telemetry;
  }

  drawMinimap(telemetry) {
    const ctx = this.minimap;
    if (!ctx) return;
    const canvas = ctx.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 150;
    const height = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bounds = this.minimapBounds;
    const pad = 10;
    const sx = (width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX);
    const sy = (height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(sx, sy);
    const ox = pad + (width - pad * 2 - (bounds.maxX - bounds.minX) * scale) / 2 - bounds.minX * scale;
    const oy = pad + (height - pad * 2 - (bounds.maxY - bounds.minY) * scale) / 2 - bounds.minY * scale;
    const project = (x, y) => ({ x: x * scale + ox, y: y * scale + oy });

    const centre = this.track.centreline;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const first = project(centre[0].x, centre[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < centre.length; i++) {
      const p = project(centre[i].x, centre[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    const car = project(telemetry.x, telemetry.y);
    ctx.fillStyle = '#ffd60a';
    ctx.beginPath();
    ctx.arc(car.x, car.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export { clamp };
