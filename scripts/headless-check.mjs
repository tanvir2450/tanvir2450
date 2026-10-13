/**
 * Headless scene-construction check: builds the world, avatars, effects and
 * bots against real three.js with a stubbed DOM/texture layer. Catches API
 * misuse without a browser. Run: node scripts/headless-check.mjs
 */

// --- minimal DOM stubs (textures only need a 2d context) --------------------
const ctxStub = {
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {},
  stroke() {},
  beginPath() {},
  arc() {},
  set fillStyle(v) {},
  set strokeStyle(v) {},
  set lineWidth(v) {},
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),
};
globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const THREE = await import('three');
const { World, terrainHeight, ARENA_HALF } = await import('../public/js/world.js');
const { Effects } = await import('../public/js/effects.js');
const { Avatar } = await import('../public/js/player.js');
const { WEAPONS, WeaponState } = await import('../public/js/weapons.js');
const { BotManager, rayHitsCapsule } = await import('../public/js/bots.js');

let failures = 0;
const check = (cond, label, extra = '') => {
  if (cond) console.log('[headless] PASS', label);
  else {
    failures++;
    console.log('[headless] FAIL', label, extra);
  }
};

// --- scene graph ------------------------------------------------------------
const scene = new THREE.Scene();
const world = new World(scene);
check(scene.children.length > 20, `world populated (${scene.children.length} nodes)`);
check(world.colliders.length > 20, `colliders registered (${world.colliders.length})`);
check(Number.isFinite(terrainHeight(12, -40)), 'terrainHeight finite');

const resolved = world.collide(0, 0, 0.6);
check(Number.isFinite(resolved.x) && Number.isFinite(resolved.z), 'collide() resolves');

const effects = new Effects(scene);
effects.muzzleFlash(new THREE.Vector3(0, 2, 0));
effects.tracer(new THREE.Vector3(0, 1, 0), new THREE.Vector3(10, 3, -10));
effects.impact(new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 0));
effects.explosion(new THREE.Vector3(2, 1, 2), 6);
effects.nadeTrail(new THREE.Vector3(0, 1, 0));
effects.respawnFlash(new THREE.Vector3(0, 1, 0));
effects.hitFlash(new THREE.Vector3(0, 1, 0));
effects.update(0.016);
effects.update(5); // force expiry pass
check(true, 'effects spawn/update without throwing');

// --- avatar -----------------------------------------------------------------
const avatar = new Avatar('#23e6ff');
scene.add(avatar.root);
for (let i = 0; i < 5; i++) avatar.setWeapon(i);
avatar.update(0.016, { speed: 6, moving: true, aimPitch: -0.4, grounded: true, dead: false });
avatar.kill();
avatar.update(0.1, {});
avatar.revive();
check(avatar.muzzle && avatar.muzzle.isObject3D, 'avatar weapons + animation + death ok');

// --- weapon state -----------------------------------------------------------
const ws = new WeaponState();
ws.fire();
check(ws.ammo[0] === 29, 'weapon fires');
ws.startReload();
ws.update(3);
check(ws.ammo[0] === WEAPONS[0].magSize, 'weapon reloads');
check(WEAPONS.length === 5 && WEAPONS.every((w) => w.name && w.kind), '5 weapon defs');

// --- bots (against a stub game) --------------------------------------------
const fakeLocal = {
  pos: new THREE.Vector3(5, terrainHeight(5, 5), 5),
  hp: 100,
  dead: false,
};
const fakeGame = {
  local: fakeLocal,
  effects,
  audio: { play() {} },
  damageLocalPlayer(dmg) {
    fakeLocal.hp -= dmg;
  },
};
const bots = new BotManager(scene, world, fakeGame, 5);
for (let i = 0; i < 120; i++) bots.update(1 / 30);
check(bots.bots.every((b) => Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y)), 'bots simulate 4s');

const bot = bots.bots[0];
bot.pos.copy(fakeLocal.pos).add(new THREE.Vector3(2, 0, 0));
const killed = bots.damage(bot, 200, 'YOU');
check(killed === true && !bot.alive, 'bot damage + kill');
bots.damage(bot, 10, 'YOU'); // dead again — no throw
check(true, 'double-kill safe');

// ray capsule math
const hit = rayHitsCapsule(
  new THREE.Vector3(0, 1.5, 10),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 0, 0),
  0.62,
  2.15
);
const miss = rayHitsCapsule(
  new THREE.Vector3(3, 1.5, 10),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 0, 0),
  0.62,
  2.15
);
check(hit === true && miss === false, 'rayHitsCapsule geometry');

// keep bots from overlapping spawn
check(Math.abs(bot.pos.x) <= ARENA_HALF + 1 && Math.abs(bot.pos.z) <= ARENA_HALF + 1, 'bots inside arena');

console.log(failures === 0 ? '[headless] ALL CHECKS PASSED' : `[headless] ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
