/**
 * Crossroads — Future Desert · core game runtime
 * Third-person shooter: movement, camera, weapons, projectiles,
 * grenades, bots (offline) and networked players (online).
 */
import * as THREE from 'three';
import { World, terrainHeight, ARENA_HALF } from './world.js';
import { Effects, makeGlowSprite } from './effects.js';
import { Avatar } from './player.js';
import { WEAPONS, WeaponState } from './weapons.js';
import { BotManager } from './bots.js';
import * as audio from './audio.js';

const GRAVITY = 24;
const JUMP_SPEED = 9.2;
const WALK_SPEED = 8.4;
const SPRINT_MULT = 1.38;
const PLAYER_RADIUS = 0.62;
const HEAD_Y = 1.78;
const KILLS_TO_WIN = 20;
const NET_SEND_RATE = 1 / 12;

const REMOTE_COLORS = ['#ff2ea6', '#ffb223', '#26ffd0', '#9d4dff', '#ff7a3c', '#3dff9e'];

function rayCapsuleT(origin, dir, feetPos, r, h) {
  let best = Infinity;
  const head = new THREE.Vector3(feetPos.x, feetPos.y + HEAD_Y, feetPos.z);
  const oc = new THREE.Vector3().subVectors(head, origin);
  const tca = oc.dot(dir);
  if (tca > 0) {
    const d2 = oc.lengthSq() - tca * tca;
    const hr = 0.38;
    if (d2 < hr * hr) best = Math.min(best, tca - Math.sqrt(Math.max(0, hr * hr - d2)));
  }
  const ox = origin.x - feetPos.x;
  const oz = origin.z - feetPos.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a > 1e-6) {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0) continue;
        const y = origin.y + dir.y * t;
        if (y >= feetPos.y + 0.25 && y <= feetPos.y + HEAD_Y + 0.35) best = Math.min(best, t);
      }
    }
  }
  return best;
}

function rayCylinderT(origin, dir, cx, cz, r, y0, y1) {
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-6) return Infinity;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let best = Infinity;
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const y = origin.y + dir.y * t;
    if (y >= y0 && y <= y1) best = Math.min(best, t);
  }
  return best;
}

function rayGroundT(origin, dir, maxT) {
  let t = 1;
  let guard = 0;
  while (t < maxT && guard++ < 220) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    const gy = terrainHeight(x, z);
    if (y <= gy) return t;
    t += Math.max(0.9, (y - gy) * 0.45);
  }
  return Infinity;
}

class LocalPlayer {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 30);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = -0.08;
    this.hp = 100;
    this.maxHp = 100;
    this.grounded = true;
    this.dead = false;
    this.speed = 0;
    this.weapon = new WeaponState();
    this.recoil = 0;
    this.ads = false;
    this.respawnT = 0;
  }
}

export class Game {
  /**
   * @param {object} opts
   *   canvas, input, network, ui, settings
   */
  constructor({ canvas, input, network, ui, settings }) {
    this.canvas = canvas;
    this.input = input;
    this.network = network;
    this.ui = ui;
    this.settings = settings;
    this.audio = audio;

    // --- renderer ---------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.quality >= 0.75,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality >= 1 ? 2 : settings.quality >= 0.75 ? 1.5 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 900);
    this.camera.position.set(0, 12, 40);

    this.effects = new Effects(this.scene);
    this.world = new World(this.scene);

    this.local = new LocalPlayer();
    this.localAvatar = new Avatar('#23e6ff', true);
    this.scene.add(this.localAvatar.root);

    this.remotes = new Map(); // id -> remote
    this.bolts = []; // plasma projectiles
    this.grenades = [];
    this.botManager = null;

    this.mode = 'practice';
    this.running = false;
    this.elapsed = 0;
    this._netTimer = 0;
    this._fireWasDown = false;
    this._camDist = 4.6;
    this._fovCurrent = 75;
    this._endShown = false;
    this._scoreRows = [];
    this._localKills = 0;
    this._localDeaths = 0;
    this._composer = null;
    this._bloomReady = false;
    this._bloomWanted = !!settings.bloom;
    this._bloomLoading = false;
    this._fovTarget = 75;
    this._fovCurrent = 75;

    this._bindNet();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._last = performance.now();
    this._raf = null;
  }

  // =====================================================================
  // lifecycle
  // =====================================================================
  /**
   * @param {'practice'|'online'} mode
   * @param {object} [welcome] server welcome payload (online only)
   */
  start(mode, welcome = null) {
    this.mode = mode;
    this.running = true;
    this._endShown = false;
    this._localKills = 0;
    this._localDeaths = 0;
    this.local.hp = this.local.maxHp;
    this.local.dead = false;
    this.local.weapon.refill();
    this.localAvatar.revive();

    if (mode === 'practice') {
      this.local.pos.set(0, terrainHeight(0, 30), 30);
      this.local.yaw = Math.PI;
      this.botManager = new BotManager(this.scene, this.world, this, 5);
      this.ui.setRoom('PRACTICE — OFFLINE');
    } else {
      if (welcome) {
        if (welcome.spawn) {
          this.local.pos.fromArray(welcome.spawn);
          this.local.pos.y = terrainHeight(this.local.pos.x, this.local.pos.z);
        }
        this.ui.setRoom(`ROOM ${welcome.room?.code || '—'}`);
        for (const p of welcome.room?.players || []) {
          if (p.id !== welcome.id) this._addRemote(p);
        }
      } else {
        this.local.pos.set(0, terrainHeight(0, 0), 0);
        this.ui.setRoom(`ROOM ${this.network.roomCode || '—'}`);
      }
    }

    this.ui.setHealth(this.local.hp, this.local.maxHp);
    this.ui.hideDeath();
    this.ui.hideEnd();
    this.localAvatar.setWeapon(this.local.weapon.slot);
    this.ui.setWeapon(WEAPONS[this.local.weapon.slot].name, this.local.weapon.slot);
    this.ui.setAmmo(this.local.weapon.def.magSize, '∞');
    this.ui.setScore(0, 0);

    this._last = performance.now();
    cancelAnimationFrame(this._raf);
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this._frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.botManager?.dispose();
    this.botManager = null;
    for (const r of this.remotes.values()) this.scene.remove(r.avatar.root);
    this.remotes.clear();
    for (const b of this.bolts) this.scene.remove(b.mesh);
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.bolts.length = 0;
    this.grenades.length = 0;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._composer?.setSize(w, h);
  }

  /** optional emissive bloom — degrades gracefully if modules fail to load */
  setBloom(on) {
    this._bloomWanted = !!on;
    if (on) this._ensureBloom();
    if (this._composer) this._bloomReady = !!on;
  }

  async _ensureBloom() {
    if (this._composer || this._bloomLoading) return;
    this._bloomLoading = true;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('/vendor/examples/jsm/postprocessing/EffectComposer.js'),
        import('/vendor/examples/jsm/postprocessing/RenderPass.js'),
        import('/vendor/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('/vendor/examples/jsm/postprocessing/OutputPass.js'),
      ]);
      const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(size, 0.52, 0.62, 0.72));
      composer.addPass(new OutputPass());
      composer.setSize(window.innerWidth, window.innerHeight);
      this._composer = composer;
      this._bloomReady = this._bloomWanted;
    } catch (err) {
      console.warn('bloom unavailable:', err);
      this._composer = null;
      this._bloomReady = false;
    } finally {
      this._bloomLoading = false;
    }
  }

  // =====================================================================
  // network wiring
  // =====================================================================
  _bindNet() {
    const net = this.network;

    net.on('join', (msg) => {
      if (this.mode !== 'online') return;
      this._addRemote(msg.player);
      this.ui.toast(`${msg.player.name} JOINED`);
    });

    net.on('leave', (msg) => {
      const r = this.remotes.get(msg.id);
      if (!r) return;
      this.scene.remove(r.avatar.root);
      this.remotes.delete(msg.id);
      this.ui.toast(`${r.name} LEFT`);
    });

    net.on('state', (msg) => {
      const r = this.remotes.get(msg.id);
      if (!r) return;
      if (r.lastState < 0) {
        r.pos.set(msg.p[0], msg.p[1], msg.p[2]);
        r.avatar.root.visible = true;
      }
      r.targetPos.set(msg.p[0], msg.p[1], msg.p[2]);
      r.targetYaw = msg.ry;
      r.targetPitch = msg.rx;
      r.targetWeapon = msg.w;
      r.targetSpeed = msg.mv;
      r.grounded = !!msg.gr;
      r.lastState = this.elapsed;
    });

    net.on('fire', (msg) => {
      const r = this.remotes.get(msg.id);
      if (!r || !msg.o || !msg.d) return;
      const from = new THREE.Vector3().fromArray(msg.o);
      const dir = new THREE.Vector3().fromArray(msg.d).normalize();
      const def = WEAPONS[msg.w] || WEAPONS[0];
      if (def.kind === 'projectile') {
        this._spawnBolt(from, dir.clone().multiplyScalar(def.boltSpeed || 90), msg.w, false);
      } else {
        const end = from.clone().addScaledVector(dir, 120);
        this.effects.tracer(from, end, def.tracer, 0.055);
        this.effects.muzzleFlash(from, def.color, 1);
        this.audio.play(def.sfx);
      }
    });

    net.on('nade', (msg) => {
      if (!msg.o || !msg.v) return;
      this._spawnGrenade(new THREE.Vector3().fromArray(msg.o), new THREE.Vector3().fromArray(msg.v), false);
    });

    net.on('hp', (msg) => {
      if (msg.id === net.playerId) {
        this.local.hp = msg.hp;
        this.ui.setHealth(msg.hp, this.local.maxHp);
        if (msg.hp > 0) {
          this.ui.damageFlash();
          this.audio.play('hurt');
        }
      } else {
        const r = this.remotes.get(msg.id);
        if (r) {
          r.hp = msg.hp;
          if (msg.hp > 0) {
            this.effects.hitFlash(r.avatar.root.position.clone().setY(r.avatar.root.position.y + 1.4));
            this.audio.play(msg.head ? 'headshot' : 'hit');
          }
        }
      }
    });

    net.on('kill', (msg) => {
      const kName = msg.killer === net.playerId ? 'YOU' : this.remotes.get(msg.killer)?.name || '???';
      const vName = msg.victim === net.playerId ? 'YOU' : this.remotes.get(msg.victim)?.name || '???';
      this.ui.killFeed(kName, vName, WEAPONS[msg.w]?.short || '?', msg.head);
      if (msg.killer === net.playerId) {
        this._localKills += 1;
        this.audio.play('kill');
      }
      if (msg.victim === net.playerId) {
        this._localDeaths += 1;
        this._enterDeath(kName);
      } else {
        const r = this.remotes.get(msg.victim);
        if (r) r.avatar.kill();
      }
      this.ui.setScore(this._localKills, this._localDeaths);
    });

    net.on('respawn', (msg) => {
      if (msg.id === net.playerId) {
        this.local.hp = msg.hp;
        this.local.pos.fromArray(msg.spawn);
        this.local.pos.y = terrainHeight(this.local.pos.x, this.local.pos.z);
        this.local.dead = false;
        this.localAvatar.revive();
        this.local.weapon.refill();
        this.ui.hideDeath();
        this.ui.setHealth(msg.hp, this.local.maxHp);
        this.effects.respawnFlash(this.local.pos.clone().setY(this.local.pos.y + 1));
      } else {
        const r = this.remotes.get(msg.id);
        if (r) {
          r.hp = msg.hp;
          r.alive = true;
          r.avatar.revive();
          r.targetPos.fromArray(msg.spawn);
          r.targetPos.y = terrainHeight(r.targetPos.x, r.targetPos.z);
          this.effects.respawnFlash(r.targetPos.clone().setY(r.targetPos.y + 1));
        }
      }
    });

    net.on('scores', (msg) => {
      this._scoreRows = msg.players || [];
      this.ui.scoreboard(this._scoreRows.map((p) => ({
        name: p.name + (p.id === net.playerId ? ' (YOU)' : ''),
        k: p.kills,
        d: p.deaths,
        hp: p.hp,
        me: p.id === net.playerId,
      })));
      const leader = this._scoreRows.reduce((a, b) => (b.kills > (a?.kills ?? -1) ? b : a), null);
      if (leader && leader.kills >= KILLS_TO_WIN && !this._endShown) {
        this._endShown = true;
        const won = leader.id === net.playerId;
        this.ui.showEnd(won ? 'VICTORY' : 'DEFEAT', `${leader.name} REACHED ${KILLS_TO_WIN} KILLS`);
      }
    });

    net.on('error', (msg) => this.ui.toast(msg.msg || 'NETWORK ERROR'));
    net.on('status', (msg) => {
      if (!msg.connected && this.mode === 'online' && !this._endShown) {
        this.ui.toast('CONNECTION LOST — RECONNECTING…');
      }
    });
  }

  _addRemote(p) {
    if (this.remotes.has(p.id)) return;
    const color = REMOTE_COLORS[p.id % REMOTE_COLORS.length];
    const avatar = new Avatar(color, false);
    avatar.setWeapon(0);
    avatar.root.visible = false; // shown once first state arrives
    this.scene.add(avatar.root);
    this.remotes.set(p.id, {
      id: p.id,
      name: p.name,
      avatar,
      pos: new THREE.Vector3(),
      targetPos: new THREE.Vector3(),
      targetYaw: 0,
      targetPitch: 0,
      targetWeapon: 0,
      targetSpeed: 0,
      grounded: true,
      hp: p.hp ?? 100,
      alive: p.alive !== false,
      lastState: -999,
    });
  }

  // =====================================================================
  // damage entry points
  // =====================================================================
  damageLocalPlayer(dmg, fromName, weaponSlot) {
    if (this.local.dead || this.mode !== 'practice') return;
    this.local.hp = Math.max(0, this.local.hp - dmg);
    this.ui.setHealth(this.local.hp, this.local.maxHp);
    this.ui.damageFlash();
    this.audio.play('hurt');
    if (this.local.hp <= 0) {
      this._localDeaths += 1;
      this.ui.setScore(this._localKills, this._localDeaths);
      this._enterDeath(fromName);
      // credit the bot
      const bot = this.botManager?.bots.find((b) => b.name === fromName);
      if (bot) bot.kills += 1;
    }
  }

  _enterDeath(byName) {
    this.local.dead = true;
    this.local.respawnT = 3;
    this.localAvatar.kill();
    this.audio.play('death');
    this.ui.showDeath(byName);
    this.ui.setRespawnCount(3);
  }

  _respawnLocal() {
    const ang = Math.random() * Math.PI * 2;
    const dist = 25 + Math.random() * 85;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    this.local.pos.set(x, terrainHeight(x, z), z);
    this.local.vel.set(0, 0, 0);
    this.local.hp = this.local.maxHp;
    this.local.dead = false;
    this.local.weapon.refill();
    this.localAvatar.revive();
    this.ui.hideDeath();
    this.ui.setHealth(this.local.hp, this.local.maxHp);
    this.effects.respawnFlash(this.local.pos.clone().setY(this.local.pos.y + 1));
  }

  // =====================================================================
  // per-frame
  // =====================================================================
  _frame() {
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;

    const input = this.input;
    input.update();

    this._updateLocal(dt);
    this._updateCamera(dt);
    this._updateRemotes(dt);
    this._updateBolts(dt);
    this._updateGrenades(dt);
    this._updateDeath(dt);

    this.botManager?.update(dt);
    this.effects.update(dt);
    this.world.update(dt, this.elapsed);

    this._netTimer += dt;
    if (this._netTimer >= NET_SEND_RATE) {
      this._netTimer = 0;
      this._sendState();
    }

    this.ui.setPing(this.mode === 'online' ? this.network.ping : null);

    if (this._composer && this._bloomReady) this._composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- local
  _updateLocal(dt) {
    const local = this.local;
    const input = this.input;

    if (local.dead) {
      input.fireDown = false;
      local.weapon.update(dt);
      // keep the death-fall animation playing
      this.localAvatar.root.position.copy(local.pos);
      this.localAvatar.root.rotation.y = local.yaw;
      this.localAvatar.update(dt, { speed: 0, moving: false, aimPitch: 0, grounded: true, dead: true });
      return;
    }

    // look
    const look = input.consumeLook();
    local.yaw += look.dx;
    local.pitch = THREE.MathUtils.clamp(local.pitch + look.dy, -1.25, 1.25);
    local.recoil *= Math.exp(-dt * 8);

    // ads
    const def = local.weapon.def;
    local.ads = input.adsDown && def.kind !== 'grenade';

    // move
    const move = input.move;
    const speedBase = WALK_SPEED * def.moveMult * (input.sprintDown && !local.ads ? SPRINT_MULT : 1) * (local.ads ? 0.62 : 1);
    const sinY = Math.sin(local.yaw);
    const cosY = Math.cos(local.yaw);
    const wishX = move.x * cosY - move.y * sinY;
    const wishZ = -move.x * sinY - move.y * cosY; // forward is -z in yaw space
    const wishLen = Math.hypot(wishX, wishZ);

    const accel = local.grounded ? 14 : 5;
    if (wishLen > 0.01) {
      local.vel.x = THREE.MathUtils.lerp(local.vel.x, (wishX / wishLen) * speedBase, Math.min(1, dt * accel));
      local.vel.z = THREE.MathUtils.lerp(local.vel.z, (wishZ / wishLen) * speedBase, Math.min(1, dt * accel));
    } else {
      local.vel.x = THREE.MathUtils.lerp(local.vel.x, 0, Math.min(1, dt * (local.grounded ? 12 : 1.4)));
      local.vel.z = THREE.MathUtils.lerp(local.vel.z, 0, Math.min(1, dt * (local.grounded ? 12 : 1.4)));
    }

    if (input.consumeJump() && local.grounded) {
      local.vel.y = JUMP_SPEED;
      local.grounded = false;
      this.audio.play('jump');
    }

    local.vel.y -= GRAVITY * dt;

    local.pos.x += local.vel.x * dt;
    local.pos.z += local.vel.z * dt;
    const fixed = this.world.collide(local.pos.x, local.pos.z, PLAYER_RADIUS);
    local.pos.x = fixed.x;
    local.pos.z = fixed.z;

    local.pos.y += local.vel.y * dt;
    const groundY = terrainHeight(local.pos.x, local.pos.z);
    if (local.pos.y <= groundY) {
      local.pos.y = groundY;
      local.vel.y = 0;
      local.grounded = true;
    } else {
      local.grounded = false;
    }
    if (local.pos.y < groundY - 4) local.pos.y = groundY; // never sink

    local.speed = Math.hypot(local.vel.x, local.vel.z);

    // weapons ---------------------------------------------------------------
    local.weapon.update(dt);

    const slot = input.consumeWeaponSlot();
    if (slot >= 0 && local.weapon.setSlot(slot)) {
      this.localAvatar.setWeapon(slot);
      this.ui.setWeapon(WEAPONS[slot].name, slot);
      this.ui.setAmmo(local.weapon.ammo[slot], '∞');
      this.audio.play('ui');
    }

    if (input.consumeReload()) {
      if (local.weapon.startReload()) this.audio.play('reload');
    }

    // grenade throw (dedicated button works from any weapon)
    if (input.consumeNade()) this._throwGrenade();

    // firing
    const firePressed = input.fireDown && !this._fireWasDown;
    this._fireWasDown = input.fireDown;

    if (local.weapon.reloadLeft <= 0 && local.weapon.cooldown <= 0 && input.fireDown) {
      const w = local.weapon.def;
      const wantFire = w.kind === 'grenade' ? firePressed : w.auto || firePressed;
      if (wantFire) {
        if (local.weapon.ammo[local.weapon.slot] > 0) {
          this._fireWeapon();
        } else if (firePressed) {
          this.audio.play('empty');
          local.weapon.startReload() && this.audio.play('reload');
        }
      }
    }

    // avatar
    this.localAvatar.setWeapon(local.weapon.slot);
    this.localAvatar.root.position.copy(local.pos);
    this.localAvatar.root.rotation.y = local.yaw;
    this.localAvatar.update(dt, {
      speed: local.speed,
      moving: local.speed > 0.6,
      aimPitch: local.pitch,
      grounded: local.grounded,
      dead: local.dead,
    });

    // HUD
    const curDef = local.weapon.def;
    this.ui.setAmmo(
      local.weapon.ammo[local.weapon.slot],
      local.weapon.reloadLeft > 0 ? '…' : '∞',
      local.weapon.reloadLeft > 0
    );
    const spread = (local.ads ? curDef.adsSpread : curDef.spread) * (local.speed > 3 ? 1.7 : 1) * (local.grounded ? 1 : 1.5);
    this.ui.setSpread(Math.min(2.2, 0.7 + spread * 55));
    this.ui.setAds(local.ads);
    this._fovTarget = 75 / (local.ads ? curDef.zoom : 1);
  }

  // ---------------------------------------------------------------- camera
  _updateCamera(dt) {
    const local = this.local;

    // smooth FOV (ADS zoom)
    const targetFov = this._fovTarget ?? 75;
    this._fovCurrent = THREE.MathUtils.lerp(this._fovCurrent, targetFov, Math.min(1, dt * 11));
    if (Math.abs(this.camera.fov - this._fovCurrent) > 0.02) {
      this.camera.fov = this._fovCurrent;
      this.camera.updateProjectionMatrix();
    }

    // third-person orbit rig
    const head = local.pos.clone().add(new THREE.Vector3(0, 1.72, 0));
    const dist = local.ads ? (local.weapon.def.id === 1 ? 1.3 : 1.85) : 4.7;
    this._camDist = THREE.MathUtils.lerp(this._camDist, dist, Math.min(1, dt * 9));

    const pitch = local.pitch + local.recoil * 2.2;
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    const sinY = Math.sin(local.yaw);
    const cosY = Math.cos(local.yaw);

    const fwd = new THREE.Vector3(-sinY * cosP, sinP, -cosY * cosP);
    const right = new THREE.Vector3(cosY, 0, -sinY);

    const side = local.ads ? 0.62 : 0.38;
    const up = local.ads ? 0.28 : 0.6;

    const camPos = head
      .clone()
      .addScaledVector(fwd, -this._camDist)
      .addScaledVector(right, side)
      .add(new THREE.Vector3(0, up, 0));

    // never dip below the dunes
    const minY = terrainHeight(camPos.x, camPos.z) + 0.55;
    if (camPos.y < minY) camPos.y = minY;

    // explosion shake
    const shake = this.effects.quakes * 0.38;
    if (shake > 0.001) {
      camPos.x += (Math.random() - 0.5) * shake;
      camPos.y += (Math.random() - 0.5) * shake;
      camPos.z += (Math.random() - 0.5) * shake;
    }

    this.camera.position.copy(camPos);
    this.camera.lookAt(head.clone().addScaledVector(fwd, 24));
  }

  _fireWeapon() {
    const local = this.local;
    const def = local.weapon.def;

    if (def.kind === 'grenade') {
      this._throwGrenade();
      return;
    }

    // muzzle world position + camera direction
    const muzzle = new THREE.Vector3();
    this.localAvatar.muzzle.getWorldPosition(muzzle);
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    local.weapon.fire();
    this.audio.play(def.sfx);

    const spread =
      (local.ads ? def.adsSpread : def.spread) *
      (local.speed > 3 ? 1.7 : 1) *
      (local.grounded ? 1 : 1.5) *
      (1 + local.recoil * 12);

    // recoil kick
    local.recoil = Math.min(0.06, local.recoil + (def.kind === 'hitscan' ? 0.008 : 0.004));
    local.pitch = Math.min(1.25, local.pitch + (def.id === 1 ? 0.022 : def.id === 3 ? 0.006 : 0.011));

    const dir = camDir.clone();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    if (def.kind === 'projectile') {
      this._spawnBolt(muzzle.clone().addScaledVector(dir, 0.6), dir.clone().multiplyScalar(def.boltSpeed), def.id, true);
      this.effects.muzzleFlash(muzzle, def.color, 1.3);
      this.network.send({ t: 'fire', w: def.id, o: [muzzle.x, muzzle.y, muzzle.z], d: [dir.x, dir.y, dir.z] });
      return;
    }

    // hitscan: resolve first so the tracer ends at the real impact point
    const result = this._hitscan(dir, def.range || 200);
    const end = result ? result.point : this.camera.position.clone().addScaledVector(dir, def.range || 200);
    this.effects.muzzleFlash(muzzle, def.color, 1.1);
    this.effects.tracer(muzzle, end, def.tracer, 0.055);
    this.network.send({ t: 'fire', w: def.id, o: [muzzle.x, muzzle.y, muzzle.z], d: [dir.x, dir.y, dir.z] });
    if (result) {
      if (result.type === 'player') {
        const head = result.head;
        const dmg = def.damage * (head ? (def.headBonus || 2) : 1);
        if (this.mode === 'online') {
          this.network.send({ t: 'hit', target: result.id, dmg, w: def.id, head });
          this.effects.hitFlash(result.point, head ? '#ffe08a' : '#ff2ea6');
          this.audio.play(head ? 'headshot' : 'hit');
        } else {
          const bot = this.botManager?.get(result.id);
          if (bot) {
            const killed = this.botManager.damage(bot, dmg, 'YOU');
            this.effects.hitFlash(result.point, head ? '#ffe08a' : '#ff2ea6');
            this.audio.play(head ? 'headshot' : 'hit');
            if (killed) {
              this._localKills += 1;
              this.ui.setScore(this._localKills, this._localDeaths);
              this.ui.killFeed('YOU', bot.name, def.short, head);
              this.audio.play('kill');
              this._checkPracticeWin();
            }
          }
        }
      } else {
        this.effects.impact(result.point, result.normal || new THREE.Vector3(0, 1, 0), def.tracer, 7);
      }
    }
  }

  /** resolve a shot: players/bots first, then props, then ground */
  _hitscan(dir, range) {
    const origin = this.camera.position.clone();
    let bestT = range;
    let hit = null;

    // remote players (online)
    for (const r of this.remotes.values()) {
      if (!r.alive && r.hp <= 0) continue;
      const t = rayCapsuleT(origin, dir, r.pos, PLAYER_RADIUS, 2.15);
      if (t < bestT) {
        bestT = t;
        hit = {
          type: 'player',
          id: r.id,
          head: origin.y + dir.y * t > r.pos.y + HEAD_Y - 0.25,
          point: origin.clone().addScaledVector(dir, t),
        };
      }
    }

    // bots (practice)
    if (this.botManager) {
      for (const b of this.botManager.bots) {
        if (!b.alive) continue;
        const t = rayCapsuleT(origin, dir, b.pos, PLAYER_RADIUS, 2.15);
        if (t < bestT) {
          bestT = t;
          hit = {
            type: 'player',
            id: b.id,
            head: origin.y + dir.y * t > b.pos.y + HEAD_Y - 0.25,
            point: origin.clone().addScaledVector(dir, t),
          };
        }
      }
    }

    // cover props
    for (const c of this.world.colliders) {
      const y0 = terrainHeight(c.x, c.z) - 1;
      const t = rayCylinderT(origin, dir, c.x, c.z, c.r, y0, y0 + 9);
      if (t < bestT) {
        bestT = t;
        hit = {
          type: 'world',
          point: origin.clone().addScaledVector(dir, t),
          normal: new THREE.Vector3(origin.x - c.x, 0.4, origin.z - c.z).normalize(),
        };
      }
    }

    // ground
    const tg = rayGroundT(origin, dir, range);
    if (tg < bestT) {
      const point = origin.clone().addScaledVector(dir, tg);
      hit = {
        type: 'world',
        point,
        normal: new THREE.Vector3(0, 1, 0),
      };
    }
    return hit;
  }

  // ------------------------------------------------------------ grenades
  _throwGrenade() {
    const local = this.local;
    // grenades live in weapon slot 4 ammo
    if (local.weapon.ammo[4] <= 0) {
      // if currently holding slot 4 this is natural; otherwise silently fail
      if (local.weapon.slot === 4) this.audio.play('empty');
      return;
    }
    local.weapon.ammo[4] -= 1;
    if (local.weapon.slot === 4) {
      local.weapon.cooldown = 60 / local.weapon.def.rpm;
      if (local.weapon.ammo[4] <= 0) local.weapon.startReload() && this.audio.play('reload');
    }
    this.audio.play('ui');

    const muzzle = new THREE.Vector3();
    this.localAvatar.muzzle.getWorldPosition(muzzle);
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const vel = camDir.clone().multiplyScalar(26).add(new THREE.Vector3(0, 5.2, 0));
    this._spawnGrenade(muzzle.clone().addScaledVector(camDir, 1), vel, true);
    this.network.send({ t: 'nade', o: [muzzle.x, muzzle.y, muzzle.z], v: [vel.x, vel.y, vel.z] });
    if (local.weapon.slot !== 4) this.ui.setAmmo(local.weapon.ammo[local.weapon.slot], '∞');
    else this.ui.setAmmo(local.weapon.ammo[4], '∞');
  }

  _spawnGrenade(pos, vel, isMine) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1a1430,
        emissive: new THREE.Color('#ff2ea6'),
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.6,
      })
    );
    const glow = makeGlowSprite('#ff2ea6', 1.1, 0.8);
    group.add(body, glow);
    group.position.copy(pos);
    this.scene.add(group);
    this.grenades.push({ mesh: group, vel: vel.clone(), fuse: 2.15, isMine, trailT: 0 });
  }

  _updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * 0.92 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);

      const groundY = terrainHeight(g.mesh.position.x, g.mesh.position.z) + 0.22;
      if (g.mesh.position.y < groundY) {
        g.mesh.position.y = groundY;
        g.vel.y = Math.abs(g.vel.y) * 0.42;
        g.vel.x *= 0.72;
        g.vel.z *= 0.72;
        if (Math.abs(g.vel.y) < 1.2) g.vel.y = 0;
      }
      const fixed = this.world.collide(g.mesh.position.x, g.mesh.position.z, 0.3);
      g.mesh.position.x = fixed.x;
      g.mesh.position.z = fixed.z;

      g.trailT -= dt;
      if (g.trailT <= 0) {
        g.trailT = 0.05;
        this.effects.nadeTrail(g.mesh.position, '#ff2ea6');
      }

      if (g.fuse <= 0) {
        this._explode(g);
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  _explode(g) {
    const pos = g.mesh.position.clone();
    const radius = WEAPONS[4].blastRadius;
    this.effects.explosion(pos, radius, '#ff8c1a');
    this.audio.play('explosion');

    const damageAt = (feet, isLocal, isBot, isRemote, id) => {
      const center = feet.clone().setY(feet.y + 1.1);
      const d = center.distanceTo(pos);
      if (d > radius) return;
      const dmg = Math.round(WEAPONS[4].damage * (1 - d / radius) ** 1.2);
      if (dmg < 4) return;
      if (isLocal) {
        this.damageLocalPlayer(dmg, 'GRENADE', 4);
      } else if (isBot) {
        const bot = this.botManager?.get(id);
        if (bot && g.isMine) {
          const killed = this.botManager.damage(bot, dmg, 'YOU');
          if (killed && g.isMine) {
            this._localKills += 1;
            this.ui.setScore(this._localKills, this._localDeaths);
            this.ui.killFeed('YOU', bot.name, 'NADE', false);
            this.audio.play('kill');
            this._checkPracticeWin();
          }
        }
      } else if (isRemote && g.isMine && this.mode === 'online') {
        this.network.send({ t: 'hit', target: id, dmg, w: 4, head: false });
      }
    };

    if (!this.local.dead) damageAt(this.local.pos, true, false, false, -1);
    if (this.botManager) {
      for (const b of this.botManager.bots) {
        if (b.alive) damageAt(b.pos, false, true, false, b.id);
      }
    }
    for (const r of this.remotes.values()) {
      if (r.hp > 0) damageAt(r.pos, false, false, true, r.id);
    }
  }

  // --------------------------------------------------------------- bolts
  _spawnBolt(pos, vel, weaponId, isMine) {
    const def = WEAPONS[weaponId] || WEAPONS[2];
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const glow = makeGlowSprite(def.color, 1.7, 0.9);
    group.add(core, glow);
    group.position.copy(pos);
    this.scene.add(group);
    this.bolts.push({ mesh: group, vel: vel.clone(), life: 2.2, isMine, dmg: def.damage });
  }

  _updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length();
      b.mesh.position.add(step);

      let dead = b.life <= 0;

      // vs ground / props
      const gy = terrainHeight(b.mesh.position.x, b.mesh.position.z);
      if (b.mesh.position.y <= gy + 0.18) {
        this.effects.impact(b.mesh.position.clone(), new THREE.Vector3(0, 1, 0), '#26ffd0', 6);
        dead = true;
      }
      if (!dead) {
        for (const c of this.world.colliders) {
          const dx = b.mesh.position.x - c.x;
          const dz = b.mesh.position.z - c.z;
          if (dx * dx + dz * dz < (c.r + 0.2) ** 2 && b.mesh.position.y < terrainHeight(c.x, c.z) + 8) {
            this.effects.impact(b.mesh.position.clone(), new THREE.Vector3(dx, 0.5, dz).normalize(), '#26ffd0', 5);
            dead = true;
            break;
          }
        }
      }

      // vs players
      if (!dead && b.isMine) {
        for (const r of this.remotes.values()) {
          if (r.hp <= 0) continue;
          const hitT = rayCapsuleT(b.mesh.position.clone().sub(step), step.clone().normalize(), r.pos, PLAYER_RADIUS, 2.15);
          if (hitT <= len + 0.3) {
            if (this.mode === 'online') {
              this.network.send({ t: 'hit', target: r.id, dmg: b.dmg, w: 2, head: false });
            }
            this.effects.hitFlash(b.mesh.position.clone(), '#26ffd0');
            dead = true;
            break;
          }
        }
        if (!dead && this.botManager) {
          for (const bot of this.botManager.bots) {
            if (!bot.alive) continue;
            const hitT = rayCapsuleT(b.mesh.position.clone().sub(step), step.clone().normalize(), bot.pos, PLAYER_RADIUS, 2.15);
            if (hitT <= len + 0.3) {
              const killed = this.botManager.damage(bot, b.dmg, 'YOU');
              this.effects.hitFlash(b.mesh.position.clone(), '#26ffd0');
              this.audio.play('hit');
              if (killed) {
                this._localKills += 1;
                this.ui.setScore(this._localKills, this._localDeaths);
                this.ui.killFeed('YOU', bot.name, 'PLASMA', false);
                this.audio.play('kill');
                this._checkPracticeWin();
              }
              dead = true;
              break;
            }
          }
        }
      }

      if (dead) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------- remotes
  _updateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 11);
    for (const r of this.remotes.values()) {
      if (r.lastState < 0) continue; // no state yet — keep hidden
      r.pos.lerp(r.targetPos, k);
      r.avatar.root.position.copy(r.pos);

      let dy = r.targetYaw - r.avatar.root.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.avatar.root.rotation.y += dy * Math.min(1, dt * 9);

      if (r.targetWeapon !== r.avatar.gunSlot) r.avatar.setWeapon(r.targetWeapon);

      const speed = r.pos.distanceTo(r.targetPos) * 4;
      r.avatar.update(dt, {
        speed: r.targetSpeed ?? speed,
        moving: (r.targetSpeed ?? speed) > 0.6,
        aimPitch: r.targetPitch,
        grounded: r.grounded,
        dead: r.hp <= 0,
      });
    }
  }

  _updateDeath(dt) {
    if (!this.local.dead) return;
    this.local.respawnT -= dt;
    this.ui.setRespawnCount(Math.max(0, Math.ceil(this.local.respawnT)));
    if (this.mode === 'practice' && this.local.respawnT <= 0) {
      this._respawnLocal();
    }
  }

  _checkPracticeWin() {
    if (this._endShown) return;
    if (this._localKills >= KILLS_TO_WIN) {
      this._endShown = true;
      this.ui.showEnd('VICTORY', `YOU REACHED ${KILLS_TO_WIN} KILLS`);
    }
  }

  _sendState() {
    if (this.mode !== 'online' || !this.local) return;
    const p = this.local.pos;
    this.network.send({
      t: 'state',
      p: [p.x, p.y, p.z],
      ry: this.local.yaw,
      rx: this.local.pitch,
      w: this.local.weapon.slot,
      mv: this.local.speed,
      gr: this.local.grounded,
    });
  }
}
