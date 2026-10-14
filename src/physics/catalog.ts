import rawCars from '../../data/cars.json';
import rawTuning from '../../data/tuning.json';
import rawTracks from '../../data/tracks.json';
import { Track, type TrackConfig } from './track';
import type { CarCatalog, CarProfile, Tuning } from './types';

const carData = rawCars as unknown as Pick<CarCatalog, 'cars' | 'surfaces'>;
// One source of truth: metadata is embedded in each car entry, not duplicated
// in a parallel presentation table. Keep the existing renderer-facing shape.
export const catalog: CarCatalog = {
  ...carData,
  presentation: Object.fromEntries(carData.cars.map(car => [car.id, {
    ...car.visual, name: car.name, class: car.class,
  }])),
};
export const trackConfigs = rawTracks.tracks as unknown as TrackConfig[];
export const tracks = trackConfigs.map(config => new Track(config));

export function defaultTuning(): Tuning {
  // Never mutate the imported baseline when adjusting debug sliders.
  return JSON.parse(JSON.stringify(rawTuning)) as Tuning;
}

export function profileById(id: string): CarProfile {
  const car = catalog.cars.find(candidate => candidate.id === id);
  if (!car) throw new Error(`Unknown car: ${id}`);
  return car;
}

export function trackById(id: string): Track {
  const track = tracks.find(candidate => candidate.config.id === id);
  if (!track) throw new Error(`Unknown track: ${id}`);
  return track;
}

// Catch invalid hand-edited JSON on launch and in tests instead of NaNs in physics.
export function validateCatalog(): void {
  if (!catalog.cars.length || !tracks.length) throw new Error('At least one car and track is required');
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const car of catalog.cars) {
    if (ids.has(car.id)) throw new Error(`Duplicate car id: ${car.id}`);
    ids.add(car.id);
    if (!car.name?.trim() || !car.class?.trim() || !car.visual) throw new Error(`${car.id}: missing identity/visual metadata`);
    if (names.has(car.name)) throw new Error(`Duplicate car name: ${car.name}`);
    names.add(car.name);
    if (!catalog.presentation[car.id]) throw new Error(`Missing presentation for ${car.id}`);
    if (car.torqueCurve.length !== 5 || car.gearRatios.length !== 5) throw new Error(`${car.id}: expected five torque samples and five gear ratios`);
    const values = [car.mass, car.enginePower, car.topSpeed, car.gripFront, car.gripRear, car.slideGrip, car.steerMax, car.brakeForce, car.dragCoeff, car.armor, car.nitroCapacity, ...car.torqueCurve, ...car.gearRatios];
    if (values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error(`${car.id}: invalid numeric stat`);
    if (car.steerSpeedFalloff < 0 || car.steerSpeedFalloff >= 1) throw new Error(`${car.id}: steerSpeedFalloff must be in [0,1)`);
    const art = catalog.presentation[car.id];
    if (!['hatch', 'coupe', 'muscle', 'super'].includes(art.body) || art.length <= 0 || art.width <= 0) throw new Error(`${car.id}: invalid collision body`);
    if (car.art) {
      if (['body', 'wheels', 'lights'].some(layer => !car.art?.[layer as keyof typeof car.art])) throw new Error(`${car.id}: missing required car art layer`);
      if (Object.keys(car.art).some(layer => !['body', 'wheels', 'lights', 'decals'].includes(layer))) throw new Error(`${car.id}: unknown car art layer`);
      if (Object.values(car.art).some(path => !/^cars\/[a-z0-9_]+\.png$/.test(path))) throw new Error(`${car.id}: art paths must be cars/*.png under /assets`);
    }
  }
  for (const key of Object.keys(catalog.presentation)) if (!ids.has(key)) throw new Error(`Presentation has no car profile: ${key}`);
  for (const surface of ['asphalt', 'wet', 'dirt', 'grass', 'oil'] as const) {
    if (!catalog.surfaces[surface] || catalog.surfaces[surface].grip <= 0 || catalog.surfaces[surface].drag <= 0) throw new Error(`Invalid surface: ${surface}`);
  }
}
