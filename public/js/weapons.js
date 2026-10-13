/**
 * Weapon definitions + per-player weapon runtime state.
 * Hitscan for AK / Sniper / MG, projectile for Plasma, throwable for Grenade.
 */
export const WEAPONS = [
  {
    id: 0,
    name: 'AK ASSAULT RIFLE',
    short: 'AK',
    kind: 'hitscan',
    auto: true,
    rpm: 600,
    magSize: 30,
    damage: 12,
    spread: 0.014,
    adsSpread: 0.005,
    reloadTime: 2.0,
    moveMult: 1.0,
    zoom: 1.15,
    color: '#23e6ff',
    tracer: '#23e6ff',
    sfx: 'ak',
    range: 220,
  },
  {
    id: 1,
    name: 'ADVANCED KINETIC SNIPER',
    short: 'SNIPER',
    kind: 'hitscan',
    auto: false,
    rpm: 48,
    magSize: 5,
    damage: 85,
    spread: 0.028,
    adsSpread: 0.0004,
    reloadTime: 3.1,
    moveMult: 0.82,
    zoom: 3.2,
    color: '#9d4dff',
    tracer: '#c79bff',
    sfx: 'sniper',
    range: 400,
    headBonus: 2.2,
  },
  {
    id: 2,
    name: 'PLASMA PISTOL',
    short: 'PLASMA',
    kind: 'projectile',
    auto: false,
    rpm: 220,
    magSize: 14,
    damage: 20,
    spread: 0.01,
    adsSpread: 0.003,
    reloadTime: 1.5,
    moveMult: 1.05,
    zoom: 1.25,
    color: '#26ffd0',
    tracer: '#26ffd0',
    sfx: 'plasma',
    boltSpeed: 90,
    splash: 1.6,
  },
  {
    id: 3,
    name: 'RAPID FIRE MACHINE GUN',
    short: 'MG',
    kind: 'hitscan',
    auto: true,
    rpm: 900,
    magSize: 100,
    damage: 8,
    spread: 0.032,
    adsSpread: 0.018,
    reloadTime: 4.2,
    moveMult: 0.9,
    zoom: 1.1,
    color: '#ffb223',
    tracer: '#ffd27a',
    sfx: 'mg',
    range: 160,
  },
  {
    id: 4,
    name: 'TACTICAL GRENADES',
    short: 'NADES',
    kind: 'grenade',
    auto: false,
    rpm: 55,
    magSize: 3,
    damage: 110,
    spread: 0,
    adsSpread: 0,
    reloadTime: 2.4,
    moveMult: 1.05,
    zoom: 1,
    color: '#ff2ea6',
    tracer: '#ff2ea6',
    sfx: 'empty',
    blastRadius: 7.5,
  },
];

export class WeaponState {
  constructor() {
    this.slot = 0;
    this.ammo = WEAPONS.map((w) => w.magSize);
    this.cooldown = 0;
    this.reloadLeft = 0;
  }

  get def() {
    return WEAPONS[this.slot];
  }

  setSlot(i) {
    if (i < 0 || i >= WEAPONS.length || i === this.slot) return false;
    this.slot = i;
    this.reloadLeft = 0;
    return true;
  }

  canFire() {
    return this.cooldown <= 0 && this.reloadLeft <= 0 && this.ammo[this.slot] > 0;
  }

  fire() {
    this.ammo[this.slot] -= 1;
    this.cooldown = 60 / this.def.rpm;
  }

  startReload() {
    const def = this.def;
    if (this.reloadLeft > 0 || this.ammo[this.slot] >= def.magSize) return false;
    this.reloadLeft = def.reloadTime;
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        this.ammo[this.slot] = this.def.magSize;
      }
    }
  }

  refill() {
    this.ammo = WEAPONS.map((w) => w.magSize);
    this.reloadLeft = 0;
    this.cooldown = 0;
  }
}
