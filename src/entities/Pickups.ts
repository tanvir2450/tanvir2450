import { distance } from '../physics/math';
import type { Track } from '../physics/track';
import type { CarState, Tuning } from '../physics/types';

/** Eligibility only; healing, reward events and one-use state belong to Simulation. */
export function canCollectQuickRepair(car: CarState, track: Track, tuning: Tuning, available: boolean): boolean {
  return available && !car.wrecked &&
    car.health < tuning.damage.maxHealth - tuning.damage.repairPickupMinDamage &&
    distance(car.position, track.config.repair) < tuning.damage.repairPickupRadius;
}
