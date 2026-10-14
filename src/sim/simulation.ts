import { catalog, defaultTuning, profileById, trackById } from './catalog';
import { carBox, hitZone, intersectBoxes, resolveCollision, segmentBox } from './collision';
import { add, angleDiff, clamp, degrees, distance, dot, forward, length, lerp, moveTowards, mul, radians, right, sub, vec, type Vec2 } from './math';
import type { Track } from './track';
import type { CarState, DriveInput, HitZone, SimEvent, Tuning } from './types';

export const neutralInput: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, source: 'keyboard', assist: 0 };

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

export function torqueAtRpm(car: CarState, tuning: Tuning): number {
  const { idleRpm, redlineRpm, peakPowerRpm, horsepowerWatts } = tuning.engine;
  const curve = car.profile.torqueCurve;
  const scaled = clamp((car.rpm - idleRpm) / (redlineRpm - idleRpm) * (curve.length - 1), 0, curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(scaled));
  const normalizedTorque = lerp(curve[i], curve[i + 1], scaled - i);
  // enginePower is hp at peakPowerRpm. Convert hp -> W -> Nm at the crank,
  // then interpolate the five torque multipliers. No velocity / 0 at launch.
  const peakTorqueNm = car.profile.enginePower * horsepowerWatts / (peakPowerRpm * 2 * Math.PI / 60);
  return peakTorqueNm * normalizedTorque;
}

interface Traffic { car: CarState; laneOffset: number; speed: number }

export class Simulation {
  readonly tuning: Tuning;
  track: Track;
  player!: CarState;
  traffic: Traffic[] = [];
  coins = 0;
  styleScore = 0;
  repairAvailable = true;
  hitStop = 0;
  time = 0;
  private events: SimEvent[] = [];
  private nearMissArmed = new Map<string, boolean>();
  private collidedTraffic = new Set<string>();
  private wallBoxes: ReturnType<typeof segmentBox>[] = [];

  constructor(carId = 'falcon', trackId = 'proving_ground', tuning = defaultTuning()) {
    this.tuning = tuning;
    this.track = trackById(trackId);
    this.reset(carId, trackId);
  }

  reset(carId = this.player?.profile.id ?? 'falcon', trackId = this.track.config.id): void {
    this.track = trackById(trackId);
    const { start } = this.track.config;
    const heading = this.track.nearest(start).heading;
    this.player = createCar(carId, start, heading, 'player', this.tuning);
    this.coins = this.tuning.damage.startingCoins;
    this.styleScore = 0;
    this.repairAvailable = true;
    this.hitStop = 0;
    this.time = 0;
    this.events = [];
    this.nearMissArmed.clear();
    this.collidedTraffic.clear();
    const { minX, minY, maxX, maxY } = this.track.bounds;
    const perimeter: [number, number, number, number][] = [
      [minX, minY, maxX, minY], [maxX, minY, maxX, maxY],
      [maxX, maxY, minX, maxY], [minX, maxY, minX, minY],
    ];
    this.wallBoxes = [...this.track.config.barriers, ...perimeter].map(segment => segmentBox(segment));
    const playerS = this.track.nearest(start).s;
    this.traffic = this.tuning.ai.traffic.map((agent, i) => {
      const sample = this.track.lane(playerS + agent.spawnAhead, agent.laneOffset);
      const car = createCar(agent.carId, sample.point, sample.heading, `npc-${i}`, this.tuning);
      car.velocity = mul(forward(sample.heading), agent.initialSpeed);
      return { car, laneOffset: agent.laneOffset, speed: agent.targetSpeed };
    });
    for (const actor of this.traffic) this.nearMissArmed.set(actor.car.id, true);
  }

  get cars(): CarState[] { return [this.player, ...this.traffic.map(actor => actor.car)]; }

  consumeEvents(): SimEvent[] {
    const pending = this.events;
    this.events = [];
    return pending;
  }

  private emit(event: SimEvent): void {
    // Defensive cap for tests / background tabs that do not consume events.
    if (this.events.length < 128) this.events.push(event);
  }

  step(input: DriveInput, dt = 1 / this.tuning.simulation.hz): void {
    // This function is only called by the fixed-step accumulator (or tests).
    // Freeze the entire simulation for a few fixed ticks on a heavy impact.
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); return; }
    this.time += dt;
    this.collidedTraffic.clear();
    for (const car of this.cars) {
      car.previousPosition = { ...car.position };
      car.previousHeading = car.heading;
    }
    this.player.drafting = this.isDrafting();
    this.driveCar(this.player, input, dt);
    for (const agent of this.traffic) this.driveCar(agent.car, this.aiInput(agent), dt);

    // Pairwise mass-based impulse resolution with OBBs.
    const all = this.cars;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (distance(a.position, b.position) > (a.art.length + b.art.length) / 2 + 1) continue;
        const contact = intersectBoxes(carBox(a), carBox(b));
        if (!contact) continue;
        if (a.id === 'player') this.collidedTraffic.add(b.id);
        else if (b.id === 'player') this.collidedTraffic.add(a.id);
        const result = resolveCollision(a, b, contact, this.tuning);
        this.handleImpact(a, b, contact.normal, result.impactEnergy, result.closingSpeed, result.point);
      }
    }
    for (const car of all) {
      for (const barrier of this.wallBoxes) {
        // AABB broadphase avoids SAT for barriers on the other side of the track.
        if (distance(car.position, barrier.center) > barrier.halfLength + car.art.length + 2) continue;
        const contact = intersectBoxes(carBox(car), barrier);
        if (!contact) continue;
        const result = resolveCollision(car, null, contact, this.tuning);
        this.handleImpact(car, null, contact.normal, result.impactEnergy, result.closingSpeed, result.point);
        if (length(car.velocity) > this.tuning.collision.wallScrapeSpeed) {
          this.damageCar(car, this.tuning.collision.wallScrapeDamagePerSecond * dt / car.profile.armor, hitZone(car, contact.normal), 0);
          if (car.sparkCooldown <= 0) {
            this.emit({ type: 'scrape', carId: car.id, position: result.point });
            car.sparkCooldown = 0.12;
          }
        }
      }
    }
    this.handleTraffic(dt);
    if (this.repairAvailable && !this.player.wrecked && this.player.health < this.tuning.damage.maxHealth - this.tuning.damage.repairPickupMinDamage && distance(this.player.position, this.track.config.repair) < this.tuning.damage.repairPickupRadius) {
      this.heal(this.player, this.tuning.damage.quickRepairHealth);
      this.repairAvailable = false;
      this.emit({ type: 'pickup', carId: 'player', position: { ...this.track.config.repair }, text: 'FREE REPAIR' });
    }
  }

  private aiInput(agent: Traffic): DriveInput {
    const { car, laneOffset, speed } = agent;
    const ai = this.tuning.ai;
    const nearest = this.track.nearest(car.position);
    const currentSpeed = length(car.velocity);
    const ahead = this.track.lane(nearest.s + ai.lookAhead + currentSpeed * ai.lookAheadSpeedFactor, laneOffset);
    const headingError = angleDiff(Math.atan2(ahead.point.y - car.position.y, ahead.point.x - car.position.x), car.heading);
    const nextTurn = Math.abs(angleDiff(this.track.at(nearest.s + ai.turnLookAhead).heading, nearest.heading));
    const targetSpeed = nextTurn > ai.tightTurnAngle ? speed * ai.tightTurnSpeedScale : speed;
    return {
      steer: clamp(headingError / ai.steerErrorScale, -1, 1), throttle: currentSpeed < targetSpeed ? ai.throttleInput : 0,
      brake: currentSpeed > targetSpeed + ai.brakeMargin ? ai.brakeInput : 0,
      handbrake: false, nitro: false, source: 'ai', assist: 0,
    };
  }

  private driveCar(car: CarState, input: DriveInput, dt: number): void {
    const t = this.tuning, profile = car.profile;
    const nearest = this.track.nearest(car.position);
    car.surface = this.track.surfaceAt(car.position, nearest);
    const surface = catalog.surfaces[car.surface];
    car.shiftCut = Math.max(0, car.shiftCut - dt);
    car.shiftCooldown = Math.max(0, car.shiftCooldown - dt);
    car.handbrakeTime = Math.max(0, car.handbrakeTime - dt);
    car.handbrakeCooldown = Math.max(0, car.handbrakeCooldown - dt);
    car.nitroLock = Math.max(0, car.nitroLock - dt);
    car.sparkCooldown = Math.max(0, car.sparkCooldown - dt);
    if (car.wrecked) {
      car.velocity = mul(car.velocity, Math.exp(-t.damage.wreckLinearDamping * dt));
      car.angularVelocity *= Math.exp(-t.damage.wreckYawDamping * dt);
      car.position = add(car.position, mul(car.velocity, dt));
      car.heading += car.angularVelocity * dt;
      car.nitroActive = false;
      return;
    }

    const oldSteer = car.steerInput;
    const desiredSteer = clamp(input.steer, -1, 1);
    car.steerInput = input.source === 'keyboard'
      ? moveTowards(oldSteer, desiredSteer, dt / t.steering.keyboardRampSeconds)
      : desiredSteer;
    const speed = length(car.velocity);
    let assist = 0;
    if (input.assist && speed > 4 && nearest.distance < this.track.config.roadWidth * 0.7) {
      const target = this.track.at(nearest.s + t.steering.assistLookAhead);
      const error = angleDiff(target.heading, car.heading);
      assist = clamp(error * t.steering.assistGain, -t.steering.assistMax, t.steering.assistMax) * input.assist * (1 - Math.abs(car.steerInput) * 0.65);
    }
    const sidePull = (car.zones.left - car.zones.right) * t.steering.sideDamagePull;
    const maxSteer = radians(profile.steerMax * (1 - profile.steerSpeedFalloff * clamp(speed / profile.topSpeed, 0, 1)));
    const targetSteering = clamp(car.steerInput + assist + sidePull, -1, 1) * maxSteer * (car.nitroActive ? t.steering.nitroScale : 1);
    const steeringRate = radians(Math.abs(targetSteering) < 0.015 ? t.steering.returnRateDeg : t.steering.turnRateDeg) * dt;
    car.steering = moveTowards(car.steering, targetSteering, steeringRate);

    if (input.handbrake && !car.handbrakeHeld && car.handbrakeCooldown <= 0) {
      car.handbrakeTime = t.braking.handbrakeSeconds;
      car.handbrakeCooldown = t.braking.handbrakeSeconds + t.braking.handbrakeCooldown;
    }
    car.handbrakeHeld = input.handbrake;

    const wasNitroActive = car.nitroActive;
    car.nitroActive = input.nitro && car.nitro > 0 && car.nitroLock <= 0 && input.throttle > 0;
    if (car.nitroActive) {
      car.nitro = Math.max(0, car.nitro - dt * t.nitro.drainPerSecond);
      if (!wasNitroActive) this.emit({ type: 'nitro', carId: car.id, position: { ...car.position } });
      if (car.nitro === 0) {
        car.nitroLock = t.nitro.lockoutSeconds;
        car.nitroActive = false;
      }
    }

    const f = forward(car.heading), lateral = right(car.heading);
    const vForward = dot(car.velocity, f), vLateral = dot(car.velocity, lateral);
    const wheelRpm = Math.abs(vForward) / (2 * Math.PI * t.engine.wheelRadius) * 60;
    car.rpm = clamp(Math.max(t.engine.idleRpm + input.throttle * t.engine.launchRpmBonus, wheelRpm * profile.gearRatios[car.gear - 1] * t.engine.finalDrive), t.engine.idleRpm, t.engine.redlineRpm);
    if (car.shiftCooldown <= 0 && car.gear < profile.gearRatios.length && car.rpm >= t.engine.redlineRpm * t.engine.shiftUpRatio) {
      car.gear++;
      car.shiftCut = t.engine.shiftCutSeconds;
      car.shiftCooldown = t.engine.shiftMinInterval;
      this.emit({ type: 'shift', carId: car.id, value: car.gear });
    } else if (car.shiftCooldown <= 0 && car.gear > 1 && car.rpm < t.engine.redlineRpm * t.engine.shiftDownRatio) {
      car.gear--;
      car.shiftCut = t.engine.shiftCutSeconds;
      car.shiftCooldown = t.engine.shiftMinInterval;
      this.emit({ type: 'shift', carId: car.id, value: car.gear });
    }
    car.rpm = clamp(Math.max(t.engine.idleRpm + input.throttle * t.engine.launchRpmBonus, wheelRpm * profile.gearRatios[car.gear - 1] * t.engine.finalDrive), t.engine.idleRpm, t.engine.redlineRpm);
    const wasLimiterOn = car.limiterOn;
    car.limiterOn = car.rpm >= t.engine.redlineRpm * t.engine.limiterStartRatio && Math.floor(this.time / t.engine.limiterPeriod) % 2 === 0;
    if (car.limiterOn && !wasLimiterOn) this.emit({ type: 'limiter', carId: car.id });

    const frontLimit = profile.mass * t.tires.gravity * t.tires.frontLoad * profile.gripFront * surface.grip * t.tires.gripScale;
    const rearLimit = profile.mass * t.tires.gravity * (1 - t.tires.frontLoad) * profile.gripRear * surface.grip * t.tires.gripScale * (car.handbrakeTime > 0 ? t.braking.handbrakeRearGrip : 1);
    // Bicycle model: each axle sees lateral velocity plus/minus yaw at its
    // position. Front wheels point at steering angle. Saturating the requested
    // force at slidingGrip leaves sideways momentum instead of rotating a sprite.
    const halfWheelbase = car.art.length * t.tires.axleOffsetFraction;
    const frontSlip = vLateral + car.angularVelocity * halfWheelbase - vForward * Math.tan(car.steering);
    const rearSlip = vLateral - car.angularVelocity * halfWheelbase;
    const frontDemand = -frontSlip * profile.mass * t.tires.frontLoad * t.tires.frontStiffness;
    const rearDemand = -rearSlip * profile.mass * (1 - t.tires.frontLoad) * t.tires.rearStiffness;
    const peakWheelForce = torqueAtRpm(car, t) * profile.gearRatios[car.gear - 1] * t.engine.finalDrive * t.engine.drivetrainEfficiency / t.engine.wheelRadius;
    const brakeDemand = clamp(input.brake, 0, 1) * profile.brakeForce * profile.mass * t.braking.deceleration;
    // Reserve friction-circle budget for braking and powered rear tires BEFORE
    // clamping lateral force. Otherwise braking in a corner never causes a slide.
    const frontShare = Math.min(t.tires.brakeGripShare, brakeDemand * t.braking.frontBias / frontLimit * t.tires.brakeGripShare);
    const rearBrakeShare = Math.min(t.tires.brakeGripShare, brakeDemand * (1 - t.braking.frontBias) / rearLimit * t.tires.brakeGripShare);
    const rearPowerShare = clamp(input.throttle, 0, 1) * t.tires.powerGripShare * clamp(speed / t.tires.powerGripReferenceSpeed, 0, 1);
    const frontLateralLimit = frontLimit * Math.sqrt(1 - frontShare ** 2);
    const rearLateralLimit = rearLimit * Math.sqrt(1 - Math.min(t.tires.maxCombinedGripShare, rearBrakeShare + rearPowerShare) ** 2);
    car.frontGripUsage = Math.abs(frontDemand) / frontLateralLimit;
    car.rearGripUsage = Math.abs(rearDemand) / rearLateralLimit;
    car.frontSliding = car.frontGripUsage > 1;
    car.rearSliding = car.rearGripUsage > 1;
    const frontForce = clamp(frontDemand, -frontLateralLimit * (car.frontSliding ? profile.slideGrip : 1), frontLateralLimit * (car.frontSliding ? profile.slideGrip : 1));
    const rearForce = clamp(rearDemand, -rearLateralLimit * (car.rearSliding ? profile.slideGrip : 1), rearLateralLimit * (car.rearSliding ? profile.slideGrip : 1));

    const availableDriveGrip = Math.sqrt(Math.max(0, (rearLimit * (car.rearSliding ? profile.slideGrip : 1)) ** 2 - Math.min(Math.abs(rearForce), rearLimit) ** 2));
    const powerPenalty = 1 - car.zones.rear * t.damage.rearPowerPenalty;
    const cut = car.shiftCut > 0 || car.limiterOn;
    const nitroMultiplier = car.nitroActive ? t.nitro.forceMultiplier : 1;
    const engineForce = Math.min(availableDriveGrip, peakWheelForce * clamp(input.throttle, 0, 1) * t.engine.forceScale * powerPenalty * nitroMultiplier * (cut ? 0 : 1));
    // ABS front bias: final longitudinal forces are capped by the remaining
    // friction circle after the lateral forces above have used their share.
    const frontBrakeCapacity = Math.sqrt(Math.max(0, frontLimit ** 2 - Math.min(Math.abs(frontForce), frontLimit) ** 2));
    const rearBrakeCapacity = Math.sqrt(Math.max(0, rearLimit ** 2 - Math.min(Math.abs(rearForce), rearLimit) ** 2));
    const braking = Math.min(brakeDemand * t.braking.frontBias, frontBrakeCapacity) + Math.min(brakeDemand * (1 - t.braking.frontBias), rearBrakeCapacity);
    const rearLock = car.handbrakeTime > 0 ? Math.min(rearBrakeCapacity, profile.mass * t.braking.handbrakeDeceleration) : 0;
    const brakeForce = vForward > 0.05 ? -(braking + rearLock) : vForward < -0.05 ? (braking + rearLock) : 0;

    const velocitySpeed = length(car.velocity);
    const aeroDrag = 0.5 * t.aero.airDensity * profile.dragCoeff * t.aero.frontalArea * velocitySpeed ** 2 * (car.drafting ? 1 - t.draft.dragReduction : 1);
    const rollDrag = profile.mass * t.tires.gravity * t.aero.rollingCoefficient * surface.drag;
    const maxSpeed = profile.topSpeed * (1 - car.zones.front * t.damage.frontTopSpeedPenalty)
      * (car.nitroActive ? t.nitro.speedMultiplier : 1) * (car.drafting ? 1 + t.draft.speedBoost : 1);
    const softCapDrag = Math.max(0, velocitySpeed - maxSpeed) * t.aero.speedSoftCap * profile.mass;
    const dragAcceleration = velocitySpeed > 0.03 ? mul(car.velocity, -(aeroDrag + rollDrag + softCapDrag) / (profile.mass * velocitySpeed)) : vec();
    const longitudinalAcceleration = mul(f, (engineForce + brakeForce) / profile.mass);
    const lateralAcceleration = mul(lateral, (frontForce + rearForce) / profile.mass);
    car.velocity = add(car.velocity, mul(add(add(longitudinalAcceleration, lateralAcceleration), dragAcceleration), dt));
    // Don't roll backward just because brake/rolling resistance overshoots zero.
    if (vForward >= 0 && dot(car.velocity, f) < 0 && !input.throttle) car.velocity = sub(car.velocity, mul(f, dot(car.velocity, f)));
    const inertia = profile.mass * (car.art.length ** 2 + car.art.width ** 2) / 12 * t.tires.yawInertiaScale;
    car.angularVelocity += (halfWheelbase * (frontForce - rearForce) / inertia) * dt;
    // A short e-brake weight-transfer yaw kick starts the rear sliding before
    // the bicycle model takes over; release and countersteer to hold the drift.
    if (car.handbrakeTime > 0 && speed > t.drift.minSpeed) {
      car.angularVelocity += Math.sign(car.steering) * t.braking.handbrakeYawAssist * clamp(speed / t.tires.powerGripReferenceSpeed, 0, 1) * dt;
    }
    car.angularVelocity *= Math.exp(-t.tires.yawDamping * dt);
    car.angularVelocity = clamp(car.angularVelocity, -t.tires.maxYawRate, t.tires.maxYawRate);
    if (velocitySpeed < 1) {
      car.angularVelocity *= Math.exp(-t.tires.lowSpeedLateralDamping * dt);
      car.velocity = sub(car.velocity, mul(lateral, dot(car.velocity, lateral) * Math.min(1, t.tires.lowSpeedLateralDamping * dt)));
    }
    car.heading += car.angularVelocity * dt;
    car.position = add(car.position, mul(car.velocity, dt));

    const newForward = dot(car.velocity, forward(car.heading));
    const newLateral = dot(car.velocity, right(car.heading));
    car.slipAngle = Math.atan2(newLateral, Math.max(0.2, Math.abs(newForward)));
    this.updateDrift(car, dt);
    if (car.drafting) car.nitro = Math.min(profile.nitroCapacity, car.nitro + t.nitro.slipstreamChargePerSecond * dt);
  }

  private updateDrift(car: CarState, dt: number): void {
    if (car.wrecked) return;
    const t = this.tuning.drift;
    const speed = length(car.velocity);
    const threshold = radians(car.drifting ? t.endAngleDeg : t.startAngleDeg);
    const sliding = speed >= t.minSpeed && Math.abs(car.slipAngle) > threshold;
    if (sliding) {
      if (!car.drifting) {
        car.drifting = true;
        car.driftSeconds = 0;
        car.driftUnbanked = 0;
        car.driftCombo = 1;
        this.emit({ type: 'driftStart', carId: car.id, position: { ...car.position } });
      }
      car.driftSeconds += dt;
      car.driftCombo = Math.min(t.maxCombo, 1 + Math.floor(car.driftSeconds / t.secondsPerCombo));
      car.driftUnbanked += t.scorePerSecond * (Math.abs(degrees(car.slipAngle)) / t.startAngleDeg) * car.driftCombo * dt;
      car.nitro = Math.min(car.profile.nitroCapacity, car.nitro + this.tuning.nitro.driftChargePerSecond * dt);
    } else if (car.drifting) {
      const clean = car.driftSeconds >= t.cleanExitSeconds && speed >= t.minSpeed * 0.8;
      if (clean) {
        // Boost in the direction of travel; reward a clean exit, not a 360.
        car.velocity = add(car.velocity, mul(forward(car.heading), t.boostMps));
        const score = Math.round(car.driftUnbanked);
        car.driftPoints += score;
        if (car.id === 'player') {
          this.styleScore += score;
          this.coins += Math.floor(score / t.coinsPerPoints);
        }
        this.emit({ type: 'driftBank', carId: car.id, position: { ...car.position }, value: score, text: `DRIFT ×${car.driftCombo}` });
      }
      car.drifting = false;
      car.driftSeconds = 0;
      car.driftUnbanked = 0;
      car.driftCombo = 1;
    }
  }

  private cancelDrift(car: CarState): void {
    if (!car.drifting) return;
    car.drifting = false;
    car.driftSeconds = 0;
    car.driftUnbanked = 0;
    car.driftCombo = 1;
    this.emit({ type: 'driftCrash', carId: car.id, position: { ...car.position }, text: 'COMBO LOST' });
  }

  private handleImpact(a: CarState, b: CarState | null, normal: Vec2, energy: number, closingSpeed: number, point: Vec2): void {
    if (closingSpeed < this.tuning.collision.minImpactSpeed) return;
    this.cancelDrift(a);
    if (b) this.cancelDrift(b);
    this.damageCar(a, energy * this.tuning.damage.impactScale / a.profile.armor, hitZone(a, normal), energy);
    if (b) this.damageCar(b, energy * this.tuning.damage.impactScale / b.profile.armor, hitZone(b, mul(normal, -1)), energy);
    const intensity = clamp(closingSpeed / 22, 0.15, 1);
    this.emit({ type: 'impact', carId: a.id, position: { ...point }, value: closingSpeed, intensity });
    if (closingSpeed >= this.tuning.collision.bigImpactSpeed) this.hitStop = Math.max(this.hitStop, this.tuning.collision.hitStopSeconds);
  }

  private damageCar(car: CarState, amount: number, zone: HitZone, energy: number): void {
    if (car.wrecked) return;
    car.health = Math.max(0, car.health - amount);
    car.zones[zone] = clamp(car.zones[zone] + energy * this.tuning.damage.zoneScale / (car.profile.armor * this.tuning.damage.maxHealth) + amount / (this.tuning.damage.maxHealth * 4), 0, 1);
    if (car.health === 0) {
      car.wrecked = true;
      this.cancelDrift(car);
      this.emit({ type: 'wreck', carId: car.id, position: { ...car.position }, text: 'WRECKED' });
    }
  }

  private heal(car: CarState, amount: number): void {
    const healthBefore = car.health;
    car.health = Math.min(this.tuning.damage.maxHealth, car.health + amount);
    const portion = (car.health - healthBefore) / this.tuning.damage.maxHealth;
    for (const zone of Object.keys(car.zones) as HitZone[]) car.zones[zone] = Math.max(0, car.zones[zone] - portion);
  }

  // A between-run economy hook; the test lab exposes it as a service button.
  // For real missions the garage can call this same method between missions.
  service(): boolean {
    if (this.player.wrecked) { this.emit({ type: 'service', text: 'RESET AFTER WRECK' }); return false; }
    const missing = this.tuning.damage.maxHealth - this.player.health;
    if (missing <= 0.01) { this.emit({ type: 'service', text: 'ALREADY REPAIRED' }); return false; }
    const cost = Math.ceil(missing * this.tuning.damage.repairCostPerHealth);
    if (cost > this.coins) { this.emit({ type: 'service', text: 'NOT ENOUGH COINS' }); return false; }
    this.coins -= cost;
    this.heal(this.player, missing);
    this.emit({ type: 'service', text: `REPAIRED −${cost} CR`, position: { ...this.player.position } });
    return true;
  }

  get repairCost(): number { return Math.ceil((this.tuning.damage.maxHealth - this.player.health) * this.tuning.damage.repairCostPerHealth); }

  private isDrafting(): boolean {
    const p = this.player;
    if (p.wrecked) return false;
    for (const { car } of this.traffic) {
      if (car.wrecked) continue;
      const toTarget = sub(car.position, p.position);
      const ahead = dot(toTarget, forward(car.heading));
      const alongside = Math.abs(dot(toTarget, right(car.heading)));
      if (ahead > (p.art.length + car.art.length) / 3 && ahead < this.tuning.draft.maxRange && alongside < this.tuning.draft.maxLateral && dot(forward(p.heading), forward(car.heading)) > this.tuning.draft.minHeadingDot) return true;
    }
    return false;
  }

  private handleTraffic(_dt: number): void {
    const p = this.player;
    if (p.wrecked) return;
    for (const agent of this.traffic) {
      const car = agent.car;
      if (car.wrecked) continue;
      if (this.collidedTraffic.has(car.id)) {
        this.nearMissArmed.set(car.id, false);
        continue; // A crash cannot also earn a Close Call reward.
      }
      // Closest-body approximation after the exact OBB collision pass.
      const separation = distance(p.position, car.position) - (p.art.length + car.art.length) / 2;
      if (separation > this.tuning.nearMiss.rearmSeparation) this.nearMissArmed.set(car.id, true);
      const relativeSpeed = length(sub(p.velocity, car.velocity));
      if (separation > 0 && separation < this.tuning.nearMiss.maxSeparation && relativeSpeed >= this.tuning.nearMiss.minRelativeSpeed && this.nearMissArmed.get(car.id)) {
        this.nearMissArmed.set(car.id, false);
        p.nitro = Math.min(p.profile.nitroCapacity, p.nitro + this.tuning.nitro.nearMissCharge);
        this.styleScore += this.tuning.nearMiss.stylePoints;
        this.coins += this.tuning.nearMiss.coinReward;
        this.emit({ type: 'nearMiss', carId: 'player', position: { ...p.position }, text: 'CLOSE CALL!' });
      }
    }
  }
}
