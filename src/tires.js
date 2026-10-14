/**
 * tires.js - SECTION 9.3 "Tire grip model (the core of the feel)".
 *
 * Everything here is a pure function of (axle state, velocity, tuning, surface)
 * so it can be unit-tested and replayed deterministically.
 *
 * Model, exactly as specified:
 *   1. the velocity at the axle is split into a FORWARD and a LATERAL component
 *      relative to the car heading,
 *   2. the lateral component is cancelled by tire grip with
 *          lateralForce = -lateralVelocity * gripFactor
 *      clamped to the axle's max grip limit (mu * axle load),
 *   3. when the demanded force exceeds that limit the tire SLIDES, the car keeps
 *      moving sideways, and grip drops to `slideGripRatio` (~70%) of the limit,
 *   4. front and rear axles are solved separately (2-wheel "bicycle model") and
 *      the car's oversteer/understeer bias shifts grip between them, so the rear
 *      can let go first (oversteer) or the front can (understeer),
 *   5. grip is multiplied by the surface multiplier from surfaces.json.
 *
 * Two gripFactor models are available in tuning.tires.model:
 *   "velocityScaled" (default) - gripFactor = C_alpha * Fz / max(|vForward|, floor).
 *       Because C_alpha scales with grip, the peak arrives at a constant slip
 *       ANGLE, which is what a real tire does; the formula is still literally
 *       `force = -lateralVelocity * gripFactor`.
 *   "velocity"                 - gripFactor = damping * axleMass, a slip-velocity
 *       proportional damper (peak arrives at a constant slip VELOCITY).
 */

import { clamp, clamp01, expApproach, lerp, smoothstep } from './mathx.js';

/**
 * Create the per-axle state container used by the solver. One of these exists
 * for the front and one for the rear axle of every car.
 */
export function createAxle(id, { massKg, inertiaKgM2, grip, stiffnessPerGrip, slideGripRatio, longitudinalGripRatio, driveShare, brakeShare }) {
  return {
    id,
    massKg,
    inertiaKgM2,
    grip, // effective friction coefficient of the tire (balance applied)
    stiffnessPerGrip, // cornering stiffness per unit grip and load [1/rad]
    slideGripRatio,
    longitudinalGripRatio,
    driveShare,
    brakeShare,
    // dynamic state
    loadN: massKg * 9.81,
    staticLoadN: massKg * 9.81,
    downforceN: 0,
    gripScale: 1,
    sliding: false,
    slideAmount: 0,
    usageLat: 0,
    usageLimit: 0,
    usageLong: 0,
    usageLongLimit: 0,
    slipAngleRad: 0,
    slipVelocityMs: 0,
    lateralForceN: 0,
    longitudinalForceN: 0,
    gripLimitN: 0,
    demandLateralN: 0,
    demandLongitudinalN: 0,
    wheelspin: 0,
    lockup: 0,
    braking: 0,
    surface: null
  };
}

/**
 * Static axle loads + aerodynamic downforce + longitudinal load transfer.
 * Downforce is split by the car's static weight distribution (i.e. no separate
 * aero balance is modelled, which keeps the aero behaviour of the provided cars
 * predictable).
 */
export function axleLoads(car, tuning, { transferN = 0, downforceN = 0, gravity }) {
  const shareFront = car.body.massFrontKg / car.body.massKg;
  const shareRear = 1 - shareFront;
  const staticFront = car.body.massFrontKg * gravity;
  const staticRear = car.body.massRearKg * gravity;
  const maxTransfer = tuning.chassis.maxTransferFraction * Math.min(staticFront, staticRear);
  const transfer = clamp(transferN, -maxTransfer, maxTransfer);
  return {
    front: Math.max(tuning.chassis.minAxleLoadN, staticFront + downforceN * shareFront - transfer),
    rear: Math.max(tuning.chassis.minAxleLoadN, staticRear + downforceN * shareRear + transfer)
  };
}

/**
 * Longitudinal load transfer from the car's (smoothed) longitudinal
 * acceleration: accelerating moves weight rearwards, braking moves it forward.
 * `loadTransferFactor` lets the game exaggerate or soften it for feel.
 */
export function loadTransferForce(car, tuning, longitudinalAccelMs2, gravity) {
  const raw = (car.body.massKg * longitudinalAccelMs2 * car.body.cgHeightM) / car.body.wheelbaseM;
  return raw * tuning.chassis.loadTransferFactor;
}

/**
 * The lateral solve - see the header. `vLateral` must be the velocity at the
 * axle, expressed relative to the tire's rolling direction (i.e. the steering
 * angle is already removed).
 */
export function solveLateral(axle, { vLateral, vForward, surfaceGrip, model, tuning, gripMul = 1, longitudinalUsage = 0 }) {
  const gripCoeff = axle.grip * surfaceGrip * gripMul;
  // The friction ellipse, both ways round: a tire that is already spending grip
  // on driving/braking has less left to steer with (power-on oversteer, locked
  // wheels that will not turn) and the other half lives in solveLongitudinal.
  // `longitudinalUsage` is the previous sub-step's demand - a 1/240 s lag, which
  // is invisible and keeps the two solves from chasing each other.
  const ellipse = combinedSlipScale(longitudinalUsage, tuning);
  // A tire that is outright SPINNING barely holds the road sideways: this is
  // what makes a rear-drive car donut, what makes the throttle a steering tool
  // on the way out of a corner, and what makes a front-drive car understeer on
  // power. It is fed by the drive-side overshoot measured in solveLongitudinal.
  const spinScale = 1 - tuning.tires.wheelspinGripLoss * clamp01(axle.wheelspin ?? 0);
  const limitN = Math.max(1, gripCoeff * axle.loadN * axle.gripScale * ellipse * spinScale);

  let gripFactor;
  if (model === 'velocity') {
    // force = -lateralVelocity * damping * axleMass  [N per (m/s)]
    gripFactor = tuning.tires.velocityDampingPerSecond * axle.massKg;
  } else {
    // force = -lateralVelocity * C_alpha / max(|vForward|, floor)
    const speedDenominator = Math.max(Math.abs(vForward), tuning.tires.slipSpeedFloorMs);
    gripFactor = (axle.stiffnessPerGrip * gripCoeff * axle.loadN) / speedDenominator;
  }

  const demandN = -gripFactor * vLateral;
  const forceN = clamp(demandN, -limitN, limitN);
  const usage = Math.abs(demandN) / limitN;
  // Usage measured against the UN-reduced limit: this is what decides whether the
  // tire is sliding. Measuring the slide decision against the reduced limit would
  // let the grip loss cancel its own cause and chatter at the limit.
  const usageLimit = Math.abs(demandN) / Math.max(1, gripCoeff * axle.loadN * ellipse * spinScale);

  axle.gripLimitN = limitN;
  axle.demandLateralN = demandN;
  axle.lateralForceN = forceN;
  axle.usageLat = usage;
  axle.usageLimit = usageLimit;
  axle.slipVelocityMs = vLateral;
  axle.slipAngleRad = Math.atan2(vLateral, Math.max(Math.abs(vForward), tuning.tires.slipSpeedFloorMs));

  return { forceN, demandN, usage, limitN, gripFactor };
}

/**
 * Slide bookkeeping with hysteresis: a tire starts sliding when the demanded
 * force reaches `slideEnterUsage` of its limit and only stops sliding once the
 * demand has fallen back below `slideExitUsage`. Grip is dropped instantly when
 * a slide starts (that snap is what the driver feels) and recovers smoothly.
 */
export function updateSlideState(axle, tuning, dt) {
  const t = tuning.tires;
  // How far past the grip limit the tire is being asked to work, 0..1. The grip
  // then falls off PROGRESSIVELY (a real tire peaks and then slides) instead of
  // switching between two states - a hard switch makes the car chatter at the
  // limit, because losing grip removes the very demand that caused it.
  const pressure = smoothstep(t.slideExitUsage, t.slideEnterUsage * t.slidePressureSpan, axle.usageLimit);
  const target = 1 - (1 - axle.slideGripRatio) * pressure;
  const rate = target < axle.gripScale ? t.slideGripDropPerSecond : t.slideGripRecoveryPerSecond;
  axle.gripScale = clamp(expApproach(axle.gripScale, target, rate, dt), axle.slideGripRatio, 1);
  axle.slideAmount = clamp01((1 - axle.gripScale) / Math.max(1e-3, 1 - axle.slideGripRatio));
  axle.sliding = pressure > 0.4 || axle.gripScale < 0.96;
  return axle.sliding;
}

/**
 * Combined slip (friction ellipse): the more of an axle's grip budget is spent
 * sideways, the less is available for driving/braking. This is what makes a
 * power-on drift slow the car down and what stops a locked wheel from turning.
 */
export function combinedSlipScale(lateralUsage, tuning) {
  const u = clamp01(lateralUsage);
  const remaining = Math.sqrt(Math.max(tuning.tires.frictionEllipseFloor, 1 - u * u));
  return 1 - tuning.tires.frictionEllipse * (1 - remaining);
}

/**
 * The longitudinal solve. Drive and brake forces are requested separately so
 * that ABS can clamp only the brake side; the total demand is then clamped to
 * the axle's longitudinal grip limit (after the combined-slip ellipse). Every
 * newton of drive force thrown away by that clamp is reported as wheelspin so
 * the renderer/audio can show smoke, spinning wheels and lost forward drive.
 *
 * @param {{driveN:number, brakeForceN:number, vForward:number, surfaceGrip:number,
 *          lateralUsage:number, tuning:object, absEnabled:boolean}} params
 */
export function solveLongitudinal(axle, { driveN, brakeForceN, vForward, surfaceGrip, lateralUsage, tuning, absEnabled = true, gripMul = 1 }) {
  const ellipse = combinedSlipScale(lateralUsage, tuning);
  const muLong = axle.grip * surfaceGrip * gripMul * axle.longitudinalGripRatio;
  const limitN = Math.max(1, muLong * axle.loadN * ellipse);

  // Brakes always oppose the direction the wheel is rolling; when the car is
  // basically stopped they oppose the drive force instead (so you can hold a
  // car still with the handbrake on a hill without it creeping backwards).
  const rollSign = Math.abs(vForward) > 0.25 ? Math.sign(vForward) : driveN > 0 ? 1 : -1;
  const abs = absEnabled ? tuning.brakes.absUsageTarget : 1;
  const clampedBrake = Math.min(Math.max(0, brakeForceN), abs * limitN);
  const demandN = driveN - rollSign * clampedBrake;

  const applied = clamp(demandN, -limitN, limitN);
  const overshoot = Math.abs(driveN) / limitN - 1;
  const lockup = Math.max(0, Math.abs(demandN) / limitN - 1);
  const tractionLoss = 1 - tuning.tires.wheelspinTractionLoss * clamp01(overshoot);
  const forceN = applied * tractionLoss;

  axle.demandLongitudinalN = demandN;
  axle.longitudinalForceN = forceN;
  axle.usageLong = Math.abs(demandN) / limitN;
  axle.wheelspin = Math.max(0, overshoot);
  axle.lockup = lockup;
  axle.gripLimitN = limitN;
  axle.usageLongLimit = Math.abs(driveN) / Math.max(1, muLong * axle.loadN);
  return { forceN, limitN, usage: axle.usageLong, wheelspin: axle.wheelspin, ellipse, lockup };
}

/** Rolling resistance (scaled by the surface drag multiplier) - opposes motion. */
export function rollingResistance(car, tuning, { speedMs, surfaceDrag, gravity }) {
  if (speedMs < 1e-4) return 0;
  const normalN = car.body.massKg * gravity;
  return car.body.rollingResistanceCoeff * normalN * surfaceDrag * tuning.aero.rollingResistanceScale;
}

/** Aerodynamic drag (0.5 * rho * CdA * v^2) - opposes motion. */
export function aeroDrag(car, tuning, { speedMs, airDensity }) {
  return 0.5 * airDensity * car.body.dragAreaCdA * tuning.aero.dragScale * speedMs * speedMs;
}

/** Aerodynamic downforce (0.5 * rho * ClA * v^2) - adds grip with speed. */
export function downforce(car, tuning, { speedMs, airDensity }) {
  return 0.5 * airDensity * car.body.downforceCoeff * tuning.aero.downforceScale * speedMs * speedMs;
}

/** 0..1 grip utilisation of an axle, used for FX (smoke, marks, screech). */
export function combinesUsage(axle) {
  return Math.hypot(axle.usageLat, axle.usageLong);
}

/** Blend a "usage" number into a smoke/dust amount for the FX layer. */
export function slipIntensity(usage, threshold, max = 2.2) {
  return clamp01((usage - threshold) / (max - threshold));
}

export { lerp };
