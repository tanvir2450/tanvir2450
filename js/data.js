/* =========================================================================
   ONE PIECE FIGHT — data.js
   Static game data: characters, specials, enemies, bosses, arcs, levels.
   ========================================================================= */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- config
  const CONFIG = {
    VIEW_H: 540,              // virtual height (all gameplay coords are in this space)
    MIN_VIEW_W: 720,
    MAX_VIEW_W: 1150,
    GROUND_Y: 452,            // y of the floor line
    GRAVITY: 2100,
    FIXED_DT: 1 / 60,
    MAX_PARTICLES: 260,
    MAX_DAMAGE_NUMBERS: 40,
    PLAYER_W: 46,
    PLAYER_H: 118,
    ARCS: 5,
    LEVELS_PER_ARC: 30,
  };

  const PALETTE = {
    gold: '#ffd700',
    goldDark: '#b8860b',
    orange: '#ff8c00',
    red: '#e63946',
    blue: '#3498db',
    green: '#27ae60',
    purple: '#9b59b6',
    ink: '#101018',
  };

  // ------------------------------------------------------------ helpers
  // Deterministic pseudo-random so an enemy archetype always looks the same.
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rand01(seed, salt) {
    let x = (seed ^ Math.imul(salt | 0, 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  }

  /* =======================================================================
     PLAYABLE CHARACTERS
     Each character has 6 "grades": 3 stat tracks (vitality / power / spirit)
     each upgradeable 1..10. Overall character level 1..10 is derived, and it
     gates the 4 specials below.
     ======================================================================= */
  const CHARACTERS = [
    {
      id: 'luffy',
      name: 'Luffy',
      fullName: 'Monkey D. Luffy',
      title: 'Straw Hat',
      epithet: 'Rubber Man',
      color: '#e63946',
      accent: '#ffd700',
      body: { skin: '#f0b98a', shirt: '#e63946', pants: '#2f6fb5', sash: '#ffd700', hair: '#1a1a1a', hat: 'straw' },
      style: 'Rubber Melee — stretchy combos + in-match Gears',
      desc: 'A rubber-bodied brawler. Extends limbs for reach, and transforms mid-fight with Gear 2 and Gear 3.',
      base: { hp: 100, atk: 10, spd: 1.0, reach: 1.1, weight: 1.0 },
      combo: { hits: 3, dmg: [1.0, 1.05, 1.45], reach: [68, 72, 90], startup: [0.09, 0.08, 0.14], active: 0.09, recovery: [0.13, 0.13, 0.26] },
      specials: [
        { id: 'gum_pistol', name: 'Gum-Gum Pistol', cost: 18, unlock: 3, kind: 'stretch_punch', desc: 'Rocket a stretched fist across the screen.' },
        { id: 'gum_gatling', name: 'Gum-Gum Gatling', cost: 30, unlock: 5, kind: 'flurry', desc: 'A blinding storm of rapid-fire punches.' },
        { id: 'gear_second', name: 'Gear Second', cost: 42, unlock: 7, kind: 'transform', desc: 'Pump blood like a jet — +45% speed, +30% power, glowing steam.' },
        { id: 'gear_third', name: 'Gear Third', cost: 65, unlock: 9, kind: 'giant_fist', desc: 'Inflate the bones into a colossal fist that crushes everything.' },
      ],
    },
    {
      id: 'zoro',
      name: 'Zoro',
      fullName: 'Roronoa Zoro',
      title: 'Pirate Hunter',
      epithet: 'Three-Sword Style',
      color: '#27ae60',
      accent: '#ffffff',
      body: { skin: '#e8b184', shirt: '#1f6b3a', pants: '#2a2a35', sash: '#1f6b3a', hair: '#3fa34d', hat: 'bandana' },
      style: 'Santoryu — close-range, high-damage slashing',
      desc: 'Three blades, zero mercy. Enormous single-hit damage at the cost of range and a long recovery.',
      base: { hp: 108, atk: 13, spd: 0.93, reach: 0.9, weight: 1.05 },
      combo: { hits: 3, dmg: [1.25, 1.3, 1.8], reach: [72, 76, 92], startup: [0.11, 0.1, 0.17], active: 0.08, recovery: [0.18, 0.18, 0.34] },
      specials: [
        { id: 'oni_giri', name: 'Oni Giri', cost: 20, unlock: 3, kind: 'triple_slash', desc: 'A three-way cross slash that lands as one instant.' },
        { id: 'tatsumaki', name: 'Tatsumaki', cost: 32, unlock: 5, kind: 'whirlwind', desc: 'Spin into a dragon twister that drags foes through the air.' },
        { id: 'ashura', name: 'Ashura', cost: 55, unlock: 7, kind: 'transform', desc: 'Nine blades, three faces. +55% damage aura of pure killing intent.' },
        { id: 'sanzen_sekai', name: 'Sanzen Sekai', cost: 72, unlock: 9, kind: 'ultimate_slash', desc: 'Three-Sword Style ultimate: the world itself is cut.' },
      ],
    },
    {
      id: 'sanji',
      name: 'Sanji',
      fullName: 'Vinsmoke Sanji',
      title: 'Black Leg',
      epithet: 'Cook of the Sea',
      color: '#f1c40f',
      accent: '#ff6b00',
      body: { skin: '#f0c9a0', shirt: '#1c1c28', pants: '#1c1c28', sash: '#f1c40f', hair: '#f5d76e', hat: 'none' },
      style: 'Aerial kick combos — Diable Jambe',
      desc: 'Fastest legs on the crew. Chains kicks into the air and ignites them with Diable Jambe.',
      base: { hp: 95, atk: 9.5, spd: 1.14, reach: 1.0, weight: 0.95 },
      combo: { hits: 4, dmg: [0.85, 0.9, 0.95, 1.3], reach: [66, 70, 74, 88], startup: [0.07, 0.07, 0.08, 0.13], active: 0.08, recovery: [0.11, 0.11, 0.12, 0.2] },
      specials: [
        { id: 'party_table', name: 'Party Table Kick Course', cost: 18, unlock: 3, kind: 'spin_kick', desc: 'A spinning kick course that clears everything around you.' },
        { id: 'diable_jambe', name: 'Diable Jambe', cost: 30, unlock: 5, kind: 'fire_kicks', desc: 'Ignite the leg — flaming kicks that burn on contact.' },
        { id: 'hell_memories', name: 'Hell Memories', cost: 52, unlock: 7, kind: 'transform', desc: 'Burst into flame. Kicks set the ground alight for 12s.' },
        { id: 'anti_manner', name: 'Anti-Manner Kick Course', cost: 68, unlock: 9, kind: 'launcher', desc: 'A vertical boot that launches a foe skyward.' },
      ],
    },
    {
      id: 'usopp',
      name: 'Usopp',
      fullName: 'God Usopp',
      title: 'Sniper King',
      epithet: 'King of Snipers',
      color: '#c39bd3',
      accent: '#f5d76e',
      body: { skin: '#d9a273', shirt: '#c8a165', pants: '#8b6b3d', sash: '#3a4a2a', hair: '#1a1a1a', hat: 'bandana' },
      style: 'Long-range sniping, traps & evasion',
      desc: 'Never in melee range if he can help it. Ranged stars, smoke escapes and heavy impact attacks.',
      base: { hp: 86, atk: 8.5, spd: 1.02, reach: 0.95, weight: 0.9 },
      combo: { hits: 3, dmg: [0.8, 0.85, 1.2], reach: [62, 66, 82], startup: [0.08, 0.08, 0.12], active: 0.08, recovery: [0.12, 0.12, 0.22] },
      specials: [
        { id: 'firebird_star', name: 'Firebird Star', cost: 16, unlock: 3, kind: 'projectile', desc: 'Launch a flaming bird star across the stage.' },
        { id: 'smoke_star', name: 'Smoke Star', cost: 22, unlock: 5, kind: 'evade', desc: 'Vanish in a cloud of smoke and reposition behind the enemy.' },
        { id: 'kaen_boshi', name: 'Kaen Boshi', cost: 40, unlock: 7, kind: 'bomb', desc: 'A huge fire star that erupts into a burning field.' },
        { id: 'impact_dial', name: 'Impact Reject', cost: 62, unlock: 9, kind: 'beam', desc: 'Unleash stored impact — a cannon of raw kinetic force.' },
      ],
    },
    {
      id: 'franky',
      name: 'Franky',
      fullName: 'Cutty Flam "Franky"',
      title: 'Cyborg Shipwright',
      epithet: 'The Iron Man',
      color: '#00bcd4',
      accent: '#e74c3c',
      body: { skin: '#eab98f', shirt: '#2e86c1', pants: '#e74c3c', sash: '#2e86c1', hair: '#2e86c1', hat: 'none' },
      style: 'Heavy cyborg strikes & weapon blasts',
      desc: 'Slow, armored and devastating. Every hit lands like a ship\u2019s anchor and lasers clear the room.',
      base: { hp: 132, atk: 11.5, spd: 0.82, reach: 0.95, weight: 1.3 },
      combo: { hits: 3, dmg: [1.1, 1.15, 1.6], reach: [74, 78, 94], startup: [0.13, 0.12, 0.19], active: 0.1, recovery: [0.2, 0.2, 0.34] },
      specials: [
        { id: 'strong_right', name: 'Strong Right', cost: 20, unlock: 3, kind: 'chain_fist', desc: 'Fire your forearm on a chain to yank enemies in.' },
        { id: 'fresh_fire', name: 'Fresh Fire', cost: 30, unlock: 5, kind: 'flame_cone', desc: 'Breathe a cone of fire from the mouth.' },
        { id: 'coup_de_vent', name: 'Coup de Vent', cost: 52, unlock: 7, kind: 'air_cannon', desc: 'Compressed air blast that hurls foes across the deck.' },
        { id: 'radical_beam', name: 'Franky Radical Beam', cost: 75, unlock: 9, kind: 'beam', desc: 'Chest-mounted laser. Wide, long and absolutely final.' },
      ],
    },
    {
      id: 'brook',
      name: 'Brook',
      fullName: 'Brook "Soul King"',
      title: 'Gentleman Skeleton',
      epithet: 'Humming Swordsman',
      color: '#aed6f1',
      accent: '#5dade2',
      body: { skin: '#f2f4f5', shirt: '#111118', pants: '#111118', sash: '#aed6f1', hair: '#111118', hat: 'tophat' },
      style: 'Fencing thrusts with ice & soul powers',
      desc: 'Lightning-fast cane-sword thrusts, freezing ice slashes, and a soul that simply refuses to die.',
      base: { hp: 92, atk: 10, spd: 1.16, reach: 1.05, weight: 0.88 },
      combo: { hits: 4, dmg: [0.85, 0.85, 0.9, 1.35], reach: [74, 76, 78, 90], startup: [0.07, 0.07, 0.07, 0.13], active: 0.07, recovery: [0.1, 0.1, 0.11, 0.24] },
      specials: [
        { id: 'yahazu_giri', name: 'Hanauta Sancho: Yahazu Giri', cost: 18, unlock: 3, kind: 'dash_thrust', desc: 'Blink forward and skewer anything in the line.' },
        { id: 'gaikotsu_giri', name: 'Gaikotsu Giri', cost: 30, unlock: 5, kind: 'ice_slash', desc: 'A frozen slash that chills enemies to the bone — literally.' },
        { id: 'soul_solid', name: 'Soul Solid', cost: 52, unlock: 7, kind: 'transform', desc: 'Freeze your own blade solid. Attacks slow enemies on hit.' },
        { id: 'hueco_mundo', name: 'Hueco Mundo', cost: 70, unlock: 9, kind: 'ice_ult', desc: 'An ice dimension opens — the whole arena frosts over.' },
      ],
    },
  ];

  const CHAR_BY_ID = {};
  CHARACTERS.forEach(c => { CHAR_BY_ID[c.id] = c; });

  /* =======================================================================
     ENEMY ARCHETYPES
     body: which procedural rig to draw.  ai: behaviour profile.
     ======================================================================= */
  const ENEMY_TYPES = {
    // ---- East Blue -------------------------------------------------------
    marine_recruit: { name: 'Marine Recruit', body: 'marine', hp: 42, atk: 6, spd: 0.95, ai: 'melee', color: '#dfe6e9', accent: '#2d6cdf', size: 0.95, coins: 6 },
    marine_swordsman: { name: 'Marine Swordsman', body: 'marine', hp: 62, atk: 9, spd: 0.92, ai: 'melee', color: '#dfe6e9', accent: '#2d6cdf', size: 1.0, weapon: 'sword', coins: 9 },
    marine_gunner: { name: 'Marine Gunner', body: 'marine', hp: 46, atk: 8, spd: 0.86, ai: 'ranged', color: '#dfe6e9', accent: '#2d6cdf', size: 0.97, weapon: 'rifle', coins: 10 },
    buggy_pirate: { name: 'Buggy Pirate', body: 'pirate', hp: 54, atk: 8, spd: 1.0, ai: 'melee', color: '#c0392b', accent: '#f39c12', size: 1.0, coins: 8 },
    buggy_thrower: { name: 'Buggy Blade Tosser', body: 'pirate', hp: 50, atk: 9, spd: 0.9, ai: 'ranged', color: '#c0392b', accent: '#f39c12', size: 0.98, weapon: 'knife', coins: 11 },
    krieg_pirate: { name: 'Krieg Pirate', body: 'pirate', hp: 88, atk: 11, spd: 0.88, ai: 'melee', color: '#7d3c98', accent: '#95a5a6', size: 1.06, coins: 13 },
    krieg_gunner: { name: 'Krieg Rifleman', body: 'pirate', hp: 62, atk: 12, spd: 0.84, ai: 'ranged', color: '#7d3c98', accent: '#95a5a6', size: 1.0, weapon: 'rifle', coins: 15 },
    fishman_fighter: { name: 'Fishman Fighter', body: 'fishman', hp: 104, atk: 13, spd: 1.06, ai: 'melee', color: '#1abc9c', accent: '#16a085', size: 1.1, coins: 17 },
    fishman_brute: { name: 'Fishman Brute', body: 'fishman', hp: 132, atk: 16, spd: 0.78, ai: 'melee', color: '#2e86c1', accent: '#1b4f72', size: 1.22, coins: 22 },

    // ---- Alabasta --------------------------------------------------------
    millions: { name: 'Baroque Million', body: 'agent', hp: 80, atk: 12, spd: 1.0, ai: 'melee', color: '#e8e8e8', accent: '#8e44ad', size: 1.0, coins: 15 },
    billions: { name: 'Baroque Billion', body: 'agent', hp: 72, atk: 13, spd: 0.94, ai: 'ranged', color: '#e8e8e8', accent: '#8e44ad', size: 1.0, weapon: 'rifle', coins: 18 },
    desert_bandit: { name: 'Desert Bandit', body: 'desert', hp: 96, atk: 14, spd: 1.04, ai: 'melee', color: '#c8a165', accent: '#7d5a2a', size: 1.04, coins: 17 },
    sand_raider: { name: 'Sand Raider', body: 'desert', hp: 84, atk: 15, spd: 0.98, ai: 'ranged', color: '#d2b48c', accent: '#8b5a2b', size: 1.0, weapon: 'knife', coins: 20 },
    palace_guard: { name: 'Alubarna Palace Guard', body: 'desert', hp: 120, atk: 16, spd: 0.9, ai: 'melee', color: '#f0e6d2', accent: '#b8860b', size: 1.14, weapon: 'sword', coins: 24 },
    baroque_elite: { name: 'Elite Agent', body: 'agent', hp: 110, atk: 18, spd: 1.08, ai: 'melee', color: '#2c3e50', accent: '#8e44ad', size: 1.06, weapon: 'knife', coins: 26 },

    // ---- Water Seven / Enies Lobby --------------------------------------
    shipwright: { name: 'Galley-La Shipwright', body: 'shipwright', hp: 112, atk: 17, spd: 0.96, ai: 'melee', color: '#b7791f', accent: '#7b4b12', size: 1.1, coins: 22 },
    franky_family: { name: 'Franky Family Punk', body: 'shipwright', hp: 96, atk: 15, spd: 1.06, ai: 'melee', color: '#4a5568', accent: '#e74c3c', size: 1.02, coins: 21 },
    marine_guard: { name: 'Enies Lobby Guard', body: 'marine', hp: 126, atk: 19, spd: 0.92, ai: 'melee', color: '#ecf0f1', accent: '#1f3a93', size: 1.12, weapon: 'sword', coins: 28 },
    cp9_initiate: { name: 'CP9 Initiate', body: 'agent', hp: 118, atk: 21, spd: 1.12, ai: 'melee', color: '#11181f', accent: '#c0392b', size: 1.04, weapon: 'knife', coins: 32 },
    gov_agent: { name: 'Government Agent', body: 'agent', hp: 108, atk: 20, spd: 1.02, ai: 'ranged', color: '#2c3e50', accent: '#95a5a6', size: 1.0, weapon: 'rifle', coins: 30 },

    // ---- Thriller Bark ---------------------------------------------------
    zombie_soldier: { name: 'Zombie Soldier', body: 'zombie', hp: 132, atk: 20, spd: 0.84, ai: 'melee', color: '#6b7b6b', accent: '#3d4a3d', size: 1.06, coins: 30 },
    zombie_archer: { name: 'Zombie Archer', body: 'zombie', hp: 120, atk: 21, spd: 0.8, ai: 'ranged', color: '#6b7b6b', accent: '#7d5a2a', size: 1.0, weapon: 'rifle', coins: 32 },
    spider_monkey: { name: 'Spider Monkey', body: 'beast', hp: 134, atk: 23, spd: 1.22, ai: 'melee', color: '#4a3b52', accent: '#9b59b6', size: 0.98, coins: 34 },
    zombie_general: { name: 'Zombie General', body: 'zombie', hp: 172, atk: 25, spd: 0.82, ai: 'melee', color: '#5d6d5d', accent: '#b8860b', size: 1.2, weapon: 'sword', coins: 42 },
    oars_follower: { name: "Oars' Follower", body: 'beast', hp: 150, atk: 24, spd: 0.94, ai: 'melee', color: '#8b6b4a', accent: '#c0392b', size: 1.16, coins: 40 },

    // ---- Impel Down ------------------------------------------------------
    blugori: { name: 'Blugori', body: 'beast', hp: 164, atk: 26, spd: 0.9, ai: 'melee', color: '#2e86c1', accent: '#1b4f72', size: 1.18, coins: 44 },
    jailer_beast: { name: 'Jailer Beast', body: 'beast', hp: 196, atk: 28, spd: 1.0, ai: 'melee', color: '#e67e22', accent: '#7b3f00', size: 1.12, coins: 50 },
    impel_guard: { name: 'Impel Down Guard', body: 'jailer', hp: 158, atk: 25, spd: 0.94, ai: 'melee', color: '#34495e', accent: '#f1c40f', size: 1.08, weapon: 'sword', coins: 46 },
    demon_guard: { name: 'Demon Guard', body: 'demon', hp: 240, atk: 32, spd: 0.86, ai: 'melee', color: '#c0392b', accent: '#7b1c1c', size: 1.28, coins: 62 },
    elite_prisoner: { name: 'Elite Prisoner', body: 'jailer', hp: 178, atk: 29, spd: 1.08, ai: 'melee', color: '#7d7d7d', accent: '#c0392b', size: 1.06, weapon: 'knife', coins: 55 },
    blackbeard_pirate: { name: "Blackbeard Pirate", body: 'blackbeard', hp: 206, atk: 31, spd: 0.92, ai: 'ranged', color: '#1c1c28', accent: '#8e44ad', size: 1.1, weapon: 'rifle', coins: 66 },
    titanic_captain: { name: 'Titanic Captain', body: 'blackbeard', hp: 262, atk: 35, spd: 0.98, ai: 'melee', color: '#2c2c3c', accent: '#e74c3c', size: 1.18, weapon: 'sword', coins: 80 },
  };

  /* =======================================================================
     BOSSES — 3 per arc, at levels 10 / 20 / 30
     ======================================================================= */
  const BOSSES = {
    // Arc 1 — East Blue
    buggy: {
      name: 'Buggy the Clown', title: 'Bara Bara no Mi', body: 'buggy', color: '#e63946', accent: '#3498db',
      hp: 420, atk: 15, spd: 0.95, size: 1.12, coins: 220, xp: 60,
      moves: ['chop_chop_cannon', 'blade_tornado', 'muggy_ball'], phase2: 0.45,
      intro: '"Fool! You cannot cut what is already in pieces!"',
    },
    krieg: {
      name: 'Don Krieg', title: 'Foul Play Krieg', body: 'krieg', color: '#c9a227', accent: '#7d3c98',
      hp: 620, atk: 19, spd: 0.88, size: 1.24, coins: 340, xp: 90,
      moves: ['mh5_flamethrower', 'spear_gun', 'poison_gas'], phase2: 0.4,
      intro: '"I am the strongest! Weapons are my only creed!"',
    },
    arlong: {
      name: 'Arlong', title: 'Saw-Tooth', body: 'arlong', color: '#1abc9c', accent: '#0e6655',
      hp: 880, atk: 24, spd: 1.06, size: 1.3, coins: 520, xp: 140,
      moves: ['shark_on_darts', 'tooth_gum', 'shark_saw'], phase2: 0.45,
      intro: '"Humans are inferior creatures! Fishmen are the superior race!"',
    },

    // Arc 2 — Alabasta
    mr3: {
      name: 'Mr. 3', title: 'Galdino, the Wax Man', body: 'mr3', color: '#f1c40f', accent: '#27ae60',
      hp: 900, atk: 26, spd: 0.9, size: 1.14, coins: 560, xp: 150,
      moves: ['wax_sword', 'candle_wall', 'wax_figure'], phase2: 0.4,
      intro: '"My wax art is the finest in the world. You are merely the mould."',
    },
    mr1: {
      name: 'Mr. 1', title: 'Daz Bonez', body: 'mr1', color: '#95a5a6', accent: '#2c3e50',
      hp: 1800, atk: 29, spd: 1.08, size: 1.2, coins: 700, xp: 190,
      moves: ['spiral_hollow', 'dice_blade', 'atomic_spine'], phase2: 0.42,
      intro: '"I am a blade. Blades do not need reasons."',
    },
    crocodile: {
      name: 'Crocodile', title: 'Sir Crocodile', body: 'crocodile', color: '#8b7355', accent: '#d4af37',
      hp: 1600, atk: 34, spd: 1.0, size: 1.26, coins: 980, xp: 260,
      moves: ['ground_death', 'desert_spada', 'sables'], phase2: 0.45,
      intro: '"Worthless. I shall bury you in the sand like all the rest."',
    },

    // Arc 3 — Water Seven / Enies Lobby
    blueno: {
      name: 'Blueno', title: 'CP9 Door-Man', body: 'blueno', color: '#2c3e50', accent: '#f1c40f',
      hp: 1350, atk: 40, spd: 1.1, size: 1.22, coins: 1000, xp: 270,
      moves: ['air_door', 'rankyaku', 'tekkai_counter'], phase2: 0.4,
      intro: '"You have already walked into my door. There is no exit."',
    },
    jabra: {
      name: 'Jabra', title: 'CP9 Wolf', body: 'jabra', color: '#a0522d', accent: '#2c3e50',
      hp: 1500, atk: 42, spd: 1.18, size: 1.24, coins: 1300, xp: 320,
      moves: ['wolf_lunge', 'rankyaku_roseo', 'tekko_gan'], phase2: 0.42,
      intro: '"A wolf does not fight fair. A wolf simply wins."',
    },
    lucci: {
      name: 'Rob Lucci', title: 'CP9 Strongest', body: 'lucci', color: '#1c1c28', accent: '#c0392b',
      hp: 2300, atk: 46, spd: 1.22, size: 1.26, coins: 1700, xp: 420,
      moves: ['soru_rush', 'rokougan', 'shigan_oo', 'leopard_form'], phase2: 0.5,
      intro: '"Dark Justice. The weak are simply in the way."',
    },

    // Arc 4 — Thriller Bark
    absalom: {
      name: 'Absalom', title: 'Invisible Lion', body: 'absalom', color: '#7d7d8f', accent: '#8e44ad',
      hp: 1900, atk: 46, spd: 1.0, size: 1.24, coins: 1750, xp: 430,
      moves: ['invisible_rush', 'gastro_phony', 'elephant_gun'], phase2: 0.4,
      intro: '"You cannot fight what you cannot see. And you cannot see me."',
    },
    ryuma: {
      name: 'Ryuma', title: 'Samurai of Wano', body: 'ryuma', color: '#4a5568', accent: '#e74c3c',
      hp: 2150, atk: 50, spd: 1.24, size: 1.2, coins: 2200, xp: 520,
      moves: ['shusui_draw', 'dragon_slash', 'gavotte_bond_avant'], phase2: 0.45,
      intro: '"A swordsman\'s strength is not in his blade, but in his conviction."',
    },
    moria: {
      name: 'Gecko Moria', title: 'Shadow Asgard', body: 'moria', color: '#5b2c6f', accent: '#f39c12',
      hp: 2800, atk: 54, spd: 0.9, size: 1.42, coins: 3000, xp: 700,
      moves: ['brick_bat', 'doppelman', 'shadow_asgard', 'shadow_revolution'], phase2: 0.5,
      intro: '"Kishishishi! Your shadow will make a fine puppet!"',
    },

    // Arc 5 — Impel Down
    hannyabal: {
      name: 'Hannyabal', title: 'Vice Warden', body: 'hannyabal', color: '#1a1a2e', accent: '#f1c40f',
      hp: 2350, atk: 52, spd: 1.02, size: 1.28, coins: 2900, xp: 680,
      moves: ['iron_whip', 'burning_fist', 'warden_charge'], phase2: 0.4,
      intro: '"For the sake of justice — and my promotion — you shall not pass!"',
    },
    magellan: {
      name: 'Magellan', title: 'Chief Warden of Hell', body: 'magellan', color: '#7b241c', accent: '#f39c12',
      hp: 3400, atk: 58, spd: 0.98, size: 1.34, coins: 4000, xp: 900,
      moves: ['venom_road', 'chloro_ball', 'hells_judgment', 'hydra'], phase2: 0.5,
      intro: '"There is no pain in my hell. Only poison."',
    },
    teach: {
      name: 'Marshall D. Teach', title: 'Blackbeard', body: 'teach', color: '#1c1c28', accent: '#8e44ad',
      hp: 4200, atk: 64, spd: 1.0, size: 1.4, coins: 6000, xp: 1400,
      moves: ['black_hole', 'liberation', 'kurozu', 'dark_impact'], phase2: 0.5,
      intro: '"Zehahaha! A man\'s dream never ends! Come, Straw Hat!"',
    },
  };

  /* =======================================================================
     ARCS
     ======================================================================= */
  const ARCS = [
    {
      id: 0, name: 'East Blue', subtitle: 'Where the journey began',
      bg: 'eastblue', palette: { sky1: '#7ec8e3', sky2: '#c8e9f5', far: '#4a7c94', mid: '#2f5a70', ground: '#c2a878', groundDark: '#9a7f52', accent: '#ffd700' },
      groups: [
        { from: 1, to: 9, enemies: ['marine_recruit', 'marine_swordsman', 'buggy_pirate', 'buggy_thrower'] },
        { from: 11, to: 19, enemies: ['krieg_pirate', 'krieg_gunner', 'buggy_pirate', 'marine_swordsman'] },
        { from: 21, to: 29, enemies: ['fishman_fighter', 'fishman_brute', 'krieg_pirate', 'marine_gunner'] },
      ],
      bosses: { 10: 'buggy', 20: 'krieg', 30: 'arlong' },
      levelNames: { 10: 'Buggy the Clown', 20: 'Don Krieg', 30: 'Arlong' },
    },
    {
      id: 1, name: 'Alabasta', subtitle: 'The kingdom in the sand',
      bg: 'alabasta', palette: { sky1: '#f6c177', sky2: '#f9e2a8', far: '#d9a05b', mid: '#b47b3f', ground: '#e0c08d', groundDark: '#b8945c', accent: '#c0392b' },
      groups: [
        { from: 1, to: 9, enemies: ['millions', 'billions', 'desert_bandit'] },
        { from: 11, to: 19, enemies: ['baroque_elite', 'sand_raider', 'millions', 'billions'] },
        { from: 21, to: 29, enemies: ['palace_guard', 'desert_bandit', 'baroque_elite'] },
      ],
      bosses: { 10: 'mr3', 20: 'mr1', 30: 'crocodile' },
      levelNames: { 10: 'Mr. 3', 20: 'Mr. 1 (Daz Bonez)', 30: 'Sir Crocodile' },
    },
    {
      id: 2, name: 'Water Seven / Enies Lobby', subtitle: 'The city of water burns',
      bg: 'waterseven', palette: { sky1: '#5d8aa8', sky2: '#9fb8c8', far: '#3e5c73', mid: '#2a3f52', ground: '#7d8b94', groundDark: '#5a666e', accent: '#f1c40f' },
      groups: [
        { from: 1, to: 9, enemies: ['shipwright', 'franky_family', 'marine_recruit'] },
        { from: 11, to: 19, enemies: ['cp9_initiate', 'marine_guard', 'gov_agent'] },
        { from: 21, to: 29, enemies: ['marine_guard', 'cp9_initiate', 'gov_agent', 'franky_family'] },
      ],
      bosses: { 10: 'blueno', 20: 'jabra', 30: 'lucci' },
      levelNames: { 10: 'Blueno', 20: 'Jabra', 30: 'Rob Lucci' },
    },
    {
      id: 3, name: 'Thriller Bark', subtitle: 'A ship of the dead',
      bg: 'thrillerbark', palette: { sky1: '#2c1e3f', sky2: '#4a2f5c', far: '#3a2a4a', mid: '#241a30', ground: '#4a3f52', groundDark: '#2e2635', accent: '#9b59b6' },
      groups: [
        { from: 1, to: 9, enemies: ['zombie_soldier', 'zombie_archer', 'spider_monkey'] },
        { from: 11, to: 19, enemies: ['zombie_general', 'spider_monkey', 'zombie_soldier'] },
        { from: 21, to: 29, enemies: ['oars_follower', 'zombie_general', 'zombie_archer'] },
      ],
      bosses: { 10: 'absalom', 20: 'ryuma', 30: 'moria' },
      levelNames: { 10: 'Absalom', 20: 'Ryuma', 30: 'Gecko Moria' },
    },
    {
      id: 4, name: 'Impel Down', subtitle: 'The great underwater prison',
      bg: 'impeldown', palette: { sky1: '#1b1b24', sky2: '#3a2a24', far: '#2e2018', mid: '#1c1410', ground: '#4a3a2e', groundDark: '#2e241c', accent: '#e74c3c' },
      groups: [
        { from: 1, to: 9, enemies: ['blugori', 'impel_guard', 'jailer_beast'] },
        { from: 11, to: 19, enemies: ['demon_guard', 'elite_prisoner', 'jailer_beast'] },
        { from: 21, to: 29, enemies: ['blackbeard_pirate', 'titanic_captain', 'demon_guard'] },
      ],
      bosses: { 10: 'hannyabal', 20: 'magellan', 30: 'teach' },
      levelNames: { 10: 'Hannyabal', 20: 'Magellan', 30: 'Marshall D. Teach' },
    },
  ];

  /* =======================================================================
     LEVEL GENERATION — 5 arcs x 30 levels
     ======================================================================= */
  function isBossLevel(level) { return level === 10 || level === 20 || level === 30; }

  function levelEnemies(arcIdx, level) {
    assertArc(arcIdx);
    const arc = ARCS[arcIdx];
    if (isBossLevel(level)) {
      return { boss: arc.bosses[level], waves: null };
    }
    return { boss: null, groups: arc.groups };
  }

  function assertArc(i) {
    if (!ARCS[i]) throw new Error('Unknown arc ' + i);
  }

  // Difficulty curve: rises within an arc and jumps per arc.
  function levelScaling(arcIdx, level) {
    const arc = arcIdx;                    // 0..4
    const within = level / CONFIG.LEVELS_PER_ARC;   // 0..1
    const enemyHp = (1 + arc * 0.26 + within * 0.30);
    const enemyAtk = (1 + arc * 0.20 + within * 0.24);
    return { hp: enemyHp, atk: enemyAtk, speed: 1 + arc * 0.045 + within * 0.05 };
  }

  // Wave composition for a normal level.
  function buildWaves(arcIdx, level) {
    const arc = ARCS[arcIdx];
    const grp = arc.groups.find(g => level >= g.from && level <= g.to) || arc.groups[0];
    const pool = grp.enemies;
    const seed = hashStr(arcIdx + ':' + level);

    // enemy count grows from 2 to 5 within each block of 9 levels
    const blockPos = ((level - 1) % 10) / 9;   // 0..1 inside the block
    const baseCount = 2 + Math.floor(blockPos * 3);
    const waveCount = level >= 25 ? 3 : level >= 15 ? 2.5 : 2;
    const waves = [];
    // 2-3 waves of grunts
    const nWaves = level <= 5 ? 2 : level <= 15 ? 2 : 3;
    for (let w = 0; w < nWaves; w++) {
      const count = Math.min(6, baseCount + (w === nWaves - 1 ? 1 : 0));
      const list = [];
      for (let i = 0; i < count; i++) {
        const r = rand01(seed, i + w * 31);
        const t = pool[Math.floor(r * pool.length) % pool.length];
        // ties: occasionally upgrade a grunt into a tougher pool member
        list.push(t);
      }
      waves.push(list);
    }
    return waves;
  }

  // Coin / XP payout for a level
  function levelReward(arcIdx, level, firstClear, performance) {
    const base = 40 + arcIdx * 55 + level * 9;
    let coins = Math.round(base * (isBossLevel(level) ? 3.2 : 1));
    if (!firstClear) coins = Math.round(coins * 0.6);
    const perf = 1 + Math.min(0.5, (performance || 0) * 0.5);
    coins = Math.round(coins * perf);
    const xp = Math.round(base * (isBossLevel(level) ? 2.4 : 1) * 0.7);
    return { coins, xp };
  }

  /* =======================================================================
     UPGRADE ECONOMY
     Tracks: vitality (+HP), power (+ATK), spirit (+Mana / special potency)
     Each track 1..10. Character level = derived 1..10.
     ======================================================================= */
  const UPGRADE_TRACKS = [
    { id: 'vitality', name: 'Vitality', desc: 'Raises maximum health.', icon: '❤', color: '#e74c3c' },
    { id: 'power', name: 'Power', desc: 'Raises attack damage.', icon: '⚔', color: '#e67e22' },
    { id: 'spirit', name: 'Spirit', desc: 'Raises mana pool, regen & special power.', icon: '✦', color: '#9b59b6' },
  ];

  // Cost of the next point in a track (current = value already owned)
  function upgradeCost(charId, trackId, current) {
    const tier = CHARACTERS.findIndex(c => c.id === charId);
    const tierMul = 1 + (tier >= 0 ? tier * 0.12 : 0);
    const base = 90;
    const cost = base * Math.pow(current + 1, 1.42) * tierMul;
    return Math.round(cost / 5) * 5;
  }

  // Derived character level 1..10 from total upgrade points (0..27)
  function charLevelFrom(upgrades) {
    const total = upgrades.vitality + upgrades.power + upgrades.spirit;
    return Math.max(1, Math.min(10, 1 + Math.floor(total / 2.9)));
  }

  // Stat resolution
  function resolveCharStats(charId, upgrades, potionBuff) {
    const c = CHAR_BY_ID[charId];
    const u = upgrades || { vitality: 0, power: 0, spirit: 0 };
    const lvl = charLevelFrom(u);
    const hp = Math.round(c.base.hp * (1 + u.vitality * 0.18));
    const atk = c.base.atk * (1 + u.power * 0.17);
    const mana = Math.round(100 + u.spirit * 15);
    const manaRegen = 4.5 + u.spirit * 1.1;
    const spd = c.base.spd * (1 + Math.min(0.1, u.vitality * 0.008));
    return { hp, atk, mana, manaRegen, spd, level: lvl, reach: c.base.reach, weight: c.base.weight };
  }

  /* =======================================================================
     CONSUMABLES
     ======================================================================= */
  const CONSUMABLES = [
    { id: 'health_potion', name: 'Health Potion', cost: 60, desc: 'Restores 40% of max health instantly.', icon: '🧪', color: '#e74c3c' },
    { id: 'mana_potion', name: 'Mana Potion', cost: 75, desc: 'Restores 50% of max mana instantly.', icon: '🔮', color: '#3498db' },
    { id: 'attack_tonic', name: 'Attack Tonic', cost: 120, desc: 'For one battle: +25% attack damage.', icon: '⚗', color: '#e67e22', battle: true },
    { id: 'iron_draught', name: 'Iron Draught', cost: 120, desc: 'For one battle: take 20% less damage.', icon: '🛡', color: '#95a5a6', battle: true },
    { id: 'revive_scroll', name: 'Revive Scroll', cost: 260, desc: 'Auto-revive once at 50% HP when defeated.', icon: '📜', color: '#f1c40f', battle: true },
  ];

  // ------------------------------------------------------------ exports
  global.OPF = global.OPF || {};
  Object.assign(global.OPF, {
    CONFIG, PALETTE, CHARACTERS, CHAR_BY_ID, ENEMY_TYPES, BOSSES, ARCS,
    UPGRADE_TRACKS, CONSUMABLES,
    isBossLevel, levelScaling, buildWaves, levelReward,
    upgradeCost, charLevelFrom, resolveCharStats, hashStr, rand01,
  });
})(window);
