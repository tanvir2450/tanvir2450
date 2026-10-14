#!/usr/bin/env node
/**
 * laps.mjs - the autopilot drives every car round a circuit and prints the lap
 * times (SECTION 9.12: "add a test track ... for tuning each car").
 *
 * A car that cannot be driven quickly and cleanly by the autopilot is a car
 * that cannot be driven quickly and cleanly by a player, so this is the
 * regression test for a handling change: run it before and after.
 *
 * Usage:
 *   node tools/laps.mjs                        # every car, Apex Loop, 3 laps
 *   node tools/laps.mjs --track grounds        # the 9.12 tuning grounds
 *   node tools/laps.mjs --car falcon --laps 2
 *   node tools/laps.mjs --track data/test-track.json --json
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromDisk } from '../src/config.js';
import { buildTrack, LapTimer } from '../src/track.js';
import { Car } from '../src/car.js';
import { Autopilot } from '../src/ai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DT = 1 / 60;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const config = await loadConfigFromDisk(undefined, { strictTuning: true });
const catalogue = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tracks.json'), 'utf8'));
const wanted = arg('track', catalogue.default);
const entry = catalogue.tracks.find((t) => t.id === wanted || t.file === wanted) ?? catalogue.tracks[0];
const trackPath = entry.file ?? path.join('data', `${wanted}.json`);
const track = buildTrack(JSON.parse(readFileSync(path.join(ROOT, trackPath), 'utf8')), config);
const laps = Number(arg('laps', 3));
const only = arg('car');
const cars = config.cars.filter((car) => !only || car.id === only);

const results = [];
for (const def of cars) {
  const car = new Car(def, config, { assists: false });
  car.reset({ ...track.startPose });
  const ai = new Autopilot(track, config);
  const timer = new LapTimer(track);
  const surfaces = new Map();
  let seconds = 0;
  let offTrack = 0;
  const limit = DT * 60 * 240;
  while (seconds < limit && timer.lapCount < laps) {
    const prevX = car.x;
    const prevY = car.y;
    car.step(DT, ai.update(DT, car), track.world);
    timer.update(DT, car, prevX, prevY);
    seconds += DT;
    const id = car.currentSurface?.id ?? '?';
    surfaces.set(id, (surfaces.get(id) ?? 0) + DT);
    if (!car.onTrack) offTrack += DT;
  }
  results.push({
    car: def.id,
    name: def.name,
    class: def.klass,
    track: track.name,
    laps: timer.lapCount,
    bestLap: timer.bestLap ? +timer.bestLap.toFixed(2) : null,
    averageLap: timer.lapCount ? +(seconds / timer.lapCount).toFixed(2) : null,
    offTrackSeconds: +offTrack.toFixed(1),
    topSpeedKph: +(car.speedMs * 3.6).toFixed(0),
    surfaces: Object.fromEntries([...surfaces.entries()].map(([k, v]) => [k, +v.toFixed(1)]))
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ track: track.name, lapLengthM: Math.round(track.lapLengthM), results }, null, 2));
} else {
  console.log(`${track.name} - ${Math.round(track.lapLengthM)} m lap, ${track.gates.length} gates, ${laps} laps on the autopilot\n`);
  for (const r of results) {
    const surfaces = Object.entries(r.surfaces)
      .sort((a, b) => b[1] - a[1])
      .map(([id, seconds]) => `${id} ${seconds}s`)
      .join(' · ');
    console.log(
      `${r.car.padEnd(11)} ${(r.bestLap ?? 0).toFixed(2)}s best  ${(r.averageLap ?? 0).toFixed(2)}s avg  ` +
        `${r.laps} laps  off-track ${r.offTrackSeconds}s  top ${r.topSpeedKph} kph`
    );
    console.log(`            ${surfaces}`);
  }
}
