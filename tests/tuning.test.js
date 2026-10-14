/**
 * Tests for section 9.11 (per-car handling profiles) and 9.12 (the tuning
 * panel + the test track).
 *
 * 9.11 is a data-conversion contract: a car authored as a profile must produce
 * exactly the model the profile describes (mass, power, top speed, grip, lock,
 * brakes, drag, armor, nitro), and the conversion constants must themselves be
 * data. 9.12 is a tool: the panel edits live values, the world rebuilds behind
 * it, and the test track has to contain the situations it promises.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromDisk, createConfig, readHandlingProfile } from '../src/config.js';
import { buildTrack, LapTimer } from '../src/track.js';
import { Car } from '../src/car.js';
import { Autopilot } from '../src/ai.js';
import { createFlatWorld } from '../src/world.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const read = (name) => JSON.parse(readFileSync(path.join(ROOT, 'data', name), 'utf8'));
const config = await loadConfigFromDisk(path.join(ROOT, 'data'), { strictTuning: true });

/* ------------------------------------------------------------------ 9.11 */

test('9.11 a handling profile becomes the model it describes', () => {
  const falcon = config.carById.get('falcon');
  const profile = readHandlingProfile(read('cars.json').cars.find((c) => c.id === 'falcon'));
  assert.ok(Object.keys(profile).length >= 12, 'the falcon must be authored as a profile');

  // mass and inertia
  assert.equal(falcon.body.massKg, profile.mass);
  const geometric = (profile.mass * (falcon.body.lengthM ** 2 + falcon.body.widthM ** 2)) / 12;
  assert.ok(
    Math.abs(falcon.body.yawInertiaKgM2 / geometric - config.tuning.profile.yawInertiaFactor) < 1e-6,
    'yaw inertia comes from the geometry times profile.yawInertiaFactor'
  );

  // grip -> the tire model's friction coefficients
  assert.equal(falcon.tires.gripFront, profile.gripFront);
  assert.equal(falcon.tires.gripRear, profile.gripRear);
  assert.equal(falcon.tires.slideGripRatio, profile.slideGrip);
  assert.ok(
    Math.abs(falcon.tires.axleGripFront - profile.gripFront * (1 - falcon.drivetrain.balance * config.tuning.balance.gripInfluence)) < 1e-6,
    'the axle grip applies the car balance like every other car'
  );

  // steerMax -> lock, steerSpeedFalloff -> the car's own lock curve
  assert.equal(falcon.steering.maxSteerAngleDeg, profile.steerMax);
  const ref = config.tuning.profile.steerFalloffRefKph / 3.6;
  assert.equal(config.steerLockPct(0, falcon), 1, 'full lock at a standstill');
  assert.ok(
    Math.abs(config.steerLockPct(ref, falcon) - (1 - profile.steerSpeedFalloff)) < 1e-9,
    'the profile falloff is the fraction of lock gone at the reference speed'
  );
  assert.ok(config.steerLockPct(400 / 3.6, falcon) >= config.tuning.profile.steerMinLockPct - 1e-9, 'lock never falls below the floor');

  // brakeForce -> brake torque, from the car's mass
  const torque = falcon.axleBrakeTorque.front + falcon.axleBrakeTorque.rear;
  assert.ok(
    Math.abs(torque - profile.mass * config.tuning.profile.brakeTorquePerKgNm * profile.brakeForce) < 1e-6,
    'brake torque is mass x profile.brakeTorquePerKgNm x brakeForce'
  );

  // dragCoeff -> CdA, armor -> a damage divisor, nitroCapacity -> seconds
  assert.ok(Math.abs(falcon.body.dragAreaCdA - profile.dragCoeff * falcon.body.frontalAreaM2) < 1e-9, 'drag is Cd x frontal area');
  assert.equal(falcon.armorRating, profile.armor);
  assert.ok(
    Math.abs(falcon.armor - config.tuning.profile.armorRatingBase / profile.armor) < 1e-9,
    'a higher armor rating takes less damage'
  );
  assert.ok(Math.abs(falcon.nitroSeconds - profile.nitroCapacity) < 1e-9, 'the nitro tank is authored in seconds of boost');
  assert.ok(Math.abs(falcon.nitro.capacity - profile.nitroCapacity * config.tuning.nitro.drainPerSecond) < 1e-9);
  assert.ok(falcon.nitro.power > 1, 'and it can still carry its own power multiplier');

  // the torque curve keeps the authored shape, and the peak is the rated power
  const factors = falcon.engine.torqueCurve.map((point) => point.nm);
  const peak = Math.max(...factors);
  const shape = factors.map((nm) => nm / peak);
  profile.torqueCurve.forEach((want, i) => {
    assert.ok(Math.abs(shape[i] - want) < 1e-3, `torque point ${i} should follow the authored shape (${shape[i].toFixed(2)} vs ${want})`);
  });
  const TAU = Math.PI * 2;
  const peakKw = Math.max(...falcon.engine.torqueCurve.map((point) => (point.nm * point.rpm * TAU) / 60000));
  const wantKw = profile.enginePower * config.tuning.profile.powerToKw;
  assert.ok(Math.abs(peakKw - wantKw) / wantKw < 0.02, `the torque curve should make the rated power (${peakKw.toFixed(1)} vs ${wantKw.toFixed(1)} kW)`);
  assert.ok(falcon.engine.powerRating === profile.enginePower, 'the rated power travels with the car');

  // top speed -> the final drive, so the quoted number is reachable
  const gearingTopKph = (((falcon.engine.revLimiterRpm / 60) * TAU * falcon.tires.radiusM * 3.6) / falcon.drivetrain.ratioTotals[4]);
  assert.ok(
    Math.abs(gearingTopKph - profile.topSpeed * 3.6) < 1.0,
    `top gear at the limiter should be the quoted top speed (${gearingTopKph.toFixed(1)} vs ${(profile.topSpeed * 3.6).toFixed(1)} kph)`
  );
});

test('9.11 the profile conversion is data, and a partial profile is allowed', () => {
  const cars = read('cars.json');
  const tuning = read('tuning.json');

  // change the conversion constant -> the derived model changes with it
  const twice = structuredClone(tuning);
  twice.profile.brakeTorquePerKgNm *= 2;
  const config2 = createConfig({ cars, surfaces: read('surfaces.json'), tuning: twice, audio: read('audio.json') }, { strictTuning: true });
  const a = config.carById.get('falcon');
  const b = config2.carById.get('falcon');
  assert.ok(
    Math.abs(b.axleBrakeTorque.front - a.axleBrakeTorque.front * 2) < 1e-6,
    'brake torque follows tuning.profile.brakeTorquePerKgNm - no constant is hardcoded'
  );

  // a profile may set ONE value: the rest of the car stays as authored
  const patched = structuredClone(cars);
  const kalos = patched.cars.find((c) => c.id === 'kalos_gt');
  kalos.tires.gripFront = 1.4;
  const config3 = createConfig({ cars: patched, surfaces: read('surfaces.json'), tuning, audio: read('audio.json') }, { strictTuning: true });
  const one = config3.carById.get('kalos_gt');
  assert.equal(one.tires.gripFront, 1.4, 'the edited value is applied');
  assert.equal(one.body.massKg, config.carById.get('kalos_gt').body.massKg, 'and nothing else moves');
  assert.equal(one.tires.gripRear, config.carById.get('kalos_gt').tires.gripRear);

  // only real 9.11 keys trigger the profile path: a classic car stays untouched
  const withArmor = structuredClone(cars);
  const sabre = withArmor.cars.find((c) => c.id === 'sabre_240');
  sabre.armor = 1.3;
  const config4 = createConfig({ cars: withArmor, surfaces: read('surfaces.json'), tuning, audio: read('audio.json') }, { strictTuning: true });
  assert.equal(config4.carById.get('sabre_240').armor, 1.3, 'armor is still a damage divisor for a classic car');
  assert.equal(config4.carById.get('sabre_240').body.massKg, config.carById.get('sabre_240').body.massKg, 'and its model is not rebuilt from a phantom profile');
});

test('9.11 the pro and starter cars hit their feel targets', () => {
  const target = (id) => {
    const car = new Car(config.carById.get(id), config, { assists: false });
    const world = createFlatWorld(config, 'asphalt');
    car.reset({ x: 0, y: 0, heading: 0 });
    let t100 = null;
    let distance = 0;
    let lastX = 0;
    let seconds = 0;
    for (let i = 0; i < Math.round(40 / DT); i++) {
      car.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, world);
      distance += car.x - lastX;
      lastX = car.x;
      seconds = i * DT;
      if (t100 === null && car.speedMs * 3.6 >= 100) t100 = seconds;
    }
    return { zeroTo100: t100, topSpeedKph: car.speedMs * 3.6, seconds };
  };

  // 9.12: "about 6 s for sport cars, about 9 s for starters"
  const falcon = target('falcon');
  assert.ok(falcon.zeroTo100 > 5.2 && falcon.zeroTo100 < 6.6, `falcon 0-100 should be about 6 s, got ${falcon.zeroTo100.toFixed(2)}s`);
  const cadet = target('cadet');
  assert.ok(cadet.zeroTo100 > 8.0 && cadet.zeroTo100 < 10.0, `cadet 0-100 should be about 9 s, got ${cadet.zeroTo100.toFixed(2)}s`);

  // and the profile targets are declared in the data, not in the test
  const cars = read('cars.json').cars;
  for (const id of ['falcon', 'cadet']) {
    const declared = cars.find((c) => c.id === id)?.targets?.zeroTo100;
    assert.ok(Array.isArray(declared) && declared.length === 2, `${id} should declare its 0-100 target`);
    const measured = id === 'falcon' ? falcon.zeroTo100 : cadet.zeroTo100;
    assert.ok(measured >= declared[0] && measured <= declared[1], `${id} is outside its declared target ${declared.join('-')}s`);
  }
});

/* ------------------------------------------------------------------ 9.12 */

test('9.12 the test track has every situation a car is tuned in', () => {
  const json = read('test-track.json');
  const track = buildTrack(json, config);

  // surfaces: the road, an off-road patch, a crossing and a low-grip patch
  const surfaces = new Set(track.patchList.map((p) => p.surface.id));
  assert.ok(surfaces.has('dirt'), 'an off-road patch');
  assert.ok(surfaces.has('wet') || surfaces.has('oil'), 'a low-grip patch');
  assert.equal(json.baseSurface, 'asphalt');

  // geometry: the road must be wider than any corner it takes, or the inside
  // of the bend folds over and the walls land on the tarmac
  const minFactor = config.tuning.world.minRadiusToWidth;
  assert.ok(
    track.minRadiusM >= (track.widthM / 2) * minFactor,
    `tightest corner r${track.minRadiusM.toFixed(0)} m is too tight for a ${track.widthM} m road`
  );

  // a long straight to test acceleration, braking and top speed
  const centre = track.centreline;
  let longestStraight = 0;
  let run = 0;
  for (let i = 0; i < centre.length; i++) {
    const a = centre[i];
    const b = centre[(i + 1) % centre.length];
    const c = centre[(i + 2) % centre.length];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    run = Math.abs(da) < 0.02 ? run + Math.hypot(b.x - a.x, b.y - a.y) : 0;
    longestStraight = Math.max(longestStraight, run);
  }
  assert.ok(longestStraight > 150, `the test track needs a real straight, longest is ${longestStraight.toFixed(0)} m`);

  // and the autopilot has to be able to drive it: a lap in under two minutes
  const car = new Car(config.carById.get('falcon'), config, { assists: false });
  car.reset({ ...track.startPose });
  const ai = new Autopilot(track, config);
  const lapTimer = new LapTimer(track);
  const visited = new Set();
  let seconds = 0;
  while (seconds < 120 && lapTimer.lapCount === 0) {
    const prevX = car.x;
    const prevY = car.y;
    car.step(DT, ai.update(DT, car), track.world);
    lapTimer.update(DT, car, prevX, prevY);
    visited.add(car.currentSurface?.id);
    seconds += DT;
  }
  assert.equal(lapTimer.lapCount, 1, 'the autopilot should complete a lap of the tuning grounds');
  assert.ok(lapTimer.bestLap < 120, `a tuning lap should be quick to run, took ${lapTimer.bestLap?.toFixed(1)}s`);
  assert.ok(visited.has('asphalt'), 'and it drives the road');
  assert.ok(visited.has('dirt') || visited.has('grass'), 'and it uses the off-road surface it is there to test');
});

test('9.12 a track whose corners fold the road is reported, not shipped', () => {
  const folded = {
    name: 'Folded',
    widthM: 15,
    runoffM: 4,
    grassM: 4,
    wallThicknessM: 1,
    baseSurface: 'asphalt',
    runoffSurface: 'dirt',
    vergeSurface: 'grass',
    start: { x: 0, y: 0, headingDeg: 0 },
    // a 10 m radius loop on a 15 m wide road
    centreline: Array.from({ length: 24 }, (_, i) => ({
      x: Math.cos((i / 24) * Math.PI * 2) * 10,
      y: Math.sin((i / 24) * Math.PI * 2) * 10
    })),
    patches: [],
    decor: []
  };
  const warnings = [];
  const probe = {
    ...config,
    warnings: { push: (w) => warnings.push(w) },
    tuning: config.tuning
  };
  buildTrack(folded, probe);
  assert.ok(
    warnings.some((w) => /tightest corner/.test(w)),
    `a folded track must warn (got: ${warnings.join(' | ') || 'nothing'})`
  );
});

test('9.12 the tuning panel edits the live data and copies a diff', async () => {
  const { setupDom, stubFetch } = await import('./dom-stub.mjs');
  const dom = setupDom();
  globalThis.fetch = stubFetch(readFileSync, ROOT);
  try {
    const { boot } = await import('../src/boot.js');
    const apex = await boot();
    assert.ok(apex, 'the game must boot');
    const tuner = apex.tuner;
    apex.game.frame(16.67);

    // hidden until asked for, then it reads the car
    assert.equal(tuner.visible, false);
    apex.game.handleActions(['tuner']);
    apex.game.frame(33);
    assert.equal(tuner.visible, true, 'K (the `tuner` action) opens the panel');
    assert.ok(tuner.rows.length >= 20, 'the panel has sliders');
    assert.ok(tuner.context.textContent.includes(apex.game.car.name), 'and it names the car being tuned');

    // the readouts come from the live telemetry, every frame
    const before = Number(tuner.readoutCells.speed.value.textContent);
    let clock = 33;
    for (let i = 0; i < 90; i++) {
      apex.game.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: false });
      clock += 16.7;
    }
    apex.game.frame(clock);
    const after = Number(tuner.readoutCells.speed.value.textContent);
    assert.ok(Number.isFinite(after) && after > before, `the speed readout follows the car (${before} -> ${after})`);
    assert.ok(/^\d+$/.test(tuner.readoutCells.rpm.value.textContent), 'rpm is shown');
    assert.ok(/^\d+$/.test(tuner.readoutCells.gear.value.textContent), 'gear is shown');
    assert.ok(tuner.readoutCells.gripFront.value.textContent !== '-', 'grip per axle is shown');
    assert.ok(Number(tuner.readoutCells.fps.value.textContent) > 0, 'fps is shown');

    // a global constant is written straight into the live tuning data
    const driftRow = tuner.rows.find((r) => r.path === 'drift.minSlipAngleDeg');
    assert.ok(driftRow, 'the panel exposes the drift entry threshold');
    driftRow.slider.value = '21';
    driftRow.slider.dispatch('input');
    assert.equal(apex.config.tuning.drift.minSlipAngleDeg, 21, 'moving a global slider changes the simulation immediately');
    assert.equal(apex.config.tuningBaseline.drift.minSlipAngleDeg, 15, 'while the baseline remembers what it booted with');

    // a car profile row queues a rebuild and the car comes back changed
    const gripRow = tuner.rows.find((r) => r.group === 'car' && r.path === 'tires.gripFront');
    assert.ok(gripRow, 'the panel exposes the 9.11 profile');
    gripRow.slider.value = '1.44';
    gripRow.slider.dispatch('input');
    assert.ok(tuner.profilePatch().kalos_gt['tires.gripFront'] === 1.44, 'the edit is queued as a profile patch');
    const carId = apex.game.car.id;
    const laps = apex.game.lapTimer.lapCount;
    await apex.rebuildWorld('car profile');
    assert.equal(apex.game.car.id, carId, 'the player keeps their car across a rebuild');
    assert.equal(apex.game.car.def.tires.gripFront, 1.44, 'and the profile is applied');
    assert.equal(apex.game.lapTimer.lapCount, laps, 'the race state survives');
    assert.ok(tuner.rebuilds >= 1, 'the rebuild is reported back to the panel');

    // reset puts the data back
    tuner.resetAll();
    assert.equal(apex.config.tuning.drift.minSlipAngleDeg, 15, 'Reset all restores the boot values');

    // the diff is the paste-ready JSON (a fresh edit after the reset)
    driftRow.slider.value = '19';
    driftRow.slider.dispatch('input');
    gripRow.slider.value = '1.3';
    gripRow.slider.dispatch('input');
    const diff = tuner.diff();
    assert.equal(diff.tuning['drift.minSlipAngleDeg'], 19, 'the diff carries the global change');
    assert.ok(diff.carProfiles.kalos_gt, 'and the car profile change');
    assert.ok(!('steering.steerRateDegPerSec' in diff.tuning), 'but not values left at their boot defaults');
    assert.match(tuner.copyJson(), /"drift\.minSlipAngleDeg": 19/);

    // closing it again leaves the game alone
    apex.game.handleActions(['tuner']);
    assert.equal(tuner.visible, false);
    tuner.dispose(); // drop the pending debounce before the stub DOM goes away
  } finally {
    dom.restore();
  }
});

test('9.12 a circuit switch rebuilds the world without losing the player', async () => {
  const { setupDom, stubFetch } = await import('./dom-stub.mjs');
  const dom = setupDom();
  globalThis.fetch = stubFetch(readFileSync, ROOT);
  try {
    const { boot } = await import('../src/boot.js');
    const apex = await boot();
    const first = apex.game.track.name;
    apex.game.economy.coins = 321;
    apex.game.selectCar('falcon');
    apex.game.handleActions(['difficulty']);
    const difficulty = apex.game.difficulty.id;

    await apex.switchCircuit(1);
    const second = apex.game.track.name;
    assert.notEqual(second, first, 'switching circuits changes the track');
    assert.equal(apex.game.car.id, 'falcon', 'the player keeps their car');
    assert.equal(apex.game.economy.coins, 321, 'and their wallet');
    assert.equal(apex.game.difficulty.id, difficulty, 'and their difficulty');
    assert.ok(apex.track.centreline.length > 50, 'the new track is built');
    assert.ok(apex.game.track === apex.track, 'and the game is driving on it');

    // and back again
    await apex.switchCircuit(1);
    assert.equal(apex.game.track.name, first, 'cycling twice returns to the first circuit');
  } finally {
    dom.restore();
  }
});
