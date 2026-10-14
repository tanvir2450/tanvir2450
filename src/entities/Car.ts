import { catalog, defaultTuning, profileById } from '../physics/catalog';
import { vec, type Vec2 } from '../physics/math';
import type { CarState, Tuning } from '../physics/types';

/** One physical car body; AI and player differ by input source, not physics. */
export function createCar(id: string, position: Vec2, heading = 0, entityId = id, tuning: Tuning = defaultTuning()): CarState {
  const profile = profileById(id);
  return {
    id: entityId, profile, art: catalog.presentation[id],
    position: { ...position }, previousPosition: { ...position }, heading, previousHeading: heading,
    velocity: vec(), angularVelocity: 0, steerInput: 0, steering: 0,
    gear: 1, rpm: tuning.engine.idleRpm, shiftCut: 0, shiftCooldown: 0, limiterOn: false,
    handbrakeTime: 0, handbrakeCooldown: 0, handbrakeHeld: false,
    nitro: profile.nitroCapacity * tuning.nitro.startFraction, nitroLock: 0, nitroActive: false,
    health: tuning.damage.maxHealth, zones: { front: 0, rear: 0, left: 0, right: 0 },
    surface: 'asphalt', slipAngle: 0, frontGripUsage: 0, rearGripUsage: 0, frontSliding: false, rearSliding: false,
    drifting: false, driftSeconds: 0, driftPoints: 0, driftCombo: 1, driftUnbanked: 0, drafting: false,
    sparkCooldown: 0, wrecked: false,
  };
}
