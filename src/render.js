/**
 * render.js - the 2D renderer. This is the ONLY module that converts metres to
 * pixels (1 m = tuning.simulation.pxPerMeter px, scaled by the camera zoom).
 *
 * The simulation runs at a fixed 60 Hz; the renderer draws interpolated poses
 * (`alpha` between the previous and the current physics state), which is what
 * makes the motion smooth on 30, 60 or 144 Hz displays.
 */

import { clamp, lerp, wrapAngle } from './mathx.js';
import { WALL } from './world.js';

/**
 * roundRect() only landed in browsers in 2022; the car and the surface patches
 * are rounded, so fill the path in by hand on anything older instead of
 * throwing on the first frame.
 */
function ensureRoundRect(ctx) {
  if (!ctx || typeof ctx.roundRect === 'function') return;
  ctx.roundRect = function roundRect(x, y, w, h, r) {
    const radius = Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
  };
}

export class Renderer {
  constructor(canvas, config, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    ensureRoundRect(this.ctx);
    this.config = config;
    this.track = track;
    this.units = config.units;
    this.dpr = 1;
    this.debug = false;
    this.grassPattern = null;
    this.roadPath = null;
    this.speedLinePhase = 0;
    this.resize();
  }

  /**
   * 9.12: swap the circuit without re-creating the renderer (a rebuilt world
   * keeps the same canvas, DPR and cached patterns; only the geometry changes).
   */
  setTrack(track) {
    this.track = track;
    this.roadPath = null; // rebuilt lazily from the new centre line
    return this;
  }

  resize() {
    const { canvas } = this;
    const rect = canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(240, Math.round(rect.height));
    canvas.width = Math.round(width * this.dpr);
    canvas.height = Math.round(height * this.dpr);
    this.viewport = { width, height };
    this.makeGrassPattern();
  }

  makeGrassPattern() {
    const size = 16;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');
    const base = this.config.surfaces.get(this.config.baseSurfaceId).render.fill;
    octx.fillStyle = base;
    octx.fillRect(0, 0, size, size);
    octx.strokeStyle = 'rgba(0,0,0,0.055)';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(-2, size);
    octx.lineTo(size, -2);
    octx.moveTo(size / 2 - 2, size + 2);
    octx.lineTo(size + 2, size / 2 - 2);
    octx.stroke();
    this.grassPattern = this.ctx.createPattern(off, 'repeat');
  }

  /** Build (and cache) the road as a stroked polyline in world metres. */
  buildRoadPath() {
    const path = new Path2D();
    const centre = this.track.centreline;
    path.moveTo(centre[0].x, centre[0].y);
    for (let i = 1; i < centre.length; i++) path.lineTo(centre[i].x, centre[i].y);
    path.closePath();
    this.roadPath = path;
  }

  /**
   * @param {object} frame
   * @param {import('./car.js').Car} frame.car
   * @param {import('./camera.js').Camera} frame.camera
   * @param {number} frame.alpha interpolation factor 0..1
   * @param {import('./fx.js').Effects} frame.effects
   * @param {object} frame.hud extra numbers the overlay needs
   */
  draw(frame) {
    const { ctx } = this;
    const { camera } = frame;
    if (!this.roadPath) this.buildRoadPath();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    const scale = this.units.pxPerMeter * camera.zoom;
    ctx.save();
    ctx.translate(this.viewport.width / 2 + camera.shakeX, this.viewport.height / 2 + camera.shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    this.drawGround(ctx, camera);
    this.drawTrack(ctx, scale);
    this.drawStartLine(ctx);
    this.drawSkidMarks(ctx, frame.effects);
    this.drawDecor(ctx);
    this.drawParticles(ctx, frame.effects, false);

    // 9.10: rivals are drawn like the player's car, minus the input effects.
    if (frame.traffic?.rivals?.length) {
      for (const rival of frame.traffic.rivals) {
        const rivalPose = this.carPose(rival.car, frame.alpha);
        this.drawCar(ctx, rival.car, rivalPose, { brake: rival.car.brakeRequest }, scale, true);
      }
    }

    const pose = this.carPose(frame.car, frame.alpha);
    this.drawCar(ctx, frame.car, pose, frame.input, scale);
    if (frame.traffic?.slipstream?.active) this.drawAirLines(ctx, frame.car, frame.traffic.slipstream, scale);
    this.drawParticles(ctx, frame.effects, true);
    if (this.debug) this.drawDebug(ctx, frame.car, pose, scale, frame);
    ctx.restore();

    // 9.7: nitro speed lines live in screen space (they are a lens effect).
    this.drawSpeedLines(ctx, frame);
    this.drawGateMarker(ctx, frame);
  }

  drawGround(ctx, camera) {
    const halfW = camera.viewWidthM / 2 + 6;
    const halfH = camera.viewHeightM / 2 + 6;
    ctx.fillStyle = this.grassPattern ?? this.config.surfaces.get(this.config.baseSurfaceId).render.fill;
    ctx.fillRect(camera.x - halfW, camera.y - halfH, halfW * 2, halfH * 2);
    // A coarse grid keeps the sense of speed on long straights.
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 0.12;
    const step = 25;
    ctx.beginPath();
    for (let x = Math.floor((camera.x - halfW) / step) * step; x < camera.x + halfW; x += step) {
      ctx.moveTo(x, camera.y - halfH);
      ctx.lineTo(x, camera.y + halfH);
    }
    for (let y = Math.floor((camera.y - halfH) / step) * step; y < camera.y + halfH; y += step) {
      ctx.moveTo(camera.x - halfW, y);
      ctx.lineTo(camera.x + halfW, y);
    }
    ctx.stroke();
  }

  drawTrack(ctx, scale) {
    const road = this.config.surfaces.get(this.track.baseSurfaceId ?? this.config.defaultSurfaceId);
    const runoff = this.config.surfaces.get('dirt');
    const lane = road.render.lane ?? '#d8dde4';
    const width = this.track.widthM;
    const runoffWidth = width + this.track.runoffM * 2;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.strokeStyle = runoff.render.fill;
    ctx.lineWidth = runoffWidth;
    ctx.stroke(this.roadPath);

    ctx.strokeStyle = lane;
    ctx.lineWidth = width + 0.5;
    ctx.stroke(this.roadPath);

    ctx.strokeStyle = road.render.fill;
    ctx.lineWidth = width - 0.6;
    ctx.stroke(this.roadPath);

    // Patches (wet sections, oil slicks) sit on top of the asphalt.
    for (const patch of this.track.patchList) {
      const surface = patch.surface;
      if (!surface) continue;
      ctx.save();
      ctx.translate(patch.x, patch.y);
      ctx.rotate((patch.angleDeg * Math.PI) / 180);
      ctx.fillStyle = surface.render.fill;
      ctx.globalAlpha = surface.id === 'oil' ? 0.92 : 0.85;
      const r = Math.min(patch.widthM, patch.lengthM) * 0.28;
      ctx.beginPath();
      ctx.roundRect(-patch.lengthM / 2, -patch.widthM / 2, patch.lengthM, patch.widthM, r);
      ctx.fill();
      if (surface.id === 'wet') {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#cfe6ff';
        for (let i = 0; i < 8; i++) {
          const t = (i / 8 - 0.5) * patch.lengthM;
          ctx.beginPath();
          ctx.ellipse(t, ((i % 3) - 1) * patch.widthM * 0.24, patch.lengthM * 0.05, patch.widthM * 0.1, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Walls / barriers.
    for (const wall of this.track.world.wallBoxes) {
      if (wall.type !== WALL) continue;
      ctx.save();
      ctx.translate(wall.x, wall.y);
      ctx.rotate(wall.angle);
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(-wall.halfW, -wall.halfH, wall.widthM, wall.heightM);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-wall.halfW, -wall.halfH, wall.widthM, wall.heightM * 0.28);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.08;
      for (let x = -wall.halfW + 1; x < wall.halfW; x += 2) {
        ctx.beginPath();
        ctx.moveTo(x, -wall.halfH);
        ctx.lineTo(x, wall.halfH);
        ctx.stroke();
      }
      ctx.restore();
    }
    void scale;
  }

  drawStartLine(ctx) {
    const gate = this.track.gates[0];
    if (!gate) return;
    ctx.save();
    ctx.translate(gate.x, gate.y);
    ctx.rotate(Math.atan2(gate.ny, gate.nx));
    const half = gate.halfWidthM;
    const cell = 1.1;
    const rows = Math.ceil(half / cell);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#f4f6f8' : '#1c1f24';
        ctx.fillRect(-cell + col * cell, -half + row * cell * 2, cell, cell);
      }
    }
    ctx.restore();
  }

  drawSkidMarks(ctx, effects) {
    if (!effects) return;
    ctx.lineCap = 'round';
    for (const mark of effects.marks) {
      const surface = this.config.surfaces.get(mark.surfaceId);
      ctx.strokeStyle = surface?.id === 'dirt' ? `rgba(66,52,34,${mark.alpha * mark.life})` : `rgba(18,18,20,${mark.alpha * mark.life})`;
      ctx.lineWidth = mark.widthM * (0.6 + 0.6 * mark.intensity);
      ctx.beginPath();
      ctx.moveTo(mark.x1, mark.y1);
      ctx.lineTo(mark.x2, mark.y2);
      ctx.stroke();
    }
  }

  drawDecor(ctx) {
    for (const item of this.track.decor) {
      if (item.type === 'cone') {
        ctx.fillStyle = '#ff7a18';
        ctx.beginPath();
        ctx.arc(item.x, item.y, 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(item.x, item.y, 0.1, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#232629';
        ctx.beginPath();
        ctx.arc(item.x, item.y, 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3b4045';
        ctx.beginPath();
        ctx.arc(item.x, item.y, 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawParticles(ctx, effects, foreground) {
    if (!effects) return;
    for (const p of effects.particles) {
      // dust stays behind the car, smoke and spray are drawn over it
      const isForeground = p.kind !== 'dust';
      if (isForeground !== foreground) continue;
      const color =
        p.kind === 'dust'
          ? '150,124,84'
          : p.kind === 'spray'
            ? '200,220,240'
            : p.kind === 'spark'
              ? '255,214,120'
              : p.kind === 'flame' || p.kind === 'fire'
                ? '255,140,60'
                : p.kind === 'flameCore'
                  ? '190,225,255'
                  : p.kind === 'engineSmoke'
                    ? '90,90,96'
                    : p.kind === 'air'
                      ? '215,238,255'
                      : '196,196,200';
      ctx.fillStyle = `rgba(${color},${p.alpha * p.life})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radiusM * (1.4 - p.life * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Interpolated pose between the last two physics ticks. */
  carPose(car, alpha) {
    const heading = car.prevHeading + wrapAngle(car.interpHeading - car.prevHeading) * alpha;
    return {
      x: lerp(car.prevX, car.interpX, alpha),
      y: lerp(car.prevY, car.interpY, alpha),
      heading,
      steer: car.steerAngleRad,
      roll: car.bodyRollRad,
      pitch: car.bodyPitchRad
    };
  }

  drawCar(ctx, car, pose, input, scale, isRival = false) {
    const body = car.def.body;
    const render = car.def.render;
    const halfLength = body.lengthM / 2;
    const halfWidth = body.widthM / 2;

    // wheels first - they are drawn in world space so their own steering
    // rotation stays independent of the body
    this.drawWheels(ctx, car, pose, scale);

    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.heading);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.roundRect(-halfLength + 0.12, -halfWidth + 0.16, body.lengthM, body.widthM, 0.5);
    ctx.fill();

    // body
    const gradient = ctx.createLinearGradient(0, -halfWidth, 0, halfWidth);
    gradient.addColorStop(0, render.livery?.[1] ?? render.color);
    gradient.addColorStop(0.45, render.color);
    gradient.addColorStop(1, render.livery?.[0] ?? render.color);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    this.bodyPath(ctx, body);
    ctx.fill();
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();

    // roof / cabin
    ctx.fillStyle = render.glass ?? '#141a22';
    ctx.beginPath();
    ctx.moveTo(halfLength * 0.42, -halfWidth * 0.72);
    ctx.lineTo(halfLength * 0.12, -halfWidth * 0.78);
    ctx.lineTo(-halfLength * 0.38, -halfWidth * 0.7);
    ctx.lineTo(-halfLength * 0.38, halfWidth * 0.7);
    ctx.lineTo(halfLength * 0.12, halfWidth * 0.78);
    ctx.lineTo(halfLength * 0.42, halfWidth * 0.72);
    ctx.closePath();
    ctx.fill();

    // roof highlight, offset by body roll so the weight transfer is readable
    const rollOffset = clamp(pose.roll * 6, -0.25, 0.25);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(-halfLength * 0.22 + rollOffset, -halfWidth * 0.34, body.lengthM * 0.3, body.widthM * 0.68, 0.2);
    ctx.fill();

    // racing stripe
    ctx.fillStyle = render.accent ?? '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-halfLength * 0.92, -0.12, body.lengthM * 0.8, 0.24);
    ctx.globalAlpha = 1;

    // 9.5 brake lights: driven by the car's own brake state (which includes the
    // handbrake) rather than by the raw input, so an autopilot car lights up too.
    const braking = (car.brakeLight ?? (input?.brake ?? 0) > 0.05) > 0.15;
    const lightAlpha = braking ? 1 : 0.45;
    ctx.fillStyle = braking ? '#ff3b30' : `rgba(141,27,22,${lightAlpha})`;
    ctx.fillRect(-halfLength + 0.02, -halfWidth * 0.86, 0.16, halfWidth * 0.5);
    ctx.fillRect(-halfLength + 0.02, halfWidth * 0.36, 0.16, halfWidth * 0.5);
    if (braking) {
      ctx.fillStyle = 'rgba(255,60,48,0.35)';
      ctx.beginPath();
      ctx.arc(-halfLength, 0, halfWidth * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(halfLength - 0.2, -halfWidth * 0.9, 0.18, halfWidth * 0.55);
    ctx.fillRect(halfLength - 0.2, halfWidth * 0.35, 0.18, halfWidth * 0.55);

    // 9.9: scratches and dents, one overlay per hit zone, driven straight by the
    // zone damage so what you see is what the physics is doing.
    this.drawDamage(ctx, car, body);

    // 9.7: an active nitro tank glows at the exhaust.
    if (car.nitroState?.active) {
      ctx.fillStyle = 'rgba(120,200,255,0.85)';
      ctx.beginPath();
      ctx.arc(-halfLength - 0.05, -halfWidth * 0.5, 0.16, 0, Math.PI * 2);
      ctx.arc(-halfLength - 0.05, halfWidth * 0.5, 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    if (isRival) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-0.12, -halfWidth * 0.28, 0.24, halfWidth * 0.56);
    }

    ctx.restore();
  }

  /** 9.9 scratches (light damage) and dents (heavy), per hit zone. */
  drawDamage(ctx, car, body) {
    const zones = car.damage?.zones;
    if (!zones) return;
    const max = car.damage.zoneMax || 25;
    const halfLength = body.lengthM / 2;
    const halfWidth = body.widthM / 2;
    const paint = (pct, fn) => {
      if (pct <= 0.05) return;
      ctx.save();
      fn(pct);
      ctx.restore();
    };
    // scratches: light lines across the damaged panel
    ctx.strokeStyle = 'rgba(20,20,22,0.55)';
    ctx.lineWidth = 0.05;
    paint(zones.front / max, (pct) => {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const y = -halfWidth * 0.6 + (i * halfWidth * 0.6);
        ctx.moveTo(halfLength * 0.55, y);
        ctx.lineTo(halfLength * 0.95, y + 0.12 - 0.2 * pct);
      }
      ctx.stroke();
    });
    paint(zones.rear / max, (pct) => {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const y = -halfWidth * 0.6 + (i * halfWidth * 0.6);
        ctx.moveTo(-halfLength * 0.55, y);
        ctx.lineTo(-halfLength * 0.95, y + 0.12 - 0.2 * pct);
      }
      ctx.stroke();
    });
    // side damage shows as a dark crumpled band down that flank
    const side = (pct, sign) => {
      if (pct <= 0.05) return;
      ctx.fillStyle = `rgba(30,30,34,${0.2 + 0.45 * pct})`;
      ctx.beginPath();
      ctx.roundRect(-halfLength * 0.6, sign * (halfWidth - 0.16) - 0.08, body.lengthM * 0.55, 0.22, 0.08);
      ctx.fill();
    };
    side(zones.left / max, -1);
    side(zones.right / max, 1);
    // dents: a scuff blob once a zone is over half destroyed
    ctx.fillStyle = 'rgba(12,12,14,0.5)';
    const dent = (pct, x, y, rx, ry) => {
      if (pct < 0.5) return;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    dent(zones.front / max, halfLength * 0.7, 0, 0.34, halfWidth * 0.5);
    dent(zones.rear / max, -halfLength * 0.7, 0, 0.34, halfWidth * 0.5);
    dent(zones.left / max, 0, -halfWidth * 0.85, halfLength * 0.4, 0.14);
    dent(zones.right / max, 0, halfWidth * 0.85, halfLength * 0.4, 0.14);
  }

  /** 9.10: the air lines that show a slipstream, converging on the car. */
  drawAirLines(ctx, car, slipstream, scale) {
    const strength = slipstream.strength ?? 0;
    if (strength <= 0.02) return;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    ctx.strokeStyle = `rgba(210,236,255,${0.12 + 0.3 * strength})`;
    ctx.lineWidth = Math.max(0.05, 1.4 / scale);
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const y = i * (car.def.body.widthM * 0.42);
      const length = 4 + 9 * strength;
      ctx.moveTo(-length, y * (1.6 - 0.5 * strength));
      ctx.lineTo(-1.2, y * 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 9.7: speed lines while the nitro is lit (screen space, so they feel fast). */
  drawSpeedLines(ctx, frame) {
    const { car } = frame;
    if (!car?.nitroState?.active) return;
    const w = this.viewport.width;
    const h = this.viewport.height;
    const cx = w / 2;
    const cy = h / 2;
    const count = Math.round(this.config.tuning.nitro.speedLinesPerSecond);
    ctx.save();
    ctx.strokeStyle = 'rgba(190,225,255,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.speedLinePhase;
      const radius = Math.min(w, h) * (0.32 + ((i * 37) % 60) / 100);
      const length = 30 + ((i * 53) % 70);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.7;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length * 0.7);
    }
    ctx.stroke();
    ctx.restore();
  }

  bodyPath(ctx, body) {
    const halfLength = body.lengthM / 2;
    const halfWidth = body.widthM / 2;
    const nose = halfLength;
    const tail = -halfLength;
    ctx.beginPath();
    ctx.moveTo(nose * 0.72, -halfWidth * 0.62);
    ctx.quadraticCurveTo(nose, -halfWidth * 0.78, nose, -halfWidth * 0.32);
    ctx.lineTo(nose, halfWidth * 0.32);
    ctx.quadraticCurveTo(nose, halfWidth * 0.78, nose * 0.72, halfWidth * 0.62);
    ctx.lineTo(tail * 0.86, halfWidth);
    ctx.quadraticCurveTo(tail, halfWidth * 0.98, tail, halfWidth * 0.6);
    ctx.lineTo(tail, -halfWidth * 0.6);
    ctx.quadraticCurveTo(tail, -halfWidth * 0.98, tail * 0.86, -halfWidth);
    ctx.closePath();
  }

  drawWheels(ctx, car, pose, scale) {
    const steer = pose.steer;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const halfTrack = car.def.body.trackWidthM / 2;
    for (const wheel of car.wheels) {
      const longitudinal = wheel.axle === 'front' ? car.def.body.cgToFrontM : -car.def.body.cgToRearM;
      const wx = pose.x + c * longitudinal - s * wheel.side * halfTrack;
      const wy = pose.y + s * longitudinal + c * wheel.side * halfTrack;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(pose.heading + (wheel.steer ? steer : 0));
      const width = car.def.tires.radiusM * 1.85;
      const height = wheel.axle === 'front' ? 0.26 : 0.28;
      // tyre
      ctx.fillStyle = '#0d0e10';
      ctx.beginPath();
      ctx.roundRect(-width / 2, -height / 2, width, height, 0.07);
      ctx.fill();
      // tread marker - reads as wheelspin / lock-up at a glance
      const tread = Math.sin(wheel.spinAngle) * (width / 2 - 0.14);
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.fillRect(tread, -height / 2, 0.07, height);
      // heat glow when the tyre is past its limit
      const heat = clamp(wheel.usage - 0.85, 0, 1);
      if (heat > 0.01) {
        ctx.fillStyle = `rgba(196,196,205,${0.3 * heat})`;
        ctx.beginPath();
        ctx.arc(0, 0, height * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    void scale;
  }

  drawDebug(ctx, car, pose, scale, frame) {
    ctx.save();
    ctx.lineWidth = 0.08 / (scale / 40);
    // velocity
    ctx.strokeStyle = '#41d1ff';
    ctx.beginPath();
    ctx.moveTo(car.x, car.y);
    ctx.lineTo(car.x + car.vx * 0.35, car.y + car.vy * 0.35);
    ctx.stroke();
    // tire forces
    for (const [axle, color] of [
      [car.frontAxle, '#ffd60a'],
      [car.rearAxle, '#ff5c8a']
    ]) {
      const pos = car.axlePosition(axle.id);
      const c = Math.cos(pose.heading);
      const s = Math.sin(pose.heading);
      const fx = axle.longitudinalForceN;
      const fy = axle.lateralForceN;
      const wx = c * fx - s * fy;
      const wy = s * fx + c * fy;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x + wx * 0.0012, pos.y + wy * 0.0012);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Off-screen arrow pointing at the next checkpoint / start line. */
  drawGateMarker(ctx, frame) {
    const gate = this.track.gates[frame.hud?.nextGateIndex ?? 1];
    if (!gate) return;
    const camera = frame.camera;
    const screen = camera.toScreen(gate.x, gate.y);
    const margin = 46;
    const inside =
      screen.x > margin && screen.x < this.viewport.width - margin && screen.y > margin && screen.y < this.viewport.height - margin;
    if (inside) return;
    const cx = this.viewport.width / 2;
    const cy = this.viewport.height / 2;
    const angle = Math.atan2(screen.y - cy, screen.x - cx);
    const radius = Math.min(cx, cy) - margin;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-8, -8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
