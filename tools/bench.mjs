#!/usr/bin/env node
/**
 * bench.mjs - head-less physics harness. Runs the REAL fixed-step simulator
 * (src/car.js + src/tires.js + src/engine.js) on flat ground and prints numbers
 * that are easy to sanity-check against reality:
 *
 *   accel   0-100 km/h, 0-200 km/h, 400 m, top speed, shift points
 *   brakes  100-0 km/h distance and the peak g
 *   corner  steady-state lateral g, body slip, which axle lets go first
 *   drift   handbrake entry, then counter-steer + power: does the slide hold?
 *   limit   wet / gravel / grass full-lock behaviour
 *
 * Note: samples are SNAPSHOTS of the car state, never the live car object.
 *
 * Usage: node tools/bench.mjs [carId] [--json]
 */

import { loadConfigFromDisk } from '../src/config.js';
import { Car } from '../src/car.js';
import { createFlatWorld } from '../src/world.js';

const PHYSICS_DT = 1 / 60;
const G = 9.81;
const DEG = 180 / Math.PI;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function makeCar(config, carId) {
  const def = carId ? config.carById.get(carId) : config.cars[0];
  if (!def) throw new Error(`unknown car "${carId}"`);
  return new Car(def, config);
}

function snapshot(car, extra = {}) {
  return {
    speedMs: car.speedMs,
    forwardSpeedMs: car.forwardSpeedMs,
    slipAngleBodyDeg: car.slipAngleBodyDeg,
    yawRate: car.yawRate,
    steerAngleRad: car.steerAngleRad,
    lateralAccelMs2: car.lateralAccelMs2,
    longitudinalAccelMs2: car.longitudinalAccelMs2,
    frontSlipMs: car.frontAxle.slipVelocityMs,
    rearSlipMs: car.rearAxle.slipVelocityMs,
    frontSliding: car.frontAxle.sliding,
    rearSliding: car.rearAxle.sliding,
    rearWheelspin: car.rearAxle.wheelspin,
    frontWheelspin: car.frontAxle.wheelspin,
    surface: car.currentSurface?.id ?? null,
    x: car.x,
    y: car.y,
    ...extra
  };
}

function run(car, worldRef, seconds, controller, onTick) {
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * PHYSICS_DT;
    car.step(PHYSICS_DT, controller(t, car), worldRef);
    if (onTick) onTick(car, t, i);
  }
}

/** A P controller that holds a speed; returns a partial input object. */
function holdSpeed(targetMs, car) {
  const error = targetMs - car.speedMs;
  return {
    throttle: error > 0 ? clamp01(error * 0.6) : 0,
    brake: error < 0 ? clamp01(-error * 0.5) : 0,
    steer: 0,
    handbrake: false
  };
}

function accelTest(config, carId) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, 'asphalt');
  car.reset({ x: 0, y: 0, heading: 0 });
  const result = { car: car.id, name: car.name, klass: car.klass };
  let t100 = null;
  let t200 = null;
  let t400 = null;
  let distance = 0;
  let lastX = 0;
  const shifts = [];
  let lastGear = car.engine.gear;

  run(
    car,
    w,
    50,
    () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false }),
    (c, t) => {
      distance += c.x - lastX;
      lastX = c.x;
      const kph = c.speedMs * 3.6;
      if (t100 === null && kph >= 100) t100 = t;
      if (t200 === null && kph >= 200) t200 = t;
      if (t400 === null && distance >= 400) t400 = t;
      if (c.engine.gear !== lastGear) {
        lastGear = c.engine.gear;
        shifts.push({ gear: c.engine.gear, t: +t.toFixed(2), kph: +kph.toFixed(1), rpm: Math.round(c.engine.rpm) });
      }
    }
  );
  result.zeroTo100 = t100;
  result.zeroTo200 = t200;
  result.quarterMileTime = t400;
  result.topSpeedKph = +(car.speedMs * 3.6).toFixed(1);
  result.shifts = shifts;
  const def = config.carById.get(car.id);
  // The gearing ceiling is the rev LIMITER in top gear - the redline is where
  // the engine stops making useful power, not where the wheels stop turning.
  result.gearingTopKph = +((((def.engine.revLimiterRpm ?? def.engine.redlineRpm) / 60) * 2 * Math.PI * def.tires.radiusM * 3.6) / def.drivetrain.ratioTotals[4]).toFixed(1);
  return result;
}

function brakeTest(config, carId) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, 'asphalt');
  car.reset({ x: 0, y: 0, heading: 0 });
  run(car, w, 14, (t, c) => {
    const kph = c.speedMs * 3.6;
    return { throttle: kph < 99 ? 1 : 0, brake: kph > 101 ? 0.35 : 0, steer: 0, handbrake: false };
  });
  const startOdometer = car.odometerM;
  const startSpeed = car.speedMs;
  let peakG = 0;
  const steps = Math.round(8 / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    car.step(PHYSICS_DT, { throttle: 0, brake: 1, steer: 0, handbrake: false }, w);
    peakG = Math.max(peakG, Math.abs(Math.min(0, car.longitudinalAccelMs2)) / G);
    if (car.speedMs < 2 / 3.6) break;
  }
  return {
    car: car.id,
    fromKph: +(startSpeed * 3.6).toFixed(1),
    distanceM: +(car.odometerM - startOdometer).toFixed(1),
    peakG: +peakG.toFixed(2)
  };
}

/** Steady corner: hold the speed, apply a fixed steer, average the last window. */
function cornerTest(config, carId, speedKph, steerInput, surface = 'asphalt') {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, surface);
  const target = speedKph / 3.6;
  car.reset({ x: 0, y: 0, heading: 0, speedMs: target });
  const samples = [];
  run(
    car,
    w,
    8,
    (t, c) => ({ ...holdSpeed(target, c), steer: t < 0.2 ? 0 : steerInput, throttle: t < 0.2 ? 0.4 : holdSpeed(target, c).throttle }),
    (c, t) => {
      if (t > 6.5) samples.push(snapshot(c));
    }
  );
  const steady = samples.filter((s) => Math.abs(s.speedMs - target) < Math.max(2.5, target * 0.12));
  const use = steady.length > 5 ? steady : samples.slice(-20);
  const avg = (f) => use.reduce((a, s) => a + f(s), 0) / Math.max(1, use.length);
  return {
    car: car.id,
    surface,
    speedKph,
    steerInput,
    settled: steady.length > 5,
    latG: +(Math.max(...use.map((s) => Math.abs(s.lateralAccelMs2))) / G).toFixed(3),
    bodySlipDeg: +avg((s) => s.slipAngleBodyDeg).toFixed(2),
    frontSlipDeg: +(Math.atan2(avg((s) => s.frontSlipMs), Math.max(3, avg((s) => s.forwardSpeedMs))) * DEG).toFixed(2),
    rearSlipDeg: +(Math.atan2(avg((s) => s.rearSlipMs), Math.max(3, avg((s) => s.forwardSpeedMs))) * DEG).toFixed(2),
    frontSliding: use.filter((s) => s.frontSliding).length > use.length * 0.5,
    rearSliding: use.filter((s) => s.rearSliding).length > use.length * 0.5,
    radiusM: +(avg((s) => s.speedMs) / Math.max(1e-3, Math.abs(avg((s) => s.yawRate)))).toFixed(1),
    steeringDeg: +avg((s) => s.steerAngleRad * DEG).toFixed(1)
  };
}

/** Handbrake entry, then counter-steer and hold the throttle: a drift. */
function driftTest(config, carId) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, 'asphalt');
  car.reset({ x: 0, y: 0, heading: 0, speedMs: 60 / 3.6 });
  // turn in
  run(car, w, 1.2, (t, c) => ({ ...holdSpeed(60 / 3.6, c), steer: 0.75, throttle: 0.55 }));
  const samples = [];
  let entryEnd = null;
  run(
    car,
    w,
    6,
    (t, c) => {
      if (t < 0.45) return { throttle: 0.2, brake: 0, steer: 1, handbrake: true };
      if (entryEnd === null) entryEnd = t;
      const counter = clamp01(Math.abs(c.slipAngleBodyDeg) / 55) * 0.9;
      return {
        throttle: 0.8,
        brake: 0,
        steer: c.slipAngleBodyDeg > 0 ? -counter : counter,
        handbrake: false
      };
    },
    (c, t) => {
      if (t > 0.1) samples.push(snapshot(c, { afterEntry: t - 0.45 }));
    }
  );
  if (!samples.length) return { car: car.id, failed: true };
  const window = samples.filter((s) => s.afterEntry < 1.6);
  const slip = window.map((s) => Math.abs(s.slipAngleBodyDeg));
  const allSlip = samples.map((s) => Math.abs(s.slipAngleBodyDeg));
  const last = samples[samples.length - 1];
  return {
    car: car.id,
    avgSlipDeg: +(slip.reduce((a, b) => a + b, 0) / Math.max(1, slip.length)).toFixed(1),
    peakSlipDeg: +Math.max(...allSlip).toFixed(1),
    heldSlide: +(slip.filter((s) => s > 15).length / Math.max(1, slip.length)).toFixed(2),
    spunOut: Math.max(...allSlip) > 100,
    recovered: Math.abs(last.slipAngleBodyDeg) < 25,
    endSpeedKph: +(last.speedMs * 3.6).toFixed(1)
  };
}

/** Full lock at speed on a low grip surface while holding the speed: stable or gone? */
function stabilityTest(config, carId, surface, speedKph) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, surface);
  const target = speedKph / 3.6;
  car.reset({ x: 0, y: 0, heading: 0, speedMs: target });
  let spun = false;
  let maxSlip = 0;
  const samples = [];
  run(
    car,
    w,
    6,
    (t, c) => ({ ...holdSpeed(target, c), steer: t < 0.3 ? 0 : 1 }),
    (c, t) => {
      const s = snapshot(c);
      samples.push(s);
      maxSlip = Math.max(maxSlip, Math.abs(s.slipAngleBodyDeg));
      if (Math.abs(s.slipAngleBodyDeg) > 80) spun = true;
      void t;
    }
  );
  const last = samples[samples.length - 1];
  return {
    car: car.id,
    surface,
    speedKph,
    spun,
    maxSlipDeg: +maxSlip.toFixed(1),
    endSpeedKph: +(last.speedMs * 3.6).toFixed(1),
    rearSliding: samples.filter((s) => s.rearSliding).length > samples.length * 0.4
  };
}

/**
 * 9.12 feel target: "a high-speed turn with throttle should drift". Full
 * throttle through a fast corner - a rear-drive or all-wheel-drive car should
 * rotate (slip angle up), a front-drive car will plough instead.
 */
function powerTest(config, carId, speedKph = 120, steerInput = 0.7) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, 'asphalt');
  car.reset({ x: 0, y: 0, heading: 0, speedMs: speedKph / 3.6 });
  let peakSlip = 0;
  let spinning = 0;
  let samples = 0;
  run(
    car,
    w,
    4,
    (t) => ({ throttle: t < 0.3 ? 0.3 : 1, brake: 0, steer: t < 0.2 ? 0 : steerInput, handbrake: false }),
    (c, t) => {
      if (t < 1) return;
      samples++;
      peakSlip = Math.max(peakSlip, Math.abs(c.slipAngleBodyDeg));
      if (Math.abs(c.slipAngleBodyDeg) > 60) spinning++;
    }
  );
  return {
    car: car.id,
    speedKph,
    steerInput,
    peakSlipDeg: +peakSlip.toFixed(1),
    spinFraction: +(spinning / Math.max(1, samples)).toFixed(2)
  };
}

/**
 * 9.12 feel target: "a moderate-speed turn should feel controllable ... a
 * beginner can still finish the race without spinning out". A gentle, fixed
 * steering input at a moderate speed must never end in a spin.
 */
function moderateTest(config, carId, speedKph = 90, steerInput = 0.35) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, 'asphalt');
  car.reset({ x: 0, y: 0, heading: 0, speedMs: speedKph / 3.6 });
  let maxSlip = 0;
  let spins = 0;
  let samples = 0;
  run(
    car,
    w,
    6,
    (t, c) => ({ ...holdSpeed(speedKph / 3.6, c), steer: t < 0.3 ? 0 : steerInput }),
    (c, t) => {
      if (t < 0.6) return;
      samples++;
      maxSlip = Math.max(maxSlip, Math.abs(c.slipAngleBodyDeg));
      if (Math.abs(c.slipAngleBodyDeg) > 45 || Math.abs(c.yawRate) > 2.2) spins++;
    }
  );
  return {
    car: car.id,
    speedKph,
    steerInput,
    maxSlipDeg: +maxSlip.toFixed(1),
    spinFraction: +(spins / Math.max(1, samples)).toFixed(2)
  };
}

/** Standing start, full lock, full throttle: can it do a donut? */
function donutTest(config, carId) {
  const car = makeCar(config, carId);
  const w = createFlatWorld(config, 'asphalt');
  car.reset({ x: 0, y: 0, heading: 0 });
  let wheelspin = 0;
  let maxSlip = 0;
  run(
    car,
    w,
    8,
    () => ({ throttle: 1, brake: 0, steer: 1, handbrake: false }),
    (c) => {
      wheelspin = Math.max(wheelspin, c.rearAxle.wheelspin);
      maxSlip = Math.max(maxSlip, Math.abs(c.slipAngleBodyDeg));
    }
  );
  return {
    car: car.id,
    maxWheelspin: +wheelspin.toFixed(2),
    maxSlipDeg: +maxSlip.toFixed(1),
    endSpeedKph: +(car.speedMs * 3.6).toFixed(1)
  };
}

async function main() {
  const args = process.argv.slice(2);
  const carId = args.find((a) => !a.startsWith('--'));
  const asJson = args.includes('--json');
  const config = await loadConfigFromDisk(undefined, { strictTuning: true });
  const ids = carId ? [carId] : config.cars.map((c) => c.id);

  const results = ids.map((id) => ({
    accel: accelTest(config, id),
    brake: brakeTest(config, id),
    corner120: cornerTest(config, id, 120, 0.6),
    corner80: cornerTest(config, id, 80, 1),
    cornerWet: cornerTest(config, id, 100, 0.8, 'wet'),
    drift: driftTest(config, id),
    power: powerTest(config, id),
    moderate: moderateTest(config, id),
    donut: donutTest(config, id),
    wet: stabilityTest(config, id, 'wet', 100),
    gravel: stabilityTest(config, id, 'dirt', 90),
    grass: stabilityTest(config, id, 'grass', 70)
  }));

  if (asJson) {
    console.log(JSON.stringify({ results, validation: validate(results, config) }, null, 2));
    return;
  }

  for (const r of results) {
    const a = r.accel;
    console.log(`\n=== ${a.name} (${a.car}) - ${a.klass} ===`);
    console.log(
      `accel : 0-100 ${a.zeroTo100?.toFixed(2)}s  0-200 ${a.zeroTo200 ? a.zeroTo200.toFixed(2) + 's' : '  --  '}  400m ${a.quarterMileTime?.toFixed(2)}s  top ${a.topSpeedKph} km/h (gearing ${a.gearingTopKph})`
    );
    console.log(`        shifts ${a.shifts.map((s) => `${s.gear}@${s.kph}kph/${s.rpm}rpm`).join('  ')}`);
    console.log(`brakes: ${r.brake.fromKph} km/h -> 0 in ${r.brake.distanceM} m (peak ${r.brake.peakG}g)`);
    for (const c of [r.corner120, r.corner80, r.cornerWet]) {
      console.log(
        `corner: ${String(c.speedKph).padStart(3)}kph steer ${c.steerInput} [${c.surface.padEnd(7)}]${c.settled ? '' : ' *'} ${String(c.latG).padStart(5)}g  steer ${String(c.steeringDeg).padStart(5)}deg  bodySlip ${String(c.bodySlipDeg).padStart(6)}deg  front ${String(c.frontSlipDeg).padStart(6)}${c.frontSliding ? ' SLIDE' : '      '}  rear ${String(c.rearSlipDeg).padStart(6)}${c.rearSliding ? ' SLIDE' : '      '}  radius ${c.radiusM}m`
      );
    }
    console.log(
      `drift : avgSlip ${r.drift.avgSlipDeg}deg peak ${r.drift.peakSlipDeg}deg heldSlide ${(r.drift.heldSlide * 100).toFixed(0)}% spunOut ${r.drift.spunOut} recovered ${r.drift.recovered} end ${r.drift.endSpeedKph}kph`
    );
    console.log(
      `power : 120kph steer 0.7 full throttle -> peak slip ${String(r.power.peakSlipDeg).padStart(5)}deg  spin ${(r.power.spinFraction * 100).toFixed(0)}%`
    );
    console.log(
      `easy  :  90kph steer 0.35 -> max slip ${String(r.moderate.maxSlipDeg).padStart(5)}deg  spin ${(r.moderate.spinFraction * 100).toFixed(0)}%`
    );
    console.log(`donut : maxWheelspin ${r.donut.maxWheelspin}  maxSlip ${r.donut.maxSlipDeg}deg`);
    console.log(
      `limit : wet100 spun ${r.wet.spun} (slip ${r.wet.maxSlipDeg} end ${r.wet.endSpeedKph})  gravel90 spun ${r.gravel.spun} (${r.gravel.maxSlipDeg} end ${r.gravel.endSpeedKph})  grass70 spun ${r.grass.spun} (${r.grass.maxSlipDeg})`
    );
  }
  console.log('\nvalidation:');
  for (const line of validate(results, config)) console.log('  ' + line);
}

/**
 * 9.12: every window the cars are held to comes from tuning.feel, so the feel
 * targets are data - change the target, not the tool.
 */
function validate(results, config) {
  const notes = [];
  const feel = config?.tuning?.feel ?? {};
  const byClass = (table, klass) => table?.[klass] ?? null;
  for (const r of results) {
    const a = r.accel;
    const id = a.car;
    const def = config?.carById?.get(id);
    // a profile car may declare the tier it was authored to hit (9.12)
    const declared = def?.profile?.targets?.zeroTo100 ?? null;
    const window100 = declared ?? byClass(feel.zeroTo100ByClass, a.klass);
    if (!Number.isFinite(a.zeroTo100)) notes.push(`${id}: never reached 100 km/h`);
    else if (a.zeroTo100 < 1.6) notes.push(`${id}: 0-100 in ${a.zeroTo100.toFixed(2)}s is beyond believable`);
    else if (window100 && (a.zeroTo100 < window100[0] || a.zeroTo100 > window100[1])) {
      const what = declared ? 'its declared profile target' : `the ${a.klass} target`;
      notes.push(`${id}: 0-100 in ${a.zeroTo100.toFixed(2)}s is outside ${what} ${window100[0]}-${window100[1]}s`);
    }
    const windowTop = byClass(feel.topSpeedKphByClass, a.klass);
    if (windowTop && (a.topSpeedKph < windowTop[0] || a.topSpeedKph > windowTop[1])) {
      notes.push(`${id}: top speed ${a.topSpeedKph} km/h is outside the ${a.klass} target ${windowTop[0]}-${windowTop[1]}`);
    }
    if (r.brake.distanceM < (feel.minBrakeM ?? 25)) notes.push(`${id}: stops from 100 in ${r.brake.distanceM}m - too much grip`);
    else if (r.brake.distanceM > (feel.maxBrakeM ?? 60)) notes.push(`${id}: stops from 100 in ${r.brake.distanceM}m - brakes too weak`);
    if (r.brake.peakG > 1.6) notes.push(`${id}: ${r.brake.peakG}g under braking`);
    for (const c of [r.corner120, r.corner80]) {
      if (c.latG > (feel.maxLatG ?? 1.75)) notes.push(`${id}: ${c.latG}g cornering is not believable`);
      if (c.latG < (feel.minLatG ?? 0.5)) notes.push(`${id}: only ${c.latG}g at ${c.speedKph} km/h - grip too low`);
    }
    if (a.topSpeedKph > a.gearingTopKph * 1.02) notes.push(`${id}: top speed above what the gearing allows`);
    if (r.cornerWet.latG > r.corner120.latG) notes.push(`${id}: more grip on wet than dry`);
    if (!Number.isFinite(r.drift.avgSlipDeg)) notes.push(`${id}: NaN in the drift test`);
    if (Number.isNaN(r.donut.maxWheelspin)) notes.push(`${id}: NaN in the donut test`);
    // 9.12 feel: a moderate turn must stay controllable ...
    if (r.moderate.spinFraction > 0) {
      notes.push(`${id}: spins in a moderate ${r.moderate.speedKph} km/h turn (slip ${r.moderate.maxSlipDeg}deg)`);
    }
    // ... a high-speed turn on the throttle must rotate the car (not for FWD)
    const layout = def?.drivetrain?.layout;
    if (layout !== 'FWD' && r.power.peakSlipDeg < (feel.powerOversteerMinSlipDeg ?? 8)) {
      notes.push(`${id}: ${layout} car does not drift on power (peak slip ${r.power.peakSlipDeg}deg)`);
    }
    // 9.11: a profile car's quoted top speed must be the one it actually reaches
    const quotedKph = def?.profile?.topSpeed ? def.profile.topSpeed * 3.6 : null;
    if (quotedKph && Math.abs(a.topSpeedKph - quotedKph) / quotedKph > 0.05) {
      notes.push(`${id}: reaches ${a.topSpeedKph} km/h but its profile says ${quotedKph.toFixed(0)} km/h`);
    }
  }
  if (!notes.length) notes.push('all checks passed');
  return notes;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
