/* =========================================================================
   ONE PIECE FIGHT — art.js
   Procedural vector art: fighters, poses, weapons, costumes, backgrounds.
   Everything is drawn from code — no image assets.
   ========================================================================= */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* =====================================================================
     POSE SYSTEM
     Angles: 0 = limb points straight down. Positive = rotate forward (+x).
     All local coords: origin at the fighter's feet, y goes up as negative.
     ===================================================================== */
  const RIG = {
    hipY: -58, shoulderY: -100, headY: -114, headR: 12.5,
    shoulderX: 8.5, hipX: 6,
    upArm: 22, foreArm: 21, thigh: 29, shin: 27, foot: 13,
  };

  function basePose() {
    return {
      crouch: 0, lean: 0, spine: 0, head: 0, rot: 0,
      armB: [0.28, 0.45], armF: [-0.22, -0.1],
      legB: [0.12, 0.2], legF: [-0.1, -0.05],
      extB: 1, extF: 1, weapon: 0, weaponExt: 1,
      sq: 1, liftY: 0, torsoTwist: 0,
    };
  }

  function p(o) { return Object.assign(basePose(), o); }
  function mixPose(a, b, t) {
    const r = {};
    for (const k in a) {
      const va = a[k], vb = b[k];
      if (typeof va === 'number') r[k] = lerp(va, vb, t);
      else if (Array.isArray(va)) r[k] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
      else r[k] = t < 0.5 ? va : vb;
    }
    return r;
  }

  // keyframes: [ [time, pose], ... ] , t in 0..1
  function kf(frames, t) {
    t = clamp(t, 0, 1);
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      if (t <= frames[i][0]) {
        const [t0, p0] = frames[i - 1], [t1, p1] = frames[i];
        const local = (t - t0) / Math.max(0.0001, t1 - t0);
        return mixPose(p0, p1, local);
      }
    }
    return frames[frames.length - 1][1];
  }
  const ease = t => t * t * (3 - 2 * t);
  const kfe = (frames, t) => kf(frames, ease(clamp(t, 0, 1)));

  /* -------------------------------------------------------- state poses -- */
  function poseIdle(e, t) {
    const b = Math.sin(t * 2.4) * 0.045;
    const br = Math.sin(t * 2.4) * 1.6;
    return p({
      lean: -0.03 + b * 0.3, spine: b * 0.5, head: -b * 0.6,
      armB: [0.3 + b, 0.55 + b], armF: [-0.25 - b, -0.05 - b * 0.5],
      legB: [0.13, 0.24], legF: [-0.12, -0.06], liftY: br,
    });
  }
  function poseWalk(e, t) {
    const s = Math.sin(t * 2 * Math.PI * 1.35);
    const c = Math.cos(t * 2 * Math.PI * 1.35);
    return p({
      lean: 0.09, spine: 0.03,
      armB: [-s * 0.55 + 0.1, 0.15 - s * 0.3], armF: [s * 0.55 - 0.1, -0.15 + s * 0.3],
      legB: [s * 0.62, Math.max(0, s) * 0.5], legF: [-s * 0.62, Math.max(0, -s) * 0.5],
      liftY: Math.abs(s) * -2.2,
    });
  }
  function poseRun(e, t) {
    const s = Math.sin(t * 2 * Math.PI * 1.9);
    return p({
      lean: 0.26, spine: 0.06, head: -0.12,
      armB: [-s * 0.95 + 0.2, 0.5 - s * 0.45], armF: [s * 0.95 - 0.2, -0.5 + s * 0.45],
      legB: [s * 0.85, Math.max(0, s) * 0.85], legF: [-s * 0.85, Math.max(0, -s) * 0.9],
      liftY: Math.abs(s) * -3.4,
    });
  }
  function poseJump(e, t) {
    return p({
      lean: 0.12, armB: [-0.9, -1.15], armF: [-1.05, -1.35],
      legB: [0.65, 1.0], legF: [-0.2, 0.35], liftY: 0,
    });
  }
  function poseFall(e, t) {
    return p({
      lean: -0.1, armB: [-1.3, -1.5], armF: [-1.45, -1.6],
      legB: [0.55, 0.2], legF: [-0.55, -0.15],
    });
  }
  function poseCrouch(e, t) {
    return p({
      crouch: 1, lean: 0.22, armB: [0.5, 1.1], armF: [0.35, 1.2],
      legB: [0.95, -1.35], legF: [-0.6, -1.5],
    });
  }
  function poseDash(e, t) {
    return p({
      lean: 0.5, spine: 0.1,
      armB: [-0.75, -0.5], armF: [0.95, 1.5],
      legB: [0.95, 0.15], legF: [-0.85, -1.15],
    });
  }
  function poseHit(e, t) {
    const b = 1 - clamp(t * 3, 0, 1);
    return p({
      lean: -0.34 * b, spine: -0.14 * b, head: -0.42 * b,
      armB: [0.75, 0.9], armF: [1.0, 1.15],
      legB: [0.3, 0.45], legF: [-0.4, -0.2], liftY: -2 * b,
    });
  }
  function poseBlock(e, t) {
    return p({
      crouch: 0.28, lean: -0.12,
      armB: [1.15, 2.05], armF: [1.35, 2.2],
      legB: [0.35, 0.5], legF: [-0.35, -0.45],
    });
  }
  function poseKO(e, t) {
    const s = clamp(t * 3.4, 0, 1);
    return p({
      rot: -1.42 * s, lean: -0.2, armB: [0.5, 0.4], armF: [-0.5, -0.3],
      legB: [0.3, 0.7], legF: [-0.35, -0.6], liftY: -6 * s,
    });
  }
  function poseVictory(e, t) {
    const b = Math.sin(t * 3) * 0.12;
    return p({
      lean: -0.05, head: -0.18,
      armB: [-1.35 + b, -1.6 + b], armF: [-1.55 - b, -1.8 - b],
      legB: [0.15, 0.22], legF: [-0.15, -0.1], liftY: b * 8,
    });
  }

  // --- attacks (index 0,1,2 = combo chain) -------------------------------
  const ATTACKS = {
    jab: [
      [0, p({ lean: 0.14, armF: [0.5, 1.5], armB: [-0.3, -0.7], legF: [-0.2, -0.1] })],
      [0.25, p({ lean: 0.22, armF: [1.62, 1.68], extF: 1.02, armB: [-0.5, -1.0] })],
      [0.42, p({ lean: 0.16, armF: [1.55, 1.62], armB: [-0.4, -0.8] })],
      [1, p({ lean: 0.05, armF: [0.2, 0.5], armB: [-0.2, -0.4] })],
    ],
    cross: [
      [0, p({ lean: -0.05, torsoTwist: -0.1, armF: [0.4, 1.2], armB: [-0.2, -0.5] })],
      [0.22, p({ lean: 0.3, torsoTwist: 0.22, armB: [1.7, 1.75], extB: 1.03, armF: [0.6, 1.1] })],
      [0.4, p({ lean: 0.22, armB: [1.6, 1.68], armF: [0.5, 0.9] })],
      [1, p({ lean: 0.04, armB: [-0.2, -0.4], armF: [0.2, 0.5] })],
    ],
    heavy: [
      [0, p({ lean: -0.22, crouch: 0.2, armF: [0.2, 0.6], armB: [-0.4, -0.9] })],
      [0.32, p({ lean: 0.36, crouch: 0.05, armF: [-1.5, -1.05], extF: 1.15, armB: [-1.7, -1.3], legF: [-0.5, -0.2], legB: [0.55, 0.2] })],
      [0.5, p({ lean: 0.3, armF: [-1.2, -0.7], armB: [-1.4, -1.0] })],
      [1, p({ lean: 0.06, armF: [0.2, 0.5], armB: [-0.2, -0.4] })],
    ],
    kick: [
      [0, p({ lean: -0.1, legF: [0.5, 0.2], armF: [0.5, 1.0], armB: [-0.4, -0.7] })],
      [0.26, p({ lean: 0.16, legF: [1.85, 1.95], armF: [-0.9, -1.2], armB: [0.8, 1.2], legB: [0.05, 0.1], liftY: -4 })],
      [0.46, p({ lean: 0.1, legF: [1.7, 1.85], armF: [-0.7, -1.0], armB: [0.7, 1.0] })],
      [1, p({ lean: 0.02, legF: [-0.12, -0.05], armF: [0.2, 0.5], armB: [-0.2, -0.4] })],
    ],
    spin: [
      [0, p({ lean: 0.05, crouch: 0.3, torsoTwist: -0.4, legF: [0.6, 0.9], legB: [-0.4, -0.6] })],
      [0.3, p({ lean: 0.1, torsoTwist: 0.5, legF: [1.9, 0.05], legB: [-1.6, -0.1], liftY: -10, armF: [-1.4, -1.0], armB: [-1.6, -1.2] })],
      [0.6, p({ lean: 0.05, torsoTwist: -0.3, legF: [-1.6, -0.1], legB: [1.9, 0.05], liftY: -6, armF: [1.4, 1.0], armB: [1.6, 1.2] })],
      [1, p({ lean: 0.02, legF: [-0.12, -0.05] })],
    ],
    upper: [
      [0, p({ lean: -0.3, crouch: 0.5, armF: [0.8, 1.9], armB: [0.4, 1.2] })],
      [0.28, p({ lean: 0.2, crouch: 0.0, liftY: -12, armF: [-2.35, -2.5], extF: 1.08, armB: [-0.6, -0.9], legF: [-0.4, -0.5], legB: [0.3, 0.6] })],
      [0.5, p({ lean: 0.1, liftY: -8, armF: [-2.1, -2.2], armB: [-0.4, -0.7] })],
      [1, p({ lean: 0.03 })],
    ],
    thrust: [
      [0, p({ lean: -0.08, crouch: 0.18, armF: [0.7, 1.9], armB: [-0.3, -0.6] })],
      [0.22, p({ lean: 0.34, armF: [1.72, 1.78], extF: 1.44, armB: [-0.7, -1.1], legF: [-0.6, -0.15], legB: [0.7, 0.25] })],
      [0.42, p({ lean: 0.28, armF: [1.66, 1.74], extF: 1.4, armB: [-0.6, -0.95] })],
      [1, p({ lean: 0.04 })],
    ],
    stretch_punch: [
      [0, p({ lean: -0.16, armF: [0.6, 1.6], armB: [-0.4, -0.9] })],
      [0.24, p({ lean: 0.3, armF: [1.62, 1.7], extF: 3.2, armB: [-0.8, -1.3], legF: [-0.5, -0.15], legB: [0.55, 0.2] })],
      [0.46, p({ lean: 0.26, armF: [1.58, 1.66], extF: 3.0, armB: [-0.7, -1.2] })],
      [1, p({ lean: 0.05 })],
    ],
    spin_kick: [
      [0, p({ lean: 0.04, crouch: 0.24, torsoTwist: -0.5, armF: [-1.0, -0.7], armB: [-1.2, -0.9] })],
      [0.3, p({ torsoTwist: 0.6, legF: [1.95, 0.1], legB: [-1.5, -0.05], liftY: -14, armF: [-1.5, -1.15], armB: [-1.7, -1.35] })],
      [0.62, p({ torsoTwist: -0.35, legF: [-1.5, -0.05], legB: [1.95, 0.1], liftY: -8, armF: [1.5, 1.1], armB: [1.7, 1.3] })],
      [1, p({}), 0],
    ],
    flurry: [
      [0, p({ lean: 0.16, armF: [0.4, 1.3], armB: [-0.2, -0.6] })],
      [0.2, p({ lean: 0.3, armF: [1.6, 1.65], extF: 1.9, armB: [1.5, 1.55], extB: 1.9 })],
      [0.5, p({ lean: 0.34, armF: [1.55, 1.6], extF: 2.1, armB: [1.58, 1.62], extB: 2.0 })],
      [0.8, p({ lean: 0.3, armF: [1.6, 1.68], extF: 1.8, armB: [1.52, 1.58], extB: 1.85 })],
      [1, p({ lean: 0.05 })],
    ],
    slam: [
      [0, p({ lean: -0.35, crouch: 0.35, armF: [-2.5, -2.2], armB: [-2.4, -2.0] })],
      [0.3, p({ lean: 0.45, crouch: 0.15, armF: [1.2, 0.3], armB: [1.1, 0.25], liftY: 0 })],
      [0.5, p({ lean: 0.5, crouch: 0.3, armF: [1.0, 0.15], armB: [0.95, 0.1] })],
      [1, p({ lean: 0.05 })],
    ],
    slash: [
      [0, p({ lean: -0.2, armF: [-2.2, -2.0], armB: [0.4, 0.8], weapon: -1.2 })],
      [0.22, p({ lean: 0.36, armF: [1.3, 1.5], extF: 1.35, armB: [-0.5, -0.8], weapon: 1.1, legF: [-0.55, -0.15], legB: [0.6, 0.2] })],
      [0.42, p({ lean: 0.3, armF: [1.1, 1.35], extF: 1.3, armB: [-0.4, -0.7], weapon: 0.9 })],
      [1, p({ lean: 0.04, weapon: 0 })],
    ],
    big_slash: [
      [0, p({ lean: -0.42, crouch: 0.24, armF: [-2.6, -2.3], armB: [-2.5, -2.2], weapon: -1.7 })],
      [0.34, p({ lean: 0.5, armF: [1.5, 1.75], extF: 1.6, armB: [-0.9, -1.3], weapon: 1.5, legF: [-0.75, -0.2], legB: [0.8, 0.25] })],
      [0.56, p({ lean: 0.42, armF: [1.3, 1.6], extF: 1.5, armB: [-0.8, -1.15], weapon: 1.25 })],
      [1, p({ lean: 0.05, weapon: 0 })],
    ],
    cast: [
      [0, p({ lean: -0.2, armF: [0.6, 1.2], armB: [-0.5, -1.0] })],
      [0.3, p({ lean: 0.1, armF: [1.5, 1.2], armB: [1.3, 1.0], liftY: -4 })],
      [0.55, p({ lean: 0.05, armF: [1.55, 1.25], armB: [1.35, 1.05] })],
      [1, p({ lean: 0.03 })],
    ],
    cast_both: [
      [0, p({ lean: -0.15, armF: [-0.6, -1.4], armB: [-0.7, -1.5], crouch: 0.2 })],
      [0.4, p({ lean: 0.05, armF: [-2.6, -2.7], armB: [-2.5, -2.6], liftY: -8, legF: [-0.3, -0.4], legB: [0.35, 0.5] })],
      [0.7, p({ lean: 0.02, armF: [-2.5, -2.65], armB: [-2.45, -2.55], liftY: -6 })],
      [1, p({})],
    ],
  };

  const WEAPONS = {
    sword: { len: 46, w: 4.2, color: '#dfe6e9', guard: '#b8860b', hilt: '#5d4037' },
    katana: { len: 52, w: 3.6, color: '#eaf2f8', guard: '#2c3e50', hilt: '#1a1a22' },
    knife: { len: 24, w: 3.0, color: '#d5dbdb', guard: '#7f8c8d', hilt: '#3d2b1f' },
    rifle: { len: 50, w: 4.5, color: '#34495e', guard: '#5d4037', hilt: '#5d4037', gun: true },
    cane: { len: 54, w: 3.4, color: '#d5d8dc', guard: '#f1c40f', hilt: '#111118' },
    spear: { len: 84, w: 5.5, color: '#95a5a6', guard: '#c9a227', hilt: '#5d4037' },
    hook: { len: 20, w: 6.0, color: '#d4af37', guard: '#b8860b', hilt: '#7b241c', hook: true },
  };

  /* =====================================================================
     LOW-LEVEL DRAW HELPERS
     ===================================================================== */
  function capsule(ctx, x1, y1, x2, y2, w1, w2, col, outline) {
    ctx.lineCap = 'round';
    ctx.lineWidth = w1 + 1.6;
    if (outline) { ctx.strokeStyle = outline; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.strokeStyle = col;
    ctx.lineWidth = w1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function joint(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // Draws a 2-segment limb. Returns end point.
  function limb(ctx, ox, oy, a1, l1, a2, l2, w1, w2, col, outline, e1, e2) {
    const L1 = l1 * (e1 === undefined ? 1 : e1);
    const L2 = l2 * (e2 === undefined ? 1 : e2);
    const jx = ox + Math.sin(a1) * L1;
    const jy = oy + Math.cos(a1) * L1;
    const ex = jx + Math.sin(a2) * L2;
    const ey = jy + Math.cos(a2) * L2;
    capsule(ctx, ox, oy, jx, jy, w1, w1 * 0.85, col, outline);
    capsule(ctx, jx, jy, ex, ey, w1 * 0.85, w2, col, outline);
    joint(ctx, jx, jy, w1 * 0.46, col);
    return { x: ex, y: ey, jx, jy };
  }

  function ellipseShadow(ctx, x, y, w, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.35 : alpha;
    ctx.fillStyle = '#000';
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, w * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* =====================================================================
     HEAD / FACE
     ===================================================================== */
  function drawHead(ctx, c, hx, hy, R, faceAng, opts) {
    opts = opts || {};
    // mass of hair that must sit behind the skull (long hair, afro, pompadour)
    drawHairBack(ctx, c, hx, hy, R, faceAng, opts);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(faceAng);

    const skin = c.skin || '#f0b98a';
    // skull
    ctx.fillStyle = skin;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (opts.skull) {
      ctx.arc(0, 0, R, 0, TAU);
    } else {
      ctx.ellipse(0, 0, R * 0.94, R, 0, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();

    if (opts.skull) {
      // jaw + eye sockets + teeth
      ctx.fillStyle = '#e9edf0';
      ctx.beginPath();
      ctx.ellipse(0, R * 0.5, R * 0.72, R * 0.5, 0, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#0d0d13';
      ctx.beginPath(); ctx.ellipse(-R * 0.34, -R * 0.1, R * 0.24, R * 0.3, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(R * 0.34, -R * 0.1, R * 0.24, R * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-R * 0.26, -R * 0.16, R * 0.09, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(R * 0.42, -R * 0.16, R * 0.09, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0d0d13';
      ctx.beginPath(); ctx.ellipse(R * 0.42, R * 0.16, R * 0.1, R * 0.08, -0.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#0d0d13'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-R * 0.5, R * 0.42); ctx.lineTo(R * 0.5, R * 0.42); ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(i * R * 0.2, R * 0.42); ctx.lineTo(i * R * 0.2, R * 0.62); ctx.stroke();
      }
    } else {
      // eyes
      const ko = opts.ko;
      ctx.strokeStyle = '#16161d';
      ctx.fillStyle = '#16161d';
      if (ko) {
        ctx.lineWidth = R * 0.16;
        [[-1, -0.2], [1, -0.2]].forEach(([sx]) => {
          ctx.beginPath();
          ctx.moveTo(sx * R * 0.2 - R * 0.16, -R * 0.3); ctx.lineTo(sx * R * 0.2 + R * 0.16, -R * 0.04);
          ctx.moveTo(sx * R * 0.2 + R * 0.16, -R * 0.3); ctx.lineTo(sx * R * 0.2 - R * 0.16, -R * 0.04);
          ctx.stroke();
        });
      } else {
        ctx.beginPath(); ctx.ellipse(R * 0.3, -R * 0.16, R * 0.13, R * 0.2, 0, 0, TAU); ctx.fill();
        if (opts.bigEyes) { ctx.beginPath(); ctx.ellipse(-R * 0.28, -R * 0.16, R * 0.13, R * 0.2, 0, 0, TAU); ctx.fill(); }
        else { ctx.lineWidth = R * 0.1; ctx.beginPath(); ctx.moveTo(-R * 0.52, -R * 0.2); ctx.lineTo(-R * 0.1, -R * 0.2); ctx.stroke(); }
        // brows
        ctx.lineWidth = R * 0.13;
        ctx.beginPath();
        ctx.moveTo(-R * 0.55, -R * 0.46); ctx.lineTo(-R * 0.08, -R * 0.5);
        ctx.moveTo(R * 0.08, -R * 0.5); ctx.lineTo(R * 0.55, -R * 0.44);
        ctx.stroke();
      }
      // mouth
      ctx.lineWidth = R * 0.11;
      ctx.beginPath();
      if (opts.grinn) {
        ctx.arc(0, R * 0.06, R * 0.5, 0.12 * Math.PI, 0.88 * Math.PI);
      } else if (opts.openMouth) {
        ctx.fillStyle = '#5d1a1a';
        ctx.beginPath(); ctx.ellipse(R * 0.14, R * 0.42, R * 0.26, R * 0.2, 0, 0, TAU); ctx.fill();
      } else {
        ctx.moveTo(-R * 0.22, R * 0.44); ctx.lineTo(R * 0.3, R * 0.42);
      }
      ctx.stroke();
      // scars
      if (opts.cheekScar) {
        ctx.strokeStyle = 'rgba(150,40,40,0.85)'; ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(R * 0.18, R * 0.14); ctx.lineTo(R * 0.5, R * 0.3); ctx.stroke();
      }
      // long nose (Usopp)
      if (opts.longNose) {
        ctx.fillStyle = skin;
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(R * 0.3, -R * 0.02);
        ctx.lineTo(R * 1.95, R * 0.12);
        ctx.lineTo(R * 0.3, R * 0.26);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // clown nose
      if (opts.clownNose) {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(R * 0.55, R * 0.1, R * 0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(R * 0.45, R * 0.0, R * 0.13, 0, TAU); ctx.fill();
      }
      // saw nose (fishman)
      if (opts.sawNose) {
        ctx.fillStyle = shade(skin, -0.08);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(R * 0.3, -R * 0.06);
        ctx.quadraticCurveTo(R * 0.95, R * 0.08, R * 1.32, R * 0.24);
        ctx.quadraticCurveTo(R * 0.95, R * 0.3, R * 0.3, R * 0.32);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.1;
        for (let i = 0; i < 3; i++) {
          const bx = R * (0.62 + i * 0.24);
          ctx.beginPath(); ctx.moveTo(bx, R * 0.05); ctx.lineTo(bx, R * 0.3); ctx.stroke();
        }
      }
      // beard
      if (opts.beard) {
        ctx.fillStyle = opts.beardColor || '#1a1a1a';
        ctx.beginPath();
        ctx.ellipse(R * 0.1, R * 0.72, R * 0.95, R * 0.72, 0, 0, TAU);
        ctx.fill();
      }
      // glasses / sunglasses
      if (opts.sunglasses) {
        ctx.fillStyle = '#15151c';
        ctx.strokeStyle = '#0a0a0f'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(R * 0.3, -R * 0.16, R * 0.29, R * 0.2, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(-R * 0.3, -R * 0.16, R * 0.29, R * 0.2, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-R * 0.02, -R * 0.18); ctx.lineTo(R * 0.02, -R * 0.18); ctx.stroke();
        ctx.fillStyle = 'rgba(140,215,255,0.55)';
        ctx.beginPath(); ctx.ellipse(R * 0.2, -R * 0.22, R * 0.1, R * 0.06, 0.4, 0, TAU); ctx.fill();
        // nose + mouth so it never reads as a mask
        ctx.fillStyle = shade(skin, -0.14);
        ctx.beginPath(); ctx.ellipse(R * 0.5, R * 0.1, R * 0.12, R * 0.09, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#5a2a2a'; ctx.lineWidth = R * 0.09;
        ctx.beginPath(); ctx.moveTo(-R * 0.16, R * 0.46); ctx.lineTo(R * 0.28, R * 0.44); ctx.stroke();
      }
    }
    ctx.restore();
    drawHairFront(ctx, c, hx, hy, R, faceAng, opts);
  }

  // Hair that sits BEHIND the head silhouette.
  function drawHairBack(ctx, c, hx, hy, R, faceAng, opts) {
    const style = c.hairStyle || 'short';
    const hairCol = c.hair || '#1a1a1a';
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(faceAng * 0.6);
    ctx.fillStyle = hairCol;
    if (style === 'long') {
      // two lobes that fall beside the neck, never across the face
      [-1, 1].forEach(sg => {
        ctx.beginPath();
        ctx.moveTo(sg * R * 0.5, -R * 0.95);
        ctx.quadraticCurveTo(sg * R * 1.55, -R * 0.2, sg * R * 1.15, R * 1.35);
        ctx.quadraticCurveTo(sg * R * 0.95, R * 1.6, sg * R * 0.78, R * 1.2);
        ctx.quadraticCurveTo(sg * R * 1.05, R * 0.2, sg * R * 0.42, -R * 0.6);
        ctx.closePath();
        ctx.fill();
      });
      ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 1.04, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    } else if (style === 'afro') {
      ctx.beginPath(); ctx.arc(0, -R * 0.5, R * 1.62, 0, TAU); ctx.fill();
    } else if (style === 'spiky') {
      ctx.beginPath(); ctx.arc(0, -R * 0.1, R * 1.1, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (1.02 + i * 0.12);
        const bx = Math.cos(a) * R * 0.95, by = Math.sin(a) * R * 0.95;
        ctx.beginPath();
        ctx.moveTo(bx * 0.95, by * 0.95);
        ctx.lineTo(bx * 1.55 - Math.cos(a) * 4, by * 1.45);
        ctx.lineTo(bx * 0.8 + Math.cos(a) * 5, by * 0.8 + R * 0.16);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Hair fringe + hats that sit IN FRONT of the skull but above the face.
  function drawHairFront(ctx, c, hx, hy, R, faceAng, opts) {
    const hairCol = c.hair || '#1a1a1a';
    const style = c.hairStyle || 'short';
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(faceAng * 0.5);

    const capTop = (y0, sweep) => {
      // cap that hugs the top of the skull, stopping above the brows
      ctx.beginPath();
      ctx.arc(0, -R * 0.08, R * 1.04, Math.PI * sweep, TAU - (TAU - Math.PI * (2 - sweep)), true);
      ctx.closePath();
      ctx.fill();
    };

    if (style === 'spiky' || style === 'short') {
      // top cap
      ctx.beginPath();
      ctx.arc(0, -R * 0.12, R * 1.05, Math.PI * 1.02, Math.PI * 1.98);
      ctx.quadraticCurveTo(R * 0.9, -R * 0.62, R * 0.6, -R * 0.66);
      ctx.quadraticCurveTo(0, -R * 0.92, -R * 0.6, -R * 0.66);
      ctx.quadraticCurveTo(-R * 0.9, -R * 0.62, -R * 1.05, -R * 0.12);
      ctx.closePath();
      ctx.fill();
      // fringe strands over the forehead
      ctx.beginPath();
      ctx.moveTo(-R * 0.85, -R * 0.52);
      ctx.quadraticCurveTo(-R * 0.2, -R * 0.34, R * 0.1, -R * 0.56);
      ctx.quadraticCurveTo(R * 0.5, -R * 0.5, R * 0.75, -R * 0.6);
      ctx.quadraticCurveTo(R * 0.2, -R * 0.66, -R * 0.85, -R * 0.52);
      ctx.closePath();
      ctx.fill();
    } else if (style === 'long') {
      // top cap with a centre parting; locks hug the temples only
      ctx.beginPath();
      ctx.arc(0, -R * 0.3, R * 1.03, Math.PI * 1.0, Math.PI * 2.0);
      ctx.quadraticCurveTo(R * 0.6, -R * 0.72, R * 0.06, -R * 0.86);
      ctx.quadraticCurveTo(-R * 0.6, -R * 0.72, -R * 1.03, -R * 0.3);
      ctx.closePath();
      ctx.fill();
      [-1, 1].forEach(sg => {
        ctx.beginPath();
        ctx.moveTo(sg * R * 0.82, -R * 0.78);
        ctx.quadraticCurveTo(sg * R * 1.28, -R * 0.1, sg * R * 1.02, R * 0.62);
        ctx.quadraticCurveTo(sg * R * 1.06, -R * 0.2, sg * R * 0.72, -R * 0.62);
        ctx.closePath();
        ctx.fill();
      });
    } else if (style === 'afro') {
      ctx.beginPath();
      ctx.arc(0, -R * 0.62, R * 1.28, Math.PI * 1.08, Math.PI * 1.92);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.arc(-R * 0.5, -R * 1.1, R * 0.6, 0, TAU); ctx.fill();
    } else if (style === 'swirl') {
      ctx.beginPath();
      ctx.moveTo(-R * 0.98, -R * 0.5);
      ctx.quadraticCurveTo(-R * 1.1, -R * 2.0, R * 0.02, -R * 2.15);
      ctx.quadraticCurveTo(R * 1.1, -R * 2.0, R * 0.98, -R * 0.5);
      ctx.quadraticCurveTo(R * 0.35, -R * 1.05, -R * 0.98, -R * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-R * 0.4, -R * 1.45); ctx.quadraticCurveTo(0, -R * 2.05, R * 0.5, -R * 1.4); ctx.stroke();
    }

    // ---- hats (always above the face) ----
    const hat = c.hat;
    if (hat === 'straw') {
      ctx.fillStyle = '#e6c15a';
      ctx.strokeStyle = '#a8862f'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, -R * 0.86, R * 2.1, R * 0.44, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f0d27a';
      ctx.beginPath(); ctx.ellipse(0, -R * 1.16, R * 1.02, R * 0.6, 0, Math.PI, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(-R * 1.02, -R * 1.12, R * 2.04, R * 0.28);
    } else if (hat === 'bandana') {
      ctx.fillStyle = c.accent || '#2c3e50';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.88, R * 1.08, R * 0.5, 0, Math.PI, TAU); ctx.fill();
      ctx.fillRect(-R * 1.05, -R * 0.98, R * 2.1, R * 0.18);
      ctx.beginPath();
      ctx.moveTo(-R * 0.9, -R * 0.9);
      ctx.lineTo(-R * 2.0, -R * 1.0);
      ctx.lineTo(-R * 1.85, -R * 0.62);
      ctx.closePath(); ctx.fill();
    } else if (hat === 'tophat') {
      ctx.fillStyle = '#111118';
      ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, -R * 0.92, R * 1.7, R * 0.32, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillRect(-R * 0.95, -R * 2.5, R * 1.9, R * 1.6);
      ctx.strokeRect(-R * 0.95, -R * 2.5, R * 1.9, R * 1.6);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(-R * 0.95, -R * 1.3, R * 1.9, R * 0.24);
    } else if (hat === 'marinecap') {
      ctx.fillStyle = '#f4f6f7';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.82, R * 1.1, R * 0.72, 0, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = '#1b3a6b';
      ctx.beginPath(); ctx.ellipse(R * 0.5, -R * 0.78, R * 1.0, R * 0.22, 0.1, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#2d6cdf';
      ctx.fillRect(-R * 1.05, -R * 0.88, R * 2.1, R * 0.2);
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(0, -R * 1.18, R * 0.17, 0, TAU); ctx.fill();
    } else if (hat === 'turban') {
      ctx.fillStyle = c.accent || '#f0e6d2';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.84, R * 1.2, R * 0.8, 0, Math.PI, TAU); ctx.fill();
      ctx.fillRect(-R * 1.16, -R * 0.98, R * 2.32, R * 0.24);
    } else if (hat === 'tricorn') {
      ctx.fillStyle = '#1c1c28';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-R * 1.9, -R * 0.92);
      ctx.quadraticCurveTo(0, -R * 2.4, R * 1.9, -R * 0.92);
      ctx.quadraticCurveTo(0, -R * 1.28, -R * 1.9, -R * 0.92);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(0, -R * 1.45, R * 0.19, 0, TAU); ctx.fill();
    } else if (hat === 'horns') {
      ctx.fillStyle = c.hornColor || '#e8e0d0';
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
      [[-1, 0.85], [1, 0.85]].forEach(([sg]) => {
        ctx.beginPath();
        ctx.moveTo(sg * R * 0.6, -R * 0.86);
        ctx.quadraticCurveTo(sg * R * 1.55, -R * 1.6, sg * R * 0.8, -R * 2.25);
        ctx.quadraticCurveTo(sg * R * 1.0, -R * 1.4, sg * R * 0.25, -R * 0.9);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
    } else if (hat === 'wardenhat') {
      ctx.fillStyle = '#1a1a24';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.98, R * 1.85, R * 0.34, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2c2c3c';
      ctx.fillRect(-R * 1.0, -R * 2.25, R * 2.0, R * 1.3);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(-R * 1.0, -R * 1.42, R * 2.0, R * 0.2);
      drawHorns(ctx, R, '#e8e0d0');
    }
    ctx.restore();
  }

  function drawHorns(ctx, R, col) {
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-R * 0.9, -R * 1.6); ctx.quadraticCurveTo(-R * 1.6, -R * 1.1, -R * 0.75, -R * 0.75);
    ctx.quadraticCurveTo(-R * 0.85, -R * 1.25, -R * 0.5, -R * 1.55);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R * 0.9, -R * 1.6); ctx.quadraticCurveTo(R * 1.6, -R * 1.1, R * 0.75, -R * 0.75);
    ctx.quadraticCurveTo(R * 0.85, -R * 1.25, R * 0.5, -R * 1.55);
    ctx.closePath(); ctx.fill();
  }

  /* =====================================================================
     WEAPON DRAWING
     ===================================================================== */
  function drawWeapon(ctx, kind, x, y, ang, opts) {
    opts = opts || {};
    const W = WEAPONS[kind];
    if (!W) return;
    const scale = opts.scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-ang);      // ang measured as weapon swing
    ctx.scale(scale, scale);
    const g = ctx.createLinearGradient(0, 0, W.len, 0);
    ctx.lineCap = 'round';

    if (W.gun) {
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(-6, -3.2, W.len * 0.72, 6.4);
      ctx.fillStyle = '#1a252f';
      ctx.fillRect(W.len * 0.6, -2.0, W.len * 0.42, 4.0);
      ctx.fillStyle = '#5d4037';
      ctx.save(); ctx.rotate(0.5); ctx.fillRect(-4, 0, 12, 7); ctx.restore();
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(-2, -6, 6, 12);
    } else if (W.hook) {
      ctx.strokeStyle = W.color; ctx.lineWidth = W.w;
      ctx.beginPath(); ctx.arc(0, 0, W.len * 0.7, -1.2, 1.6); ctx.stroke();
      ctx.fillStyle = W.hilt; ctx.fillRect(-14, -4, 14, 8);
    } else {
      // blade
      ctx.fillStyle = W.hilt;
      ctx.fillRect(-10, -2.6, 12, 5.2);
      ctx.fillStyle = W.guard;
      ctx.fillRect(0, -5, 4, 10);
      const blade = ctx.createLinearGradient(0, -3, 0, 3);
      blade.addColorStop(0, '#ffffff');
      blade.addColorStop(0.5, W.color);
      blade.addColorStop(1, 'rgba(120,140,160,0.9)');
      ctx.fillStyle = blade;
      ctx.beginPath();
      ctx.moveTo(4, -W.w * 0.6);
      ctx.lineTo(W.len - 6, -W.w * 0.45);
      ctx.lineTo(W.len, 0);
      ctx.lineTo(W.len - 6, W.w * 0.45);
      ctx.lineTo(4, W.w * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7; ctx.stroke();
      if (kind === 'katana' || kind === 'cane') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(8, -1); ctx.lineTo(W.len - 8, -1); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* =====================================================================
     BODY RIG
     ===================================================================== */
  function bodyColors(c, flashAmt) {
    const out = {
      skin: c.skin || '#f0b98a',
      shirt: c.shirt || '#e63946',
      pants: c.pants || '#2f6fb5',
      sash: c.sash || '#ffd700',
      hair: c.hair || '#1a1a1a',
      hat: c.hat || 'none',
      outline: 'rgba(0,0,0,0.32)',
    };
    if (flashAmt) {
      for (const k of ['skin', 'shirt', 'pants', 'sash', 'hair']) {
        out[k] = shade(out[k], Math.min(0.92, flashAmt));
      }
    }
    return out;
  }

  function drawFighter(ctx, e, time) {
    const s = e.scale || 1;
    const c = bodyColors(e.colors || {}, e.flashAmt || 0);
    const limbCol = e.skinOverride || c.skin;

    ctx.save();
    ctx.translate(e.x, e.y);
    // ground shadow (drawn in world space, so reset rotation for it)
    ellipseShadow(ctx, 0, 0, 22 * s * (e.sizeScale || 1), 0.5);

    ctx.scale((e.facing || 1) * s * (e.sizeScale || 1), s * (e.sizeScale || 1));
    ctx.translate(0, -(e.pose.liftY || 0));

    if (e.pose.rot) {
      ctx.translate(0, -6);
      ctx.rotate(-e.pose.rot);
      ctx.translate(0, 6);
    }
    if (e.pose.lean) {
      ctx.rotate(e.pose.lean * 0.5);
    }

    const cs = e.pose.crouch * 22;
    const hipY = RIG.hipY + cs;
    const shoulderY = RIG.shoulderY + cs * 1.35;
    const headY = RIG.headY + cs * 1.5;
    const twist = e.pose.torsoTwist || 0;
    const sx = RIG.shoulderX * Math.cos(twist), hipx = RIG.hipX * Math.cos(twist);

    // ---- garments that sit behind the whole body (coats, capes, pads) ----
    if (e.extrasBack) e.extrasBack(ctx, e, { hipY, shoulderY, headY, sx, hipx, RIG });

    // ---------------- BACK LIMBS ----------------
    const backLimb = shade(limbCol, -0.18);
    const backCloth = shade(c.shirt, -0.2);
    const backPants = shade(c.pants, -0.2);

    // back leg
    limb(ctx, -hipx, hipY, e.pose.legB[0], RIG.thigh, e.pose.legB[1], RIG.shin,
      13, 10, backPants, c.outline);
    drawFoot(ctx, -hipx, hipY, e.pose.legB, backPants, -1);

    // back arm
    const backArmEnd = limb(ctx, -sx, shoulderY, e.pose.armB[0], RIG.upArm, e.pose.armB[1], RIG.foreArm,
      10.5, 8.5, backCloth, null, 1, 1);
    const backHandX = backArmEnd.x, backHandY = backArmEnd.y;

    // ---------------- TORSO ----------------
    drawTorso(ctx, c, e, hipx, hipY, sx, shoulderY, cs);

    // ---------------- FRONT LEG ----------------
    limb(ctx, hipx, hipY, e.pose.legF[0], RIG.thigh, e.pose.legF[1], RIG.shin,
      13.5, 10.5, c.pants, c.outline);
    drawFoot(ctx, hipx, hipY, e.pose.legF, c.pants, 1);

    // ---------------- FRONT ARM (with weapon) ----------------
    const extF = e.pose.extF || 1;
    const fArm = limb(ctx, sx, shoulderY, e.pose.armF[0], RIG.upArm, e.pose.armF[1], RIG.foreArm,
      11, 9, c.shirt, null, 1, 1);
    const fHandX = fArm.x, fHandY = fArm.y;
    // rubber stretch: draw a stretched link between shoulder and hand
    if (extF > 1.25) {
      ctx.strokeStyle = limbCol; ctx.lineWidth = 9; ctx.lineCap = 'round';
      const ax = sx, ay = shoulderY;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + fHandX) / 2, (ay + fHandY) / 2 + 10 * Math.sin(time * 6), fHandX, fHandY);
      ctx.stroke();
      ctx.fillStyle = limbCol;
      ctx.beginPath(); ctx.arc(fHandX, fHandY, 8.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // weapon in front hand
    if (e.weapon && WEAPONS[e.weapon]) {
      const wang = 1.35 + (e.pose.weapon || 0) + e.pose.armF[1] * 0.15;
      drawWeapon(ctx, e.weapon, fHandX, fHandY, wang, { scale: e.weaponScale || 1 });
    }
    // second weapon (dual wielding / three-sword style)
    if (e.weapon2) {
      drawWeapon(ctx, e.weapon2, backHandX, backHandY, 1.9 + (e.pose.weapon || 0) * 0.7, { scale: 1 });
    }

    // ---------------- HEAD ----------------
    drawHead(ctx, e.colors || {}, 0, headY, RIG.headR * (e.headScale || 1), (e.pose.head || 0) + 0.06, e.faceOpts || {});

    // accessories that need torso context
    if (e.extras) e.extras(ctx, e, { hipY, shoulderY, headY, sx, hipx });

    ctx.restore();
  }

  function drawFoot(ctx, hx, hy, leg, col, front) {
    const kx = hx + Math.sin(leg[0]) * RIG.thigh;
    const ky = hy + Math.cos(leg[0]) * RIG.thigh;
    const fx = kx + Math.sin(leg[1]) * RIG.shin;
    const fy = ky + Math.cos(leg[1]) * RIG.shin;
    const ang = leg[1] * 0.7 + 1.5;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(ang * (front >= 0 ? 1 : 1));
    ctx.fillStyle = shade(col, front >= 0 ? 0 : -0.2);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(RIG.foot * 0.4, 2, RIG.foot * 0.62, 5.0, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    return { x: fx, y: fy };
  }

  function drawTorso(ctx, c, e, hipx, hipY, sx, shoulderY, cs) {
    const body = e.bodyType || 'human';
    const w = 15 + (e.bulk || 0) * 6;
    const topW = 17 + (e.bulk || 0) * 7;

    ctx.save();
    // shirt / torso shape
    ctx.beginPath();
    ctx.moveTo(-hipx - w * 0.8, hipY + 4);
    ctx.quadraticCurveTo(-topW, (hipY + shoulderY) / 2, -topW * 0.9, shoulderY + 2);
    ctx.quadraticCurveTo(0, shoulderY - 6, topW * 0.9, shoulderY + 2);
    ctx.quadraticCurveTo(topW, (hipY + shoulderY) / 2, hipx + w * 0.8, hipY + 4);
    ctx.closePath();
    const g = ctx.createLinearGradient(-topW, 0, topW, 0);
    g.addColorStop(0, shade(c.shirt, -0.16));
    g.addColorStop(0.45, c.shirt);
    g.addColorStop(1, shade(c.shirt, 0.12));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1.6; ctx.stroke();

    if (body === 'skeleton') {
      // Brook: ribcage
      ctx.strokeStyle = '#f2f4f5'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const y = shoulderY + 10 + i * 8;
        ctx.beginPath();
        ctx.moveTo(-topW * 0.55, y);
        ctx.quadraticCurveTo(0, y + 4, topW * 0.55, y);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(0, shoulderY + 2); ctx.lineTo(0, hipY); ctx.stroke();
      ctx.fillStyle = '#111118';
      ctx.fillRect(-6, hipY - 8, 12, 14);
    } else if (body === 'fishman' || body === 'beast' || body === 'demon') {
      // gill / muscle lines
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(sx * 0.3 + i * 3, shoulderY + 8);
        ctx.lineTo(sx * 0.5 + i * 3, shoulderY + 20);
        ctx.stroke();
      }
      if (body === 'fishman') {
        ctx.fillStyle = shade(c.skin || '#1abc9c', -0.25);
        ctx.beginPath();
        ctx.ellipse(-topW * 0.9, (hipY + shoulderY) / 2, 5, 16, 0.2, 0, TAU);
        ctx.fill();
      }
    } else if (body === 'zombie' || body === 'jailer') {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const y = shoulderY + 14 + i * 12;
        ctx.beginPath();
        ctx.moveTo(-6, y);
        for (let k = -3; k <= 3; k++) ctx.lineTo(k * 3.2, y + (k % 2 ? 2.4 : -2.4));
        ctx.stroke();
      }
    }

    // sash / belt
    if (c.sash) {
      ctx.fillStyle = c.sash;
      ctx.fillRect(-hipx - w * 0.85, hipY - 4, (hipx + w * 0.85) * 2, 7);
    }
    if (e.torsoExtra) e.torsoExtra(ctx, e, { hipx, hipY, sx, shoulderY, topW });
    ctx.restore();
  }

  function shade(hex, amt) {
    if (!hex) return '#888';
    if (hex[0] !== '#') return hex;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    const to = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  }

  /* =====================================================================
     COSTUME OVERLAYS
     ===================================================================== */
  function makeExtras(kind, opt, layer) {
    if (layer === 'back') {
      return function (ctx, e, geo) {
        const { hipY, shoulderY, headY, sx, hipx } = geo;
        switch (kind) {
          case 'coat': {    // generic long coat / cape behind the fighter
            ctx.fillStyle = opt && opt.col || '#2c2c3c';
            ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.6;
            const w2 = opt && opt.w || 26;
            ctx.beginPath();
            ctx.moveTo(-w2 * 0.7, shoulderY - 6);
            ctx.quadraticCurveTo(-w2 * 1.8, hipY + 30, -w2 * 1.15, hipY + (opt && opt.len || 62));
            ctx.lineTo(w2 * 1.0, hipY + (opt && opt.len || 62));
            ctx.quadraticCurveTo(w2 * 1.7, hipY + 26, w2 * 0.72, shoulderY - 6);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          }
          case 'fur': {     // Crocodile's fur collar
            ctx.fillStyle = opt && opt.col || '#3d2b1f';
            for (let i = 0; i < 11; i++) {
              const a = -1.75 + i * 0.32;
              const bx = Math.sin(a) * 20, by = shoulderY + 8 + Math.cos(a) * 6;
              ctx.beginPath(); ctx.ellipse(bx, by, 8, 9, a, 0, TAU); ctx.fill();
            }
            break;
          }
          case 'pads': {    // Franky / Krieg shoulder pads
            ctx.fillStyle = opt && opt.col || '#2e86c1';
            ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4;
            [-1, 1].forEach(sg => {
              ctx.beginPath();
              ctx.ellipse(sg * 20, shoulderY + 2, 12, 11, sg * 0.2, 0, TAU);
              ctx.fill(); ctx.stroke();
            });
            break;
          }
          case 'hannya': {  // Hannyabal warden coat
            ctx.fillStyle = '#1a1a2e';
            ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-14, shoulderY - 4);
            ctx.lineTo(-30, hipY + 58); ctx.lineTo(22, hipY + 62); ctx.lineTo(13, shoulderY - 4);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#f1c40f';
            ctx.fillRect(-17, shoulderY + 16, 34, 5);
            break;
          }
          case 'marine': {
            ctx.fillStyle = '#f4f6f7';
            ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(-15, shoulderY - 2); ctx.lineTo(-27, shoulderY + 52);
            ctx.lineTo(18, shoulderY + 56); ctx.lineTo(12, shoulderY - 2);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          }
          case 'clown_cloak': {
            ctx.fillStyle = '#e63946';
            ctx.beginPath();
            ctx.moveTo(-14, shoulderY - 4); ctx.lineTo(-24, hipY + 34);
            ctx.lineTo(18, hipY + 36); ctx.lineTo(13, shoulderY - 4);
            ctx.closePath(); ctx.fill();
            break;
          }
          case 'samurai': {
            ctx.fillStyle = '#4a5568';
            ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(-15, shoulderY - 2); ctx.lineTo(-21, hipY + 26);
            ctx.lineTo(19, hipY + 28); ctx.lineTo(14, shoulderY - 2);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
          }
        }
      };
    }
    return function (ctx, e, geo) {
      const { hipY, shoulderY, headY, sx, hipx } = geo;
      switch (kind) {
          case 'swords3': {   // Zoro — three katanas at the hip
          ctx.save();
          for (let i = 0; i < 3; i++) {
            ctx.save();
            ctx.translate(-hipx - 4 + i * 3.4, hipY - 2);
            ctx.rotate(-2.5 + i * 0.16);
            drawWeapon(ctx, 'katana', 0, 0, 0, {});
            ctx.restore();
          }
          ctx.restore();
          // haramaki
          ctx.fillStyle = '#1f6b3a';
          ctx.fillRect(-16, hipY - 12, 32, 13);
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.2;
          ctx.strokeRect(-16, hipY - 12, 32, 13);
          // bandana on arm
          ctx.fillStyle = '#111';
          ctx.fillRect(-16, shoulderY + 16, 10, 5);
          break;
        }
        case 'suit_tie': {  // Sanji
          ctx.fillStyle = '#f5d76e';
          ctx.beginPath();
          ctx.moveTo(-11, shoulderY + 3); ctx.lineTo(9, shoulderY + 2);
          ctx.lineTo(7, headY - 4); ctx.lineTo(-9, headY - 3);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#c0392b';
          ctx.beginPath();
          ctx.moveTo(0, shoulderY + 8); ctx.lineTo(4, shoulderY + 12); ctx.lineTo(2, hipY - 4); ctx.lineTo(-2, hipY - 4); ctx.lineTo(-4, shoulderY + 12);
          ctx.closePath(); ctx.fill();
          // cigarette
          ctx.fillStyle = '#fff';
          ctx.fillRect(9, headY + 2, 9, 2.4);
          ctx.fillStyle = '#ff6b00';
          ctx.beginPath(); ctx.arc(19, headY + 3.2, 1.4, 0, TAU); ctx.fill();
          break;
        }
        case 'sniper': {    // Usopp — satchel, bandolier and belt
          ctx.fillStyle = '#5f4726';
          ctx.fillRect(-15, hipY - 14, 30, 16);
          ctx.strokeStyle = '#2e8b57'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(-13, shoulderY + 4); ctx.lineTo(11, hipY - 12); ctx.stroke();
          ctx.fillStyle = '#3a4a2a';
          ctx.fillRect(-16, hipY - 4, 32, 6);
          break;
        }
        case 'cyborg': {    // Franky's speedo + chest plate (pads are on the back layer)
          ctx.fillStyle = '#c0392b';
          ctx.fillRect(-16, hipY - 16, 32, 20);
          ctx.fillStyle = '#e74c3c';
          ctx.beginPath(); ctx.arc(0, hipY - 6, 7, 0, TAU); ctx.fill();
          ctx.fillStyle = '#e67e22';
          ctx.beginPath();
          ctx.moveTo(0, shoulderY - 2); ctx.lineTo(8, shoulderY + 6); ctx.lineTo(0, shoulderY + 13); ctx.lineTo(-8, shoulderY + 6);
          ctx.closePath(); ctx.fill();
          break;
        }
        case 'leopard': {   // Lucci hybrid / Jabra
          ctx.fillStyle = opt && opt.col || '#c9a227';
          ctx.beginPath(); ctx.ellipse(0, shoulderY + 26, 26, 34, 0, 0, TAU);
          ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = '#2c3e50';
          for (let i = 0; i < 7; i++) {
            ctx.beginPath();
            ctx.arc(-18 + i * 6, shoulderY + 12 + (i % 3) * 12, 2.6, 0, TAU);
            ctx.fill();
          }
          // tail
          ctx.strokeStyle = opt && opt.col || '#c9a227'; ctx.lineWidth = 7; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-hipx, hipY + 2);
          ctx.quadraticCurveTo(-42, hipY - 14, -34 - Math.sin(e.animTime * 2) * 8, hipY + 22);
          ctx.stroke();
          break;
        }
        case 'poison_aura': {  // Magellan
          ctx.fillStyle = 'rgba(142,68,173,0.55)';
          ctx.strokeStyle = 'rgba(230,126,34,0.8)'; ctx.lineWidth = 1.6;
          for (let i = 0; i < 5; i++) {
            const px = -20 + i * 10;
            const ph = 8 + Math.sin(e.animTime * 3 + i) * 4;
            ctx.beginPath();
            ctx.moveTo(px - 4, shoulderY + 4);
            ctx.quadraticCurveTo(px, shoulderY - ph, px + 4, shoulderY + 4);
            ctx.fill(); ctx.stroke();
          }
          break;
        }
        case 'samurai': {   // Ryuma
          ctx.fillStyle = '#4a5568';
          ctx.beginPath();
          ctx.moveTo(-16, shoulderY - 2); ctx.lineTo(-20, hipY + 20); ctx.lineTo(16, hipY + 22); ctx.lineTo(14, shoulderY - 2);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#e74c3c';
          ctx.fillRect(-18, hipY - 2, 36, 7);
          break;
        }
        case 'gold_armor': { // Don Krieg
          ctx.fillStyle = '#c9a227';
          ctx.strokeStyle = '#7b5e0e'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.ellipse(0, shoulderY + 22, 19, 24, 0, 0, TAU); ctx.fill(); ctx.stroke();
          [[-1, -20], [1, 20]].forEach(([s, ox]) => {
            ctx.beginPath();
            ctx.moveTo(ox - 10, shoulderY - 4); ctx.lineTo(ox, shoulderY - 18); ctx.lineTo(ox + 10, shoulderY - 4);
            ctx.closePath(); ctx.fill(); ctx.stroke();
          });
          break;
        }
        case 'clown': {     // Buggy
          ctx.fillStyle = '#1abc9c';
          ctx.fillRect(-16, hipY - 8, 32, 12);
          // floating detached hands (Bara Bara)
          const t = e.animTime * 2;
          [[-26, shoulderY + 20 + Math.sin(t) * 6], [28, shoulderY + 10 + Math.cos(t * 1.3) * 6]].forEach(([hx2, hy2]) => {
            ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(hx2, hy2, 7.5, 0, TAU); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath(); ctx.arc(hx2, hy2, 3, 0, TAU); ctx.fill();
          });
          break;
        }
      }
    };
  }

  /* =====================================================================
     ENTITY → VISUAL CONFIG
     ===================================================================== */
  function charVisual(charId) {
    const C = global.OPF.CHAR_BY_ID[charId];
    const v = { scaleHint: 1.0,
      bodyType: 'human', colors: {}, faceOpts: {}, weapon: null, weapon2: null,
      extras: null, bulk: 0, headScale: 1, sizeScale: 1,
    };
    v.scaleHint = 1.0;
    switch (charId) {
      case 'luffy':
        v.colors = { skin: '#f0b98a', shirt: '#e63946', pants: '#2f6fb5', sash: '#ffd700', hair: '#1a1a1a', hat: 'straw', hairStyle: 'short' };
        v.faceOpts = { bigEyes: true, grinn: true, cheekScar: true };
        v.extras = makeExtras('strawhat_vest');
        break;
      case 'zoro':
        v.colors = { skin: '#e8b184', shirt: '#1f6b3a', pants: '#2a2a35', sash: '#1f6b3a', hair: '#3fa34d', hat: 'bandana', hairStyle: 'short' };
        v.faceOpts = { grin: false };
        v.weapon = 'katana'; v.weapon2 = 'katana';
        v.extras = makeExtras('swords3');
        break;
      case 'sanji':
        v.colors = { skin: '#f0c9a0', shirt: '#1c1c28', pants: '#1c1c28', sash: '#111', hair: '#f5d76e', hat: 'none', hairStyle: 'long' };
        v.faceOpts = {};
        v.extras = makeExtras('suit_tie');
        break;
      case 'usopp':
        v.colors = { skin: '#a86a3c', shirt: '#8b6b3d', pants: '#5f4726', sash: '#c8a165', accent: '#2e8b57', hair: '#191919', hat: 'bandana', hairStyle: 'long' };
        v.faceOpts = { longNose: true, bigEyes: true };
        v.extras = makeExtras('sniper');
        break;
      case 'franky':
        v.colors = { skin: '#eab98f', shirt: '#2e86c1', pants: '#e74c3c', sash: '#2980b9', hair: '#2e86c1', hat: 'none', hairStyle: 'swirl' };
        v.faceOpts = { sunglasses: true };
        v.bulk = 0.8; v.headScale = 1.05;
        v.extras = makeExtras('cyborg');
        v.extrasBack = makeExtras('pads', { col: '#2e86c1' }, 'back');
        break;
      case 'brook':
        v.bodyType = 'skeleton';
        v.colors = { skin: '#f2f4f5', shirt: '#111118', pants: '#111118', sash: '#aed6f1', hair: '#111118', hat: 'tophat', hairStyle: 'afro' };
        v.faceOpts = { skull: true };
        v.weapon = 'cane';
        v.extras = makeExtras('skeleton');
        break;
    }
    v.char = C;
    return v;
  }

  function enemyVisual(typeId) {
    const T = global.OPF.ENEMY_TYPES[typeId];
    const v = { scaleHint: (T.size || 1) * 0.96,
      bodyType: 'human', colors: {}, faceOpts: {}, weapon: T.weapon || null, weapon2: null,
      extras: null, bulk: 0, headScale: 1, sizeScale: T.size || 1, anim: 'sword',
    };
    const base = { skin: '#e0a878', shirt: T.color, pants: shade(T.color, -0.3), sash: T.accent, hair: '#2b2b2b', hat: 'none', hairStyle: 'short' };
    v.colors = Object.assign(base, {});

    switch (T.body) {
      case 'marine':
        v.colors = { skin: '#e8b98f', shirt: '#f4f6f7', pants: '#f4f6f7', sash: '#1b3a6b', hair: '#3b2f2f', hat: 'marinecap', hairStyle: 'short' };
        v.faceOpts = {};
        if (typeId === 'marine_guard') v.extrasBack = makeExtras('marine', {}, 'back');
        break;
      case 'pirate':
        v.colors = { skin: '#dfa878', shirt: T.color, pants: '#4a4a52', sash: T.accent, hair: '#1f1f1f', hat: 'bandana', hairStyle: 'long' };
        v.faceOpts = { openMouth: true };
        break;
      case 'fishman':
        v.bodyType = 'fishman';
        v.colors = { skin: T.color, shirt: shade(T.color, -0.35), pants: '#2c3e50', sash: T.accent, hair: '#0e6655', hat: 'none', hairStyle: 'bald' };
        v.faceOpts = { sawNose: true, openMouth: true, gills: true };
        v.bulk = 0.5; v.headScale = 1.1;
        break;
      case 'agent':
        v.colors = { skin: '#e8b98f', shirt: '#2c3e50', pants: '#1c2833', sash: T.accent, hair: '#111', hat: 'none', hairStyle: 'short' };
        v.faceOpts = { sunglasses: true };
        break;
      case 'desert':
        v.colors = { skin: '#c99a63', shirt: T.color, pants: shade(T.color, -0.25), sash: T.accent, hair: '#2b2118', hat: 'turban', hairStyle: 'short' };
        v.faceOpts = { beard: true, beardColor: '#3b2f2f' };
        break;
      case 'shipwright':
        v.colors = { skin: '#e0a878', shirt: T.color, pants: '#4a3b2a', sash: T.accent, hair: '#2b2118', hat: 'bandana', hairStyle: 'short' };
        v.bulk = 0.4;
        v.faceOpts = { beard: true, beardColor: '#2b2118' };
        break;
      case 'zombie':
        v.bodyType = 'zombie';
        v.colors = { skin: '#8fa07a', shirt: T.color, pants: shade(T.color, -0.35), sash: T.accent, hair: '#4a4a4a', hat: 'none', hairStyle: 'long' };
        v.faceOpts = { openMouth: true, bigEyes: false };
        break;
      case 'beast':
        v.bodyType = 'beast';
        v.colors = { skin: T.color, shirt: shade(T.color, -0.3), pants: shade(T.color, -0.4), sash: T.accent, hair: '#2b2118', hat: 'none', hairStyle: 'bald' };
        v.bulk = 0.7; v.headScale = 1.15;
        v.faceOpts = { openMouth: true, bigEyes: true };
        break;
      case 'jailer':
        v.colors = { skin: '#d9a273', shirt: '#e8e8e8', pants: '#2c3e50', sash: T.accent, hair: '#111', hat: 'none', hairStyle: 'bald' };
        v.faceOpts = { sunglasses: true };
        break;
      case 'demon':
        v.bodyType = 'demon';
        v.colors = { skin: T.color, shirt: shade(T.color, -0.3), pants: '#1c1c22', sash: T.accent, hair: '#111', hat: 'horns', hairStyle: 'bald', hornColor: '#e8e0d0' };
        v.bulk = 0.9; v.headScale = 1.12;
        v.faceOpts = { openMouth: true };
        break;
      case 'blackbeard':
        v.colors = { skin: '#c99a63', shirt: '#1c1c28', pants: '#2c2c3c', sash: T.accent, hair: '#111', hat: 'tricorn', hairStyle: 'long' };
        v.faceOpts = { beard: true, beardColor: '#111', openMouth: true };
        v.bulk = 0.6;
        break;
    }
    v.type = T;
    return v;
  }

  function bossVisual(bossId) {
    const B = global.OPF.BOSSES[bossId];
    const v = { scaleHint: (B.size || 1.2) * 0.94,
      bodyType: 'human', colors: { skin: '#e8b98f', shirt: B.color, pants: shade(B.color, -0.35), sash: B.accent, hair: '#111', hat: 'none', hairStyle: 'short' },
      faceOpts: {}, weapon: null, weapon2: null, extras: null, bulk: 0.5, headScale: 1.1, sizeScale: B.size || 1.2, boss: B,
    };
    switch (bossId) {
      case 'buggy':
        v.colors = { skin: '#f0c9a0', shirt: '#e63946', pants: '#1abc9c', sash: '#3498db', hair: '#2e86c1', hat: 'tricorn', hairStyle: 'long' };
        v.faceOpts = { clownNose: true, grinn: true, bigEyes: true };
        v.extras = makeExtras('clown');
        v.extrasBack = makeExtras('clown_cloak', {}, 'back');
        break;
      case 'krieg':
        v.colors = { skin: '#d9a273', shirt: '#c9a227', pants: '#4a3b2a', sash: '#7d3c98', hair: '#111', hat: 'none', hairStyle: 'bald' };
        v.faceOpts = { openMouth: true, sunglasses: true };
        v.weapon = 'spear'; v.bulk = 1.1;
        v.extras = makeExtras('gold_armor');
        break;
      case 'arlong':
        v.bodyType = 'fishman';
        v.colors = { skin: '#7fd4c1', shirt: '#f1c40f', pants: '#2c3e50', sash: '#0e6655', hair: '#111', hat: 'none', hairStyle: 'long' };
        v.faceOpts = { sawNose: true, openMouth: true };
        v.bulk = 0.7; v.headScale = 1.15;
        break;
      case 'mr3':
        v.colors = { skin: '#f0c9a0', shirt: '#f1c40f', pants: '#27ae60', sash: '#fff', hair: '#8b4513', hat: 'none', hairStyle: 'swirl' };
        v.faceOpts = { sunglasses: true, grinn: true };
        v.bulk = 0.3;
        break;
      case 'mr1':
        v.colors = { skin: '#bdc3c7', shirt: '#2c3e50', pants: '#1c2833', sash: '#95a5a6', hair: '#333', hat: 'none', hairStyle: 'bald' };
        v.faceOpts = { sunglasses: true };
        v.weapon = 'knife'; v.weapon2 = 'knife'; v.bulk = 0.6;
        v.torsoExtra = function (ctx) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2;
          for (let i = 0; i < 5; i++) {
            ctx.beginPath(); ctx.moveTo(-14 + i * 7, -60); ctx.lineTo(-10 + i * 7, -95); ctx.stroke();
          }
        };
        break;
      case 'crocodile':
        v.colors = { skin: '#d9a273', shirt: '#8b7355', pants: '#4a3b2a', sash: '#d4af37', hair: '#111', hat: 'none', hairStyle: 'long' };
        v.faceOpts = { sunglasses: true, openMouth: true };
        v.weapon = 'hook'; v.bulk = 0.7; v.headScale = 1.05;
        v.extrasBack = makeExtras('fur', { col: '#3d2b1f' }, 'back');
        break;
      case 'blueno':
        v.colors = { skin: '#e8b98f', shirt: '#1c2833', pants: '#1c2833', sash: '#f1c40f', hair: '#111', hat: 'horns', hairStyle: 'short', hornColor: '#8b7d6b' };
        v.faceOpts = { sunglasses: false };
        v.bulk = 0.6;
        break;
      case 'jabra':
        v.bodyType = 'beast';
        v.colors = { skin: '#a0522d', shirt: '#2c3e50', pants: '#1c2833', sash: '#c9a227', hair: '#3b2f2f', hat: 'none', hairStyle: 'long' };
        v.faceOpts = { openMouth: true };
        v.bulk = 0.85; v.headScale = 1.1;
        v.extras = makeExtras('leopard', { col: '#a0522d' });
        break;
      case 'lucci':
        v.bodyType = 'beast';
        v.colors = { skin: '#d9c9a0', shirt: '#1c1c28', pants: '#1c1c28', sash: '#c0392b', hair: '#111', hat: 'tricorn', hairStyle: 'short' };
        v.faceOpts = { openMouth: true };
        v.bulk = 0.9; v.headScale = 1.1;
        v.extras = makeExtras('leopard', { col: '#d9c9a0' });
        break;
      case 'absalom':
        v.colors = { skin: '#cfcfcf', shirt: '#7d7d8f', pants: '#3d3d4a', sash: '#8e44ad', hair: '#f0f0f0', hat: 'none', hairStyle: 'afro' };
        v.faceOpts = { sunglasses: true, grinn: true };
        v.bulk = 0.85; v.headScale = 1.2;
        break;
      case 'ryuma':
        v.colors = { skin: '#8fa07a', shirt: '#4a5568', pants: '#2c3e50', sash: '#e74c3c', hair: '#111', hat: 'none', hairStyle: 'afro' };
        v.faceOpts = { sunglasses: true };
        v.weapon = 'katana'; v.bulk = 0.4;
        v.extrasBack = makeExtras('samurai', {}, 'back');
        break;
      case 'moria':
        v.colors = { skin: '#b6a4c9', shirt: '#5b2c6f', pants: '#3b1f4a', sash: '#f39c12', hair: '#f39c12', hat: 'horns', hairStyle: 'long', hornColor: '#b6a4c9' };
        v.faceOpts = { openMouth: true, grinn: true };
        v.bulk = 1.3; v.headScale = 1.25; v.sizeScale = 1.5;
        v.extrasBack = makeExtras('coat', { col: '#3b1f4a', w: 30, len: 56 }, 'back');
        break;
      case 'hannyabal':
        v.colors = { skin: '#c99a63', shirt: '#1a1a2e', pants: '#2c2c3c', sash: '#f1c40f', hair: '#111', hat: 'wardenhat', hairStyle: 'long' };
        v.faceOpts = { openMouth: true };
        v.bulk = 0.9;
        v.extrasBack = makeExtras('hannya', {}, 'back');
        break;
      case 'magellan':
        v.bodyType = 'demon';
        v.colors = { skin: '#c0392b', shirt: '#7b241c', pants: '#4a1512', sash: '#f39c12', hair: '#111', hat: 'horns', hairStyle: 'bald', hornColor: '#e8e0d0' };
        v.faceOpts = { openMouth: true };
        v.bulk = 1.2; v.headScale = 1.2;
        v.extras = makeExtras('poison_aura');
        break;
      case 'teach':
        v.colors = { skin: '#c99a63', shirt: '#1c1c28', pants: '#2c2c3c', sash: '#8e44ad', hair: '#111', hat: 'tricorn', hairStyle: 'long' };
        v.faceOpts = { beard: true, beardColor: '#111', openMouth: true, grinn: true };
        v.bulk = 1.2; v.headScale = 1.15; v.sizeScale = 1.45;
        v.extrasBack = makeExtras('coat', { col: '#15151f', w: 30, len: 54 }, 'back');
        break;
    }
    return v;
  }

  /* =====================================================================
     BACKGROUNDS
     ===================================================================== */
  function drawSky(ctx, view, pal, top, bottom, horizon) {
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, horizon);
  }

  function cloud(ctx, x, y, s, col, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, TAU);
    ctx.arc(x + 18 * s, y - 6 * s, 20 * s, 0, TAU);
    ctx.arc(x + 40 * s, y, 15 * s, 0, TAU);
    ctx.arc(x + 20 * s, y + 8 * s, 16 * s, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBackground(ctx, arcId, view, cam, time) {
    const arc = global.OPF.ARCS[arcId];
    const pal = arc.palette;
    const GY = global.OPF.CONFIG.GROUND_Y + (view.yOffset || 0);
    const horizon = GY - 158;
    const floorTop = GY - 34;      // top edge of the walkable ground plane
    ctx.save();

    if (arc.bg === 'eastblue') {
      drawSky(ctx, view, pal, '#4aa6d6', '#cfeaf6', horizon);
      // sun
      ctx.fillStyle = 'rgba(255,242,180,0.9)';
      ctx.beginPath(); ctx.arc(view.w * 0.78, horizon * 0.32, 44, 0, TAU); ctx.fill();
      // clouds
      for (let i = 0; i < 5; i++) {
        const cx = ((i * 340 + time * 8) % (view.w + 400)) - 200;
        cloud(ctx, cx - cam.x * 0.06, horizon * (0.2 + (i % 3) * 0.11), 1 + (i % 3) * 0.4, '#ffffff', 0.75);
      }
      // far sea
      ctx.fillStyle = '#2f7fa8';
      ctx.fillRect(0, horizon - 30, view.w, 90);
      // island silhouettes
      ctx.fillStyle = '#3d6d86';
      for (let i = -1; i < 4; i++) {
        const bx = i * 420 - (cam.x * 0.12) % 420;
        ctx.beginPath();
        ctx.moveTo(bx, horizon - 26);
        ctx.quadraticCurveTo(bx + 90, horizon - 96, bx + 190, horizon - 26);
        ctx.closePath(); ctx.fill();
      }
      // ship masts
      ctx.strokeStyle = '#2b5470'; ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const sx2 = i * 520 + 180 - ((cam.x * 0.2) % 520);
        ctx.beginPath(); ctx.moveTo(sx2, horizon - 20); ctx.lineTo(sx2, horizon - 96); ctx.stroke();
        ctx.fillStyle = '#eef6fb';
        ctx.beginPath(); ctx.moveTo(sx2, horizon - 92); ctx.quadraticCurveTo(sx2 + 44, horizon - 70, sx2, horizon - 34); ctx.fill();
      }
      // sea below
      const sg = ctx.createLinearGradient(0, horizon, 0, floorTop);
      sg.addColorStop(0, '#2f7fa8'); sg.addColorStop(1, '#1b4f6b');
      ctx.fillStyle = sg;
      ctx.fillRect(0, horizon, view.w, floorTop - horizon);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const y = horizon + 8 + i * 12;
        const off = Math.sin(time * 1.4 + i) * 14 - cam.x * 0.2;
        ctx.beginPath();
        ctx.moveTo(((i * 120 + off) % (view.w + 140)) - 70, y);
        ctx.lineTo(((i * 120 + off) % (view.w + 140)) + 40 - 70, y);
        ctx.stroke();
      }
      // dock props
      drawWoodDeck(ctx, view, cam, time, '#b98b4e', '#8a6435', floorTop);
    } else if (arc.bg === 'alabasta') {
      drawSky(ctx, view, pal, '#f2a75a', '#fbe3b0', horizon);
      ctx.fillStyle = 'rgba(255,220,150,0.55)';
      ctx.beginPath(); ctx.arc(view.w * 0.2, horizon * 0.28, 62, 0, TAU); ctx.fill();
      // dunes (3 parallax layers)
      const layers = [
        { c: '#dda760', s: 0.08, h: 120, y: horizon + 6 },
        { c: '#c68d4a', s: 0.18, h: 90, y: horizon + 34 },
        { c: '#ab7639', s: 0.32, h: 66, y: horizon + 62 },
      ];
      layers.forEach((L, li) => {
        ctx.fillStyle = L.c;
        ctx.beginPath();
        ctx.moveTo(-50, view.h);
        for (let x = -50; x < view.w + 100; x += 50) {
          const wx = x + cam.x * L.s;
          const y = L.y - Math.sin(wx * 0.004 + li) * L.h * 0.4 - L.h * 0.5;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(view.w + 60, view.h);
        ctx.closePath(); ctx.fill();
      });
      // palace silhouette
      ctx.fillStyle = 'rgba(120,80,40,0.55)';
      const px = view.w * 0.62 - cam.x * 0.1;
      ctx.fillRect(px, horizon - 120, 120, 120);
      for (let i = 0; i < 4; i++) ctx.fillRect(px + 12 + i * 28, horizon - 148, 16, 30);
      ctx.beginPath(); ctx.arc(px + 60, horizon - 120, 42, Math.PI, TAU); ctx.fill();
      drawSandGround(ctx, view, cam, time, floorTop);
    } else if (arc.bg === 'waterseven') {
      drawSky(ctx, view, pal, '#4d7e9c', '#b9cfda', horizon);
      // clouds
      for (let i = 0; i < 4; i++) cloud(ctx, ((i * 380 + time * 5) % (view.w + 400)) - 200 - cam.x * 0.05, horizon * 0.3, 1.2, '#e8f0f5', 0.6);
      // canal water strip
      ctx.fillStyle = '#3f6b85';
      ctx.fillRect(0, horizon - 8, view.w, 60);
      // city towers (2 layers)
      for (let layer = 0; layer < 2; layer++) {
        const col = layer === 0 ? '#55788f' : '#3d5a6d';
        ctx.fillStyle = col;
        const s = layer === 0 ? 0.14 : 0.26;
        const baseY = horizon + 6 + layer * 10;
        for (let i = 0; i < 10; i++) {
          const bw = 60 + (i % 3) * 26;
          const bh = 80 + ((i * 37) % 5) * 30;
          const bx = i * 150 - ((cam.x * s) % 150);
          ctx.fillRect(bx, baseY - bh, bw, bh + 40);
          ctx.beginPath(); ctx.moveTo(bx - 8, baseY - bh); ctx.lineTo(bx + bw / 2, baseY - bh - 34); ctx.lineTo(bx + bw + 8, baseY - bh); ctx.closePath(); ctx.fill();
          if (layer === 1) {
            ctx.fillStyle = 'rgba(255,236,170,0.5)';
            for (let w2 = 0; w2 < 4; w2++) {
              for (let h2 = 0; h2 < 3; h2++) ctx.fillRect(bx + 10 + w2 * 14, baseY - bh + 16 + h2 * 22, 8, 11);
            }
            ctx.fillStyle = col;
          }
        }
      }
      drawStoneGround(ctx, view, cam, time, floorTop);
    } else if (arc.bg === 'thrillerbark') {
      drawSky(ctx, view, pal, '#1d1330', '#4a2f5c', horizon);
      // moon
      ctx.fillStyle = 'rgba(240,235,255,0.85)';
      ctx.beginPath(); ctx.arc(view.w * 0.2, horizon * 0.24, 40, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(74,47,92,0.9)';
      ctx.beginPath(); ctx.arc(view.w * 0.2 + 14, horizon * 0.24 - 8, 34, 0, TAU); ctx.fill();
      // mansion silhouette
      ctx.fillStyle = '#2a1f38';
      const mx = view.w * 0.5 - cam.x * 0.1;
      ctx.fillRect(mx, horizon - 170, 300, 176);
      for (let i = 0; i < 3; i++) {
        const tx = mx + 20 + i * 110;
        ctx.fillRect(tx, horizon - 240, 50, 80);
        ctx.beginPath(); ctx.moveTo(tx - 8, horizon - 240); ctx.lineTo(tx + 25, horizon - 278); ctx.lineTo(tx + 58, horizon - 240); ctx.closePath(); ctx.fill();
      }
      // windows
      ctx.fillStyle = 'rgba(255,170,60,0.55)';
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 3; j++) {
          const wx = mx + 22 + i * 34 + ((i + j) % 2) * 4;
          if (wx < mx + 290) ctx.fillRect(wx, horizon - 150 + j * 46, 16, 22);
        }
      }
      // dead trees
      ctx.strokeStyle = '#1f1828'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const tx = i * 300 + 60 - ((cam.x * 0.3) % 300);
        ctx.beginPath();
        ctx.moveTo(tx, horizon + 70);
        ctx.quadraticCurveTo(tx + 12, horizon - 20, tx + 4, horizon - 96);
        ctx.stroke();
        ctx.lineWidth = 4;
        [[-1, -60], [1, -40], [-1, -20]].forEach(([s, dy]) => {
          ctx.beginPath();
          ctx.moveTo(tx + 4, horizon + dy);
          ctx.quadraticCurveTo(tx + s * 34, horizon + dy - 26, tx + s * 52, horizon + dy - 46);
          ctx.stroke();
        });
        ctx.lineWidth = 7;
      }
      ctx.fillStyle = pal.ground;
      ctx.fillRect(0, horizon + 60, view.w, view.h - (horizon + 60));
      // fog
      ctx.fillStyle = 'rgba(160,140,190,0.16)';
      for (let i = 0; i < 4; i++) {
        const fy = horizon + 10 + i * 26 + Math.sin(time * 0.6 + i) * 6;
        ctx.fillRect(0, fy, view.w, 22);
      }
      drawGround(ctx, view, cam, time, pal.ground, pal.groundDark, floorTop);
    } else {
      // impel down
      drawSky(ctx, view, pal, '#16121a', '#3a2318', horizon);
      ctx.fillStyle = 'rgba(255,120,40,0.14)';
      ctx.beginPath(); ctx.arc(view.w * 0.5, horizon + 40, 240, 0, TAU); ctx.fill();
      // cave walls
      ctx.fillStyle = '#241a14';
      for (let i = -1; i < 6; i++) {
        const bx = i * 260 - ((cam.x * 0.16) % 260);
        ctx.beginPath();
        ctx.moveTo(bx, horizon + 80);
        ctx.lineTo(bx + 40, horizon - 180 - (i % 3) * 40);
        ctx.lineTo(bx + 130, horizon - 150 - (i % 2) * 30);
        ctx.lineTo(bx + 200, horizon + 80);
        ctx.closePath(); ctx.fill();
      }
      // cell bars
      ctx.fillStyle = '#1a1210';
      for (let i = 0; i < 7; i++) {
        const bx = i * 200 + 40 - ((cam.x * 0.3) % 200);
        ctx.fillRect(bx, horizon - 130, 6, 200);
        ctx.fillRect(bx + 34, horizon - 130, 6, 200);
        ctx.fillRect(bx - 4, horizon - 130, 48, 7);
      }
      // lava glow seams
      ctx.strokeStyle = 'rgba(255,110,30,0.5)'; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const lx = i * 210 - ((cam.x * 0.22) % 210);
        ctx.beginPath();
        ctx.moveTo(lx, horizon + 60);
        ctx.lineTo(lx + 30, horizon - 20);
        ctx.lineTo(lx + 10, horizon - 60);
        ctx.stroke();
      }
      // chains
      ctx.strokeStyle = '#4a4a52'; ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const cx = i * 340 + 120 - ((cam.x * 0.34) % 340);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.quadraticCurveTo(cx + Math.sin(time * 0.8 + i) * 16, horizon * 0.5, cx, horizon - 120);
        ctx.stroke();
      }
      drawGround(ctx, view, cam, time, pal.ground, pal.groundDark, floorTop);
    }
    ctx.restore();
  }

  function drawWoodDeck(ctx, view, cam, time, c1, c2, gy) {
    gy = gy === undefined ? global.OPF.CONFIG.GROUND_Y + (view.yOffset || 0) - 34 : gy;
    ctx.fillStyle = c1;
    ctx.fillRect(0, gy, view.w, view.h - gy);
    ctx.fillStyle = c2;
    for (let i = 0; i < 40; i++) {
      const x = i * 60 - ((cam.x * 0.9) % 60);
      ctx.fillRect(x, gy, 3, view.h - gy);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const y = gy + 20 + i * 22;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.w, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, gy, view.w, 6);
  }

  function drawSandGround(ctx, view, cam, time, gyIn) {
    const gy = gyIn === undefined ? global.OPF.CONFIG.GROUND_Y + (view.yOffset || 0) - 34 : gyIn;
    const g = ctx.createLinearGradient(0, gy, 0, view.h);
    g.addColorStop(0, '#e8cb95'); g.addColorStop(1, '#c9a86c');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, view.w, view.h - gy);
    ctx.strokeStyle = 'rgba(150,115,70,0.4)'; ctx.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      const y = gy + 12 + i * 16 + Math.sin(i) * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= view.w; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
      ctx.stroke();
    }
  }

  function drawStoneGround(ctx, view, cam, time, gyIn) {
    const gy = gyIn === undefined ? global.OPF.CONFIG.GROUND_Y + (view.yOffset || 0) - 34 : gyIn;
    ctx.fillStyle = '#6d7a83';
    ctx.fillRect(0, gy, view.w, view.h - gy);
    ctx.strokeStyle = 'rgba(40,50,58,0.55)'; ctx.lineWidth = 2;
    const tile = 74;
    for (let i = -1; i < view.w / tile + 2; i++) {
      const x = i * tile - ((cam.x * 0.95) % tile);
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x - 30, view.h); ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const y = gy + 18 + i * 20;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.w, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(0, gy, view.w, 5);
    ctx.fillStyle = 'rgba(90,170,200,0.18)'; ctx.fillRect(0, gy - 2, view.w, 3);
  }

  function drawGround(ctx, view, cam, time, c1, c2, gyIn) {
    const gy = gyIn === undefined ? global.OPF.CONFIG.GROUND_Y + (view.yOffset || 0) - 34 : gyIn;
    const g = ctx.createLinearGradient(0, gy, 0, view.h);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, view.w, view.h - gy);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 30; i++) {
      const x = i * 46 - ((cam.x * 0.9) % 46);
      const y = gy + 16 + ((i * 37) % 60);
      ctx.fillRect(x, y, 22 + (i % 4) * 8, 5);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, gy, view.w, 5);
  }

  /* =====================================================================
     PORTRAITS (for menus) — draws a bust of a character into a canvas
     ===================================================================== */
  function drawPortrait(canvas, kind, id) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    let v;
    if (kind === 'char') v = charVisual(id);
    else if (kind === 'boss') v = bossVisual(id);
    else v = enemyVisual(id);

    const C = v.colors;
    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, shade(C.shirt || '#333', -0.5));
    bg.addColorStop(1, '#0d0d16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = C.accent || '#ffd700';
    ctx.beginPath(); ctx.arc(W * 0.7, H * 0.3, W * 0.45, 0, TAU); ctx.fill();
    ctx.restore();

    const s = H / 168;
    ctx.save();
    ctx.translate(W / 2, H * 1.0);
    ctx.scale(s, s);
    // shoulders
    ctx.fillStyle = C.shirt;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-54, 0);
    ctx.quadraticCurveTo(-56, -46, -23, -56);
    ctx.lineTo(23, -56);
    ctx.quadraticCurveTo(56, -46, 54, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // neck
    ctx.fillStyle = C.skin;
    ctx.fillRect(-12, -76, 24, 24);
    // head
    drawHead(ctx, C, 0, -98, 27, 0.02, Object.assign({}, v.faceOpts, { bigEyes: true }));
    ctx.restore();

    // border highlight
    ctx.strokeStyle = 'rgba(255,215,0,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  }

  global.OPF = global.OPF || {};
  global.OPF.Art = {
    drawFighter, drawBackground, drawPortrait, charVisual, enemyVisual, bossVisual,
    drawWeapon, pose: {
      idle: poseIdle, walk: poseWalk, run: poseRun, jump: poseJump, fall: poseFall,
      crouch: poseCrouch, dash: poseDash, hit: poseHit, block: poseBlock, ko: poseKO,
      victory: poseVictory, attacks: ATTACKS, kf, kfe, basePose, p, mixPose,
    },
    shade,
  };
})(window);
