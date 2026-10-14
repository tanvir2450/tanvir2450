import { angleDiff, clamp, length } from '../physics/math';
import type { Track } from '../physics/track';
import type { CarState, DriveInput, Tuning } from '../physics/types';

export interface TrafficAgent { car: CarState; laneOffset: number; speed: number }

/** Pure-pursuit input for a traffic car. The same rigid-body controller advances it. */
export function trafficInput(agent: TrafficAgent, track: Track, tuning: Tuning): DriveInput {
  const { car, laneOffset, speed } = agent;
  const ai = tuning.ai;
  const nearest = track.nearest(car.position);
  const currentSpeed = length(car.velocity);
  const ahead = track.lane(nearest.s + ai.lookAhead + currentSpeed * ai.lookAheadSpeedFactor, laneOffset);
  const headingError = angleDiff(Math.atan2(ahead.point.y - car.position.y, ahead.point.x - car.position.x), car.heading);
  const nextTurn = Math.abs(angleDiff(track.at(nearest.s + ai.turnLookAhead).heading, nearest.heading));
  const targetSpeed = nextTurn > ai.tightTurnAngle ? speed * ai.tightTurnSpeedScale : speed;
  return {
    steer: clamp(headingError / ai.steerErrorScale, -1, 1), throttle: currentSpeed < targetSpeed ? ai.throttleInput : 0,
    brake: currentSpeed > targetSpeed + ai.brakeMargin ? ai.brakeInput : 0,
    handbrake: false, nitro: false, source: 'ai', assist: 0,
  };
}
