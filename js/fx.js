/* =========================================================================
   ONE PIECE FIGHT — fx.js
   Particles, impact sparks, slashes, beams, screen shake, damage numbers.
   ========================================================================= */
(function (global) {
  'use strict';

  const OPF = global.OPF;
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);

  class FX {
    constructor() {
      this.parts = [];
      this.numbers = [];
      this.slashes = [];
      this.beams = [];
      this.rings = [];
      this.shakeMag = 0;
      this.shakeTime = 0;
      this.flash = 0;
      this.flashColor = '#fff';
      this.hitFreeze = 0;
    }

    reset() {
      this.parts.length = 0; this.numbers.length = 0;
      this.slashes.length = 0; this.beams.length = 0; this.rings.length = 0;
      this.shakeMag = 0; this.shakeTime = 0; this.flash = 0;
    }

    spawn(p) {
      if (this.parts.length > OPF.CONFIG.MAX_PARTICLES) this.parts.shift();
      this.parts.push(Object.assign({
        x: 0, y: 0, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 4, color: '#fff',
        grav: 0, drag: 0.98, kind: 'circle', rot: 0, vr: 0, alpha: 1,
      }, p));
      return this.parts[this.parts.length - 1];
    }

    /* ------------------------------------------------ named effects ---- */
    dust(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.spawn({
          x: x + rnd(-14, 14), y: y - rnd(0, 6), vx: rnd(-90, 90), vy: rnd(-70, -10),
          life: rnd(0.3, 0.6), max: 0.6, size: rnd(3, 7), color: 'rgba(220,210,190,0.75)',
          grav: 120, drag: 0.92, kind: 'smoke',
        });
      }
    }

    dashTrail(x, y) {
      for (let i = 0; i < 8; i++) {
        this.spawn({
          x: x + rnd(-10, 10), y: y - rnd(10, 110), vx: rnd(-40, 40), vy: rnd(-30, 10),
          life: rnd(0.15, 0.35), max: 0.35, size: rnd(4, 10), color: 'rgba(255,255,255,0.5)',
          kind: 'smoke', drag: 0.9,
        });
      }
    }

    hit(x, y, opts) {
      opts = opts || {};
      const n = opts.big ? 20 : 10;
      const col = opts.color || '#ffd166';
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), s = rnd(120, opts.big ? 620 : 380);
        this.spawn({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.16, 0.42), max: 0.42,
          size: rnd(2.5, 6), color: i % 3 === 0 ? '#fff' : col, grav: 260, drag: 0.9, kind: 'spark',
        });
      }
      this.slashes.push({ x, y, r: opts.big ? 46 : 28, life: 0.22, max: 0.22, color: col, rot: rnd(0, TAU) });
      if (opts.big) {
        this.rings.push({ x, y, r: 10, r2: 140, life: 0.4, max: 0.4, color: col, w: 7 });
        this.shake(14, 0.25);
        this.flashScreen(col, 0.28);
      }
    }

    blockHit(x, y) {
      for (let i = 0; i < 8; i++) {
        const a = rnd(-1.2, 1.2);
        this.spawn({
          x, y, vx: Math.cos(a) * rnd(80, 240), vy: Math.sin(a) * rnd(-160, 60),
          life: 0.26, max: 0.26, size: rnd(2, 5), color: '#9fe6ff', grav: 300, kind: 'spark',
        });
      }
      this.rings.push({ x, y, r: 6, r2: 34, life: 0.2, max: 0.2, color: '#9fe6ff', w: 3 });
    }

    tick(f, color) {
      this.spawn({
        x: f.x + rnd(-10, 10), y: f.centerY + rnd(-12, 12), vx: rnd(-30, 30), vy: rnd(-90, -40),
        life: 0.5, max: 0.5, size: rnd(2, 5), color: color || '#ff6b00', grav: -60, kind: 'spark',
      });
    }

    transformBurst(f, color) {
      for (let i = 0; i < 34; i++) {
        const a = rnd(0, TAU), s = rnd(120, 460);
        this.spawn({
          x: f.x, y: f.centerY, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, life: rnd(0.4, 0.9),
          max: 0.9, size: rnd(3, 9), color, grav: -40, drag: 0.94, kind: 'glow',
        });
      }
      this.rings.push({ x: f.x, y: f.centerY, r: 10, r2: 210, life: 0.6, max: 0.6, color, w: 9 });
      this.shake(12, 0.35);
      this.flashScreen(color, 0.35);
    }

    smokeBurst(f, x, y) {
      for (let i = 0; i < 22; i++) {
        this.spawn({
          x: x + rnd(-24, 24), y: y + rnd(-40, 30), vx: rnd(-120, 120), vy: rnd(-120, 20),
          life: rnd(0.4, 0.9), max: 0.9, size: rnd(10, 26), color: 'rgba(210,210,220,0.7)',
          kind: 'smoke', drag: 0.9, grav: -20,
        });
      }
    }

    coinPop(x, y, n) {
      for (let i = 0; i < (n || 5); i++) {
        this.spawn({
          x, y: y - 60, vx: rnd(-140, 140), vy: rnd(-360, -180), life: rnd(0.6, 1.0), max: 1.0,
          size: rnd(4, 8), color: '#ffd700', grav: 900, kind: 'coin', rot: rnd(0, TAU), vr: rnd(-12, 12),
        });
      }
    }

    explode(x, y, r, color) {
      this.rings.push({ x, y, r: 8, r2: r, life: 0.34, max: 0.34, color: color || '#ff8c00', w: 8 });
      for (let i = 0; i < 26; i++) {
        const a = rnd(0, TAU), s = rnd(100, r * 5);
        this.spawn({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: rnd(0.3, 0.7), max: 0.7,
          size: rnd(4, 12), color: i % 2 ? (color || '#ff8c00') : '#ffe066', grav: 240, drag: 0.93, kind: 'glow',
        });
      }
      this.shake(16, 0.3);
      this.flashScreen(color || '#ff8c00', 0.3);
    }

    iceNova(f) {
      for (let i = 0; i < 40; i++) {
        const a = rnd(0, TAU), s = rnd(80, 520);
        this.spawn({
          x: f.x, y: f.centerY, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, life: rnd(0.5, 1.1),
          max: 1.1, size: rnd(3, 9), color: i % 2 ? '#aed6f1' : '#eaf6ff', grav: 300, drag: 0.95, kind: 'shard', rot: rnd(0, TAU), vr: rnd(-8, 8),
        });
      }
      this.rings.push({ x: f.x, y: f.centerY, r: 12, r2: 420, life: 0.8, max: 0.8, color: '#aed6f1', w: 10 });
      this.shake(18, 0.5);
      this.flashScreen('#aed6f1', 0.4);
    }

    flameCone(f, dir, len) {
      const ox = f.x + dir * 30, oy = f.y - 92;
      for (let i = 0; i < 16; i++) {
        this.spawn({
          x: ox + dir * rnd(0, len * 0.8), y: oy + rnd(-34, 34),
          vx: dir * rnd(120, 420), vy: rnd(-120, 40),
          life: rnd(0.25, 0.6), max: 0.6, size: rnd(8, 22), color: i % 3 === 0 ? '#ffd166' : (i % 3 === 1 ? '#ff6b00' : '#ff3d00'),
          kind: 'smoke', drag: 0.94, grav: -90,
        });
      }
      this.flashScreen('#ff8c00', 0.16);
    }

    windBlast(f, dir) {
      for (let i = 0; i < 22; i++) {
        this.spawn({
          x: f.x + dir * rnd(20, 240), y: f.y - 92 + rnd(-70, 70), vx: dir * rnd(260, 700), vy: rnd(-60, 60),
          life: rnd(0.2, 0.5), max: 0.5, size: rnd(3, 10), color: 'rgba(200,240,255,0.55)', kind: 'smoke', drag: 0.96,
        });
      }
    }

    stretchTrail(self, t) {
      if (t < 0.12 || t > 0.5) return;
      for (let i = 0; i < 2; i++) {
        this.spawn({
          x: self.x + self.facing * rnd(60, 180), y: self.y - 84 + rnd(-14, 14),
          vx: rnd(-40, 40), vy: rnd(-30, 30), life: 0.24, max: 0.24, size: rnd(4, 9),
          color: 'rgba(255,255,255,0.5)', kind: 'smoke',
        });
      }
    }

    crossSlash(self) {
      for (let i = 0; i < 3; i++) {
        this.slashes.push({
          x: self.x + self.facing * rnd(80, 180), y: self.y - rnd(40, 130),
          r: rnd(40, 80), life: 0.24, max: 0.24, color: i === 1 ? '#ffd700' : '#fff', rot: (i * 1.2 + rnd(-0.3, 0.3)) * (self.facing),
        });
      }
    }

    beamCharge(f) {
      this.rings.push({ x: f.x, y: f.centerY, r: 60, r2: 10, life: 0.4, max: 0.4, color: '#00e5ff', w: 4 });
    }

    chestBeam(f, prog) {
      this.beams.push({
        x: f.x, y: f.centerY, dir: f.facing, len: 900, w: 26 + Math.sin(prog * 20) * 6,
        life: 0.06, max: 0.06, color: '#00e5ff', core: '#ffffff',
      });
      for (let i = 0; i < 4; i++) {
        this.spawn({
          x: f.x + f.facing * rnd(0, 300), y: f.centerY + rnd(-10, 10), vx: f.facing * rnd(200, 600), vy: rnd(-80, 80),
          life: 0.3, max: 0.3, size: rnd(3, 8), color: '#aef7ff', kind: 'glow',
        });
      }
    }

    moveCharge(f, sp) {
      this.rings.push({ x: f.x, y: f.centerY, r: 70, r2: 18, life: 0.3, max: 0.3, color: '#ffd700', w: 3 });
      for (let i = 0; i < 10; i++) {
        const a = rnd(0, TAU);
        this.spawn({
          x: f.x + Math.cos(a) * 46, y: f.centerY + Math.sin(a) * 46, vx: -Math.cos(a) * 160, vy: -Math.sin(a) * 160,
          life: 0.28, max: 0.28, size: rnd(2, 6), color: '#ffd700', kind: 'glow',
        });
      }
    }

    damageNumber(x, y, amount, kind, crit) {
      if (this.numbers.length > OPF.CONFIG.MAX_DAMAGE_NUMBERS) this.numbers.shift();
      this.numbers.push({
        x: x + rnd(-14, 14), y: y, vy: -110, life: 0.85, max: 0.85,
        text: kind === 'heal' ? '+' + amount : String(amount),
        color: kind === 'heal' ? '#7bed9f' : kind === 'player' ? '#ffd700' : crit ? '#ff6b00' : '#ff6b6b',
        size: crit ? 30 : 22, crit: !!crit,
      });
    }

    label(x, y, text, color, size) {
      this.numbers.push({ x, y, vy: -46, life: 1.25, max: 1.25, text, color: color || '#fff', size: size || 20, label: true });
    }

    slashArc(x, y, r, color, rot) {
      this.slashes.push({ x, y, r, life: 0.2, max: 0.2, color: color || '#fff', rot: rot || rnd(0, TAU) });
    }

    shake(mag, time) {
      this.shakeMag = Math.max(this.shakeMag, mag);
      this.shakeTime = Math.max(this.shakeTime, time);
    }

    flashScreen(color, a) {
      this.flash = Math.max(this.flash, a);
      this.flashColor = color;
    }

    /* ------------------------------------------------------- update ---- */
    update(dt) {
      const P = this.parts;
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0) { P.splice(i, 1); continue; }
        p.vy += (p.grav || 0) * dt;
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vr) p.rot += p.vr * dt;
        if (p.kind === 'smoke') p.alpha = Math.min(1, p.life / p.max);
      }
      for (let i = this.numbers.length - 1; i >= 0; i--) {
        const n = this.numbers[i];
        n.life -= dt; n.y += n.vy * dt; n.vy *= Math.pow(0.94, dt * 60);
        if (n.life <= 0) this.numbers.splice(i, 1);
      }
      for (let i = this.slashes.length - 1; i >= 0; i--) {
        const s = this.slashes[i]; s.life -= dt;
        if (s.life <= 0) this.slashes.splice(i, 1);
      }
      for (let i = this.beams.length - 1; i >= 0; i--) {
        const b = this.beams[i]; b.life -= dt;
        if (b.life <= 0) this.beams.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i]; r.life -= dt;
        if (r.life <= 0) this.rings.splice(i, 1);
      }
      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        this.shakeMag *= Math.pow(0.02, dt);
      } else this.shakeMag = 0;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    }

    get shakeOffset() {
      if (this.shakeMag < 0.4) return { x: 0, y: 0 };
      return { x: rnd(-this.shakeMag, this.shakeMag), y: rnd(-this.shakeMag, this.shakeMag) * 0.6 };
    }

    /* -------------------------------------------------------- draw ----- */
    drawWorld(ctx) {
      // particles
      for (const p of this.parts) {
        const a = p.kind === 'smoke' ? p.alpha * 0.65 : 1;
        ctx.globalAlpha = Math.max(0, a * Math.min(1, p.life / (p.max * 0.6)));
        if (p.kind === 'spark' || p.kind === 'shard') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.5);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // slashes
      for (const s of this.slashes) {
        const t = 1 - s.life / s.max;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.globalAlpha = Math.sin((1 - t) * Math.PI) * 0.95;
        ctx.strokeStyle = s.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = s.r * 0.22 * (1 - t * 0.4);
        ctx.beginPath();
        ctx.arc(0, 0, s.r, -0.9, 0.9);
        ctx.stroke();
        ctx.globalAlpha *= 0.55;
        ctx.lineWidth = s.r * 0.1;
        ctx.beginPath(); ctx.arc(0, 0, s.r * 1.1, -0.7, 0.7); ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // rings
      for (const r of this.rings) {
        const t = 1 - r.life / r.max;
        const rad = r.r + (r.r2 - r.r) * t;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = (r.w || 6) * (1 - t * 0.6);
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // beams
      for (const b of this.beams) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.dir * 300, b.y);
        g.addColorStop(0, b.core || '#fff');
        g.addColorStop(0.2, b.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        const h = b.w;
        ctx.fillRect(b.x, b.y - h / 2, b.dir * b.len, h);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(b.x, b.y - h * 0.28, b.dir * b.len, h * 0.56);
        ctx.restore();
      }
    }

    drawNumbers(ctx) {
      for (const n of this.numbers) {
        const t = 1 - n.life / n.max;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - t) * 2.2);
        ctx.font = '900 ' + n.size + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        const scale = n.crit ? 1 + Math.sin(Math.min(1, t * 3) * Math.PI) * 0.25 : 1;
        ctx.translate(n.x, n.y);
        ctx.scale(scale, scale);
        ctx.strokeText(n.text, 0, 0);
        ctx.fillStyle = n.color;
        ctx.fillText(n.text, 0, 0);
        ctx.restore();
      }
    }
  }

  OPF.FX = FX;
})(window);
