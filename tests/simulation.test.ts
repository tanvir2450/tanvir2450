import { describe, expect, it } from 'vitest';
import { catalog, defaultTuning, profileById, tracks, validateCatalog } from '../src/sim/catalog';
import { carBox, hitZone, intersectBoxes, resolveCollision, segmentBox } from '../src/sim/collision';
import { vec } from '../src/sim/math';
import { createCar, neutralInput, Simulation, torqueAtRpm } from '../src/sim/simulation';
import type { DriveInput } from '../src/sim/types';

const drive: DriveInput = { ...neutralInput, throttle: 1 };
const advance = (sim: Simulation, seconds: number, input: DriveInput = drive) => {
  const steps = Math.round(seconds * sim.tuning.simulation.hz);
  for (let i = 0; i < steps; i++) sim.step(input);
};

describe('data and courses', () => {
  it('keeps the user-supplied Falcon stats verbatim and registers eight unique playable cars', () => {
    expect(() => validateCatalog()).not.toThrow();
    expect(catalog.cars).toHaveLength(8);
    const falcon = profileById('falcon');
    expect(falcon).toEqual({
      id: 'falcon', mass: 1250, enginePower: 310,
      torqueCurve: [.55, .85, 1, .9, .7], gearRatios: [3.2, 2.2, 1.6, 1.2, .95],
      topSpeed: 62, gripFront: 1.05, gripRear: .95, slideGrip: .7,
      steerMax: 32, steerSpeedFalloff: .75, brakeForce: 1, dragCoeff: .35,
      armor: 4, nitroCapacity: 5,
    });
    expect(new Set(catalog.cars.map(car => car.id)).size).toBe(8);
  });

  it('contains a looping proving ground and oval plus all five surfaces', () => {
    expect(tracks.map(t => t.config.id)).toEqual(['proving_ground', 'oval', 'drag_strip']);
    expect(tracks.map(t => t.config.code)).toEqual(['PG-01', 'OV-02', 'LS-03']);
    for (const track of tracks) {
      expect(track.length).toBeGreaterThan(300);
      expect(track.at(0).point.x).toBeCloseTo(track.at(track.length).point.x, 4);
      expect(track.nearest(track.config.start).distance).toBeLessThan(track.config.roadWidth / 2);
    }
    const track = tracks[0];
    expect(track.surfaceAt(vec(129, 122))).toBe('oil');
    expect(track.surfaceAt(vec(166, 120))).toBe('wet');
    expect(track.surfaceAt(vec(108, 35))).toBe('dirt');
    expect(track.surfaceAt(vec(95, 50))).toBe('dirt');
    expect(track.surfaceAt(vec(132, 76))).toBe('grass');
  });
});

describe('deterministic drivetrain and handling', () => {
  it('uses five automatic gears, 5-point torque interpolation and shift torque cuts', () => {
    const tuning = defaultTuning();
    const sim = new Simulation('falcon', 'proving_ground', tuning);
    sim.traffic = [];
    const idle = torqueAtRpm(sim.player, tuning);
    sim.player.rpm = tuning.engine.peakPowerRpm;
    expect(torqueAtRpm(sim.player, tuning)).toBeGreaterThan(idle);
    const shifts: number[] = [];
    for (let i = 0; i < 1100; i++) {
      sim.step(drive);
      for (const event of sim.consumeEvents()) if (event.type === 'shift') {
        expect(sim.player.shiftCut).toBeGreaterThan(0);
        shifts.push(event.value!);
      }
    }
    expect(shifts[0]).toBe(2);
    expect(shifts.every(gear => gear >= 1 && gear <= 5)).toBe(true);
    expect(sim.player.gear).toBeGreaterThan(1);
    expect(sim.player.rpm).toBeGreaterThanOrEqual(tuning.engine.idleRpm);
    expect(sim.player.rpm).toBeLessThanOrEqual(tuning.engine.redlineRpm);
  });

  it('gives the same outcome with 30, 60 and 120 Hz render frames', () => {
    const run = (fps: number) => {
      const sim = new Simulation('falcon');
      sim.traffic = [];
      let accumulator = 0;
      const fixed = 1 / sim.tuning.simulation.hz;
      for (let frame = 0; frame < fps * 5; frame++) {
        accumulator += 1 / fps;
        while (accumulator + 1e-12 >= fixed) { sim.step(drive, fixed); accumulator -= fixed; }
      }
      return sim.player;
    };
    const a = run(30), b = run(60), c = run(120);
    for (const car of [b, c]) {
      expect(car.position.x).toBeCloseTo(a.position.x, 8);
      expect(car.position.y).toBeCloseTo(a.position.y, 8);
      expect(car.velocity.x).toBeCloseTo(a.velocity.x, 8);
      expect(car.gear).toBe(a.gear);
    }
  });

  it('has starter ~9 s and sport ~6 s 0–100 km/h targets on a straight test run', () => {
    const times: Record<string, number> = {};
    for (const id of ['compact_starter', 'falcon', 'spectre_rs']) {
      const sim = new Simulation(id, 'drag_strip');
      sim.traffic = [];
      sim.player.heading = 0; // launch straight, no steering or traffic
      for (let i = 0; i < 900; i++) {
        sim.step(drive);
        if (Math.hypot(sim.player.velocity.x, sim.player.velocity.y) * 3.6 >= 100) { times[id] = i / 60; break; }
      }
    }
    // Calibrated against 9.12 on a dry, traffic-free 400 m straight:
    // Metro ~9.0 s, Falcon ~6.2 s, Spectre RS ~6.1 s (60 Hz simulation).
    expect(times.compact_starter).toBeGreaterThan(8);
    expect(times.compact_starter).toBeLessThan(10);
    expect(times.falcon).toBeGreaterThan(5.5);
    expect(times.falcon).toBeLessThan(7);
    expect(times.spectre_rs).toBeGreaterThan(5.5);
    expect(times.spectre_rs).toBeLessThan(7);
  });

  it('loses sideways momentum slowly on wet and much more slowly on oil', () => {
    const slides: Record<string, number> = {};
    for (const [surface, position] of [['asphalt', vec(80, 122)], ['wet', vec(166, 120)], ['oil', vec(129, 122)]] as const) {
      const sim = new Simulation(); sim.traffic = [];
      sim.player.position = position;
      sim.player.heading = 0;
      sim.player.velocity = vec(2, 7);
      advance(sim, .12, neutralInput);
      slides[surface] = Math.abs(sim.player.velocity.y);
    }
    expect(slides.wet).toBeGreaterThan(slides.asphalt);
    expect(slides.oil).toBeGreaterThan(slides.wet);
  });

  it('ramps keyboard steering, limits steering at speed and locks rear grip for handbrake', () => {
    const low = new Simulation(); low.traffic = [];
    low.step({ ...drive, steer: 1 });
    expect(low.player.steerInput).toBeGreaterThan(0);
    expect(low.player.steerInput).toBeLessThan(1);
    advance(low, .3, { ...drive, steer: 1, handbrake: true });
    expect(low.player.handbrakeTime).toBeGreaterThan(0);
    expect(low.player.steerInput).toBe(1);
    const high = new Simulation(); high.traffic = [];
    high.player.velocity = vec(35, 0);
    advance(high, .3, { ...drive, steer: 1 });
    expect(Math.abs(high.player.steering)).toBeLessThan(Math.abs(low.player.steering));
  });

  it('can hold and bank a countersteered handbrake drift; braking spends front grip', () => {
    const sim = new Simulation('falcon', 'drag_strip');
    sim.traffic = [];
    sim.player.position = vec(170, 130);
    sim.player.heading = 0;
    sim.player.velocity = vec(22, 0);
    const nitroBefore = sim.player.nitro;
    let driftingFrames = 0;
    for (let i = 0; i < 200; i++) {
      sim.step({ ...drive, source: 'analog', steer: i < 24 ? .8 : -1, handbrake: i < 24, throttle: i < 70 ? 1 : .3 });
      if (sim.player.drifting) driftingFrames++;
    }
    expect(driftingFrames).toBeGreaterThan(40);
    expect(sim.player.driftPoints).toBeGreaterThan(0);
    expect(sim.styleScore).toBeGreaterThan(0);
    expect(sim.player.nitro).toBeGreaterThan(nitroBefore);

    const clear = new Simulation('falcon', 'drag_strip'); clear.traffic = [];
    const braking = new Simulation('falcon', 'drag_strip'); braking.traffic = [];
    clear.player.velocity = vec(19, 0);
    braking.player.velocity = vec(19, 0);
    clear.player.heading = 0;
    braking.player.heading = 0;
    clear.step({ ...neutralInput, steer: .8, source: 'analog' });
    braking.step({ ...neutralInput, steer: .8, brake: 1, source: 'analog' });
    expect(braking.player.frontGripUsage).toBeGreaterThan(clear.player.frontGripUsage);
  });

  it('drains nitro to a lockout and recharges from slipstream', () => {
    const sim = new Simulation();
    sim.traffic = [];
    sim.player.nitro = .03;
    advance(sim, .12, { ...drive, nitro: true });
    expect(sim.player.nitro).toBe(0);
    expect(sim.player.nitroLock).toBeGreaterThan(1);
    sim.player.nitro = 1;
    sim.step({ ...drive, nitro: true });
    expect(sim.player.nitroActive).toBe(false);
    const behind = new Simulation();
    const p = behind.player, npc = behind.traffic[0].car;
    p.heading = 0; p.position = vec(65, 122); p.velocity = vec(15, 0); p.nitro = 0;
    npc.heading = 0; npc.position = vec(75, 122); npc.velocity = vec(15, 0);
    behind.traffic = [behind.traffic[0]];
    behind.step(drive);
    expect(p.drafting).toBe(true);
    expect(p.nitro).toBeGreaterThan(0);
  });
});

describe('impacts, damage and rewards', () => {
  it('keeps AI traffic close to the route over 30 seconds', () => {
    const sim = new Simulation();
    advance(sim, 30, neutralInput);
    for (const { car } of sim.traffic) {
      expect(sim.track.nearest(car.position).distance).toBeLessThan(sim.track.config.roadWidth / 2 + 3);
      expect(car.health).toBeGreaterThan(20);
    }
  });

  it('applies front-zone crash damage and a brief hit-stop at a wall', () => {
    const sim = new Simulation(); sim.traffic = [];
    const car = sim.player;
    car.position = vec(75, 130.4);
    car.heading = Math.PI / 2;
    car.velocity = vec(0, 10);
    sim.step(neutralInput);
    expect(car.health).toBeLessThan(sim.tuning.damage.maxHealth);
    expect(car.zones.front).toBeGreaterThan(0);
    expect(sim.hitStop).toBeGreaterThan(0);
    expect(sim.consumeEvents().some(e => e.type === 'impact')).toBe(true);
  });

  it('resolves rotated car and wall rectangles, and the heavier car takes less momentum change', () => {
    const tuning = defaultTuning();
    const light = createCar('compact_starter', vec(0, 0), 0, 'light', tuning);
    const heavy = createCar('ironclad', vec(3, .3), .07, 'heavy', tuning);
    light.velocity = vec(12, 0);
    const contact = intersectBoxes(carBox(light), carBox(heavy));
    expect(contact).not.toBeNull();
    expect(hitZone(light, contact!.normal)).toBe('front');
    expect(hitZone(heavy, { x: -contact!.normal.x, y: -contact!.normal.y })).toBe('rear');
    const result = resolveCollision(light, heavy, contact!, tuning);
    expect(result.impactEnergy).toBeGreaterThan(0);
    expect(12 - light.velocity.x).toBeGreaterThan(heavy.velocity.x);
    expect(intersectBoxes(carBox(light), segmentBox([5, -5, 5, 5]))).toBeNull();
  });

  it('does not reward a crash as a near miss', () => {
    const sim = new Simulation('falcon', 'drag_strip');
    const npc = sim.traffic[0];
    sim.traffic = [npc];
    sim.player.position = vec(80, 130); sim.player.heading = 0; sim.player.velocity = vec(18, 0);
    npc.car.position = vec(82, 130); npc.car.heading = 0; npc.car.velocity = vec(0, 0);
    sim.step(drive);
    expect(sim.styleScore).toBe(0);
    expect(sim.consumeEvents().some(e => e.type === 'nearMiss')).toBe(false);
  });

  it('awards one near miss per encounter and offers one free repair plus coin service', () => {
    const sim = new Simulation();
    sim.player.position = vec(65, 122); sim.player.velocity = vec(20, 0);
    const agent = sim.traffic[0];
    agent.car.position = vec(72, 126); agent.car.velocity = vec(0, 0); agent.car.heading = 0;
    sim.traffic = [agent];
    const initialScore = sim.styleScore;
    sim.step(drive);
    expect(sim.styleScore).toBe(initialScore + sim.tuning.nearMiss.stylePoints);
    advance(sim, .25, drive);
    expect(sim.styleScore).toBe(initialScore + sim.tuning.nearMiss.stylePoints);
    const repair = new Simulation();
    repair.traffic = [];
    repair.player.health = 40;
    repair.player.zones.front = .4;
    repair.player.position = { ...repair.track.config.repair };
    repair.step(neutralInput);
    expect(repair.player.health).toBe(75);
    expect(repair.repairAvailable).toBe(false);
    expect(repair.player.zones.front).toBeLessThan(.4);
    const cost = repair.repairCost;
    expect(repair.service()).toBe(true);
    expect(repair.coins).toBe(repair.tuning.damage.startingCoins - cost);
    expect(repair.player.health).toBe(100);
  });
});
