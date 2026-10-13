/* =========================================================================
   ONE PIECE FIGHT — battle.js
   The World: wave spawning, hit resolution, projectiles, hazards, camera,
   wave progression and win/lose evaluation.
   ========================================================================= */
(function (global) {
  'use strict';

  const OPF = global.OPF;
  const CFG = OPF.CONFIG;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);

  let idc = 1;

  class World {
    constructor(game, opts) {
      this.game = game;
      this.audio = OPF.Audio;
      this.fx = new OPF.FX();
      this.arcIdx = opts.arcIdx;
      this.level = opts.level;
      this.arc = OPF.ARCS[this.arcIdx];
      this.isBoss = OPF.isBossLevel(this.level);
      this.scaling = OPF.levelScaling(this.arcIdx, this.level);
      this.time = 0;
      this.paused = false;
      this.over = false;
      this.result = null;
      this.autoFace = true;
      this.logs = [];
      this.combo = 0;
      this.comboTimer = 0;
      this.maxCombo = 0;
      this.enemies = [];
      this.projectiles = [];
      this.hazards = [];
      this.waveIndex = 0;
      this.waves = [];
      this.waveDelay = 0;
      this.spawnQueue = [];
      this.camera = { x: 0, y: 0 };
      this.stats = { damageDealt: 0, damageTaken: 0, kills: 0, specialsUsed: 0, time: 0 };
      this.boss = null;
      this.introTimer = 1.4;
      this.hitStopFrames = 0;

      const stageW = this.isBoss ? 1250 : 1500;
      this.stageW = stageW;
      this.arenaLeft = 110;
      this.arenaRight = stageW - 110;
      this.view = game.view;
      this.groundY = CFG.GROUND_Y;

      this.setupPlayer(opts);
      this.setupEnemies();
    }

    /* ------------------------------------------------------ setup ----- */
    setupPlayer(opts) {
      const charId = opts.charId;
      const st = OPF.resolveCharStats(charId, opts.upgrades);
      const C = OPF.CHAR_BY_ID[charId];
      const p = new OPF.Fighter({
        isPlayer: true,
        charId,
        name: C.name,
        x: this.arenaLeft + 180,
        y: CFG.GROUND_Y,
        facing: 1,
        hp: st.hp, maxHp: st.hp,
        mana: st.mana, maxMana: st.mana, manaRegen: st.manaRegen + 3.5,
        atk: st.atk, spd: st.spd, weight: st.weight, size: 1,
        level: st.level,
        sizeScale: 1,
      });
      p.visual = OPF.Art.charVisual(charId);
      p.weapon = p.visual.weapon;
      p.buffs = [];
      // battle consumable effects
      this.usedItems = opts.usedItems || {};
      if (this.usedItems.attack_tonic) p.addBuff({ id: 'tonic', time: 9999, atkMul: 1.25, name: 'Attack Tonic' });
      if (this.usedItems.iron_draught) p.addBuff({ id: 'iron', time: 9999, defMul: 0.8, name: 'Iron Draught' });
      this.hasRevive = !!this.usedItems.revive_scroll;
      this.player = p;
      this.player.world = this;
    }

    setupEnemies() {
      if (this.isBoss) {
        const bossId = this.arc.bosses[this.level];
        this.spawnBoss(bossId);
        return;
      }
      this.waves = OPF.buildWaves(this.arcIdx, this.level);
      this.spawnWave(0);
    }

    spawnBoss(bossId) {
      const B = OPF.BOSSES[bossId];
      const hpMul = 1 + this.arcIdx * 0.07 + (this.level === 30 ? 0.16 : this.level === 20 ? 0.08 : 0);
      const atkMul = 1 + this.arcIdx * 0.10;
      const f = new OPF.Fighter({
        name: B.name,
        bossId, boss: B,
        typeData: B,
        x: this.arenaRight - 190,
        y: CFG.GROUND_Y,
        facing: -1,
        hp: Math.round(B.hp * hpMul), maxHp: Math.round(B.hp * hpMul),
        mana: 100, maxMana: 100, manaRegen: 4,
        atk: B.atk * atkMul,
        spd: B.spd || 1,
        weight: 2.4,
        sizeScale: B.size || 1.2,
        reachBonus: 26,
      });
      f.visual = OPF.Art.bossVisual(bossId);
      f.weapon = f.visual.weapon;
      f.id = idc++;
      f.ai = new OPF.AIController(f, {
        aggression: 0.55 + this.arcIdx * 0.06 + (this.level === 30 ? 0.12 : 0),
        boss: true, bossId,
      });
      f.xpValue = B.xp || 40;
      f.coinValue = B.coins || 100;
      this.boss = f;
      this.enemies.push(f);
      this.audio.setIntensity(3);
      this.shout(B.name.toUpperCase() + '!');
      if (B.intro) this.log(B.intro, 'special');
    }

    spawnWave(i) {
      if (i >= this.waves.length) return;
      const list = this.waves[i];
      const spread = 130;
      list.forEach((typeId, k) => {
        const fromRight = k % 2 === 0;
        const T = OPF.ENEMY_TYPES[typeId];
        const hp = Math.round(T.hp * this.scaling.hp);
        const f = new OPF.Fighter({
          name: T.name,
          typeData: T,
          typeId,
          x: fromRight ? this.arenaRight - 40 - (k * 42) % spread : this.arenaLeft + 40 + (k * 42) % spread,
          y: CFG.GROUND_Y,
          facing: fromRight ? -1 : 1,
          hp, maxHp: hp,
          mana: 100, maxMana: 100, manaRegen: 0,
          atk: T.atk * this.scaling.atk,
          spd: T.spd * this.scaling.speed,
          weight: T.size * 1.2,
          sizeScale: T.size || 1,
          reachBonus: T.weapon === 'sword' || T.weapon === 'spear' ? 18 : 0,
        });
        f.visual = OPF.Art.enemyVisual(typeId);
        f.weapon = f.visual.weapon;
        f.id = idc++;
        f.ai = new OPF.AIController(f, {
          aggression: 0.42 + this.arcIdx * 0.07 + this.level * 0.004,
        });
        f.ai.profile = T.ai;
        f.xpValue = 8 + this.arcIdx * 6;
        f.coinValue = T.coins;
        f.spawnTime = 0;
        this.enemies.push(f);
      });
      this.log('Wave ' + (i + 1) + ' / ' + this.waves.length, 'special');
      this.audio.setIntensity(1 + this.arcIdx * 0.4 + i * 0.3);
    }

    /* ------------------------------------------------------- helpers --- */
    log(msg, type) {
      this.logs.push({ msg, type, life: 4 });
      if (this.logs.length > 30) this.logs.shift();
      if (this.game.onLog) this.game.onLog(msg, type);
    }

    shout(text) {
      if (this.game.onShout) this.game.onShout(text);
    }

    nearestEnemy(from) {
      let best = null, bd = 1e9;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.abs(e.x - from.x);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    onSpecialUsed(f, sp) {
      this.stats.specialsUsed++;
      this.log(f.name + ': ' + sp.name, 'special');
    }

    // visible wind-up so players can react to boss specials
    telegraph(f, kind, move) {
      const color = kind === 'projectile' || kind === 'volley' || kind === 'beam' ? '#ff5252'
        : kind === 'wave' ? '#ff8c00' : '#ff3d3d';
      this.fx.rings.push({ x: f.x, y: f.centerY, r: 90, r2: 26, life: 0.45, max: 0.45, color, w: 5 });
      this.fx.label(f.x, f.y - 150 * f.sizeScale, '!', color, 34);
      if (this.player && !this.player.dead) {
        // subtle flash on the side the attack is coming from
        this.fx.spawn({
          x: f.x + f.facing * 30, y: f.centerY, vx: 0, vy: 0, life: 0.3, max: 0.3,
          size: 24, color, kind: 'glow',
        });
      }
    }

    onBossPhase2(f) {
      this.shout('RAGE!');
      this.fx.transformBurst(f, '#e74c3c');
      this.audio.sfx('roar');
      this.audio.setIntensity(4);
      this.log(f.name + ' grows furious!', 'damage');
    }

    /* ---------------------------------------------------- combat ------- */
    targetsFor(attacker) {
      if (attacker.isPlayer) return this.enemies.filter(e => !e.dead);
      return this.player && !this.player.dead ? [this.player] : [];
    }

    // One place to tune how hard enemies hit the player.
    incomingMul(attacker) {
      if (!attacker || attacker.isPlayer) return 1;
      return attacker.boss ? 0.30 : 0.45;
    }

    overlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    resolveMeleeHit(attacker, box, hit) {
      attacker.hitMemory.clear();
      const targets = this.targetsFor(attacker);
      let connected = false;
      for (const t of targets) {
        const tb = t.bodyBox;
        if (!this.overlap(box, tb)) continue;
        if (hit.pierce !== true && attacker.hitMemory.has(t.id)) continue;
        attacker.hitMemory.add(t.id);
        connected = true;
        this.applyHit(attacker, t, hit, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
      }
      if (!connected && attacker.isPlayer) {
        // whiffed — small feedback
        this.fx.slashArc(box.x + box.w / 2, box.y + box.h / 2, 18, 'rgba(255,255,255,0.25)');
      }
      return connected;
    }

    applyHit(attacker, target, hit, contact) {
      const mul = hit.mul !== undefined ? hit.mul : (hit.dmgMul !== undefined ? hit.dmgMul : 1);
      let dmg = attacker.atk * mul;
      if (attacker.isPlayer) dmg *= attacker.buffAtk;
      else dmg *= (attacker.ai && attacker.ai.phase2 ? 1.08 : 1);
      dmg *= this.incomingMul(attacker);
      const crit = attacker.isPlayer && Math.random() < 0.12;
      if (crit) dmg *= 1.6;

      const dealt = target.takeDamage(dmg, {
        big: !!hit.big || crit,
        freeze: hit.freeze,
        burn: hit.burn,
        poison: hit.poison,
        unblockable: !!hit.pierce,
      });

      if (dealt <= 0) return;
      const cx = contact ? contact.x : (target.x + attacker.x) / 2;
      const cy = contact ? contact.y : target.centerY;

      this.fx.hit(cx, cy, { big: !!hit.big || crit, color: hit.ice ? '#aed6f1' : hit.fire ? '#ff6b00' : hit.color || '#ffd166' });
      if (target.blocking) this.fx.blockHit(cx, cy);
      this.fx.damageNumber(target.x, target.centerY - 26, dealt, attacker.isPlayer ? 'enemy' : 'player', crit);

      if (attacker.isPlayer) {
        this.stats.damageDealt += dealt;
        this.combo++;
        this.comboTimer = 1.8;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        // mana gain from landing hits
        this.player.restoreMana(2.2 + mul * 1.6);
        if (this.player.buffAtk > 1) this.fx.spawn({ x: cx, y: cy, vx: 0, vy: -60, life: 0.4, max: 0.4, size: 8, color: '#ffd700', kind: 'glow' });
      } else {
        this.stats.damageTaken += dealt;
        this.combo = 0;
      }

      // knockback / launch
      const kb = (hit.knock || 0) / Math.max(0.6, target.weight);
      if (kb) target.vx += (target.x >= attacker.x ? 1 : -1) * kb * 3.2;
      if (hit.launch) {
        target.vy = -Math.abs(hit.launch);
        target.onGround = false;
        if (!target.dead) target.setState('hurt', 0.7);
      } else if (!target.dead && dealt > 0) {
        const stunChance = hit.isCombo ? 0.55 : 1;
        if (Math.random() < stunChance && !target.blocking) target.setState('hurt', 0.3);
      }
      if (hit.pull && target.x !== undefined) {
        target.x = clamp(attacker.x + attacker.facing * (hit.pullTo || 60), this.arenaLeft, this.arenaRight);
        target.vx = 0;
      }
      if (hit.shake) this.fx.shake(hit.shake, 0.25);
      this.audio.sfx(target.blocking ? 'block' : 'hit', target.x < this.player.x ? -0.4 : 0.4, !!hit.big);

      if (target.dead) this.onKill(target, attacker);
    }

    areaDamage(attacker, x, y, r, dmg, opts) {
      opts = opts || {};
      const targets = this.targetsFor(attacker);
      for (const t of targets) {
        const d = Math.hypot(t.x - x, t.centerY - y);
        if (d <= r + 30 * t.sizeScale) {
          const dealt = t.takeDamage(dmg * this.incomingMul(attacker), opts);
          if (dealt > 0) {
            this.fx.damageNumber(t.x, t.centerY - 26, dealt, attacker.isPlayer ? 'enemy' : 'player', !!opts.big);
            const kb = (opts.knock || 120) / Math.max(0.6, t.weight);
            t.vx += (t.x >= x ? 1 : -1) * kb * 3;
            if (opts.launch) { t.vy = -Math.abs(opts.launch); t.onGround = false; }
            if (attacker.isPlayer) this.stats.damageDealt += dealt;
            if (t.dead) this.onKill(t, attacker);
          }
        }
      }
      this.fx.rings.push({ x, y, r: 10, r2: r, life: 0.4, max: 0.4, color: opts.ice ? '#aed6f1' : opts.color || '#ffd700', w: 8 });
    }

    beamDamage(f, beam) {
      const x0 = f.x, x1 = f.x + f.facing * beam.len;
      const targets = this.targetsFor(f);
      for (const t of targets) {
        const inX = (t.x >= Math.min(x0, x1)) && (t.x <= Math.max(x0, x1));
        const inY = Math.abs(t.centerY - f.centerY) < beam.w * 1.4 + 40 * t.sizeScale;
        if (inX && inY) {
          const dmg = (f.isPlayer ? f.atk * f.buffAtk : f.atk) * beam.mul * this.incomingMul(f);
          const dealt = t.takeDamage(dmg, { burn: 4 });
          if (dealt > 0) {
            this.fx.damageNumber(t.x, t.centerY - 20, dealt, f.isPlayer ? 'enemy' : 'player', false);
            t.vx += f.facing * 120;
            if (f.isPlayer) this.stats.damageDealt += dealt;
            if (t.dead) this.onKill(t, f);
          }
        }
      }
    }

    onKill(target, attacker) {
      this.stats.kills++;
      this.fx.explode(target.x, target.centerY, 70, '#ffd166');
      this.fx.coinPop(target.x, target.y, Math.min(10, Math.round((target.coinValue || 8) / 4)));
      this.audio.sfx('coin');
      if (attacker && attacker.isPlayer) {
        this.player.restoreMana(8);
        this.log('Defeated ' + target.name + '!', 'coin');
      }
      if (target === this.boss) {
        this.audio.setIntensity(2);
      }
    }

    spawnProjectile(owner, cfg) {
      const p = Object.assign({
        owner, x: 0, y: 0, vx: 0, vy: 0, r: 12, life: 2, dmg: 10, grav: 0,
        color: '#ffd166', trailCol: null, pierce: false, hitSet: new Set(), t: 0,
        knock: 100, homing: false, pull: false, crescent: false, big: false,
        burn: 0, poison: 0, freeze: 0, ground: false, shake: 0, onLand: null,
      }, cfg);
      p.id = idc++;
      this.projectiles.push(p);
      return p;
    }

    spawnHazard(owner, cfg) {
      const h = Object.assign({
        owner, x: 0, y: CFG.GROUND_Y, w: 60, h: 120, hp: 100, life: 6, color: '#f1c40f',
        pull: 0, vortex: false, dmg: 8, t: 0, dead: false,
      }, cfg);
      h.id = idc++;
      this.hazards.push(h);
      if (h.hp < 900) {
        // candle/clone walls are destructible: they appear as enemy targets for the player
        this.enemies.push(this.makeHazardFighter(h));
      }
      return h;
    }

    makeHazardFighter(h) {
      const f = new OPF.Fighter({
        name: 'Barrier', x: h.x, y: CFG.GROUND_Y, facing: -1,
        hp: h.hp, maxHp: h.hp, atk: 0, spd: 0, weight: 4, sizeScale: 1.1, mana: 0, maxMana: 0,
      });
      f.visual = { bodyType: 'human', colors: { skin: h.color, shirt: h.color, pants: h.color, sash: '#000', hair: h.color, hat: 'none' }, faceOpts: {}, weapon: null, extras: null, bulk: 0, headScale: 1, sizeScale: 1.1 };
      f.hazard = h;
      f.static = true;
      f.id = idc++;
      f.coinValue = 0;
      f.ai = null;
      return f;
    }

    /* ------------------------------------------------ player actions --- */
    useItem(itemId) {
      const inv = this.game.save.bag;
      if (!inv[itemId] || inv[itemId] <= 0) { this.log('None left!', 'damage'); return false; }
      const IT = OPF.CONSUMABLES.find(c => c.id === itemId);
      if (!IT || IT.battle) return false;
      const p = this.player;
      if (itemId === 'health_potion') {
        const before = p.hp;
        p.heal(p.maxHp * 0.4);
        this.fx.damageNumber(p.x, p.centerY - 30, Math.round(p.hp - before), 'heal');
        this.fx.spawn({ x: p.x, y: p.centerY, vx: 0, vy: -80, life: 0.6, max: 0.6, size: 26, color: 'rgba(80,220,120,0.35)', kind: 'glow' });
      } else if (itemId === 'mana_potion') {
        p.restoreMana(p.maxMana * 0.5);
        this.fx.spawn({ x: p.x, y: p.centerY, vx: 0, vy: -80, life: 0.6, max: 0.6, size: 26, color: 'rgba(80,160,255,0.35)', kind: 'glow' });
      }
      inv[itemId]--;
      this.audio.sfx('potion');
      this.game.persist();
      return true;
    }

    playerAttack() {
      const p = this.player;
      if (p.dead || p.locked) {
        if (p.state === 'attack' && p.comboIndex < 2) p.comboQueued = true;
        return;
      }
      p.comboIndex = p.comboIndex || 0;
      p.beginAttack();
    }

    playerSpecial(idx) {
      const p = this.player;
      if (p.dead) return;
      p.useSpecial(idx);
    }

    /* ------------------------------------------------------ update ----- */
    update(dt) {
      if (this.paused || this.over) {
        this.fx.update(dt * 0.25);
        return;
      }
      this.time += dt;
      this.stats.time += dt;
      if (this.introTimer > 0) this.introTimer -= dt;
      if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }

      const p = this.player;
      // ---- entities ----
      if (!p.dead) p.update(dt, this);
      else p.update(dt, this);

      for (const e of this.enemies) {
        if (e.static) { e.animTime += dt; continue; }
        if (e.dead) {
          e.update(dt, this);
          continue;
        }
        e.update(dt, this);
        if (e.ai) e.ai.update(dt, this);
      }

      // ---- projectiles ----
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        pr.t += dt;
        pr.life -= dt;
        if (pr.homing) {
          const tgt = pr.owner.isPlayer ? this.nearestEnemy(pr.owner) : this.player;
          if (tgt) {
            const ang = Math.atan2((tgt.centerY - pr.y), (tgt.x - pr.x));
            const sp = Math.hypot(pr.vx, pr.vy);
            pr.vx += (Math.cos(ang) * sp - pr.vx) * 3.2 * dt;
            pr.vy += (Math.sin(ang) * sp - pr.vy) * 3.2 * dt;
          }
        }
        if (pr.pull && !pr.owner.isPlayer) {
          // kurozu style pull
          const tgt = this.player;
          if (tgt && !tgt.dead && Math.abs(tgt.x - pr.x) < 240) {
            tgt.x += Math.sign(pr.x - tgt.x) * 120 * dt;
          }
        }
        pr.vy += (pr.grav || 0) * dt;
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;

        if (pr.ground && pr.y > this.groundY - 14) { pr.y = this.groundY - 14; pr.vy = 0; }

        // trail
        if (Math.random() < 0.7) {
          this.fx.spawn({
            x: pr.x + rnd(-4, 4), y: pr.y + rnd(-4, 4), vx: -pr.vx * 0.06, vy: -pr.vy * 0.06,
            life: 0.24, max: 0.24, size: Math.max(3, pr.r * 0.6),
            color: pr.trailCol || pr.color, kind: 'glow',
          });
        }

        // collisions
        const targets = pr.owner.isPlayer ? this.enemies.filter(e => !e.dead) : [this.player].filter(x => x && !x.dead);
        let hitSomething = false;
        for (const t of targets) {
          if (pr.hitSet.has(t.id)) continue;
          const tb = t.bodyBox;
          const cx = clamp(pr.x, tb.x, tb.x + tb.w), cy = clamp(pr.y, tb.y, tb.y + tb.h);
          if (Math.hypot(cx - pr.x, cy - pr.y) > pr.r + 6) continue;
          pr.hitSet.add(t.id);
          hitSomething = true;
          let pdmg = pr.dmg * this.incomingMul(pr.owner);
          if (pr.owner.isPlayer) pdmg *= pr.owner.buffAtk;
          const dealt = t.takeDamage(pdmg, {
            burn: pr.burn, poison: pr.poison, freeze: pr.freeze, big: pr.big,
          });
          if (dealt > 0) {
            this.fx.hit(pr.x, pr.y, { big: pr.big, color: pr.color });
            this.fx.damageNumber(t.x, t.centerY - 22, dealt, pr.owner.isPlayer ? 'enemy' : 'player', !!pr.big);
            t.vx += Math.sign(pr.vx || 1) * (pr.knock || 100) * 2.4 / Math.max(0.6, t.weight);
            if (pr.burn) t.addDot({ id: 'burn', time: pr.burn, dps: 4, color: '#ff6b00' });
            if (pr.poison) t.addDot({ id: 'poison', time: pr.poison, dps: 3, color: '#8e44ad' });
            if (pr.freeze) t.addDot({ id: 'freeze', time: pr.freeze, freeze: pr.freeze, dps: 0, color: '#aed6f1' });
            if (pr.owner.isPlayer) { this.stats.damageDealt += dealt; this.combo++; this.comboTimer = 1.8; }
            if (t.dead) this.onKill(t, pr.owner);
          }
          if (!pr.pierce) break;
        }
        if (hitSomething && pr.shake) this.fx.shake(pr.shake, 0.25);

        // hazards hit by projectiles
        if (pr.owner.isPlayer) {
          for (const hz of this.hazards) {
            if (hz.dead) continue;
            if (Math.abs(pr.x - hz.x) < hz.w / 2 + pr.r && pr.y > hz.y - hz.h && pr.y < hz.y + 10) {
              hz.hp -= pr.dmg || 10;
              hitSomething = true;
              if (hz.hp <= 0) this.destroyHazard(hz);
            }
          }
        }

        const outOfBounds = pr.x < this.arenaLeft - 220 || pr.x > this.arenaRight + 220;
        if (pr.life <= 0 || outOfBounds || (hitSomething && !pr.pierce)) {
          if (pr.onLand === 'fire_field' || (pr.kind === 'bomb' && (pr.life <= 0 || pr.y >= this.groundY - 16))) {
            this.fx.explode(pr.x, pr.y, 120, '#ff3d00');
            this.areaDamage(pr.owner, pr.x, pr.y, 130, pr.owner.atk * 1.4, { burn: 8, knock: 180, big: true });
          } else if (pr.big) {
            this.fx.explode(pr.x, pr.y, 90, pr.color);
          }
          this.projectiles.splice(i, 1);
        }
      }

      // ---- hazards ----
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const h = this.hazards[i];
        h.t += dt; h.life -= dt;
        if (h.vortex) {
          const p2 = this.player;
          if (!p2.dead) {
            const d = p2.x - h.x;
            if (Math.abs(d) < 320) {
              p2.x += Math.sign(-d) * 60 * dt * (1 - Math.abs(d) / 320);
              if (Math.abs(d) < 60 && Math.abs(p2.y - h.y) < 120) {
                p2.hp -= h.dmg * dt * 1.15;
                if (p2.hp <= 0) { p2.hp = 0; p2.die(); }
              }
            }
          }
          // pull particles in
          if (Math.random() < 0.8) {
            const a = rnd(0, Math.PI * 2);
            this.fx.spawn({
              x: h.x + Math.cos(a) * 140, y: h.y - 90 + Math.sin(a) * 140,
              vx: -Math.cos(a) * 260, vy: -Math.sin(a) * 260, life: 0.5, max: 0.5,
              size: rnd(2, 6), color: h.color, kind: 'glow',
            });
          }
        }
        if (h.life <= 0 || h.dead) {
          const fi = this.enemies.findIndex(e => e.hazard === h);
          if (fi >= 0) { this.enemies.splice(fi, 1); }
          this.hazards.splice(i, 1);
        }
      }

      // hazard fighters mirror their hazard position and die when shield breaks
      for (const e of this.enemies) {
        if (e.hazard) {
          if (e.dead || e.hazard.hp <= 0) this.destroyHazard(e.hazard);
          else e.x = e.hazard.x;
        }
      }

      // ---- separation (avoid stacking) ----
      const all = [this.player].concat(this.enemies.filter(e => !e.dead && !e.static));
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i], b = all[j];
          if (a.dead || b.dead) continue;
          const minD = 34 * (a.sizeScale + b.sizeScale) / 2;
          const d = b.x - a.x;
          if (Math.abs(d) < minD) {
            const push = (minD - Math.abs(d)) / 2 * Math.sign(d || 1);
            const wa = b.weight / (a.weight + b.weight);
            a.x -= push * (1 - wa) * 1.2;
            b.x += push * wa * 1.2;
          }
        }
      }

      // ---- wave progression ----
      const aliveEnemies = this.enemies.filter(e => !e.dead && !e.static && !e.hazard);
      if (!this.isBoss && aliveEnemies.length === 0 && !this.over) {
        this.clearTimer = (this.clearTimer === undefined ? 0.9 : this.clearTimer) - dt;
        if (this.clearTimer <= 0) {
          if (this.waveIndex + 1 < this.waves.length) {
            this.waveIndex++;
            this.spawnWave(this.waveIndex);
            this.player.restoreMana(20);
            this.log('Wave cleared! Mana restored.', 'mana');
            this.clearTimer = 1.1;
          } else {
            this.finish(true);
          }
        }
      } else if (!this.isBoss && aliveEnemies.length > 0) {
        this.clearTimer = 0.9;
      }

      // ---- boss fight resolution ----
      if (this.isBoss && this.boss && this.boss.dead && !this.over) {
        this.bossTimer = (this.bossTimer === undefined ? 1.5 : this.bossTimer) - dt;
        if (this.bossTimer <= 0) this.finish(true);
      }

      // ---- remove long-dead enemies ----
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.dead && e.stateTime > 1.6) this.enemies.splice(i, 1);
      }

      // ---- win / lose ----
      if (p.dead && !this.over) {
        if (this.hasRevive) {
          this.hasRevive = false;
          p.dead = false;
          p.hp = Math.round(p.maxHp * 0.5);
          p.setState('idle');
          p.invuln = 2;
          this.fx.transformBurst(p, '#f1c40f');
          this.shout('REVIVED!');
          this.log('Revive Scroll consumed!', 'heal');
          this.audio.sfx('levelup');
        } else {
          this.finish(false);
        }
      }

      // ---- camera ----
      const targetX = clamp(p.x - this.view.w * 0.42, 0, Math.max(0, this.stageW - this.view.w));
      this.camera.x += (targetX - this.camera.x) * Math.min(1, dt * 8);

      this.fx.update(dt);
      // audio intensity while fighting
      if (Math.floor(this.time * 2) % 2 === 0) {
        this.audio.setIntensity(this.boss ? 4 : 1 + this.arcIdx * 0.4);
      }
    }

    destroyHazard(h) {
      h.dead = true;
      this.fx.explode(h.x, h.y - h.h / 2, 80, h.color);
      const fi = this.enemies.findIndex(e => e.hazard === h);
      if (fi >= 0) this.enemies.splice(fi, 1);
      const hi = this.hazards.indexOf(h);
      if (hi >= 0) this.hazards.splice(hi, 1);
    }

    finish(victory) {
      if (this.over) return;
      this.over = true;
      this.result = victory ? 'victory' : 'defeat';
      const perf = this.maxCombo / 20 + (1 - this.stats.damageTaken / Math.max(1, this.player.maxHp * 3)) * 0.2;
      const base = OPF.levelReward(this.arcIdx, this.level, true, clamp(perf, 0, 1.4));
      if (!victory) { base.coins = Math.round(base.coins * 0.25); base.xp = Math.round(base.xp * 0.3); }
      this.rewards = base;
      this.audio.sfx(victory ? 'victory' : 'defeat');
      if (victory && this.boss) this.fx.coinPop(this.boss.x, this.boss.y, 18);
      if (this.game.onBattleEnd) this.game.onBattleEnd(this, victory, base);
    }

    /* -------------------------------------------------------- draw ----- */
    drawEntities(ctx) {
      const v = this.view;
      const sh = this.fx.shakeOffset;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      // hazards behind fighters
      for (const h of this.hazards) {
        ctx.save();
        if (h.vortex) {
          const g = ctx.createRadialGradient(h.x, h.y - 90, 6, h.x, h.y - 90, 110);
          g.addColorStop(0, '#000');
          g.addColorStop(0.6, h.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(h.x, h.y - 90, 90, 120, 0, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = h.color;
          ctx.globalAlpha = 0.92;
          const wob = Math.sin(h.t * 2) * 4;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(h.x - h.w / 2, h.y - h.h, h.w, h.h + wob, 8) : ctx.rect(h.x - h.w / 2, h.y - h.h, h.w, h.h);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.restore();
      }

      // fighters (draw dead first, then lower HP first for depth)
      const list = this.enemies.filter(e => e).concat([this.player]);
      list.sort((a, b) => (a.y - b.y) || (a.dead ? -1 : 1));
      for (const e of list) {
        if (e.static) continue;
        e.draw(ctx, this.time);
      }

      this.fx.drawWorld(ctx);
      this.fx.drawNumbers(ctx);
      ctx.restore();
    }

    drawOverlays(ctx) {
      const v = this.view;
      // combo counter
      if (this.combo > 1) {
        const t = this.comboTimer / 1.8;
        ctx.save();
        ctx.globalAlpha = clamp(t * 1.6, 0, 1);
        ctx.font = '900 40px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 6;
        const cx = v.w * 0.5, cy = 150 - (1 - t) * 20;
        ctx.strokeText(this.combo + ' HIT COMBO', cx, cy);
        ctx.fillText(this.combo + ' HIT COMBO', cx, cy);
        ctx.restore();
      }

      // screen flash
      if (this.fx.flash > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(this.fx.flash, 0, 0.5);
        ctx.fillStyle = this.fx.flashColor;
        ctx.fillRect(0, 0, v.w, v.h);
        ctx.restore();
      }
    }
  }

  OPF.World = World;
})(window);
