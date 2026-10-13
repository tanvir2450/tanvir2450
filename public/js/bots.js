/**
 * Practice-mode bots: wander, hunt, strafe, shoot. Fully client-side so
 * offline play works with zero connectivity.
 */
import * as THREE from 'three';
import { Avatar } from './player.js';
import { terrainHeight, ARENA_HALF } from './world.js';

const BOT_NAMES = [
  'Vex', 'Nyx', 'Rust', 'Mirage', 'Zephyr', 'Cinder', 'Hex', 'Rogue',
  'Dune', 'Sable', 'Volt', 'Ghost', 'Razor', 'Comet', 'Onyx', 'Flare',
];
const BOT_COLORS = ['#ff2ea6', '#ffb223', '#ff3b52', '#9d4dff', '#26ffd0', '#ff7a3c'];

export class Bot {
  constructor(scene, id, name) {
    this.id = id;
    this.name = name;
    this.color = BOT_COLORS[id % BOT_COLORS.length];
    this.avatar = new Avatar(this.color, false);
    scene.add(this.avatar.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 100;
    this.alive = true;
    this.respawnT = 0;
    this.fireCd = 0;
    this.burst = 0;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeT = 1 + Math.random() * 2;
    this.wander = new THREE.Vector3();
    this.pickWander();
    this.weaponSlot = [0, 0, 3, 3, 1][id % 5];
    this.avatar.setWeapon(this.weaponSlot);
    this.deaths = 0;
    this.kills = 0;
  }

  pickWander() {
    const ang = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * 70;
    this.wander.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
    this.wander.x = THREE.MathUtils.clamp(this.wander.x, -ARENA_HALF + 10, ARENA_HALF - 10);
    this.wander.z = THREE.MathUtils.clamp(this.wander.z, -ARENA_HALF + 10, ARENA_HALF - 10);
  }

  spawnAt(pos, yaw = Math.random() * Math.PI * 2) {
    this.pos.copy(pos);
    this.pos.y = terrainHeight(pos.x, pos.z);
    this.yaw = yaw;
    this.hp = 100;
    this.alive = true;
    this.avatar.revive();
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = yaw;
    this.vel.set(0, 0, 0);
    this.fireCd = 0.6 + Math.random();
    this.pickWander();
  }
}

export class BotManager {
  constructor(scene, world, game, count = 5) {
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.bots = [];
    this.nextId = 9001;
    for (let i = 0; i < count; i++) this.addBot();
  }

  addBot() {
    const bot = new Bot(this.scene, this.nextId++, BOT_NAMES[(this.nextId * 7) % BOT_NAMES.length]);
    this.spawnBot(bot);
    this.bots.push(bot);
    return bot;
  }

  spawnBot(bot) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 80;
    bot.spawnAt(new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist));
  }

  /** bots damage the local player through the same pipeline as net hits */
  update(dt) {
    const game = this.game;
    const player = game.local;
    if (!player) return;

    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.respawnT -= dt;
        if (bot.respawnT <= 0) {
          this.spawnBot(bot);
          game.effects.respawnFlash(bot.pos.clone().setY(bot.pos.y + 1));
        }
        continue;
      }

      // --- target selection: local player if alive & near, else wander ---
      const toPlayer = new THREE.Vector3().subVectors(player.pos, bot.pos);
      const distPlayer = toPlayer.length();
      const hunt = player.hp > 0 && distPlayer < 72;

      let moveTarget;
      let faceTarget;
      if (hunt) {
        faceTarget = player.pos;
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) {
          bot.strafeT = 1.2 + Math.random() * 2.2;
          bot.strafeDir *= -1;
        }
        const toward = toPlayer.clone().normalize();
        const strafe = new THREE.Vector3(-toward.z, 0, toward.x).multiplyScalar(bot.strafeDir * Math.min(18, distPlayer * 0.42));
        const keepDist = distPlayer > 26 ? 12 : distPlayer < 12 ? -10 : 0;
        moveTarget = player.pos.clone().addScaledVector(toward, keepDist).add(strafe);
      } else {
        moveTarget = bot.wander;
        faceTarget = bot.wander;
        if (bot.pos.distanceTo(bot.wander) < 4) bot.pickWander();
      }

      // --- movement ---
      const dir = new THREE.Vector3().subVectors(moveTarget, bot.pos);
      dir.y = 0;
      const dist = dir.length();
      if (dist > 0.7) {
        dir.normalize();
        const speed = hunt ? 7.2 : 5.2;
        bot.pos.addScaledVector(dir, speed * dt);
      }
      const fixed = this.world.collide(bot.pos.x, bot.pos.z, 0.6);
      bot.pos.x = fixed.x;
      bot.pos.z = fixed.z;
      bot.pos.y = terrainHeight(bot.pos.x, bot.pos.z);

      // --- facing ---
      const flat = new THREE.Vector3().subVectors(faceTarget, bot.pos);
      const targetYaw = Math.atan2(flat.x, flat.z);
      let dy = targetYaw - bot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.yaw += dy * Math.min(1, dt * 6);

      bot.avatar.root.position.copy(bot.pos);
      bot.avatar.root.rotation.y = bot.yaw;

      const aimPitch = hunt
        ? THREE.MathUtils.clamp(Math.atan2(player.pos.y + 1.4 - (bot.pos.y + 1.5), distPlayer), -0.7, 0.7)
        : 0;

      bot.avatar.update(dt, {
        speed: dist > 0.7 ? (hunt ? 7 : 5) : 0,
        moving: dist > 0.7,
        aimPitch,
        grounded: true,
        dead: false,
      });

      // --- combat ---
      bot.fireCd -= dt;
      if (hunt && bot.fireCd <= 0) {
        const facing = Math.abs(dy) < 0.42;
        if (facing) {
          this.botShoot(bot, distPlayer);
          const slot = bot.weaponSlot;
          bot.fireCd = slot === 1 ? 1.9 + Math.random() * 1.2 : slot === 3 ? 0.14 + Math.random() * 0.1 : 0.32 + Math.random() * 0.22;
        } else {
          bot.fireCd = 0.15;
        }
      }
    }
  }

  botShoot(bot, dist) {
    const game = this.game;
    const player = game.local;
    const from = bot.pos.clone().add(new THREE.Vector3(0, 1.55, 0));

    // aim at player chest with skill-based error
    const to = player.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    const err = Math.min(0.5, 0.055 + dist * 0.0026);
    to.x += (Math.random() - 0.5) * err * dist * 0.32;
    to.y += (Math.random() - 0.5) * err * dist * 0.22;
    to.z += (Math.random() - 0.5) * err * dist * 0.32;

    const dir = to.clone().sub(from).normalize();
    const color = bot.weaponSlot === 1 ? '#c79bff' : bot.weaponSlot === 3 ? '#ffd27a' : '#23e6ff';
    const end = from.clone().addScaledVector(dir, dist + 12);
    game.effects.tracer(from, end, color, 0.05);
    game.effects.muzzleFlash(from, color, 0.9);
    game.audio.play(bot.weaponSlot === 1 ? 'sniper' : bot.weaponSlot === 3 ? 'mg' : 'ak');

    // geometric hit test vs local player capsule
    const hit = rayHitsCapsule(from, dir, player.pos, 0.62, 2.15);
    if (hit) {
      const dmg = bot.weaponSlot === 1 ? 26 : bot.weaponSlot === 3 ? 6 : 8;
      game.damageLocalPlayer(dmg, bot.name, bot.weaponSlot);
    }
  }

  /** damage a bot (from local player weapon); returns true if killed */
  damage(bot, dmg, fromName = 'YOU') {
    if (!bot.alive) return false;
    bot.hp -= dmg;
    gameSafe(this.game, bot);
    if (bot.hp <= 0) {
      bot.alive = false;
      bot.hp = 0;
      bot.deaths += 1;
      bot.respawnT = 3;
      bot.avatar.kill();
      return true;
    }
    return false;
  }

  get(id) {
    return this.bots.find((b) => b.id === id) || null;
  }

  dispose() {
    for (const bot of this.bots) this.scene.remove(bot.avatar.root);
    this.bots.length = 0;
  }
}

function gameSafe(game, bot) {
  game.effects.hitFlash(bot.pos.clone().setY(bot.pos.y + 1.4), '#ff2ea6');
}

/**
 * Ray vs vertical capsule (segment from pos.y+0.1 to pos.y+h, radius r).
 * Returns true on hit.
 */
export function rayHitsCapsule(origin, dir, feetPos, r, h) {
  // head sphere
  const head = new THREE.Vector3(feetPos.x, feetPos.y + h - 0.18, feetPos.z);
  const bodyTop = feetPos.y + h - 0.35;
  const bodyBottom = feetPos.y + 0.35;

  // sphere test (head)
  const oc = new THREE.Vector3().subVectors(head, origin);
  const tca = oc.dot(dir);
  if (tca > 0) {
    const d2 = oc.lengthSq() - tca * tca;
    const hr = 0.34;
    if (d2 < hr * hr) return true;
  }

  // infinite cylinder about Y axis at (feetPos.x, feetPos.z)
  const ox = origin.x - feetPos.x;
  const oz = origin.z - feetPos.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-6) return false;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  for (const t of [t0, t1]) {
    if (t < 0) continue;
    const y = origin.y + dir.y * t;
    if (y >= bodyBottom && y <= bodyTop + 0.3) return true;
  }
  return false;
}
