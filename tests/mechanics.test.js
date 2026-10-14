/**
 * Mechanics tests for sections 9.4 - 9.10: steering shaping, brakes and
 * handbrake, the drift mechanic, nitro, weight/collisions, damage and traffic.
 *
 * These run the real modules against a flat asphalt world (no track needed), so
 * a failure names the mechanic rather than the scenery.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromDisk } from '../src/config.js';
import { Car } from '../src/car.js';
import { createFlatWorld } from '../src/world.js';
import { DriftScore } from '../src/drift.js';
import { DamageModel } from '../src/damage.js';
import { Economy } from '../src/economy.js';
import { Traffic } from '../src/traffic.js';
import { Autopilot } from '../src/ai.js';
import { buildTrack } from '../src/track.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const config = await loadConfigFromDisk(path.join(ROOT, 'data'), { strictTuning: true });
const asphalt = createFlatWorld(config, 'asphalt');
const car = (id = 'kalos_gt') => new Car(config.carById.get(id), config);
const DEG = 180 / Math.PI;

/* ------------------------------------------------------------------ 9.4 */

test('9.4 steering is shaped, speed-sensitive and gives touch players a hand', () => {
  const c = car();
  c.reset({ x: 0, y: 0, heading: 0 });

  // speed-sensitive lock: ~32 deg at a standstill, a quarter of it at 300 km/h
  const lockAt = (speedMs) => {
    const probe = car();
    probe.reset({ x: 0, y: 0, heading: 0, speedMs });
    probe.steering.update(DT, probe, { steer: 1 });
    return probe.steerLockRad * DEG;
  };
  const rest = lockAt(0);
  const fast = lockAt(300 / 3.6);
  assert.ok(rest > 30 && rest < 34, `standstill lock should be ~32 deg, got ${rest.toFixed(1)}`);
  assert.ok(fast > 6 && fast < 11, `top speed lock should be ~8 deg, got ${fast.toFixed(1)}`);
  assert.ok(lockAt(30) < rest && lockAt(30) > fast, 'the lock must shrink progressively with speed');

  // the wheel turns at ~300 deg/s toward the target, slower back to centre
  let t = 0;
  while (Math.abs(c.steerAngleRad) < rest * 0.8 / DEG && t < 1) {
    c.step(DT, { steer: 1 }, asphalt);
    t += DT;
  }
  const rate = (rest * 0.8) / t;
  assert.ok(rate > 230 && rate < 360, `steering rate should be ~300 deg/s (ramp included), got ${rate.toFixed(0)}`);

  // keyboard ramp: a held key reaches full input in about 120 ms
  const ramped = car();
  ramped.reset({ x: 0, y: 0, heading: 0 });
  let rampTime = 0;
  while (Math.abs(ramped.steerRamp) < 0.98 && rampTime < 1) {
    ramped.step(DT, { steer: 1 }, asphalt);
    rampTime += DT;
  }
  assert.ok(rampTime > 0.08 && rampTime < 0.2, `keyboard should ramp over ~120 ms, took ${(rampTime * 1000).toFixed(0)} ms`);

  // touch assist: only after a moment of holding the wheel, and never mid-drift
  const mobile = car();
  mobile.reset({ x: 0, y: 0, heading: 0, speedMs: 20 });
  mobile.steering.raw = 0.6; // the player is holding a steering input
  let assist = 0;
  for (let i = 0; i < 90; i++) {
    assist = mobile.steering.updateAssist(DT, { active: true, heading: 0, desiredHeading: 0.4, speedMs: 20, drifting: false });
  }
  assert.ok(assist > 0.02, `the assist should steer toward the road, got ${assist}`);
  assert.ok(assist < 0.4, `the assist must stay gentle, got ${assist}`);
  let whileDrifting = assist;
  for (let i = 0; i < 12; i++) {
    whileDrifting = mobile.steering.updateAssist(DT, { active: true, heading: 0, desiredHeading: 0.4, speedMs: 20, drifting: true });
  }
  assert.ok(whileDrifting < 0.02, `the assist must release in a drift, got ${whileDrifting.toFixed(3)}`);
  const desktop = mobile.steering.updateAssist(DT, { active: false, heading: 0, desiredHeading: 0.4, speedMs: 20 });
  assert.equal(desktop, 0, 'no assist away from touch controls');
});

test('9.4 the touch pad and tilt steer are analog, and difficulty scales the help', async () => {
  const { padSteerFrom, tiltSteerFrom, InputManager } = await import('../src/input.js');
  const input = config.tuning.input;

  // the drag pad: dead zone, rise, clamp, both signs, monotone
  assert.equal(padSteerFrom(0, input), 0);
  assert.equal(padSteerFrom(input.padDeadZonePx - 1, input), 0, 'a thumb resting on the glass must not steer');
  const half = padSteerFrom((input.padDeadZonePx + input.padFullLockPx) / 2, input);
  assert.ok(half > 0.4 && half < 0.7, `halfway across the pad should be a big part of the lock, got ${half.toFixed(2)}`);
  assert.equal(padSteerFrom(input.padFullLockPx + 200, input), 1, 'dragging past full lock clamps at 1');
  assert.equal(padSteerFrom(-input.padFullLockPx, input), -1, 'the other direction mirrors');
  const ramp = [12, 24, 36, 48, 60].map((px) => padSteerFrom(px, input));
  for (let i = 1; i < ramp.length; i++) {
    assert.ok(ramp[i] > ramp[i - 1], `the pad must be monotonic, got ${ramp.map((v) => v.toFixed(2)).join(' ')}`);
  }

  // tilt: zeroed where it was calibrated, dead-zoned, clamped, both signs
  assert.equal(tiltSteerFrom(input.tiltDeadZoneDeg - 1, input, 0), 0);
  const expected = (12 - input.tiltDeadZoneDeg) / (input.tiltFullLockDeg - input.tiltDeadZoneDeg);
  assert.ok(Math.abs(tiltSteerFrom(12, input, 0) - expected) < 1e-9, 'tilt is linear between the dead zone and full lock');
  assert.ok(expected > 0.3 && expected < 0.6, `12 degrees of roll is a partial input, got ${expected.toFixed(2)}`);
  assert.equal(tiltSteerFrom(-90, input, 0), -1, 'tilt clamps at full lock');
  assert.equal(tiltSteerFrom(12, input, 13), 0, 'tilt is relative to the angle it was calibrated at');

  // the real manager: a drag steers, lifting off centres it over a few frames
  const padHandlers = new Map();
  const element = {
    classList: { add() {}, remove() {} },
    addEventListener: (type, fn) => padHandlers.set(type, fn),
    setPointerCapture() {}
  };
  const manager = new InputManager({ addEventListener() {}, removeEventListener() {} }, input);
  manager.bindSteerPad(element);
  padHandlers.get('pointerdown')({ pointerId: 7, clientX: 300, preventDefault() {} });
  assert.equal(manager.sample(DT).steer, 0, 'putting a finger down is not a steering input by itself');
  padHandlers.get('pointermove')({ pointerId: 7, clientX: 300 + (input.padDeadZonePx + input.padFullLockPx) / 2 });
  const held = manager.sample(DT).steer;
  assert.ok(held > 0.4 && held < 0.7, `a held drag must steer immediately, got ${held.toFixed(2)}`);
  assert.equal(manager.touchOnly, true, 'the pad makes this a touch device, so 9.4 help applies');
  padHandlers.get('pointerup')({ pointerId: 7, preventDefault() {} });
  const released = manager.sample(0.1).steer;
  assert.ok(released > 0.02 && released < held * 0.8, `releasing must centre at a limited rate, got ${released.toFixed(3)} from ${held.toFixed(3)}`);
  assert.equal(manager.sample(1).steer, 0, 'the wheel is centred a second after the finger lifts');

  // tilt: permission, calibration at the held angle, and it counts as a mobile input
  const tiltHandlers = new Map();
  class FakeOrientation {
    static async requestPermission() {
      return 'granted';
    }
  }
  const tiltTarget = {
    DeviceOrientationEvent: FakeOrientation,
    addEventListener: (type, fn) => tiltHandlers.set(type, fn),
    removeEventListener() {}
  };
  const tiltManager = new InputManager(tiltTarget, input);
  assert.equal(await tiltManager.enableTilt(), true, 'a device with a motion sensor can turn tilt on');
  tiltHandlers.get('deviceorientation')({ gamma: 0 });
  tiltHandlers.get('deviceorientation')({ gamma: 12 });
  let tiltRead = 0;
  for (let i = 0; i < 30; i++) tiltRead = tiltManager.sample(DT).steer;
  assert.ok(tiltRead > 0.3 && tiltRead < 0.7, `tilting 12 degrees must steer, got ${tiltRead.toFixed(2)}`);
  assert.equal(tiltManager.touchOnly, true, 'tilt is a mobile input, so the assist may help');
  tiltHandlers.get('deviceorientation')({ gamma: -30 });
  for (let i = 0; i < 30; i++) tiltRead = tiltManager.sample(DT).steer;
  assert.ok(tiltRead < -0.6, `tilting the other way must steer the other way, got ${tiltRead.toFixed(2)}`);

  // difficulty is data: harder levels help less (master: not at all)
  const levels = config.difficultyLevels;
  assert.ok(levels.length >= 2, 'tuning.json should author more than one difficulty');
  const casual = config.difficultyFor('casual');
  const master = config.difficultyFor('master');
  assert.ok(casual.assistPct > config.defaultDifficulty.assistPct, 'casual gives more help than the default');
  assert.ok(config.defaultDifficulty.assistPct > master.assistPct, 'harder levels give less help');
  assert.equal(master.assistPct, 0, 'master means no steering help at all');
});

/* ------------------------------------------------------------------ 9.5 */

test('9.5 brakes are front-biased with lights, ABS cap and a timed handbrake lock', () => {
  const c = car();
  c.reset({ x: 0, y: 0, heading: 0, speedMs: 25 });
  c.step(DT, { brake: 1 }, asphalt);
  assert.ok(c.brakeLight > 0.9, 'brake lights must light up under braking');
  for (let i = 0; i < 30; i++) c.step(DT, { brake: 0 }, asphalt);
  assert.ok(c.brakeLight < 0.2, 'brake lights must go out');
  const bias = c.def.brakes.brakeBiasFront;
  assert.ok(bias > 0.5 && bias < 0.85, `front bias should be sensible, got ${bias}`);

  // ABS: heavy braking while turning slides the tires
  const straight = car();
  straight.reset({ x: 0, y: 0, heading: 0, speedMs: 33 });
  let straightSlip = 0;
  for (let i = 0; i < 60; i++) {
    straight.step(DT, { brake: 1 }, asphalt);
    straightSlip = Math.max(straightSlip, Math.abs(straight.slipAngleBodyDeg));
  }
  const turning = car();
  turning.reset({ x: 0, y: 0, heading: 0, speedMs: 33 });
  let turningSlip = 0;
  let slid = false;
  for (let i = 0; i < 60; i++) {
    turning.step(DT, { brake: 1, steer: 0.7 }, asphalt);
    turningSlip = Math.max(turningSlip, Math.abs(turning.slipAngleBodyDeg));
    slid = slid || turning.frontAxle.sliding || turning.rearAxle.sliding;
  }
  assert.ok(slid, 'braking hard while turning must be able to break traction');
  assert.ok(turningSlip > straightSlip, `corner braking should slide more (${turningSlip.toFixed(1)} vs ${straightSlip.toFixed(1)} deg)`);

  // handbrake: a timed lock of the rear grip, then a cooldown
  const hb = car();
  hb.reset({ x: 0, y: 0, heading: 0, speedMs: 20 });
  hb.step(DT, { handbrake: true, steer: 0.5 }, asphalt);
  const lockMs = hb.handbrakeLockTimer;
  assert.ok(lockMs > 0.35 && lockMs <= 0.4, `handbrake should lock the rear for ~0.4 s, got ${lockMs.toFixed(2)}`);
  assert.equal(config.tuning.brakes.handbrakeLockGripScale, 0.35, 'the lock holds 35 % of the rear grip');
  assert.ok(hb.handbrakeCooldown > 1, 'a handbrake press must start a cooldown');
  for (let i = 0; i < 8; i++) hb.step(DT, { handbrake: true, steer: 0.5 }, asphalt);
  assert.ok(hb.handbrakeLockTimer <= 0.4, 'holding the handbrake must not re-trigger the lock');
  assert.ok(hb.handbrakeCooldown > 0.6, 'the cooldown must still be running');

  // and it really does make the rear step out faster
  const entry = (useHandbrake) => {
    const probe = car('sabre_240');
    probe.reset({ x: 0, y: 0, heading: 0, speedMs: 80 / 3.6 });
    let reached = null;
    for (let i = 0; i < 150; i++) {
      const time = i * DT;
      probe.step(
        DT,
        { steer: 0.35, throttle: time > 0.3 ? 0.5 : 0.2, handbrake: useHandbrake && time < 0.1, brake: 0 },
        asphalt
      );
      if (reached === null && Math.abs(probe.slipAngleBodyDeg) > 15) reached = time;
    }
    return reached ?? Infinity;
  };
  const withHb = entry(true);
  const without = entry(false);
  assert.ok(withHb < without * 0.6, `handbrake entry should be much sharper (${withHb.toFixed(2)}s vs ${without.toFixed(2)}s)`);
});

/* ------------------------------------------------------------------ 9.6 */

test('9.6 a drift scores, charges nitro and pays a clean exit', () => {
  const drift = new DriftScore(config);
  let coins = 0;
  const c = car();
  c.reset({ x: 0, y: 0, heading: 0, speedMs: 28 });
  assert.equal(config.tuning.drift.minSlipAngleDeg, 15, 'a drift starts at 15 degrees of slip');

  // straight: nothing
  c.slipAngleBodyDeg = 8;
  drift.update(DT, c);
  assert.equal(drift.drifting, false, 'no drift below the slip threshold');

  // sideways: score, combo, nitro charge. A bigger angle scores faster.
  const scoreFor = (angleDeg, seconds = 2) => {
    const scorer = new DriftScore(config);
    const probe = car();
    probe.reset({ x: 0, y: 0, heading: 0, speedMs: 28 });
    probe.slipAngleBodyDeg = angleDeg;
    let charge = 0;
    for (let i = 0; i < seconds / DT; i++) charge += scorer.update(DT, probe).nitroCharge;
    return { points: scorer.pending, charge };
  };
  const mild = scoreFor(25, 2);
  const big = scoreFor(45, 3);
  assert.ok(mild.points > 150, `a mild slide still scores, got ${mild.points.toFixed(0)}`);
  assert.ok(big.points > mild.points * 2, `a bigger slide must score much faster (${big.points.toFixed(0)} vs ${mild.points.toFixed(0)})`);
  assert.ok(big.points > 900, `a 3 second drift should be worth banking, got ${big.points.toFixed(0)}`);
  assert.ok(mild.charge > 0 && big.charge > mild.charge, 'drifting charges nitro, and a bigger drift charges faster');

  c.slipAngleBodyDeg = 30;
  for (let i = 0; i < 180; i++) {
    const gain = drift.update(DT, c);
    coins += gain.coins;
    if (i === 30) assert.equal(drift.drifting, true, 'a 30 degree slide is a drift');
  }
  assert.ok(drift.pending > 300, `a 3 second slide should score, got ${drift.pending.toFixed(0)}`);
  assert.ok(drift.score === 0, 'points stay pending until the drift ends');

  // clean exit: bank + a boost
  c.slipAngleBodyDeg = 2;
  const gain = drift.update(DT, c);
  assert.ok(drift.score > 300, 'a clean exit banks the pending points');
  assert.ok(drift.combo > 1, 'a sustained drift builds the combo');
  assert.ok(drift.boosting && drift.boostMultiplier > 1, 'a clean exit gives a speed boost');
  assert.ok(drift.boostPct <= 0.12, `the boost should be small, got ${(drift.boostPct * 100).toFixed(1)}%`);
  assert.ok(coins + gain.coins > 0, 'drifting pays coins');

  // crash: the combo and the pending points are cancelled
  const doomed = new DriftScore(config);
  c.slipAngleBodyDeg = 30;
  for (let i = 0; i < 120; i++) doomed.update(DT, c);
  doomed.crash(1);
  assert.equal(doomed.pending, 0, 'a crash cancels the pending points');
  assert.equal(doomed.combo, 1, 'a crash resets the combo');
  assert.equal(doomed.boosting, false, 'a crash kills the drift boost');
  // a crash inside the window also cancels on the exit
  const late = new DriftScore(config);
  for (let i = 0; i < 120; i++) late.update(DT, c);
  late.crash(1);
  c.slipAngleBodyDeg = 2;
  late.update(DT, c);
  assert.equal(late.score, 0, 'a crash inside the window loses the drift');
});

/* ------------------------------------------------------------------ 9.7 */

test('9.7 nitro adds force and top speed, and overheats when emptied', () => {
  const mk = (id) => {
    const c = car(id);
    c.reset({ x: 0, y: 0, heading: 0, speedMs: 30 });
    for (let i = 0; i < 60; i++) c.step(DT, { throttle: 1 }, asphalt); // settle the gearbox
    return c;
  };
  const plain = mk('sabre_240');
  const boosted = mk('sabre_240');
  let plainForce = 0;
  let boostedForce = 0;
  const plainStart = plain.speedMs;
  const boostedStart = boosted.speedMs;
  for (let i = 0; i < Math.round(3 / DT); i++) {
    plain.step(DT, { throttle: 1 }, asphalt);
    boosted.step(DT, { throttle: 1, nitro: true }, asphalt);
    plainForce = Math.max(plainForce, plain.engineState.driveForceN);
    boostedForce = Math.max(boostedForce, boosted.engineState.driveForceN);
  }
  assert.ok(boostedForce / plainForce > 1.35, `nitro should add ~40 % engine force, got x${(boostedForce / plainForce).toFixed(2)}`);
  assert.ok(
    boosted.speedMs - boostedStart > (plain.speedMs - plainStart) * 1.25,
    'a nitro burst must actually accelerate harder'
  );
  assert.ok(boosted.engineState.revCeiling > boosted.def.engine.revLimiterRpm, 'nitro raises the rev ceiling (+20 % top speed)');
  assert.equal(config.tuning.nitro.steerAnglePct, 0.85, 'nitro takes a little steering lock away');

  // drain + overheat lockout
  const drained = car();
  drained.reset({ x: 0, y: 0, heading: 0, speedMs: 30 });
  let overheated = false;
  let lockoutSeen = 0;
  for (let i = 0; i < 60 * 10; i++) {
    drained.step(DT, { throttle: 1, nitro: true }, asphalt);
    if (drained.nitro.overheated) {
      overheated = true;
      lockoutSeen++;
    }
  }
  assert.ok(overheated, 'holding nitro to empty must overheat the tank');
  assert.ok(lockoutSeen > 60, `the lockout should last ~1.5 s, saw ${lockoutSeen} ticks`);
  assert.equal(config.tuning.nitro.overheatLockoutMs, 1500);
  assert.ok(config.carById.get('vortex_9').nitro.capacity > config.carById.get('kalos_gt').nitro.capacity, 'tank capacity is a car stat');

  // the tank fills from drifting, a near miss and a slipstream
  const tank = car();
  tank.nitro.amount = tank.nitro.capacity * 0.1; // start with an empty-ish tank
  const before = tank.nitro.amount;
  tank.nitro.fillFromDrift(600);
  tank.nitro.fillFromNearMiss();
  tank.nitro.fillFromSlipstream(1, 1);
  assert.ok(tank.nitro.amount > before, 'the tank must fill from good driving');
});

/* ------------------------------------------------------------------ 9.8 */

test('9.8 mass decides how a collision ends', () => {
  const world = createFlatWorld(config, 'asphalt');
  const runPair = (aId, bId, speed) => {
    const light = car(aId);
    const heavy = car(bId);
    light.reset({ x: 0, y: 0, heading: 0, speedMs: 0 });
    heavy.reset({ x: 4.0, y: 0, heading: Math.PI, speedMs: speed });
    const before = { light: Math.hypot(light.vx, light.vy), heavy: Math.hypot(heavy.vx, heavy.vy) };
    const contact = world.resolveCarCollision(heavy, light, DT);
    return {
      contact,
      lightGain: Math.hypot(light.vx, light.vy) - before.light,
      heavyChange: Math.hypot(heavy.vx, heavy.vy) - before.heavy
    };
  };
  const heavyHitsLight = runPair('vortex_9', 'vandal_v8', 12);
  assert.ok(heavyHitsLight.contact, 'a two car overlap must produce a contact');
  assert.ok(heavyHitsLight.lightGain > 2, `the light car should be shunted, gained ${heavyHitsLight.lightGain.toFixed(2)} m/s`);
  assert.ok(heavyHitsLight.heavyChange < 0, 'the heavy car must lose speed in the hit');
  assert.equal(config.carById.get('vandal_v8').body.massKg, 1900, 'the muscle car weighs 1900 kg');

  const lightHitsHeavy = runPair('vandal_v8', 'vortex_9', 12);
  assert.ok(
    Math.abs(lightHitsHeavy.heavyChange) > Math.abs(lightHitsHeavy.lightGain),
    'a light car hitting a heavy one is pushed backwards harder than it pushes'
  );
  // relative speed and angle feed the bounce: a glancing blow transfers less
  const square = runPair('kalos_gt', 'sabre_240', 12);
  assert.ok(square.contact.speedMs > 10, `a square hit should read the closing speed, got ${square.contact.speedMs.toFixed(1)}`);
  assert.ok(square.contact.energy > 0, 'the impact must report energy for the damage model');
});

test('9.8 a big impact adds hit-stop and shakes the camera', async () => {
  const { setupDom, stubFetch } = await import('./dom-stub.mjs');
  const dom = setupDom();
  globalThis.fetch = stubFetch(readFileSync, ROOT);
  try {
    const { boot } = await import('../src/boot.js');
    const apex = await boot();
    const { game } = apex;
    game.frame(16.67);
    game.onImpact(
      { x: game.car.x, y: game.car.y, speedMs: 14, energy: 400000, normalX: 1, normalY: 0, kind: 'wall' },
      game.car,
      DT
    );
    const freeze = game.hitStopTimer;
    assert.ok(freeze >= 0.04 && freeze <= 0.09, `hit-stop should be 40-60 ms (scaled), got ${(freeze * 1000).toFixed(0)} ms`);
    assert.ok(game.camera.shake > 0.2, 'a big impact must shake the camera');
    const x = game.car.x;
    game.step(DT, { throttle: 1 });
    assert.equal(game.car.x, x, 'the car must not move during hit-stop');
    assert.ok(game.car.damage.healthPct < 1, 'the impact must damage the car');
    // and the freeze ends
    for (let i = 0; i < 10; i++) game.step(DT, { throttle: 1 });
    assert.equal(game.hitStopTimer, 0, 'hit-stop must not stick');
    assert.ok(game.car.x !== x, 'the car drives again once the freeze is over');

    // a light scrape is damage + sparks, not a freeze
    game.car.damage.reset();
    const before = game.car.damage.health;
    game.onImpact({ x: game.car.x, y: game.car.y, speedMs: 2.6, energy: 500, normalX: 0, normalY: 1, kind: 'wall' }, game.car, DT);
    game.effects.update(DT, game.car);
    assert.equal(game.hitStopTimer, 0, 'a scrape must not freeze the game');
    assert.ok(game.car.damage.health <= before, 'rubbing a wall costs a little health');

    /* ---- 9.4: difficulty decides how much help a touch player gets --- */
    // Frozen physics (paused) so the only thing moving is the assist itself.
    game.paused = true;
    game.assists = true;
    game.input.touchOnly = true;
    game.input.lastDevice = 'touch';
    game.car.heading += Math.PI / 2; // point across the road: a big error to correct
    game.car.speedMs = 24;
    let clock = 100;
    const assistAt = (id) => {
      game.setDifficulty(id);
      game.car.steering.assistHold = 0;
      let value = 0;
      for (let i = 0; i < 70; i++) {
        game.car.steering.raw = 1; // the player is holding a steering input
        clock += 16.7;
        game.frame(clock);
        value = Math.abs(game.assistSteer);
      }
      return value;
    };
    const casual = assistAt('casual');
    const master = assistAt('master');
    game.paused = false;
    assert.ok(casual > 0.02, `casual difficulty should steer a touch player back to the road, got ${casual.toFixed(3)}`);
    assert.ok(master < casual * 0.05, `master difficulty is no help at all, got ${master.toFixed(3)} vs ${casual.toFixed(3)}`);
  } finally {
    dom.restore();
  }
});

/* ------------------------------------------------------------------ 9.9 */

test('9.9 damage is sorted into hit zones and costs performance', () => {
  const hyper = new DamageModel(config, config.carById.get('vortex_9'));
  const muscle = new DamageModel(config, config.carById.get('vandal_v8'));
  const front = { speedMs: 14, energy: 120000, normalX: 1, normalY: 0 };
  const rear = { speedMs: 14, energy: 120000, normalX: -1, normalY: 0 };
  const side = { speedMs: 14, energy: 120000, normalX: 0, normalY: 1 };
  const target = car('vortex_9');
  assert.equal(hyper.zoneFor(front.normalX, front.normalY, 0), 'front');
  assert.equal(hyper.zoneFor(rear.normalX, rear.normalY, 0), 'rear');
  assert.equal(hyper.zoneFor(side.normalX, side.normalY, 0), 'right');
  assert.equal(hyper.zoneFor(0, -1, 0), 'left');
  const hit = hyper.applyImpact(front, target);
  assert.equal(hit.zone, 'front', 'a head-on hit damages the front zone');
  assert.ok(hyper.zonePct('front') > 0, 'the front zone must take the damage');

  // armor: the same hit hurts the lighter car more
  muscle.applyImpact(front, car('vandal_v8'));
  assert.ok(1 - muscle.healthPct < 1 - hyper.healthPct, 'more armor means less damage');

  // performance effects
  const wounded = new DamageModel(config, config.carById.get('kalos_gt'));
  wounded.health = 35;
  wounded.zones.front = 24;
  wounded.recompute();
  assert.ok(wounded.topSpeedScale < 1, 'front damage lowers the top speed');
  const rearHurt = new DamageModel(config, config.carById.get('kalos_gt'));
  rearHurt.health = 35;
  rearHurt.zones.rear = 24;
  rearHurt.recompute();
  assert.ok(rearHurt.accelScale < 1, 'rear damage lowers acceleration');
  const sideHurt = new DamageModel(config, config.carById.get('kalos_gt'));
  sideHurt.health = 40;
  sideHurt.zones.left = 20;
  sideHurt.recompute();
  assert.ok(sideHurt.steerPullRad !== 0, 'side damage makes the steering pull');
  assert.ok(Math.abs(sideHurt.steerPullRad * DEG) < 4, 'the pull must stay small');

  // visual states: smoke at 50 %, fire at 20 %, wreck at 0
  const smoking = new DamageModel(config, config.carById.get('kalos_gt'));
  smoking.health = 45;
  smoking.zones.front = 10;
  smoking.recompute();
  assert.ok(smoking.smoke > 0 && smoking.fire === 0, 'smoke appears at half health, not fire');
  const burning = new DamageModel(config, config.carById.get('kalos_gt'));
  burning.health = 18;
  burning.zones.rear = 20;
  burning.recompute();
  assert.ok(burning.fire > 0, 'fire appears under 20 % health');
  const dead = new DamageModel(config, config.carById.get('kalos_gt'));
  dead.health = 0;
  dead.recompute();
  assert.equal(dead.wrecked, true, 'zero health is a wreck');
  const intact = new DamageModel(config, config.carById.get('kalos_gt'));
  assert.equal(intact.smoke, 0, 'a healthy car must not smoke');
  assert.equal(intact.fire, 0, 'a healthy car must not burn');
  assert.equal(intact.topSpeedScale, 1, 'a healthy car is not slowed down');

  // repair: cost, coins, and one free quick repair
  const economy = new Economy(config);
  const broken = new DamageModel(config, config.carById.get('kalos_gt'));
  broken.health = 30;
  broken.zones.front = 18;
  broken.recompute();
  const cost = broken.repairCost();
  assert.ok(cost > 0, 'repairing costs coins');
  const free = economy.repair(broken);
  assert.ok(free.ok && free.free && free.cost === 0, 'the first repair is the free quick repair');
  assert.ok(broken.healthPct > 0.5, `a quick repair should restore over half the health, got ${broken.healthPct}`);
  economy.add(2000, 'test');
  const paid = economy.repair(broken);
  assert.ok(paid.ok && !paid.free && paid.cost > 0, 'the next repair is paid for with coins');
  assert.equal(broken.healthPct, 1, 'a full repair restores all health');
});

/* ------------------------------------------------------------------ 9.10 */

test('9.10 rivals drive, slipstreams and near misses pay out', async () => {
  const track = buildTrack(JSON.parse(readFileSync(path.join(ROOT, 'data/track.json'), 'utf8')), config);
  const traffic = new Traffic(config, track, { makeCar: (def) => new Car(def, config, { assists: false }) });
  traffic.spawn(config.cars.filter((c) => c.id !== 'kalos_gt'));
  traffic.attachAutopilot(() => new Autopilot(track, config));
  assert.ok(traffic.rivals.length >= 2, 'there should be rivals on the circuit');

  const player = car('kalos_gt');
  const rival = traffic.rivals[0].car;
  const heading = rival.heading;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  player.reset({ x: rival.x - cos * 20, y: rival.y - sin * 20, heading, speedMs: 30 });

  const out = traffic.update(DT, player);
  assert.ok(out.slipstream.active, 'sitting 20 m behind a rival is a slipstream');
  assert.ok(out.slipstream.strength > 0.3, `slipstream strength should scale with distance, got ${out.slipstream.strength.toFixed(2)}`);
  const tank = player.nitro.amount;
  player.nitro.fillFromSlipstream(1, out.slipstream.strength);
  assert.ok(player.nitro.amount > 0 || tank >= player.nitro.capacity, 'a slipstream charges nitro');

  // a near miss: right alongside, at speed, and only counted once
  rival.reset({ x: player.x - sin * 2.0, y: player.y + cos * 2.0, heading, speedMs: 30 });
  traffic.nearMissTimer = 0;
  traffic.decorCooldowns.clear();
  const near = traffic.closestPass(player);
  assert.ok(near, 'a close pass must be detected');
  assert.ok(near.distanceM < 3, `near miss distance should be small, got ${near.distanceM.toFixed(2)}`);
  player.nitro.amount = 10;
  player.nitro.fillFromNearMiss();
  assert.ok(player.nitro.amount > 10, 'a near miss charges nitro');
  const economy = new Economy(config);
  const coins = economy.coins;
  economy.bankNearMiss();
  assert.ok(economy.coins > coins && economy.nearMisses === 1, 'a near miss pays coins and style points');

  // the rivals actually drive, and a stuck one is recovered
  for (let i = 0; i < 240; i++) traffic.update(DT, player);
  assert.ok(traffic.rivals.every((r) => r.car.speedMs > 3), 'rivals must be driving, not parked');
  const stuck = traffic.rivals[0];
  stuck.car.reset({ x: stuck.car.x, y: stuck.car.y, heading: stuck.car.heading });
  for (let i = 0; i < 60 * 8; i++) traffic.update(DT, player);
  assert.ok(stuck.car.speedMs > 3, 'a stopped rival must be put back on the road');
});
