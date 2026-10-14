/**
 * car.js - SECTION 9.1 "Simulation setup".
 *
 * A car is a rigid body: position, heading, velocity vector, angular velocity,
 * mass, yaw inertia and a rotated-rectangle collision shape. All internal maths
 * is metric; the renderer applies the single metre->pixel conversion.
 *
 * Body frame convention (matches the canvas used by the renderer, y down):
 *   +x = forward, +y = the driver's right.
 *   heading increases clockwise on screen, so a positive yaw rate is a right turn.
 *
 * Per step the car is integrated with a variable number of SUB-steps so that a
 * fast car cannot tunnel through a wall and so that the tire solve stays stable,
 * while the outer loop always runs at exactly tuning.simulation.physicsHz.
 */

import {
  clamp,
  clamp01,
  DEG,
  expApproach,
  RAD,
  rateApproach,
  smoothstep,
  worldToBody,
  bodyToWorld,
  wrapAngle
} from './mathx.js';
import {
  aeroDrag,
  axleLoads,
  combinesUsage,
  createAxle,
  downforce,
  loadTransferForce,
  rollingResistance,
  solveLateral,
  solveLongitudinal,
  updateSlideState
} from './tires.js';
import { Drivetrain } from './engine.js';

const WHEELS_PER_AXLE = 2;

export class Car {
  /**
   * @param {object} definition resolved car from config.cars
   * @param {object} config full resolved config (tuning + surfaces + units)
   * @param {{assists?:boolean}} [options]
   */
  constructor(definition, config, options = {}) {
    this.def = definition;
    this.config = config;
    this.tuning = config.tuning;
    this.id = definition.id;
    this.name = definition.name;
    this.klass = definition.klass;
    this.assistsEnabled = options.assists ?? true;

    const tires = definition.tires;
    const axleCommon = {
      stiffnessPerGrip: 0,
      slideGripRatio: tires.slideGripRatio,
      longitudinalGripRatio: tires.longitudinalGripRatio
    };
    this.frontAxle = createAxle('front', {
      ...axleCommon,
      massKg: definition.body.massFrontKg,
      inertiaKgM2: definition.wheels.inertiaFrontKgM2 * WHEELS_PER_AXLE,
      grip: tires.axleGripFront,
      stiffnessPerGrip: tires.corneringStiffnessFront,
      driveShare: definition.drivetrain.powerSplitFront,
      brakeShare: definition.brakes.brakeBiasFront
    });
    this.rearAxle = createAxle('rear', {
      ...axleCommon,
      massKg: definition.body.massRearKg,
      inertiaKgM2: definition.wheels.inertiaRearKgM2 * WHEELS_PER_AXLE,
      grip: tires.axleGripRear,
      stiffnessPerGrip: tires.corneringStiffnessRear,
      driveShare: definition.drivetrain.powerSplitRear,
      brakeShare: 1 - definition.brakes.brakeBiasFront
    });
    this.axles = [this.frontAxle, this.rearAxle];
    this.engine = new Drivetrain(definition, this.tuning);

    this.wheels = [
      { id: 'FL', axle: 'front', side: -1, lateralM: -definition.body.trackWidthM / 2, steer: 1, drive: definition.drivetrain.powerSplitFront > 0 },
      { id: 'FR', axle: 'front', side: 1, lateralM: definition.body.trackWidthM / 2, steer: 1, drive: definition.drivetrain.powerSplitFront > 0 },
      { id: 'RL', axle: 'rear', side: -1, lateralM: -definition.body.trackWidthM / 2, steer: 0, drive: definition.drivetrain.powerSplitRear > 0 },
      { id: 'RR', axle: 'rear', side: 1, lateralM: definition.body.trackWidthM / 2, steer: 0, drive: definition.drivetrain.powerSplitRear > 0 }
    ].map((w) => ({ ...w, x: 0, y: 0, spinAngle: 0, spinSpeedRadS: 0, surfaceId: null, usage: 0, wheelspin: 0, lockup: 0, sliding: false }));

    this.reset({ x: 0, y: 0, heading: 0 });
  }

  reset({ x = 0, y = 0, heading = 0, speedMs = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    this.vx = c * speedMs;
    this.vy = s * speedMs;
    this.yawRate = 0;
    this.prevX = x;
    this.prevY = y;
    this.prevHeading = heading;
    this.interpX = x;
    this.interpY = y;
    this.interpHeading = heading;
    this.speedMs = Math.abs(speedMs);
    this.forwardSpeedMs = speedMs;
    this.lateralSpeedMs = 0;
    this.longitudinalAccelMs2 = 0;
    this.lateralAccelMs2 = 0;
    this.yawAccelRadS2 = 0;
    this.smoothedYawRate = 0;
    this.rawLongitudinalAccelMs2 = 0;
    this.rawLateralAccelMs2 = 0;
    this.engineState = this.engineState ?? null;
    this.steerInput = 0;
    this.steerAngleRad = 0;
    this.wheelSpin = 0;
    this.wheelLockup = 0;
    this.slipAngleBodyDeg = 0;
    this.bodyRollRad = 0;
    this.bodyPitchRad = 0;
    this.airborne = false;
    this.onTrack = false;
    this.currentSurface = this.config.surfaces.get(this.config.baseSurfaceId);
    this.odometerM = 0;
    this.timeSinceReset = 0;
    this.lastImpactSpeedMs = 0;
    this.impactEvents = [];
    this.engine.reset();
    for (const axle of this.axles) {
      axle.loadN = axle.massKg * this.tuning.simulation.gravity;
      axle.gripScale = 1;
      axle.sliding = false;
      axle.usageLat = 0;
      axle.usageLong = 0;
      axle.lateralForceN = 0;
      axle.longitudinalForceN = 0;
      axle.wheelspin = 0;
    }
    for (const wheel of this.wheels) {
      wheel.spinAngle = 0;
      wheel.spinSpeedRadS = 0;
      wheel.usage = 0;
      wheel.wheelspin = 0;
      wheel.sliding = false;
    }
  }

  /** Axle load in newtons (including downforce), for tools / HUD / tests. */
  get massKg() {
    return this.def.body.massKg;
  }

  get position() {
    return { x: this.x, y: this.y };
  }

  get bodyCorners() {
    const { lengthM, widthM } = this.def.body;
    const hl = lengthM / 2;
    const hw = widthM / 2;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const fx = this.x + c * this.def.body.cgToFrontM;
    const fy = this.y + s * this.def.body.cgToFrontM;
    // corner order: front-right, front-left, rear-left, rear-right (screen sense)
    const pts = [
      [hl, hw],
      [hl, -hw],
      [-hl, -hw],
      [-hl, hw]
    ];
    return pts.map(([lx, ly]) => {
      const px = this.x + c * lx - s * ly;
      const py = this.y + s * lx + c * ly;
      return { x: px, y: py, fx, fy };
    });
  }

  /** World-space position of an axle (used for surface queries and FX). */
  axlePosition(which) {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const d = which === 'front' ? this.def.body.cgToFrontM : -this.def.body.cgToRearM;
    return { x: this.x + c * d, y: this.y + s * d };
  }

  /** Physics tick at exactly one fixed step. */
  step(dt, input, world) {
    const sim = this.tuning.simulation;
    this.impactEvents.length = 0;
    this.timeSinceReset += dt;

    /* ---- steering input shaping -------------------------------- */
    const steerTarget = clamp(input.steer ?? 0, -1, 1);
    const degreesPerInput = this.def.steering.maxSteerAngleDeg;
    const towardLock = Math.abs(steerTarget) > Math.abs(this.steerInput) && Math.sign(steerTarget) === Math.sign(this.steerInput || steerTarget);
    const inputRate = (towardLock ? this.tuning.steering.steerRateDegPerSec : this.tuning.steering.returnRateDegPerSec) / Math.max(1, degreesPerInput);
    this.steerInput = rateApproach(this.steerInput, steerTarget, inputRate, dt);

    /* ---- engine / gearbox once per frame ----------------------- */
    const engineTelemetry = this.engine.update(
      dt,
      { throttle: input.throttle ?? 0, brake: input.brake ?? 0, handbrake: input.handbrake ? 1 : 0 },
      { speedMs: this.speedMs, forwardSpeedMs: this.forwardSpeedMs, wheelSpin: this.wheelSpin, grounded: true }
    );
    this.engineState = engineTelemetry;

    /* ---- integrate (sub-stepped so nothing tunnels) ------------ */
    const travel = this.speedMs * dt;
    const travelSteps = Math.ceil(travel / sim.maxSubStepTravelM);
    const stiffnessSteps = Math.ceil(dt / sim.maxSubStepSeconds);
    const subSteps = clamp(Math.max(travelSteps, stiffnessSteps), 1, sim.maxSubSteps);
    const h = dt / subSteps;
    for (let i = 0; i < subSteps; i++) this.integrate(h, input, engineTelemetry, world);

    /* ---- smoothed telemetry for HUD / audio / FX --------------- */
    this.prevX = this.interpX;
    this.prevY = this.interpY;
    this.prevHeading = this.interpHeading;
    this.interpX = this.x;
    this.interpY = this.y;
    this.interpHeading = this.heading;

    const v = worldToBody(this.vx, this.vy, this.heading);
    this.forwardSpeedMs = v.x;
    this.lateralSpeedMs = v.y;
    this.speedMs = Math.hypot(this.vx, this.vy);
    this.slipAngleBodyDeg = Math.atan2(v.y, Math.max(Math.abs(v.x), 1)) * RAD;
    this.smoothedYawRate = expApproach(this.smoothedYawRate, this.yawRate, this.tuning.chassis.bodyMotionSmoothing, dt);
    const smoothing = this.tuning.chassis.bodyMotionSmoothing;
    this.longitudinalAccelMs2 = expApproach(this.longitudinalAccelMs2, this.rawLongitudinalAccelMs2 ?? 0, smoothing, dt);
    this.lateralAccelMs2 = expApproach(this.lateralAccelMs2, this.rawLateralAccelMs2 ?? 0, smoothing, dt);
    this.wheelSpin = clamp01(Math.max(this.frontAxle.wheelspin, this.rearAxle.wheelspin));
    this.wheelLockup = clamp01(Math.max(this.frontAxle.lockup ?? 0, this.rearAxle.lockup ?? 0));

    const rollTarget = -clamp(this.lateralAccelMs2, -14, 14) * this.tuning.chassis.bodyRollVisualDeg * DEG / 6;
    const pitchTarget = clamp(this.longitudinalAccelMs2, -16, 16) * this.tuning.chassis.bodyPitchVisualDeg * DEG / 8;
    this.bodyRollRad = expApproach(this.bodyRollRad, rollTarget, this.tuning.chassis.bodyMotionSmoothing, dt);
    this.bodyPitchRad = expApproach(this.bodyPitchRad, pitchTarget, this.tuning.chassis.bodyMotionSmoothing, dt);

    // Safety net: a game must never show a NaN car. If anything upstream ever
    // produced a non-finite state, park the car instead of propagating it.
    if (!Number.isFinite(this.x + this.y + this.vx + this.vy + this.heading + this.yawRate)) {
      this.vx = 0;
      this.vy = 0;
      this.yawRate = 0;
      if (!Number.isFinite(this.x)) this.x = 0;
      if (!Number.isFinite(this.y)) this.y = 0;
      if (!Number.isFinite(this.heading)) this.heading = 0;
      this.longitudinalAccelMs2 = 0;
      this.lateralAccelMs2 = 0;
    }

    this.updateWheelVisuals(dt, world);
    this.odometerM += this.speedMs * dt;
    this.currentSurface = world.surfaceAt(this.x, this.y);
    this.onTrack = this.currentSurface.id !== this.config.baseSurfaceId;
  }

  /** One sub-step of the physics solve. */
  integrate(h, input, engineTelemetry, world) {
    const tuning = this.tuning;
    const body = this.def.body;
    const sim = tuning.simulation;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const v = worldToBody(this.vx, this.vy, this.heading);
    const vForward = v.x;
    const vLateral = v.y;

    /* ---- surfaces under each axle ------------------------------ */
    const frontPos = this.axlePosition('front');
    const rearPos = this.axlePosition('rear');
    const frontSurface = world.surfaceAt(frontPos.x, frontPos.y);
    const rearSurface = world.surfaceAt(rearPos.x, rearPos.y);
    this.frontAxle.surface = frontSurface;
    this.rearAxle.surface = rearSurface;
    // The body drag uses the surface under the car's centre.
    const centreSurface = world.surfaceAt(this.x, this.y);

    /* ---- axle loads (static + aero + longitudinal transfer) ---- */
    const dfN = downforce(this.def, tuning, { speedMs: this.speedMs, airDensity: sim.airDensity });
    const transferN = loadTransferForce(this.def, tuning, this.longitudinalAccelMs2, sim.gravity);
    const loads = axleLoads(this.def, tuning, { transferN, downforceN: dfN, gravity: sim.gravity });
    this.frontAxle.loadN = loads.front;
    this.rearAxle.loadN = loads.rear;
    this.frontAxle.downforceN = dfN * (body.massFrontKg / body.massKg);
    this.rearAxle.downforceN = dfN * (body.massRearKg / body.massKg);

    /* ---- steering angle ---------------------------------------- */
    const authority = 1 - (1 - tuning.steering.highSpeedSteerAnglePct) * smoothstep(0, tuning.steering.steerFalloffSpeedMs, this.speedMs);
    const hbBoost = input.handbrake ? tuning.steering.handbrakeSteerBoostDeg * DEG : 0;
    const counterSteer = this.assistsEnabled ? tuning.assists.counterSteerAssistPct * Math.atan2(vLateral, Math.max(Math.abs(vForward), 1)) : 0;
    this.steerAngleRad = clamp(
      this.steerInput * this.def.steering.maxSteerAngleRad * this.def.steering.steerAuthority * authority + counterSteer + hbBoost,
      -this.def.steering.maxSteerAngleRad * 1.15,
      this.def.steering.maxSteerAngleRad * 1.15
    );

    /* ---- driver forces ----------------------------------------- */
    const handbrakeGrip = input.handbrake ? tuning.brakes.handbrakeRearGripScale : 1;
    const brakeFrontN = (this.def.axleBrakeTorque.front * (input.brake ?? 0)) / this.def.tires.radiusM;
    const brakeRearN = (this.def.axleBrakeTorque.rear * (input.brake ?? 0)) / this.def.tires.radiusM;
    const handbrakeN = ((input.handbrake ? this.def.brakes.handbrakeTorqueNm * tuning.brakes.handbrakeRearBrakeScale : 0)) / this.def.tires.radiusM;
    const driveN = engineTelemetry.driveForceN;
    const engineBrakeN = engineTelemetry.engineBrakeForceN;
    const dt = this.def.drivetrain;

    const frontDrive = driveN * this.frontAxle.driveShare;
    const rearDrive = driveN * this.rearAxle.driveShare;
    const frontEngineBrake = engineBrakeN * this.frontAxle.driveShare;
    const rearEngineBrake = engineBrakeN * this.rearAxle.driveShare;

    /* ---- lateral solve (SECTION 9.3) --------------------------- */
    // Velocity of each axle, expressed in the tire's own frame (the front tires
    // are rotated by the steering angle). Lateral component -> tire lateral
    // force, longitudinal component -> tire longitudinal force.
    const frontVelY = vLateral + this.yawRate * body.cgToFrontM;
    const cosSteer = Math.cos(this.steerAngleRad);
    const sinSteer = Math.sin(this.steerAngleRad);
    const vLongFrontTire = vForward * cosSteer + frontVelY * sinSteer;
    const vLatFrontTire = frontVelY * cosSteer - vForward * sinSteer;
    const vLatRearTire = vLateral - this.yawRate * body.cgToRearM;

    solveLateral(this.frontAxle, {
      vLateral: vLatFrontTire,
      vForward: vLongFrontTire > 0 ? Math.abs(vLongFrontTire) : -Math.abs(vLongFrontTire),
      surfaceGrip: frontSurface.grip,
      model: tuning.tires.model,
      tuning,
      gripMul: 1,
      longitudinalUsage: this.frontAxle.usageLong
    });
    solveLateral(this.rearAxle, {
      vLateral: vLatRearTire,
      vForward,
      surfaceGrip: rearSurface.grip,
      model: tuning.tires.model,
      tuning,
      gripMul: handbrakeGrip,
      longitudinalUsage: this.rearAxle.usageLong
    });
    for (const axle of this.axles) updateSlideState(axle, tuning, h);

    /* ---- longitudinal solve + friction ellipse ----------------- */
    const frontLong = solveLongitudinal(this.frontAxle, {
      driveN: frontDrive,
      brakeForceN: brakeFrontN + frontEngineBrake,
      vForward,
      surfaceGrip: frontSurface.grip,
      lateralUsage: this.frontAxle.usageLat,
      tuning,
      absEnabled: tuning.brakes.absEnabled
    });
    const rearLong = solveLongitudinal(this.rearAxle, {
      driveN: rearDrive,
      brakeForceN: brakeRearN + handbrakeN + rearEngineBrake,
      vForward,
      surfaceGrip: rearSurface.grip,
      lateralUsage: this.rearAxle.usageLat,
      tuning,
      absEnabled: tuning.brakes.absEnabled,
      gripMul: handbrakeGrip
    });

    /* ---- forces in the body frame ------------------------------ */
    // The front tires point along the steering angle, so their forces have to be
    // rotated back into the body frame. This is what makes a big steering angle
    // scrub speed off (the lateral force gains a backwards component) and gives
    // front-drive cars their torque-steer pull.
    const frontFx = this.frontAxle.longitudinalForceN * cosSteer - this.frontAxle.lateralForceN * sinSteer;
    const frontFy = this.frontAxle.longitudinalForceN * sinSteer + this.frontAxle.lateralForceN * cosSteer;
    let fx = frontFx + this.rearAxle.longitudinalForceN;
    let fy = frontFy + this.rearAxle.lateralForceN;

    const resistanceN =
      rollingResistance(this.def, tuning, { speedMs: this.speedMs, surfaceDrag: centreSurface.drag, gravity: sim.gravity }) * (Math.abs(vForward) > 0.05 ? 1 : 0) +
      aeroDrag(this.def, tuning, { speedMs: this.speedMs, airDensity: sim.airDensity });
    if (this.speedMs > 1e-3) {
      const invSpeed = 1 / this.speedMs;
      fx -= resistanceN * vForward * invSpeed;
      fy -= resistanceN * vLateral * invSpeed;
    }

    /* ---- rigid body equations ---------------------------------- */
    // The velocity is stored in the WORLD frame and re-projected into the body
    // frame at the start of every sub-step, so the rotating-frame (centripetal)
    // terms are already accounted for by the heading update below. Adding them
    // here as well would count them twice and halve the car's cornering power.
    const mass = body.massKg;
    const aForward = fx / mass;
    const aLateral = fy / mass;
    let yawAccel = (body.cgToFrontM * frontFy - body.cgToRearM * this.rearAxle.lateralForceN) / body.yawInertiaKgM2;

    /* ---- driver assists ---------------------------------------- */
    if (this.assistsEnabled) {
      const a = tuning.assists;
      if (a.stabilityAssistEnabled && this.speedMs > 1) {
        const velocityHeading = Math.atan2(this.vy, this.vx);
        const bodySlip = wrapAngle(this.heading - velocityHeading);
        const activation = a.stabilityAssistActivationDeg * DEG;
        const speedScale = 1 - smoothstep(a.stabilityAssistMaxSpeedMs * 0.75, a.stabilityAssistMaxSpeedMs, this.speedMs);
        const excess = Math.abs(bodySlip) - activation;
        if (excess > 0 && this.speedMs < a.stabilityAssistMaxSpeedMs) {
          yawAccel -= Math.sign(bodySlip) * a.stabilityAssistStrength * excess * speedScale * 2.2;
        }
      }
    }

    /* ---- integrate the rigid body ------------------------------ */
    const vForwardNew = vForward + aForward * h;
    const vLateralNew = vLateral + aLateral * h;
    this.yawRate = clamp(this.yawRate + yawAccel * h, -sim.maxYawRateRadS, sim.maxYawRateRadS);

    const worldVel = bodyToWorld(vForwardNew, vLateralNew, this.heading);
    this.vx = worldVel.x;
    this.vy = worldVel.y;

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > sim.maxSpeedMs) {
      const scale = sim.maxSpeedMs / speed;
      this.vx *= scale;
      this.vy *= scale;
    }

    this.heading = wrapAngle(this.heading + this.yawRate * h);
    this.x += this.vx * h;
    this.y += this.vy * h;

    // Snap to rest: kills the last few millimetres per second of creep.
    const throttleNow = Math.max(input.throttle ?? 0, input.brake ?? 0);
    if (speed < sim.restVelocityEpsilon && throttleNow < 0.05) {
      this.vx = 0;
      this.vy = 0;
      this.yawRate *= 0.5;
    }

    /* ---- collisions with the world ----------------------------- */
    if (world.resolveCollision) world.resolveCollision(this, h);

    /* ---- bookkeeping for the next step ------------------------- */
    this.speedMs = Math.hypot(this.vx, this.vy);
    const after = worldToBody(this.vx, this.vy, this.heading);
    // What the driver feels: tire force per unit mass (this is the g-meter).
    this.rawLongitudinalAccelMs2 = fx / mass;
    this.rawLateralAccelMs2 = fy / mass;
    this.yawAccelRadS2 = yawAccel;
    this.forwardSpeedMs = after.x;
    this.lateralSpeedMs = after.y;
    this.lastAxleTelemetry = { front: frontLong, rear: rearLong };
    void c;
    void s;
    void dt;
  }

  /** Wheel positions / spin for the renderer and the skid-mark layer. */
  updateWheelVisuals(dt, world) {
    void world;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const body = this.def.body;
    for (const wheel of this.wheels) {
      const axleDef = wheel.axle === 'front' ? this.frontAxle : this.rearAxle;
      const longitudinalM = wheel.axle === 'front' ? body.cgToFrontM : -body.cgToRearM;
      const steer = wheel.steer ? this.steerAngleRad : 0;
      wheel.x = this.x + c * longitudinalM - s * wheel.lateralM;
      wheel.y = this.y + s * longitudinalM + c * wheel.lateralM;
      wheel.steerAngle = steer;
      wheel.surfaceId = axleDef.surface?.id ?? this.currentSurface.id;
      wheel.drag = axleDef.surface?.drag ?? 1;
      wheel.usage = combinesUsage(axleDef);
      wheel.sliding = axleDef.sliding;
      wheel.wheelspin = axleDef.wheelspin;
      wheel.lockup = axleDef.lockup ?? 0;
      const rollingSpeed = this.forwardSpeedMs / this.def.tires.radiusM;
      const spinBoost = wheel.drive ? wheel.wheelspin * this.tuning.skid.wheelspinSpinBoostRadS : 0;
      wheel.spinSpeedRadS = expApproach(wheel.spinSpeedRadS, rollingSpeed + spinBoost, this.tuning.skid.wheelspinSpinRatePerSecond, dt);
      wheel.spinAngle = (wheel.spinAngle + wheel.spinSpeedRadS * dt) % (Math.PI * 2);
    }
  }

  /** Copies of the axle states - handy for tests, HUD overlays and the AI. */
  telemetry() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      heading: this.heading,
      speedMs: this.speedMs,
      speedKph: this.speedMs * 3.6,
      forwardSpeedMs: this.forwardSpeedMs,
      lateralSpeedMs: this.lateralSpeedMs,
      yawRate: this.yawRate,
      bodySlipDeg: this.slipAngleBodyDeg,
      longitudinalAccelMs2: this.longitudinalAccelMs2,
      lateralAccelMs2: this.lateralAccelMs2,
      lateralG: Math.abs(this.lateralAccelMs2) / this.tuning.simulation.gravity,
      brakeG: -Math.abs(Math.min(0, this.longitudinalAccelMs2)) / this.tuning.simulation.gravity,
      steerAngleRad: this.steerAngleRad,
      surface: this.currentSurface?.id ?? 'asphalt',
      onTrack: this.onTrack,
      engine: this.engineState,
      front: { ...this.frontAxle, surface: this.frontAxle.surface?.id ?? null },
      rear: { ...this.rearAxle, surface: this.rearAxle.surface?.id ?? null },
      wheels: this.wheels.map((w) => ({ ...w })),
      odometerM: this.odometerM
    };
  }
}
