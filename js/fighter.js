/* =========================================================================
   ONE PIECE FIGHT — fighter.js
   Fighter state machine, hitboxes, combos, special powers, projectiles.
   ========================================================================= */
(function (global) {
  'use strict';

  const OPF = global.OPF;
  const CFG = OPF.CONFIG;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* -------- combo definitions per character ---------------------------- */
  const COMBO_ANIM = {
    luffy: ['stretch_punch', 'cross', 'heavy'],
    zoro: ['slash', 'slash', 'big_slash'],
    sanji: ['kick', 'kick', 'spin'],
    usopp: ['jab', 'jab', 'thrust'],
    franky: ['jab', 'cross', 'heavy'],
    brook: ['thrust', 'thrust', 'slash'],
  };

  /* -------- special power implementations ------------------------------ */
  // Each move: { dur, anim, sfx, onStart(world,self), tick(world,self,dt,t), multi }
  const SPECIALS = {
    /* ---- Luffy ---- */
    gum_pistol: {
      dur: 0.62, anim: 'stretch_punch', sfx: 'whiff', manaGain: 4,
      hit: { at: 0.24, mul: 1.5, reach: 250, w: 84, h: 54, oy: -84, launch: 90 },
      draw(world, self, t) { world.fx.stretchTrail(self, t); },
    },
    gum_gatling: {
      dur: 1.15, anim: 'flurry', sfx: 'power', manaGain: 2,
      hits: [0.22, 0.31, 0.4, 0.49, 0.58, 0.67, 0.76, 0.85, 0.95].map(t => ({ at: t, mul: 0.5, reach: 130, w: 70, h: 60, oy: -84, knock: 20 })),
    },
    gear_second: {
      dur: 0.9, anim: 'cast_both', sfx: 'transform', manaGain: 0,
      onStart(world, self) {
        self.addBuff({ id: 'gear2', time: 14, speedMul: 1.45, atkMul: 1.3, aura: '#ff9a3c', name: 'GEAR SECOND' });
        world.fx.transformBurst(self, '#ff8c00');
        world.shout('GEAR SECOND!');
      },
    },
    gear_third: {
      dur: 1.3, anim: 'slam', sfx: 'power', manaGain: 0,
      hit: { at: 0.62, mul: 3.0, reach: 150, w: 150, h: 150, oy: -110, shake: 22, launch: 240, big: true },
      onStart(world, self) {
        self.addBuff({ id: 'gear3', time: 10, atkMul: 1.15, sizeMul: 1.25, aura: '#e74c3c', name: 'GEAR THIRD' });
        world.fx.transformBurst(self, '#e74c3c');
        world.shout('GEAR THIRD!');
      },
    },

    /* ---- Zoro ---- */
    oni_giri: {
      dur: 0.7, anim: 'big_slash', sfx: 'slash', manaGain: 2,
      hits: [
        { at: 0.26, mul: 1.5, reach: 120, w: 76, h: 96, oy: -86 },
        { at: 0.33, mul: 1.5, reach: 130, w: 76, h: 96, oy: -86 },
        { at: 0.42, mul: 2.0, reach: 140, w: 88, h: 110, oy: -86, shake: 10 },
      ],
    },
    tatsumaki: {
      dur: 1.2, anim: 'spin', sfx: 'whiff', manaGain: 2,
      onStart(world, self) { self.advance = 150; },
      hits: [0.28, 0.4, 0.52, 0.64, 0.76, 0.9].map(t => ({ at: t, mul: 0.75, reach: 120, w: 90, h: 130, oy: -80, launch: 120, knock: 90 })),
    },
    ashura: {
      dur: 1.0, anim: 'cast_both', sfx: 'transform',
      onStart(world, self) {
        self.addBuff({ id: 'ashura', time: 14, atkMul: 1.55, aura: '#9b59b6', name: 'ASHURA' });
        world.fx.transformBurst(self, '#9b59b6');
        world.shout('ASHURA!');
      },
    },
    sanzen_sekai: {
      dur: 1.5, anim: 'big_slash', sfx: 'slash', manaGain: 0,
      hits: [
        { at: 0.5, mul: 2.4, reach: 170, w: 150, h: 170, oy: -90, shake: 16 },
        { at: 0.66, mul: 3.4, reach: 200, w: 200, h: 180, oy: -90, shake: 26, launch: 200, big: true },
      ],
      draw(world, self, t) { if (t > 0.35 && t < 0.8) world.fx.crossSlash(self); },
    },

    /* ---- Sanji ---- */
    party_table: {
      dur: 0.95, anim: 'spin_kick', sfx: 'whiff', manaGain: 3,
      hits: [0.24, 0.36, 0.5, 0.64, 0.78].map(t => ({ at: t, mul: 0.9, reach: 105, w: 96, h: 110, oy: -80, knock: 60, launch: 40 })),
    },
    diable_jambe: {
      dur: 1.1, anim: 'kick', sfx: 'fire', manaGain: 2,
      onStart(world, self) { self.addBuff({ id: 'diable', time: 13, atkMul: 1.25, aura: '#ff6b00', burn: true, name: 'DIABLE JAMBE' }); world.fx.transformBurst(self, '#ff6b00'); },
      hits: [0.3, 0.45, 0.6, 0.78].map(t => ({ at: t, mul: 1.0, reach: 115, w: 90, h: 110, oy: -80, burn: 14, fire: true })),
    },
    hell_memories: {
      dur: 1.4, anim: 'spin_kick', sfx: 'fire', manaGain: 0,
      onStart(world, self) {
        self.addBuff({ id: 'hell', time: 15, atkMul: 1.5, speedMul: 1.15, aura: '#ff3d00', burn: true, name: 'HELL MEMORIES' });
        world.fx.transformBurst(self, '#ff3d00');
        world.shout('HELL MEMORIES!');
      },
      hits: [0.3, 0.45, 0.6, 0.75, 0.9, 1.05].map(t => ({ at: t, mul: 1.0, reach: 130, w: 110, h: 130, oy: -80, burn: 18, fire: true, launch: 60 })),
    },
    anti_manner: {
      dur: 1.0, anim: 'upper', sfx: 'hit', manaGain: 0,
      hit: { at: 0.3, mul: 2.6, reach: 110, w: 110, h: 150, oy: -110, launch: -420, shake: 14, big: true },
    },

    /* ---- Usopp ---- */
    firebird_star: {
      dur: 0.55, anim: 'cast', sfx: 'fire', manaGain: 3,
      onStart(world, self) {
        world.spawnProjectile(self, {
          kind: 'firebird', x: self.x + self.facing * 40, y: self.y - 92, vx: self.facing * 520, vy: 0,
          dmg: self.atk * 1.4, r: 16, life: 1.6, burn: 10, color: '#ff6b00', trail: '#ffd166',
        });
      },
    },
    smoke_star: {
      dur: 0.45, anim: 'cast', sfx: 'whiff', manaGain: 0,
      onStart(world, self) {
        world.fx.smokeBurst(self, self.x, self.y - 60);
        const foe = world.nearestEnemy(self);
        const tx = foe ? foe.x - foe.facing * 60 : self.x + self.facing * 120;
        self.x = clamp(tx, world.arenaLeft + 40, world.arenaRight - 40);
        self.facing = foe ? (foe.x > self.x ? 1 : -1) : self.facing;
        self.invuln = Math.max(self.invuln, 0.5);
        world.fx.smokeBurst(self, self.x, self.y - 60);
      },
    },
    kaen_boshi: {
      dur: 0.8, anim: 'cast_both', sfx: 'fire', manaGain: 0,
      onStart(world, self) {
        world.spawnProjectile(self, {
          kind: 'bomb', x: self.x + self.facing * 40, y: self.y - 110, vx: self.facing * 420, vy: -180,
          dmg: self.atk * 2.0, r: 18, life: 2.2, gravity: 900, onLand: 'fire_field', color: '#ff3d00',
        });
      },
    },
    impact_dial: {
      dur: 1.1, anim: 'cast_both', sfx: 'explosion', manaGain: 0,
      onStart(world, self) {
        world.spawnProjectile(self, {
          kind: 'impact', x: self.x + self.facing * 46, y: self.y - 92, vx: self.facing * 780, vy: 0,
          dmg: self.atk * 2.8, r: 40, life: 1.2, pierce: true, knock: 320, color: '#f1c40f', shake: 12,
        });
      },
    },

    /* ---- Franky ---- */
    strong_right: {
      dur: 0.75, anim: 'stretch_punch', sfx: 'whiff', manaGain: 3,
      hit: { at: 0.24, mul: 1.3, reach: 230, w: 90, h: 56, oy: -84, pull: true, pullTo: 60 },
    },
    fresh_fire: {
      dur: 1.0, anim: 'cast', sfx: 'fire', manaGain: 2,
      onStart(world, self) { world.fx.flameCone(self, self.facing, 240); world.audio.sfx('fire'); },
      hits: [0.2, 0.32, 0.44, 0.56, 0.68, 0.8].map(t => ({ at: t, mul: 0.55, reach: 230, w: 150, h: 90, oy: -92, burn: 8, fire: true })),
    },
    coup_de_vent: {
      dur: 0.9, anim: 'cast_both', sfx: 'explosion', manaGain: 0,
      onStart(world, self) { world.fx.windBlast(self, self.facing); world.audio.sfx('explosion'); },
      hit: { at: 0.34, mul: 2.2, reach: 260, w: 170, h: 130, oy: -90, knock: 420, launch: 80, shake: 18, big: true },
    },
    radical_beam: {
      dur: 1.5, anim: 'cast_both', sfx: 'laser', manaGain: 0,
      onStart(world, self) {
        world.fx.beamCharge(self);
        world.audio.sfx('laser');
        self.beam = { t: 0 };
      },
      beam: { start: 0.45, end: 1.0, mul: 0.9, tickRate: 0.09, color: '#00e5ff', len: 900, w: 60 },
      draw(world, self, t) {
        if (t > 0.45 && t < 1.0) world.fx.chestBeam(self, (t - 0.45) / 0.55);
      },
    },

    /* ---- Brook ---- */
    yahazu_giri: {
      dur: 0.5, anim: 'thrust', sfx: 'whiff', manaGain: 3,
      onStart(world, self) { self.dashVel = 620; self.dashFacing = self.facing; self.invuln = Math.max(self.invuln, 0.22); },
      hits: [0.12, 0.2, 0.28].map(t => ({ at: t, mul: 1.0, reach: 130, w: 120, h: 50, oy: -86, pierce: true })),
    },
    gaikotsu_giri: {
      dur: 0.8, anim: 'big_slash', sfx: 'ice', manaGain: 2,
      hits: [
        { at: 0.26, mul: 1.4, reach: 140, w: 110, h: 120, oy: -86, freeze: 1.6, ice: true },
        { at: 0.42, mul: 1.6, reach: 150, w: 120, h: 130, oy: -86, freeze: 2.2, ice: true, shake: 8 },
      ],
    },
    soul_solid: {
      dur: 1.0, anim: 'cast', sfx: 'ice', manaGain: 0,
      onStart(world, self) {
        self.addBuff({ id: 'soulsolid', time: 15, atkMul: 1.35, freeze: true, aura: '#aed6f1', name: 'SOUL SOLID' });
        world.fx.transformBurst(self, '#aed6f1');
        world.shout('SOUL SOLID!');
      },
    },
    hueco_mundo: {
      dur: 1.6, anim: 'cast_both', sfx: 'ice', manaGain: 0,
      onStart(world, self) {
        world.fx.iceNova(self);
        world.audio.sfx('ice');
        world.areaDamage(self, self.x, self.y - 80, 340, self.atk * 2.4, { freeze: 2.5, ice: true, shake: 20, knock: 160 });
      },
    },
  };

  /* -------- boss move archetypes --------------------------------------- */
  // kind: melee | dash | projectile | volley | wave | slam | spin | beam | summon | buff
  const BOSS_MOVES = {
    chop_chop_cannon: { kind: 'melee', mul: 1.5, reach: 120, w: 90, h: 90, oy: -90, dur: 0.85, anim: 'heavy', knock: 220, launch: 60, proj: 'hand' },
    blade_tornado: { kind: 'spin', mul: 1.1, hits: 6, dur: 1.5, anim: 'spin', reach: 130, w: 120, h: 130, oy: -84, knock: 120 },
    muggy_ball: { kind: 'projectile', mul: 1.4, dur: 0.9, anim: 'cast', speed: 460, r: 18, color: '#e74c3c', kind3d: 'ball' },

    mh5_flamethrower: { kind: 'cone', mul: 0.8, hits: 6, dur: 1.4, anim: 'cast', reach: 260, w: 160, h: 110, oy: -90, burn: 10, color: '#ff6b00' },
    spear_gun: { kind: 'dash', mul: 1.6, dur: 1.0, anim: 'thrust', reach: 130, w: 90, h: 80, oy: -86, speed: 620, knock: 260 },
    poison_gas: { kind: 'volley', mul: 0.7, dur: 1.4, anim: 'cast_both', count: 5, speed: 330, r: 20, color: '#8e44ad', arc: true, poison: 12 },

    shark_on_darts: { kind: 'dash', mul: 1.9, dur: 1.0, anim: 'thrust', reach: 150, w: 110, h: 90, oy: -90, speed: 760, knock: 300 },
    tooth_gum: { kind: 'melee', mul: 1.7, reach: 130, w: 100, h: 100, oy: -92, dur: 0.8, anim: 'heavy', knock: 260 },
    shark_saw: { kind: 'wave', mul: 1.8, dur: 1.2, anim: 'slam', speed: 520, color: '#1abc9c', r: 30, ground: true },

    wax_sword: { kind: 'melee', mul: 1.5, reach: 140, w: 100, h: 100, oy: -86, dur: 0.8, anim: 'big_slash', knock: 220 },
    candle_wall: { kind: 'summon', dur: 1.0, anim: 'cast_both', color: '#f1c40f', hp: 200, life: 8 },
    wax_figure: { kind: 'projectile', mul: 1.6, dur: 1.0, anim: 'cast', speed: 400, r: 24, color: '#f1c40f', homing: true },

    spiral_hollow: { kind: 'dash', mul: 2.0, dur: 0.9, anim: 'thrust', reach: 150, w: 110, h: 90, oy: -88, speed: 820, knock: 320, pierce: true },
    dice_blade: { kind: 'melee', mul: 1.8, reach: 150, w: 120, h: 110, oy: -88, dur: 0.9, anim: 'big_slash', knock: 240 },
    atomic_spine: { kind: 'volley', mul: 1.2, dur: 1.2, anim: 'cast_both', count: 4, speed: 620, r: 14, color: '#bdc3c7', spread: 0.1 },

    ground_death: { kind: 'wave', mul: 1.9, dur: 1.3, anim: 'slam', speed: 560, color: '#c2a878', r: 34, ground: true, shake: 20 },
    desert_spada: { kind: 'dash', mul: 2.0, dur: 1.0, anim: 'slash', reach: 160, w: 130, h: 100, oy: -88, speed: 800, knock: 300 },
    sables: { kind: 'volley', mul: 1.0, dur: 1.6, anim: 'cast_both', count: 7, speed: 400, r: 26, color: '#d2b48c', arc: true, knock: 160 },

    air_door: { kind: 'summon', dur: 0.9, anim: 'cast', color: '#2c3e50', hp: 160, life: 7, teleport: true },
    rankyaku: { kind: 'projectile', mul: 1.7, dur: 0.85, anim: 'spin_kick', speed: 620, r: 22, color: '#eaf2f8', crescent: true },
    tekkai_counter: { kind: 'buff', dur: 1.0, anim: 'block', defMul: 0.35, time: 3.2, name: 'TEKKAI' },

    wolf_lunge: { kind: 'dash', mul: 2.1, dur: 0.95, anim: 'thrust', reach: 150, w: 110, h: 96, oy: -88, speed: 900, knock: 300 },
    rankyaku_roseo: { kind: 'volley', mul: 1.1, dur: 1.3, anim: 'spin_kick', count: 4, speed: 520, r: 26, color: '#e8a0a0', crescent: true, spread: 0.16 },
    tekko_gan: { kind: 'melee', mul: 2.0, reach: 130, w: 110, h: 110, oy: -90, dur: 0.95, anim: 'heavy', knock: 340, launch: 120 },

    soru_rush: { kind: 'multi_dash', mul: 1.1, dur: 1.6, anim: 'thrust', hits: 4, reach: 120, w: 90, h: 90, oy: -88, color: '#1c1c28', shake: 10 },
    rokougan: { kind: 'melee', mul: 2.4, reach: 140, w: 120, h: 120, oy: -92, dur: 1.05, anim: 'heavy', knock: 400, launch: 80, shock: true },
    shigan_oo: { kind: 'dash', mul: 2.2, dur: 0.85, anim: 'thrust', reach: 170, w: 90, h: 80, oy: -88, speed: 940, pierce: true, knock: 260 },
    leopard_form: { kind: 'buff', dur: 1.2, anim: 'cast_both', atkMul: 1.35, speedMul: 1.25, time: 16, name: 'LEOPARD FORM' },

    invisible_rush: { kind: 'multi_dash', mul: 1.2, dur: 1.5, anim: 'thrust', hits: 4, reach: 120, w: 90, h: 90, oy: -88, transparent: true },
    gastro_phony: { kind: 'volley', mul: 1.0, dur: 1.2, anim: 'cast_both', count: 5, speed: 480, r: 20, color: '#8e44ad', spread: 0.2, poison: 10 },
    elephant_gun: { kind: 'melee', mul: 2.3, reach: 130, w: 110, h: 110, oy: -92, dur: 1.0, anim: 'heavy', knock: 380, launch: 100 },

    shusui_draw: { kind: 'dash', mul: 2.2, dur: 0.85, anim: 'big_slash', reach: 170, w: 130, h: 100, oy: -88, speed: 880, knock: 300 },
    dragon_slash: { kind: 'projectile', mul: 2.4, dur: 1.2, anim: 'big_slash', speed: 700, r: 34, color: '#e74c3c', crescent: true, big: true, shake: 16 },
    gavotte_bond_avant: { kind: 'spin', mul: 1.3, hits: 5, dur: 1.4, anim: 'spin', reach: 140, w: 130, h: 140, oy: -84, knock: 140, freeze: 1.2, color: '#aed6f1' },

    brick_bat: { kind: 'melee', mul: 2.0, reach: 160, w: 130, h: 130, oy: -94, dur: 0.9, anim: 'heavy', knock: 340, launch: 90 },
    doppelman: { kind: 'multi_dash', mul: 1.3, dur: 1.6, anim: 'thrust', hits: 5, reach: 120, w: 90, h: 90, oy: -88, transparent: true, color: '#5b2c6f' },
    shadow_asgard: { kind: 'buff', dur: 1.3, anim: 'cast_both', atkMul: 1.4, defMul: 0.85, time: 18, name: 'SHADOW ASGARD', aura: '#5b2c6f' },
    shadow_revolution: { kind: 'wave', mul: 2.2, dur: 1.4, anim: 'slam', speed: 480, color: '#5b2c6f', r: 40, ground: true, shake: 22, arcWave: true },

    iron_whip: { kind: 'melee', mul: 1.7, reach: 150, w: 110, h: 110, oy: -90, dur: 0.85, anim: 'slash', knock: 280 },
    burning_fist: { kind: 'dash', mul: 2.0, dur: 1.0, anim: 'thrust', reach: 140, w: 100, h: 90, oy: -90, speed: 760, knock: 300, burn: 12, color: '#ff6b00' },
    warden_charge: { kind: 'dash', mul: 1.9, dur: 1.1, anim: 'heavy', reach: 150, w: 120, h: 110, oy: -90, speed: 700, knock: 360, launch: 100 },

    venom_road: { kind: 'wave', mul: 2.0, dur: 1.4, anim: 'slam', speed: 520, color: '#8e44ad', r: 34, ground: true, poison: 16, shake: 18 },
    chloro_ball: { kind: 'projectile', mul: 1.8, dur: 1.0, anim: 'cast', speed: 520, r: 26, color: '#7b241c', poison: 18 },
    hells_judgment: { kind: 'volley', mul: 1.3, dur: 1.5, anim: 'cast_both', count: 6, speed: 460, r: 30, color: '#8e44ad', poison: 14, spread: 0.25 },
    hydra: { kind: 'multi_dash', mul: 1.4, dur: 1.8, anim: 'thrust', hits: 6, reach: 150, w: 110, h: 100, oy: -88, poison: 14, color: '#8e44ad' },

    black_hole: { kind: 'summon', dur: 1.4, anim: 'cast_both', color: '#2c003e', hp: 1, life: 3.2, vortex: true },
    liberation: { kind: 'wave', mul: 2.4, dur: 1.4, anim: 'slam', speed: 540, color: '#8e44ad', r: 40, ground: true, shake: 24 },
    kurozu: { kind: 'projectile', mul: 2.0, dur: 1.2, anim: 'cast', speed: 420, r: 34, color: '#8e44ad', pull: true },
    dark_impact: { kind: 'melee', mul: 2.8, reach: 170, w: 150, h: 140, oy: -96, dur: 1.15, anim: 'heavy', knock: 460, launch: 120, shock: true, shake: 26, big: true },
  };

  /* =====================================================================
     FIGHTER
     ===================================================================== */
  class Fighter {
    constructor(cfg) {
      Object.assign(this, {
        isPlayer: false,
        x: 0, y: CFG.GROUND_Y, vx: 0, vy: 0,
        facing: 1, onGround: true,
        hp: 100, maxHp: 100, mana: 100, maxMana: 100, manaRegen: 5,
        atk: 10, spd: 1, weight: 1, size: 1,
        state: 'idle', stateTime: 0,
        animName: 'idle', animTime: 0, animDur: 1,
        invuln: 0, hurtFlash: 0, hitstop: 0,
        comboIndex: 0, comboQueued: false, comboTimer: 0,
        buffs: [], dots: [], shield: null,
        dead: false, victory: false,
        name: 'Fighter',
      }, cfg);
      this.startX = this.x;
      this.pose = OPF.Art.pose.basePose();
      this.cooldowns = {};
      this.hitMemory = new Set();
      this.move = null;         // active special
      this.moveTime = 0;
      this.moveHitIdx = 0;
      this.advance = 0;
      this.dashVel = 0;
      this.animTime = 0;
      this.visual = null;
      this.sizeScale = 1;
      this.prevX = this.x;
    }

    /* ---------------- query helpers ---------------- */
    get bodyBox() {
      const h = 118 * this.sizeScale * (this.buffs.find(b => b.sizeMul) ? this.buffs.find(b => b.sizeMul).sizeMul : 1);
      const w = 40 * this.sizeScale;
      return { x: this.x - w / 2, y: this.y - h, w, h };
    }
    get centerY() { return this.y - 60 * this.sizeScale; }
    distanceTo(o) { return Math.abs(this.x - o.x); }
    get buffAtk() { return this.buffs.reduce((m, b) => m * (b.atkMul || 1), 1); }
    get buffSpeed() { return this.buffs.reduce((m, b) => m * (b.speedMul || 1), 1); }
    get buffDef() { return this.buffs.reduce((m, b) => m * (b.defMul || 1), 1); }
    get frozen() { return this.dots.some(d => d.freeze > 0); }

    addBuff(b) {
      const ex = this.buffs.find(x => x.id === b.id);
      if (ex) Object.assign(ex, b);
      else this.buffs.push(Object.assign({}, b));
    }
    removeBuff(id) { this.buffs = this.buffs.filter(b => b.id !== id); }

    addDot(d) {
      const ex = this.dots.find(x => x.id === d.id);
      if (ex) { ex.time = Math.max(ex.time, d.time); ex.dps = Math.max(ex.dps, d.dps); }
      else this.dots.push(Object.assign({ time: 3 }, d));
    }

    /* ---------------- damage ---------------- */
    takeDamage(amount, opts) {
      opts = opts || {};
      if (this.dead || this.invuln > 0) return 0;
      let dmg = amount * this.buffDef;
      if (opts.pierceDef !== true) dmg *= (opts.defMul === undefined ? 1 : opts.defMul);
      if (this.blocking && !opts.unblockable) {
        dmg *= 0.25;
        this.mana = Math.min(this.maxMana, this.mana + 4);
        this.world && this.world.audio.sfx('block');
        if (opts.onBlock) opts.onBlock();
      }
      if (opts.dmgMul) dmg *= opts.dmgMul;
      dmg = Math.max(1, Math.round(dmg));
      this.hp -= dmg;
      this.hurtFlash = 0.18;
      if (!opts.pierceDef) this.invuln = Math.max(this.invuln, this.isPlayer ? 0.45 : 0.22);
      this.hitstop = opts.big ? 0.1 : 0.055;
      if (this.isPlayer) {
        this.world.fx.shake(opts.big ? 12 : 5, 0.2);
      }
      if (opts.freeze) this.addDot({ id: 'freeze', time: opts.freeze, dps: 0, freeze: opts.freeze, color: '#aed6f1' });
      if (opts.burn) this.addDot({ id: 'burn', time: opts.burn, dps: opts.burnDps || 4, color: '#ff6b00' });
      if (opts.poison) this.addDot({ id: 'poison', time: opts.poison, dps: opts.poisonDps || 3, color: '#8e44ad' });

      if (this.hp <= 0) { this.hp = 0; this.die(); }
      return dmg;
    }

    die() {
      this.dead = true;
      this.setState('ko');
      this.vx = -this.facing * 60;
      this.vy = -180;
      this.onGround = false;
      this.world && this.world.audio.sfx('ko');
    }

    heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); return v; }
    restoreMana(v) { this.mana = Math.min(this.maxMana, this.mana + v); }

    /* ---------------- state ---------------- */
    setState(s, dur) {
      if (this.state === s && !dur) return;
      this.state = s;
      this.stateTime = 0;
      this.animTime = 0;
      this.animDur = dur || 0.4;
      if (s !== 'attack') this.hitMemory.clear();
    }

    get blocking() { return this.state === 'block' && this.onGround; }
    get attacking() { return this.state === 'attack' || this.state === 'special'; }
    get locked() { return this.attacking || this.state === 'hurt' || this.state === 'ko' || this.state === 'dash'; }

    /* ---------------- combo attack ---------------- */
    beginAttack() {
      const charId = this.charId;
      const C = OPF.CHAR_BY_ID[charId];
      const idx = this.comboIndex % C.combo.hits;
      const anims = COMBO_ANIM[charId] || ['jab', 'cross', 'heavy'];
      const anim = anims[Math.min(idx, anims.length - 1)];
      const reachMul = C.combo.reach[idx] / 60;
      const reach = C.combo.reach[idx] * this.sizeScale;
      this.move = {
        id: 'combo', idx, anim,
        reach,
        hits: [{
          at: C.combo.startup[idx] + C.combo.active * 0.35,
          mul: C.combo.dmg[idx],
          reach,
          w: 74 * (0.9 + idx * 0.12),
          h: 78,
          oy: -88,
          knock: 30 + idx * 80,
          launch: idx === 2 ? 60 : 0,
          isCombo: true,
          comboHit: idx,
        }],
      };
      this.moveTime = 0;
      this.moveHitIdx = 0;
      this.setState('attack', this.move.startup + this.move.active + this.move.recovery);
      this.comboQueued = false;
      this.comboTimer = 0.7;
    }

    useSpecial(idx) {
      const C = OPF.CHAR_BY_ID[this.charId];
      const sp = C.specials[idx];
      if (!sp) return false;
      if (this.level < sp.unlock) { this.world && this.world.log('Locked until Lv.' + sp.unlock, 'damage'); return false; }
      if (this.mana < sp.cost) { this.world && this.world.log('Not enough mana', 'mana'); return false; }
      if (this.locked || !this.onGround && sp.groundOnly) return false;
      const impl = SPECIALS[sp.id];
      if (!impl) return false;
      this.mana -= sp.cost;
      this.move = Object.assign({ id: sp.id, name: sp.name, cost: sp.cost, anim: impl.anim || 'cast' }, impl);
      this.moveTime = 0;
      this.moveHitIdx = 0;
      this.hitMemory.clear();
      this.dashFacing = this.facing;
      this.dashVel = 0;
      this.setState('special', impl.dur);
      if (impl.onStart) impl.onStart(this.world, this);
      if (impl.sfx) this.world.audio.sfx(impl.sfx);
      this.world.fx.moveCharge(this, sp);
      this.world.onSpecialUsed(this, sp);
      return true;
    }

    /* ---------------- update ---------------- */
    update(dt, world) {
      this.world = world;
      this.prevX = this.x;
      this.animTime += dt;
      if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.12; }
      if (this.invuln > 0) this.invuln -= dt;
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.comboIndex = 0; }

      // buffs / dots
      for (let i = this.buffs.length - 1; i >= 0; i--) {
        this.buffs[i].time -= dt;
        if (this.buffs[i].time <= 0) {
          const b = this.buffs[i];
          if (this.isPlayer) world.log(b.name + ' expired', 'mana');
          this.buffs.splice(i, 1);
        }
      }
      for (let i = this.dots.length - 1; i >= 0; i--) {
        const d = this.dots[i];
        d.time -= dt;
        if (d.freeze > 0) d.freeze = Math.max(0, d.time);
        if (d.dps > 0 && this.hp > 0) {
          this.dotAccum = (this.dotAccum || 0) + d.dps * dt;
          if (this.dotAccum >= 1) {
            const tick = Math.floor(this.dotAccum);
            this.dotAccum -= tick;
            this.hp -= tick;
            world.fx.tick(this, d.color || '#ff6b00');
            if (this.hp <= 0) { this.hp = 0; this.die(); }
          }
        }
        if (d.time <= 0) this.dots.splice(i, 1);
      }

      // mana regen
      if (this.maxMana > 0 && !this.dead) {
        this.mana = Math.min(this.maxMana, this.mana + this.manaRegen * dt * (this.state === 'special' ? 0.35 : 1));
      }

      this.updateState(dt, world);
      this.updatePhysics(dt, world);
      this.updatePose(dt);
    }

    updateState(dt, world) {
      this.stateTime += dt;
      const st = this.state;

      switch (st) {
        case 'attack':
        case 'special': {
          const m = this.move;
          if (!m) { this.setState('idle'); break; }
          this.moveTime += dt;
          if (st === 'special' && m.draw) m.draw(world, this, this.moveTime / m.dur);
          if (st === 'special' && m.advance) this.dashVel = Math.max(this.dashVel || 0, m.advance);

          if (m.beam && st === 'special') {
            const b = m.beam;
            if (this.moveTime >= b.start && this.moveTime < b.end) {
              this.beamTimer = (this.beamTimer || 0) + dt;
              if (this.beamTimer >= b.tickRate) {
                this.beamTimer = 0;
                world.beamDamage(this, b);
              }
            }
          }
          const hits = m.hits || (m.hit ? [m.hit] : null);
          if (hits) {
            while (this.moveHitIdx < hits.length && this.moveTime >= hits[this.moveHitIdx].at) {
              this.performHit(world, hits[this.moveHitIdx]);
              this.moveHitIdx++;
            }
          }
          if (this.moveTime >= this.animDur) {
            if (st === 'attack') {
              if (this.comboQueued && this.comboIndex < 2) {
                this.comboIndex++;
                this.beginAttack();
                return;
              }
              this.comboIndex = 0;
            }
            this.move = null;
            this.setState('idle');
          }
          break;
        }
        case 'hurt':
          if (this.onGround && this.stateTime > 0.32) this.setState('idle');
          break;
        case 'dash':
          if (this.stateTime >= this.animDur) this.setState('idle');
          break;
        case 'block':
        case 'idle':
          // handled by input/AI
          break;
      }
    }

    performHit(world, hit) {
      const reach = (hit.reach || 100) * this.sizeScale;
      const w = (hit.w || 80) * this.sizeScale;
      const h = (hit.h || 80) * this.sizeScale;
      // hitbox centre sits in front of the body, extending to ~reach + arm
      const box = {
        x: this.x + this.facing * (reach * 0.78 + 10) - w / 2,
        y: this.y + (hit.oy || -84) - h / 2,
        w, h, hit,
      };

      world.audio.sfx(hit.fire ? 'fire' : hit.ice ? 'ice' : 'whiff', this.isPlayer ? -0.3 : 0.3);
      world.resolveMeleeHit(this, box, hit);
    }

    updatePhysics(dt, world) {
      const frozenMul = this.frozen ? 0.25 : 1;
      // gravity
      if (!this.onGround) {
        this.vy += CFG.GRAVITY * dt;
      }
      this.x += this.vx * dt * frozenMul;
      this.y += this.vy * dt;
      if (this.dashVel) {
        this.x += (this.dashFacing || this.facing) * this.dashVel * dt;
        this.dashVel *= Math.pow(0.004, dt);
        if (Math.abs(this.dashVel) < 12) this.dashVel = 0;
      }

      // friction
      const fri = this.onGround ? Math.pow(0.0025, dt) : Math.pow(0.35, dt);
      this.vx *= fri;
      if (Math.abs(this.vx) < 4) this.vx = 0;

      if (this.y >= CFG.GROUND_Y) {
        if (!this.onGround) {
          this.y = CFG.GROUND_Y;
          this.onGround = true;
          this.vy = 0;
          world.fx.dust(this.x, this.y, 6);
          if (this.state === 'fall' || this.state === 'jump') this.setState('idle');
          if (this.state === 'hurt' && this.stateTime > 0.3) this.setState('idle');
        }
        this.y = CFG.GROUND_Y;
        this.vy = 0;
      } else {
        this.onGround = false;
        if (this.state === 'idle' || this.state === 'walk' || this.state === 'crouch') this.setState('fall');
      }

      this.x = clamp(this.x, world.arenaLeft, world.arenaRight);

      // face the opponent when neutral
      if (world.autoFace && !this.locked && this.state !== 'block') {
        const foe = this.isPlayer ? world.nearestEnemy(this) : world.player;
        if (foe && !foe.dead && Math.abs(foe.x - this.x) > 12) {
          const want = foe.x > this.x ? 1 : -1;
          if (!this.isPlayer || this.state === 'idle' || this.state === 'walk') this.facing = want;
        }
      }
    }

    moveInput(dirX, world) {
      if (this.locked || this.state === 'ko' || this.dead) return;
      if (dirX !== 0) {
        const spd = 235 * this.spd * this.buffSpeed * this.sizeScale;
        this.vx = dirX * spd;
        this.facing = dirX > 0 ? 1 : -1;
        if (this.onGround) this.setState('walk');
      } else if (this.state === 'walk') {
        this.setState('idle');
      }
    }

    jump() {
      if (this.locked || this.dead || !this.onGround) return false;
      this.vy = -760;
      this.onGround = false;
      this.setState('jump');
      this.world.audio.sfx('jump');
      this.world.fx.dust(this.x, this.y, 5);
      return true;
    }

    dash(dir) {
      if (this.locked || this.dead || !this.onGround) return false;
      const d = dir || this.facing;
      this.vx = d * 640;
      this.facing = d > 0 ? 1 : -1;
      this.invuln = Math.max(this.invuln, 0.30);
      this.setState('dash', 0.3);
      this.world.audio.sfx('dash');
      this.world.fx.dashTrail(this.x, this.y);
      return true;
    }

    /* ---------------- pose ---------------- */
    updatePose(dt) {
      const P = OPF.Art.pose;
      const t = this.animTime;
      let pose;
      switch (this.state) {
        case 'walk': pose = P.walk(this, t); break;
        case 'run': pose = P.run(this, t); break;
        case 'jump': pose = P.jump(this, t); break;
        case 'fall': pose = P.fall(this, t); break;
        case 'crouch': pose = P.crouch(this, t); break;
        case 'dash': pose = P.dash(this, t); break;
        case 'hurt': pose = P.hit(this, Math.min(1, this.stateTime / 0.35)); break;
        case 'block': pose = P.block(this, t); break;
        case 'ko': pose = P.ko(this, Math.min(1, this.stateTime / 0.6)); break;
        case 'victory': pose = P.victory(this, t); break;
        case 'attack':
        case 'special': {
          const m = this.move;
          if (m) {
            const frames = P.attacks[m.anim] || P.attacks.jab;
            const prog = clamp(this.moveTime / Math.max(0.12, this.animDur * 0.92), 0, 1);
            pose = P.kfe(frames, prog);
            // stretch multiplier for rubber attacks
            if (m.ext) { pose.extF = m.ext; }
            if (m.anim === 'stretch_punch' && m.reach > 160) pose.extF = Math.max(pose.extF || 1, 1 + (m.reach - 100) / 46);
            if (m.anim === 'flurry') pose.extF = Math.max(pose.extF || 1, 1.7);
          } else pose = P.idle(this, t);
          break;
        }
        default: pose = P.idle(this, t);
      }
      // frozen tint / stagger
      if (this.frozen && (this.state === 'idle' || this.state === 'walk')) {
        pose = P.mixPose(pose, P.hit(this, 0.6), 0.25);
      }
      this.pose = pose;
    }

    /* ---------------- draw ---------------- */
    draw(ctx, time) {
      const v = this.visual;
      if (!v) return;
      const e = {
        x: this.x, y: this.y, facing: this.facing, pose: this.pose,
        colors: Object.assign({}, v.colors),
        faceOpts: Object.assign({}, v.faceOpts, { ko: this.dead }),
        bodyType: v.bodyType, weapon: v.weapon, weapon2: v.weapon2, extras: v.extras,
        bulk: v.bulk, headScale: v.headScale,
        scale: 1.06 * (v.scaleHint || 1),
        sizeScale: this.sizeScale * (v.sizeScale || 1),
        animTime: this.animTime,
      };
      // size buff (Gear Third / Moria)
      const sz = this.buffs.find(b => b.sizeMul);
      if (sz) e.sizeScale *= sz.sizeMul;
      if (this.weapon) e.weapon = this.weapon;

      // hit flash: whiten the character's own colours (no overlay rectangle)
      if (this.hurtFlash > 0) {
        const amt = Math.min(0.8, this.hurtFlash / 0.18 * 0.8);
        e.flashAmt = amt;
      }
      OPF.Art.drawFighter(ctx, e, time);
      // aura
      this.drawAura(ctx);
    }

    drawAura(ctx) {
      const aura = this.buffs.find(b => b.aura);
      if (!aura) return;
      const t = performance.now() / 1000;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + Math.sin(t * 8) * 0.08;
      const g = ctx.createRadialGradient(this.x, this.centerY, 6, this.x, this.centerY, 70 * this.sizeScale);
      g.addColorStop(0, aura.aura);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.centerY, 70 * this.sizeScale, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  OPF.Fighter = Fighter;
  OPF.SPECIALS = SPECIALS;
  OPF.BOSS_MOVES = BOSS_MOVES;
  OPF.COMBO_ANIM = COMBO_ANIM;
})(window);
