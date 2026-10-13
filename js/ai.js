/* =========================================================================
   ONE PIECE FIGHT — ai.js
   Enemy & boss behaviour. Grunts use a simple profile; bosses run a
   cooldown-driven move pattern from OPF.BOSS_MOVES.
   ========================================================================= */
(function (global) {
  'use strict';

  const OPF = global.OPF;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // per-boss move ordering / weights (maps data.js move names to archetypes)
  const PATTERN_ORDER = {
    buggy: ['chop_chop_cannon', 'blade_tornado', 'muggy_ball'],
    krieg: ['spear_gun', 'mh5_flamethrower', 'poison_gas'],
    arlong: ['shark_on_darts', 'tooth_gum', 'shark_saw'],
    mr3: ['wax_sword', 'candle_wall', 'wax_figure'],
    mr1: ['spiral_hollow', 'dice_blade', 'atomic_spine'],
    crocodile: ['desert_spada', 'sables', 'ground_death'],
    blueno: ['air_door', 'rankyaku', 'tekkai_counter'],
    jabra: ['wolf_lunge', 'rankyaku_roseo', 'tekko_gan'],
    lucci: ['shigan_oo', 'soru_rush', 'rokougan', 'leopard_form'],
    absalom: ['invisible_rush', 'gastro_phony', 'elephant_gun'],
    ryuma: ['shusui_draw', 'gavotte_bond_avant', 'dragon_slash'],
    moria: ['brick_bat', 'doppelman', 'shadow_revolution', 'shadow_asgard'],
    hannyabal: ['iron_whip', 'burning_fist', 'warden_charge'],
    magellan: ['venom_road', 'chloro_ball', 'hydra', 'hells_judgment'],
    teach: ['kurozu', 'black_hole', 'liberation', 'dark_impact'],
  };

  class AIController {
    constructor(fighter, opts) {
      opts = opts || {};
      this.f = fighter;
      this.aggression = opts.aggression !== undefined ? opts.aggression : 0.5;
      this.think = 0;
      this.decision = 'approach';
      this.decisionTime = 0;
      this.attackCd = rnd(0.4, 1.2);
      this.dodgeCd = rnd(1, 3);
      this.jumpCd = rnd(1.5, 4);
      this.specialCd = rnd(1.5, 3.5);
      this.blockTimer = 0;
      this.pending = null;
      this.strafe = Math.random() < 0.5 ? 1 : -1;
      this.boss = !!opts.boss;
      this.bossPattern = opts.bossId ? (PATTERN_ORDER[opts.bossId] || []) : [];
      this.patternIdx = 0;
      this.phase2 = false;
      this.lastMove = null;
    }

    update(dt, world) {
      const f = this.f;
      if (f.dead || world.over) { f.moveInput(0, world); return; }
      const p = world.player;
      if (!p || p.dead) { f.moveInput(0, world); return; }

      this.think += dt;
      this.attackCd -= dt;
      this.dodgeCd -= dt;
      this.jumpCd -= dt;
      this.specialCd -= dt;
      this.decisionTime -= dt;
      if (this.blockTimer > 0) this.blockTimer -= dt;

      const dx = p.x - f.x;
      const adx = Math.abs(dx);
      const dir = dx > 0 ? 1 : -1;

      // phase 2 trigger
      const B = f.boss;
      if (B && !this.phase2 && f.hp / f.maxHp <= (B.phase2 || 0.45)) {
        this.phase2 = true;
        world.onBossPhase2(f);
      }
      const agg = this.aggression * (this.phase2 ? 1.45 : 1);

      // face target unless mid-action
      if (!f.locked) f.facing = dir;

      if (f.locked) return;   // busy attacking / hurt

      // --- Ranged / keep-away grunts -------------------------------------
      if (this.profile === 'ranged') {
        const want = 250;
        if (this.attackCd <= 0 && adx < 520 && Math.abs(p.y - f.y) < 90) {
          this.shoot(world, dir);
          this.attackCd = rnd(1.3, 2.4) / agg;
          return;
        }
        if (adx < want - 60) f.moveInput(-dir, world);
        else if (adx > want + 80) f.moveInput(dir, world);
        else f.moveInput(0, world);
        if (this.jumpCd <= 0 && adx < 120) { f.jump(); this.jumpCd = rnd(2, 4); }
        return;
      }

      // --- Boss -----------------------------------------------------------
      if (this.boss) { this.updateBoss(dt, world, p, adx, dir, agg); return; }

      // --- Melee grunt ----------------------------------------------------
      const range = 78 + (f.reachBonus || 0);
      if (f.state === 'block') {
        if (this.blockTimer <= 0) f.setState('idle');
        return;
      }
      // decide to block incoming attacks
      if (p.attacking && adx < 110 && this.dodgeCd <= 0 && Math.random() < 0.5 * this.aggression) {
        f.setState('block', 0.5);
        this.blockTimer = rnd(0.4, 0.9);
        this.dodgeCd = rnd(1.4, 2.6);
        return;
      }
      if (adx <= range) {
        if (this.attackCd <= 0) {
          this.meleeAttack(world);
          this.attackCd = rnd(0.7, 1.5) / agg;
        } else {
          // shuffle in place
          if (Math.random() < 0.02) this.strafe *= -1;
          f.moveInput(0, world);
        }
      } else {
        f.moveInput(dir, world);
        // hop over / close the gap
        if (this.jumpCd <= 0 && adx > 180 && Math.random() < 0.35) {
          f.jump();
          f.vx = dir * 260;
          this.jumpCd = rnd(2, 5);
        }
      }
      // occasional back-off after taking a beating
      if (f.hp / f.maxHp < 0.3 && Math.random() < 0.006) {
        f.moveInput(-dir, world);
      }
    }

    /* ---------------- grunt attack ---------------- */
    meleeAttack(world) {
      const f = this.f;
      const T = f.typeData || {};
      const weapon = f.weapon;
      const heavy = weapon === 'sword' || weapon === 'spear';
      const reach = heavy ? 82 : 68;
      f.move = {
        id: 'grunt', anim: heavy ? 'slash' : (Math.random() < 0.5 ? 'jab' : 'cross'),
        reach,
        hits: [{
          at: 0.18, mul: heavy ? 1.35 : 1.0, reach,
          w: 74, h: 76, oy: -88, knock: heavy ? 150 : 80, isEnemy: true,
        }],
      };
      f.moveTime = 0; f.moveHitIdx = 0;
      const dur = heavy ? 0.62 : 0.5;
      f.animDur = dur;
      f.setState('attack', dur);
      world.audio.sfx(heavy ? 'whiff' : 'whiff', 0.3);
    }

    /* ---------------- ranged attack ---------------- */
    shoot(world, dir) {
      const f = this.f;
      f.state = 'special';
      f.setState('special', 0.55);
      f.move = { id: 'grunt_shoot', anim: 'cast', dmgMul: 1.2 };
      f.moveTime = 0; f.moveHitIdx = 0;
      f.animDur = 0.55;
      setTimeout(() => {
        if (f.dead || world.over) return;
        world.spawnProjectile(f, {
          kind: 'bullet', x: f.x + dir * 34, y: f.y - 92, vx: dir * 620, vy: 0,
          dmg: f.atk * 1.15, r: 7, life: 1.6, color: '#f1c40f', trailCol: '#f39c12',
        });
        world.audio.sfx('gun', f.x < world.player.x ? -0.3 : 0.3);
      }, 260);
    }

    /* ---------------- boss brain ---------------- */
    updateBoss(dt, world, p, adx, dir, agg) {
      const f = this.f;
      const B = f.boss;
      if (this.pending) return this.runPending(dt, world, p);

      const phase2 = this.phase2;
      const closeRange = adx < 110;
      const midRange = adx >= 110 && adx < 280;

      if (closeRange && f.comboTimer >= 0 && this.attackCd <= 0 && Math.random() < 0.35 + agg * 0.25) {
        // basic 1-2 combo
        this.bossBasicCombo(world, dir);
        this.attackCd = rnd(0.85, 1.5) / agg;
        return;
      }

      if (this.specialCd <= 0 && this.bossPattern.length) {
        const moveId = this.bossPattern[this.patternIdx % this.bossPattern.length];
        const m = OPF.BOSS_MOVES[moveId];
        if (m) {
          const wantClose = m.kind === 'melee' || m.kind === 'spin' || m.kind === 'cone' || m.kind === 'dash' || m.kind === 'multi_dash';
          const wantFar = m.kind === 'projectile' || m.kind === 'volley';
          const okDist = wantClose ? adx < 260 : wantFar ? adx > 150 : true;
          if (okDist || Math.random() < 0.25) {
            this.patternIdx++;
            this.specialCd = rnd(3.0, 4.6) / (phase2 ? 1.8 : 1);
            this.attackCd = 0.6;
            return this.executeBossMove(world, moveId, m, dir);
          }
          this.patternIdx++;
        }
      }

      // reposition
      const want = 120;
      if (adx > want + 40) f.moveInput(dir, world);
      else if (adx < want - 50) f.moveInput(-dir, world);
      else f.moveInput(0, world);

      // taunt / idle
      if (Math.random() < 0.004 && adx > 200) world.log(f.name + ' watches you...', 'special');
    }

    bossBasicCombo(world, dir) {
      const f = this.f;
      const anims = ['jab', 'cross', 'heavy'];
      const a = anims[Math.floor(Math.random() * anims.length)];
      f.move = {
        id: 'boss_combo', anim: a, reach: 84,
        hits: [{ at: 0.2, mul: 1.0, reach: 84, w: 80, h: 80, oy: -90, knock: 110, isEnemy: true }],
      };
      f.moveTime = 0; f.moveHitIdx = 0;
      f.animDur = 0.55;
      f.setState('attack', 0.55);
      world.audio.sfx('whiff', 0.3);
    }

    executeBossMove(world, moveId, m, dir) {
      const f = this.f;
      // rapid repeated-hit patterns hit for less per tick than single heavy blows
      const RAPID = { volley: 0.55, multi_dash: 0.6, spin: 0.62, cone: 0.5 };
      const mul = (m.mul || 1) * (RAPID[m.kind] || 1);
      const base = { id: moveId, anim: m.anim || 'cast', mul, isBoss: true };
      if (world && world.telegraph && (m.kind === 'projectile' || m.kind === 'volley' || m.kind === 'beam' || m.kind === 'wave' || m.kind === 'cone')) {
        world.telegraph(f, m.kind, moveId);
      }

      switch (m.kind) {
        case 'melee': {
          f.animDur = m.dur;
          f.move = Object.assign(base, {
            reach: m.reach, w: m.w, h: m.h, oy: m.oy, knock: m.knock || 200, launch: m.launch || 0,
            burn: m.burn, freeze: m.freeze, shock: m.shock, big: m.big,
          });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('attack', m.dur);
          world.audio.sfx(m.shock ? 'power' : 'whiff', 0.3);
          break;
        }
        case 'dash': {
          f.animDur = m.dur;
          f.move = Object.assign(base, {
            advance: 0, dashVel: 0,
            hits: [
              { at: 0.12, mul: m.mul, reach: m.reach, w: m.w, h: m.h, oy: m.oy, knock: m.knock || 240, burn: m.burn, pierce: m.pierce, color: m.color },
              { at: 0.3, mul: m.mul * 0.9, reach: m.reach, w: m.w, h: m.h, oy: m.oy, knock: m.knock || 240, pierce: m.pierce },
            ],
          });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          f.vx = dir * (m.speed || 620);
          f.dashVel = dir * (m.speed || 620);
          world.fx.dashTrail(f.x, f.y);
          world.audio.sfx('dash');
          break;
        }
        case 'multi_dash': {
          f.animDur = m.dur;
          const hits = [];
          const n = m.hits || 4;
          for (let i = 0; i < n; i++) {
            hits.push({ at: 0.14 + i * (m.dur * 0.72 / n), mul: m.mul, reach: m.reach, w: m.w, h: m.h, oy: m.oy, knock: 100, pierce: true, color: m.color });
          }
          f.move = Object.assign(base, { hits, vanish: m.transparent });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          this.pending = { type: 'blink', until: 0, interval: m.dur * 0.72 / n, move: f.move };
          break;
        }
        case 'spin': {
          f.animDur = m.dur;
          const hits = [];
          const n = m.hits || 5;
          for (let i = 0; i < n; i++) hits.push({ at: 0.2 + i * (m.dur * 0.66 / n), mul: m.mul, reach: m.reach, w: m.w, h: m.h, oy: m.oy, knock: m.knock || 120, freeze: m.freeze, color: m.color });
          f.move = Object.assign(base, { hits });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          f.advance = 260;
          world.audio.sfx('whiff');
          break;
        }
        case 'cone': {
          f.animDur = m.dur;
          const hits = [];
          const n = m.hits || 6;
          for (let i = 0; i < n; i++) hits.push({ at: 0.18 + i * (m.dur * 0.7 / n), mul: m.mul, reach: m.reach, w: m.w, h: m.h, oy: m.oy, burn: m.burn, fire: true });
          f.move = Object.assign(base, { hits });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          world.fx.flameCone(f, f.facing, m.reach);
          world.audio.sfx('fire');
          break;
        }
        case 'projectile': {
          f.animDur = m.dur;
          f.move = base;
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          const self = f;
          this.pending = {
            type: 'timed', until: 0.3, once: true, fn: () => {
              world.spawnProjectile(self, {
                kind: 'boss', x: self.x + self.facing * 40, y: self.y - 92,
                vx: self.facing * (m.speed || 460), vy: 0,
                dmg: self.atk * m.mul, r: m.r || 20, life: 2.2,
                pierce: m.pierce, knock: m.knock || 160, poison: m.poison,
                color: m.color || '#e74c3c', homing: m.homing, pull: m.pull,
                crescent: m.crescent, big: m.big, shake: m.shake,
              });
              world.audio.sfx(m.crescent ? 'slash' : 'power');
            },
          };
          break;
        }
        case 'volley': {
          f.animDur = m.dur;
          f.move = base;
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          const self = f;
          const count = m.count || 4;
          const gap = (m.dur * 0.66) / count;
          let fired = 0;
          this.pending = {
            type: 'repeating', interval: gap, times: count, last: 0.2,
            fn: () => {
              fired++;
              const spread = (m.spread || 0) * (Math.random() - 0.5) * 2;
              const arc = m.arc ? rnd(-220, -60) : 0;
              world.spawnProjectile(self, {
                kind: 'boss', x: self.x + self.facing * 40, y: self.y - 92,
                vx: self.facing * (m.speed || 400) * Math.cos(spread),
                vy: (m.speed || 400) * Math.sin(spread) + arc,
                dmg: self.atk * m.mul, r: m.r || 20, life: 2.4, gravity: m.arc ? 900 : 0,
                poison: m.poison, burn: m.burn, knock: m.knock || 120,
                color: m.color || '#8e44ad', crescent: m.crescent, big: m.big,
              });
              world.audio.sfx(m.crescent ? 'slash' : 'power');
            },
          };
          break;
        }
        case 'wave': {
          f.animDur = m.dur;
          f.move = Object.assign(base, {
            hits: [{ at: m.dur * 0.42, mul: m.mul, reach: 120, w: 120, h: 90, oy: -60, knock: 200, shake: m.shake }],
          });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          const self = f;
          this.pending = {
            type: 'timed', until: m.dur * 0.5, once: true, fn: () => {
              world.spawnProjectile(self, {
                kind: 'wave', x: self.x + self.facing * 60, y: OPF.CONFIG.GROUND_Y - 20,
                vx: self.facing * (m.speed || 520), vy: 0,
                dmg: self.atk * m.mul, r: m.r || 30, life: 2.4, ground: true,
                color: m.color || '#c2a878', ground: true, shake: m.shake, poison: m.poison,
                arcWave: m.arcWave, big: true,
              });
              world.fx.shake(m.shake || 12, 0.3);
              world.audio.sfx('explosion');
            },
          };
          break;
        }
        case 'beam': {
          f.animDur = m.dur;
          f.move = Object.assign(base, { beam: { start: 0.4, end: 0.95, mul: m.mul, tickRate: 0.1, color: m.color, len: m.len || 800, w: m.w || 50 } });
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          world.audio.sfx('laser');
          break;
        }
        case 'summon': {
          f.animDur = m.dur;
          f.move = base;
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          const self = f;
          this.pending = {
            type: 'timed', until: m.dur * 0.5, once: true, fn: () => {
              world.spawnHazard(self, {
                x: self.x + self.facing * 120, y: OPF.CONFIG.GROUND_Y,
                hp: m.hp, life: m.life, color: m.color, vortex: m.vortex,
                pull: m.vortex ? 220 : 0, dmg: self.atk * 0.8, r: 46,
              });
              world.audio.sfx('power');
            },
          };
          break;
        }
        case 'buff': {
          f.animDur = m.dur;
          f.move = base;
          f.moveTime = 0; f.moveHitIdx = 0;
          f.setState('special', m.dur);
          f.addBuff({ id: moveId, time: m.time || 10, defMul: m.defMul, atkMul: m.atkMul, speedMul: m.speedMul, aura: m.aura || m.color, name: m.name });
          if (m.aura || m.atkMul) world.fx.transformBurst(f, m.aura || '#ffd700');
          world.log(f.name + ' — ' + (m.name || moveId) + '!', 'special');
          world.audio.sfx('power');
          break;
        }
      }
    }

    runPending(dt, world, p) {
      const f = this.f;
      const pd = this.pending;
      if (!pd) return;
      pd.t = (pd.t || 0) + dt;

      if (pd.type === 'timed') {
        if (!pd.done && pd.t >= pd.until) { pd.done = true; pd.fn && pd.fn(); }
        if (pd.t > pd.until + 0.05) this.pending = null;
      } else if (pd.type === 'repeating') {
        pd.fired = pd.fired || 0;
        const start = pd.last || 0.2;
        if (pd.t >= start && pd.fired < pd.times && (pd.t - start) >= pd.fired * pd.interval) {
          pd.fired++;
          pd.fn && pd.fn();
        }
        if (pd.t > start + pd.times * pd.interval + 0.1) this.pending = null;
      } else if (pd.type === 'blink') {
        pd.n = pd.n || 0;
        if (pd.t >= pd.until) {
          pd.until += pd.interval;
          pd.n++;
          // blink to just beside the player and strike
          const ppx = p.x - (p.x > f.x ? 1 : -1) * 44;
          world.fx.smokeBurst(f, f.x, f.y - 60);
          f.x = clamp(ppx, world.arenaLeft + 30, world.arenaRight - 30);
          f.facing = p.x > f.x ? 1 : -1;
          world.fx.smokeBurst(f, f.x, f.y - 60);
          world.audio.sfx('dash');
          if (pd.n >= 6) this.pending = null;
        }
      }
    }
  }

  OPF.AIController = AIController;
  OPF.PATTERN_ORDER = PATTERN_ORDER;
})(window);
