/**
 * config.js - the single place where data/*.json is turned into the numbers the
 * simulator runs on. It also owns the ONE unit conversion the spec allows:
 * metres <-> pixels (1 m = tuning.simulation.pxPerMeter px).
 *
 * Anything the physics needs must be present in the JSON files. Missing values
 * that change handling raise a ConfigError so a typo can never silently become
 * a hardcoded fallback.
 */

import { DEG } from './mathx.js';

export class ConfigError extends Error {
  constructor(problems) {
    super(`Car config is invalid:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/* ------------------------------------------------------------------ *
 * tiny validation helpers
 * ------------------------------------------------------------------ */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Optional strict mode: wraps the tuning object so that asking for a value that
 * does not exist throws instead of silently evaluating to `undefined` (which
 * turns into NaN a few frames later). Tests and tools run with this enabled -
 * it is how a renamed constant gets caught before it becomes a mystery bug.
 */
function strictTuning(value, path, cache) {
  if (value === null || typeof value !== 'object') return value;
  if (cache.has(value)) return cache.get(value);
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !(key in target) && !key.startsWith('$')) {
        throw new ConfigError([`tuning.json has no value "${path}${key}" (a constant was renamed or misspelled)`]);
      }
      return strictTuning(Reflect.get(target, key, receiver), `${path}${key}.`, cache);
    }
  });
  cache.set(value, proxy);
  return proxy;
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function checkNumbers(obj, paths, problems, where) {
  for (const path of paths) {
    const value = getPath(obj, path);
    if (!isNum(value)) problems.push(`${where}: ${path} must be a number (got ${JSON.stringify(value)})`);
  }
}

function checkArrays(obj, paths, lengths, problems, where) {
  for (const path of paths) {
    const value = getPath(obj, path);
    const expected = lengths[path];
    if (!Array.isArray(value) || value.length !== expected) {
      problems.push(`${where}: ${path} must be an array of exactly ${expected} entries`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * required data shape
 * ------------------------------------------------------------------ */

const TUNING_NUMBERS = [
  'simulation.physicsHz',
  'simulation.maxSubSteps',
  'simulation.maxSubStepTravelM',
  'simulation.maxSubStepSeconds',
  'simulation.maxFrameTimeMs',
  'simulation.pxPerMeter',
  'simulation.gravity',
  'simulation.airDensity',
  'simulation.maxSpeedMs',
  'simulation.restVelocityEpsilon',
  'simulation.maxYawRateRadS',
  'drivetrain.gearCount',
  'drivetrain.shiftUpAtRedlinePct',
  'drivetrain.shiftDownAtRedlinePct',
  'drivetrain.shiftTorqueCutMs',
  'drivetrain.shiftTotalMs',
  'drivetrain.shiftCooldownMs',
  'drivetrain.rpmResponsePerSecond',
  'drivetrain.clutchLockRpmPct',
  'drivetrain.clutchLockIdlePct',
  'drivetrain.clutchLockRatePerSecond',
  'drivetrain.kickdownSpeedMs',
  'drivetrain.shiftBlipMs',
  'drivetrain.limiterBouncePct',
  'drivetrain.finalDriveEfficiency',
  'drivetrain.engineBrakeTorqueNm',
  'drivetrain.engineBrakePerRpm',
  'drivetrain.engineBrakeWheelCutoffMs',
  'drivetrain.idleGovernorTorqueNm',
  'drivetrain.idleGovernorKp',
  'drivetrain.revLimiterRpmMargin',
  'drivetrain.revLimiterCutMs',
  'drivetrain.revLimiterRecoverMs',
  'drivetrain.wheelspinRpmBoostPct',
  'drivetrain.reverseEngageSpeedMs',
  'drivetrain.reverseEngageDwellMs',
  'drivetrain.reverseTopSpeedMs',
  'drivetrain.launchTorqueScale',
  'drivetrain.throttleBlipDownshift',
  'tires.velocityDampingPerSecond',
  'tires.slipSpeedFloorMs',
  'tires.slideGripRatio',
  'tires.slideEnterUsage',
  'tires.slideExitUsage',
  'tires.slideGripRecoveryPerSecond',
  'tires.slideGripDropPerSecond',
  'tires.slidePressureSpan',
  'tires.longitudinalGripRatio',
  'tires.wheelspinTractionLoss',
  'tires.wheelspinGripLoss',
  'tires.frictionEllipse',
  'tires.frictionEllipseFloor',
  'tires.gripSmoothing',
  'chassis.loadTransferFactor',
  'chassis.loadTransferSmoothing',
  'chassis.maxTransferFraction',
  'chassis.minAxleLoadN',
  'chassis.referenceLoadN',
  'chassis.bodyRollVisualDeg',
  'chassis.bodyPitchVisualDeg',
  'chassis.bodyMotionSmoothing',
  'chassis.wheelVisualTravelM',
  'aero.dragScale',
  'aero.rollingResistanceScale',
  'aero.downforceScale',
  'steering.steerRateDegPerSec',
  'steering.returnRateDegPerSec',
  'steering.handbrakeSteerBoostDeg',
  'steering.maxVisualSteerDeg',
  'brakes.absUsageTarget',
  'brakes.handbrakeRearGripScale',
  'brakes.handbrakeRearBrakeScale',
  'balance.gripInfluence',
  'assists.counterSteerAssistPct',
  'assists.stabilityAssistStrength',
  'assists.stabilityAssistActivationDeg',
  'assists.stabilityAssistMaxYawRateRadS',
  'assists.stabilityAssistMaxSpeedMs',
  'world.gridCellM',
  'world.gateSpacingM',
  'world.minGateWidthM',
  'world.gateResyncWindow',
  'collision.skinM',
  'collision.hardImpactSpeedMs',
  'collision.wallRestitution',
  'collision.wallFriction',
  'collision.wallScrapeSpeedLoss',
  'collision.impactSpeedLossPct',
  'collision.impactYawImpulse',
  'collision.maxImpactSpeedMs',
  'collision.impactShakeScale',
  'skid.markMinSpeedMs',
  'skid.markUsageThreshold',
  'skid.markWidthM',
  'skid.markAlpha',
  'skid.markFadeSeconds',
  'skid.maxMarkSegments',
  'skid.smokeUsageThreshold',
  'skid.dustUsageThreshold',
  'skid.maxParticles',
  'skid.wheelspinSpinBoostRadS',
  'skid.wheelspinSpinRatePerSecond',
  'drift.minSpeedMs',
  'drift.minSlipAngleDeg',
  'drift.scorePerSecondAtFullSlide',
  'drift.comboWindowSeconds',
  'drift.comboStep',
  'drift.comboMax',
  'drift.bankOnCleanSeconds',
  'drift.spinOutYawRateRadS',
  'camera.followLerpPerSecond',
  'camera.speedZoomPct',
  'camera.baseZoom',
  'camera.minZoom',
  'camera.maxZoom',
  'camera.leadDistanceM',
  'camera.shakeDecayPerSecond',
  'camera.fitWidthPx',
  'camera.minFitZoom',
  'audio.screechUsageThreshold',
  'audio.windStartSpeedMs',
  'audio.windFullSpeedMs',
  'debug.surfaceProbeRadiusM',
  // 9.4 steering
  'steering.steerRateDegPerSec',
  'steering.returnRateDegPerSec',
  'steering.keyboardRampMs',
  'steering.assistSteerPct',
  'steering.assistMaxSteerPct',
  'steering.assistSpeedMs',
  'steering.assistHoldSeconds',
  'steering.assistDriftReleasePerSecond',
  // 9.5 brakes
  'brakes.handbrakeLockGripScale',
  'brakes.handbrakeLockSeconds',
  'brakes.handbrakeCooldownSeconds',
  'brakes.handbrakeLockBrakeScale',
  'brakes.brakeLightOnThreshold',
  // 9.6 drift
  'drift.crashCancelWindowSeconds',
  'drift.cleanExitBoostPct',
  'drift.cleanExitMinPoints',
  'drift.cleanExitBoostSeconds',
  'drift.nitroPerPoint',
  'drift.coinsPerPoint',
  'drift.stylePerPoint',
  // 9.7 nitro
  'nitro.drainPerSecond',
  'nitro.minToActivatePct',
  'nitro.forceMultiplier',
  'nitro.topSpeedMultiplier',
  'nitro.steerAnglePct',
  'nitro.fillFromDriftPerPoint',
  'nitro.fillFromNearMissPct',
  'nitro.fillFromSlipstreamPerSecond',
  'nitro.fillFromSlipstreamMaxPct',
  'nitro.overheatLockoutMs',
  'nitro.cameraZoomOutPct',
  'nitro.flameParticlesPerSecond',
  'nitro.speedLinesPerSecond',
  'nitro.audioLayerGain',
  // 9.8 collisions
  'collision.carRestitution',
  'collision.carFriction',
  'collision.carImpulseMaxSpeedMs',
  'collision.hitStopMs',
  'collision.hitStopMinImpactMs',
  'collision.hitStopMaxMs',
  'collision.hitStopImpactMs',
  'collision.scrapeSparkSpeedMs',
  'collision.sparksPerSecond',
  'collision.hitStopShakeScale',
  // 9.9 damage
  'damage.armorScale',
  'damage.minImpactSpeedMs',
  'damage.minImpactEnergyJ',
  'damage.healthMax',
  'damage.smokeAtHealthPct',
  'damage.fireAtHealthPct',
  'damage.frontEffectAtZonePct',
  'damage.sideEffectAtZonePct',
  'damage.rearEffectAtZonePct',
  'damage.topSpeedLossPctPerDamage',
  'damage.topSpeedLossMaxPct',
  'damage.steerPullMaxDeg',
  'damage.accelLossPctPerDamage',
  'damage.accelLossMaxPct',
  'damage.scrapeDamagePerSecond',
  'damage.wreckSeconds',
  // 9.10 traffic + economy
  'traffic.count',
  'traffic.spawnAheadM',
  'traffic.spawnSpreadM',
  'traffic.slipstreamRangeM',
  'traffic.slipstreamHalfAngleDeg',
  'traffic.slipstreamSpeedPct',
  'traffic.slipstreamMinSpeedMs',
  'traffic.nearMissDistanceM',
  'traffic.nearMissMinSpeedMs',
  'traffic.nearMissCooldownSeconds',
  'traffic.respawnSeconds',
  'traffic.contactDamageScale',
  'economy.coinsPerLap',
  'economy.coinsPerNearMiss',
  'economy.coinsPerStylePoint',
  'economy.coinsPerStar',
  'economy.repairCostPerDamage',
  'economy.repairCostMin',
  'economy.freeQuickRepairs',
  'economy.quickRepairHealthPct',
  'economy.startCoins',
  // 9.6 / 9.10 shapes and recovery, authored rather than coded
  'drift.fullSlideAngleSpanDeg',
  'drift.fullScoreSpeedMs',
  'drift.minSpeedFactor',
  'drift.minBankSeconds',
  'drift.cancelMinPoints',
  'drift.spinMinSpeedMs',
  'drift.comboRampSeconds',
  'traffic.stuckSpeedMs',
  'traffic.respawnAheadM',
  'traffic.respawnSpeedMs',
  'traffic.respawnLockoutSeconds',
  'traffic.decorCooldownScale',
  // 9.11 handling-profile conversion + 9.12 feel targets
  'profile.yawInertiaFactor',
  'profile.brakeTorquePerKgNm',
  'profile.frontalAreaM2',
  'profile.topSpeedRpmPct',
  'profile.steerFalloffRefKph',
  'profile.steerMinLockPct',
  'profile.armorRatingBase',
  'profile.powerToKw',
  'world.minRadiusToWidth',
  'steering.assistFullErrorDeg',
  'steering.assistReleasePerSecond',
  'steering.assistMinInput',
  'steering.steerOvershootScale',
  // 9.4 analog steering sources
  'input.padDeadZonePx',
  'input.padFullLockPx',
  'input.padResponseExponent',
  'input.padReleasePerSecond',
  'input.tiltDeadZoneDeg',
  'input.tiltFullLockDeg',
  'input.tiltSmoothPerSecond'
];

const TUNING_FLAGS = [
  'brakes.absEnabled',
  'input.tiltEnabled',
  'input.tiltInvert',
  'assists.stabilityAssistEnabled',
  'debug.showForcesByDefault',
  'debug.drawTelemetry',
  'damage.enabled',
  'traffic.enabled'
];

const TUNING_ARRAYS = ['steering.speedSteerCurve', 'assists.difficulty.levels', 'profile.curveRpmPct'];
const TUNING_KEYED_NUMBERS = ['damage.zoneBias'];

const CAR_NUMBERS = [
  'body.massKg',
  'body.yawInertiaKgM2',
  'body.cgToFrontM',
  'body.cgToRearM',
  'body.cgHeightM',
  'body.trackWidthM',
  'body.lengthM',
  'body.widthM',
  'body.heightM',
  'body.dragAreaCdA',
  'body.rollingResistanceCoeff',
  'body.downforceCoeff',
  'tires.radiusM',
  'tires.gripFront',
  'tires.gripRear',
  'tires.corneringStiffnessPerGrip',
  'tires.slideGripRatio',
  'tires.longitudinalGripRatio',
  'wheels.inertiaFrontKgM2',
  'wheels.inertiaRearKgM2',
  'engine.idleRpm',
  'engine.redlineRpm',
  'engine.revLimiterRpm',
  'engine.audio.toneHz',
  'engine.audio.brightness',
  'engine.audio.roughness',
  'drivetrain.reverseRatio',
  'drivetrain.finalDrive',
  'drivetrain.powerSplitFront',
  'drivetrain.balance',
  'drivetrain.launchRpm',
  'steering.maxSteerAngleDeg',
  'steering.steerAuthority',
  'brakes.maxBrakeTorqueNm',
  'brakes.brakeBiasFront',
  'brakes.handbrakeTorqueNm',
  // 9.7 / 9.9 car stats
  'nitro.capacity',
  'nitro.power',
  'armor'
];

const SURFACE_NUMBERS = ['grip', 'drag', 'skidIntensity'];

const AUDIO_NUMBERS = [
  'master.volume',
  'engine.lowpassIdleHz',
  'engine.lowpassRedlineHz',
  'engine.gainIdlePct',
  'engine.gainRedlinePct',
  'engine.gainOffThrottlePct',
  'engine.shiftDipPct',
  'engine.shiftDipMs',
  'engine.shiftDipPitchPct',
  'engine.limiterGateHz',
  'engine.limiterCutGainPct',
  'engine.fadeInMs',
  'engine.fadeOutMs',
  'tires.screechQ',
  'tires.volumeAtFullSlip',
  'tires.pitchJitterPct',
  'surface.volumeAtFullSlip',
  'surface.windVolume'
];

/* ------------------------------------------------------------------ *
 * SECTION 9.11 - the per-car handling profile
 *
 * A car can be authored as a handling profile: the handful of numbers a
 * designer actually tunes (mass, engine power, torque curve shape, gear
 * ratios, top speed, front/rear grip, slide grip, steering lock and falloff,
 * brake force, drag, armor, nitro capacity). Those are authored at the top
 * level of the car - exactly the shape in the spec - or inside a "profile"
 * block, and are converted ONCE here into the internal model:
 *
 *   mass              -> body.massKg (real kg)
 *   enginePower       -> a torque curve scaled so peak power matches (kW)
 *   torqueCurve       -> 5 shape factors across idle..redline
 *   gearRatios        -> drivetrain.gearRatios
 *   topSpeed          -> drivetrain.finalDrive solved so top gear redlines there
 *   gripFront/Rear    -> tires.gripFront / gripRear (friction coefficients)
 *   slideGrip         -> tires.slideGripRatio
 *   steerMax          -> steering.maxSteerAngleDeg
 *   steerSpeedFalloff -> a per-car steering-lock curve (fraction of lock lost
 *                        at profile.steerFalloffRefKph, floored at steerMinLockPct)
 *   brakeForce        -> brakes.maxBrakeTorqueNm (mass x profile.brakeTorquePerKgNm)
 *   dragCoeff         -> body.dragAreaCdA (Cd x profile.frontalAreaM2)
 *   armor             -> a damage divisor around profile.armorRatingBase
 *   nitroCapacity     -> nitro.capacity in seconds of boost
 *
 * The conversion constants are themselves data (tuning.profile), and every
 * derived value is kept on the car as `profile` + `armorRating` / `nitro.seconds`
 * so tools and the debug panel (9.12) can show what the profile produced.
 * ------------------------------------------------------------------ */

const PROFILE_NUMBERS = [
  'mass',
  'enginePower',
  'topSpeed',
  'gripFront',
  'gripRear',
  'slideGrip',
  'steerMax',
  'steerSpeedFalloff',
  'brakeForce',
  'dragCoeff',
  'armor',
  'nitroCapacity'
];
const PROFILE_KEYS = [...PROFILE_NUMBERS, 'torqueCurve', 'gearRatios', 'nitroPower', 'targets'];
// Every profile key except `armor`, which a classic car also carries (as a
// damage divisor rather than a rating), so it cannot be a trigger on its own.
const PROFILE_TRIGGER_KEYS = PROFILE_KEYS.filter((key) => key !== 'armor');

/**
 * Read the handling profile off a raw car: values in the car's own object win,
 * the nested "profile" block overrides them, so both spellings work.
 * @returns {object} only the profile keys that were actually authored, or {} for
 *   a classic car that does not use a profile at all
 */
export function readHandlingProfile(car) {
  const block = car?.profile && typeof car.profile === 'object' ? car.profile : null;
  const triggered = Boolean(block) || PROFILE_TRIGGER_KEYS.some((key) => car?.[key] !== undefined);
  if (!triggered) return {};
  const out = {};
  for (const key of PROFILE_KEYS) {
    if (car?.[key] !== undefined) out[key] = car[key];
    if (block?.[key] !== undefined) out[key] = block[key];
  }
  return out;
}

/** Is there enough of a profile here to build a car from? */
const hasProfile = (profile) => PROFILE_TRIGGER_KEYS.some((key) => profile[key] !== undefined);

/**
 * Apply a handling profile to a (already cloned) car definition, in place.
 * @param {object} car
 * @param {object} profile
 * @param {object} tuning resolved tuning (for tuning.profile + tuning.nitro)
 */
function applyHandlingProfile(car, profile, tuning) {
  const p = tuning.profile;
  const TAU = Math.PI * 2;

  // --- mass and inertia ------------------------------------------------
  if (isNum(profile.mass)) car.body.massKg = profile.mass;
  const lengthM = car.body.lengthM ?? 4.2;
  const widthM = car.body.widthM ?? 1.8;
  const inertiaFactor = isNum(car.body.yawInertiaFactor) ? car.body.yawInertiaFactor : p.yawInertiaFactor;
  car.body.yawInertiaKgM2 = (car.body.massKg * (lengthM * lengthM + widthM * widthM)) / 12 * inertiaFactor;

  // --- tires -----------------------------------------------------------
  if (isNum(profile.gripFront)) car.tires.gripFront = profile.gripFront;
  if (isNum(profile.gripRear)) car.tires.gripRear = profile.gripRear;
  if (isNum(profile.slideGrip)) car.tires.slideGripRatio = profile.slideGrip;

  // --- steering --------------------------------------------------------
  if (isNum(profile.steerMax)) car.steering.maxSteerAngleDeg = profile.steerMax;
  if (isNum(profile.steerSpeedFalloff)) {
    // "fraction of the lock gone at the reference speed", floored so a car can
    // always make a correction at speed.
    const atRef = 1 - profile.steerSpeedFalloff;
    car.steering.falloff = Math.max(p.steerMinLockPct, Math.min(1, atRef));
    car.steering.falloffRefKph = p.steerFalloffRefKph;
    car.steering.minLockPct = p.steerMinLockPct;
  }

  // --- brakes ----------------------------------------------------------
  if (isNum(profile.brakeForce)) {
    car.brakes.brakeForce = profile.brakeForce;
    car.brakes.maxBrakeTorqueNm = car.body.massKg * p.brakeTorquePerKgNm * profile.brakeForce;
  }

  // --- aero ------------------------------------------------------------
  if (isNum(profile.dragCoeff)) {
    const area = isNum(car.body.frontalAreaM2) ? car.body.frontalAreaM2 : p.frontalAreaM2;
    car.body.dragCoeff = profile.dragCoeff;
    car.body.dragAreaCdA = profile.dragCoeff * area;
  }

  // --- gearbox ---------------------------------------------------------
  if (Array.isArray(profile.gearRatios)) car.drivetrain.gearRatios = [...profile.gearRatios];
  const ratios = car.drivetrain.gearRatios;
  const topGear = ratios[ratios.length - 1];
  const radiusM = car.tires.radiusM ?? 0.33;
  if (isNum(profile.topSpeed) && isNum(topGear)) {
    const wheelOmega = profile.topSpeed / radiusM;                       // rad/s at top speed
    // The quoted top speed is the speed the car reaches in top gear at the rev
    // limiter (that is the drivetrain's hard ceiling), with topSpeedRpmPct as a
    // safety factor a designer can dial back.
    const limiterRpm = (car.engine.revLimiterRpm ?? car.engine.redlineRpm) * (p.topSpeedRpmPct ?? 1);
    const engineOmega = (limiterRpm * TAU) / 60;
    car.drivetrain.finalDrive = engineOmega / Math.max(1e-6, wheelOmega * topGear);
  }
  if (car.drivetrain.balance == null) car.drivetrain.balance = 0;

  // --- engine: power + curve shape -> torque ---------------------------
  const shape = Array.isArray(profile.torqueCurve) ? profile.torqueCurve : [0.55, 0.85, 1, 0.9, 0.7];
  const rpmPoints = p.curveRpmPct.map((pct) => car.engine.idleRpm + (car.engine.redlineRpm - car.engine.idleRpm) * pct);
  if (isNum(profile.enginePower)) {
    const omega = rpmPoints.map((rpm) => (rpm * TAU) / 60);
    const peakPowerPerNm = Math.max(...shape.map((factor, i) => factor * omega[i]));
    // `enginePower` is authored in metric horsepower (PS) - "310" reads as 310 hp,
    // which is how a designer quotes a car - and converted here. Set
    // tuning.profile.powerToKw to 1 to author kilowatts instead.
    const kW = profile.enginePower * (p.powerToKw ?? 1);
    const peakTorqueNm = (kW * 1000) / Math.max(1e-6, peakPowerPerNm);
    car.engine.powerKw = kW;
    car.engine.powerRating = profile.enginePower;
    car.engine.torqueCurveNm = rpmPoints.map((rpm, i) => ({ rpm: Math.round(rpm), nm: +(shape[i] * peakTorqueNm).toFixed(2) }));
  }

  // --- damage + nitro --------------------------------------------------
  if (isNum(profile.armor)) {
    car.armorRating = profile.armor;
    car.armor = p.armorRatingBase / Math.max(0.1, profile.armor);
  }
  if (isNum(profile.nitroCapacity)) {
    const seconds = Math.max(0.5, profile.nitroCapacity);
    car.nitro = { ...(car.nitro ?? {}), seconds, capacity: seconds * tuning.nitro.drainPerSecond };
    if (isNum(profile.nitroPower)) car.nitro.power = profile.nitroPower;
  }

  // `targets` is the 9.12 tier the car was authored to hit - carried through so
  // tools can hold the car to its own declared target as well as its class.
  const targets = car.targets ?? car.profile?.targets ?? null;
  car.profile = Object.freeze({ ...profile, ...(targets ? { targets } : {}) });
  return car;
}

/* ------------------------------------------------------------------ *
 * construction
 * ------------------------------------------------------------------ */

/**
 * Turn the raw JSON payloads into a frozen, pre-computed runtime model.
 *
 * @param {{cars:object, surfaces:object, tuning:object, audio:object}} raw
 * @returns {{tuning:object, audio:object, surfaces:Map<string,object>, surfaceList:object[], cars:object[], carById:Map<string,object>, units:object, warnings:string[]}}
 */
export function createConfig(raw, options = {}) {
  const problems = [];
  const warnings = [];

  for (const key of ['cars', 'surfaces', 'tuning', 'audio']) {
    if (!raw || typeof raw[key] !== 'object' || raw[key] === null) {
      problems.push(`data/${key}.json is missing or not an object`);
    }
  }
  if (problems.length) throw new ConfigError(problems);

  const tuning = structuredClone(raw.tuning);
  const audio = structuredClone(raw.audio);

  checkNumbers(tuning, TUNING_NUMBERS, problems, 'tuning.json');
  for (const path of TUNING_FLAGS) {
    if (typeof getPath(tuning, path) !== 'boolean') problems.push(`tuning.json: ${path} must be true or false`);
  }
  if (typeof tuning.tires.model !== 'string') problems.push('tuning.json: tires.model must be a string');
  for (const path of TUNING_ARRAYS) {
    if (!Array.isArray(getPath(tuning, path))) problems.push(`tuning.json: ${path} must be an array`);
  }
  for (const path of TUNING_KEYED_NUMBERS) {
    const value = getPath(tuning, path);
    if (!value || typeof value !== 'object') {
      problems.push(`tuning.json: ${path} must be an object of numbers`);
    } else {
      for (const [key, number] of Object.entries(value)) {
        if (!isNum(number)) problems.push(`tuning.json: ${path}.${key} must be a number`);
      }
    }
  }
  // 9.4: the speed-sensitive steering curve must be authorable in any order.
  const steerCurve = tuning.steering.speedSteerCurve;
  if (Array.isArray(steerCurve)) {
    if (steerCurve.length < 2) {
      problems.push('tuning.json: steering.speedSteerCurve needs at least two points');
    }
    for (const [i, point] of steerCurve.entries()) {
      if (!isNum(point?.speedKph) || !isNum(point?.pct)) {
        problems.push(`tuning.json: steering.speedSteerCurve[${i}] needs {speedKph, pct}`);
      }
    }
    if (!problems.length) {
      tuning.steering.speedSteerCurve = [...steerCurve].sort((a, b) => a.speedKph - b.speedKph);
    }
  }

  /* ---- surfaces ------------------------------------------------- */
  const surfaces = new Map();
  const surfaceSource = raw.surfaces.surfaces;
  if (!surfaceSource || typeof surfaceSource !== 'object') {
    problems.push('surfaces.json: "surfaces" must be an object');
  } else {
    for (const [id, surface] of Object.entries(surfaceSource)) {
      checkNumbers(surface, SURFACE_NUMBERS, problems, `surfaces.json[${id}]`);
      surfaces.set(id, Object.freeze({ ...surface, id }));
    }
  }
  const defaultSurfaceId = raw.surfaces.defaultSurface;
  const baseSurfaceId = raw.surfaces.baseSurface;
  if (!surfaces.has(defaultSurfaceId)) problems.push(`surfaces.json: defaultSurface "${defaultSurfaceId}" is not defined`);
  if (!surfaces.has(baseSurfaceId)) problems.push(`surfaces.json: baseSurface "${baseSurfaceId}" is not defined`);

  /* ---- cars ----------------------------------------------------- */
  const cars = [];
  for (const rawCar of raw.cars.cars ?? []) {
    const where = `cars.json[${rawCar.id ?? '?'}]`;
    const car = structuredClone(rawCar);
    const carProblems = [];
    // 9.11: a handling profile fills in the model before it is validated, so a
    // car can be authored as just a profile (plus the geometry it needs).
    const profile = readHandlingProfile(car);
    if (hasProfile(profile)) {
      // A profile may be PARTIAL (the 9.12 tuning panel writes a single value,
      // and a car can mix a profile with classic blocks): validate and apply
      // only what is actually authored.
      for (const key of PROFILE_NUMBERS) {
        if (profile[key] !== undefined && !isNum(profile[key])) {
          carProblems.push(`${where}.profile: ${key} must be a number (got ${JSON.stringify(profile[key])})`);
        }
      }
      if (profile.torqueCurve !== undefined) {
        if (!Array.isArray(profile.torqueCurve) || profile.torqueCurve.length !== 5 || profile.torqueCurve.some((v) => !isNum(v))) {
          carProblems.push(`${where}.profile: torqueCurve must be 5 numbers (low / mid / peak / high / redline)`);
        }
      }
      if (profile.gearRatios !== undefined) {
        if (!Array.isArray(profile.gearRatios) || profile.gearRatios.length !== tuning.drivetrain.gearCount || profile.gearRatios.some((v) => !isNum(v))) {
          carProblems.push(`${where}.profile: gearRatios must be ${tuning.drivetrain.gearCount} numbers`);
        }
      }
      if (!carProblems.length) applyHandlingProfile(car, profile, tuning);
    }
    checkNumbers(car, CAR_NUMBERS, carProblems, where);
    checkArrays(car, ['drivetrain.gearRatios'], { 'drivetrain.gearRatios': tuning.drivetrain.gearCount }, carProblems, where);
    if (!Array.isArray(car.engine?.torqueCurveNm) || car.engine.torqueCurveNm.length !== 5) {
      carProblems.push(`${where}: engine.torqueCurveNm must be a 5 point lookup table (low / mid / peak / high / redline)`);
    } else {
      for (const [i, point] of car.engine.torqueCurveNm.entries()) {
        if (!isNum(point?.rpm) || !isNum(point?.nm)) carProblems.push(`${where}: torqueCurveNm[${i}] needs {rpm, nm}`);
      }
    }
    if (carProblems.length) {
      problems.push(...carProblems);
      continue;
    }

    const body = car.body;
    const wheelbaseM = body.cgToFrontM + body.cgToRearM;
    const massRearShare = body.cgToFrontM / wheelbaseM; // weight on the rear axle
    const massFrontShare = 1 - massRearShare;

    // Oversteer / understeer bias: a positive balance takes grip off the rear
    // axle and gives it to the front, so the rear lets go first.
    const bias = car.drivetrain.balance * tuning.balance.gripInfluence;
    const clampGrip = (v) => Math.max(0.05, v);

    const tires = {
      ...car.tires,
      // effective axle friction coefficients (tire x balance, surface applied later)
      axleGripFront: clampGrip(car.tires.gripFront * (1 - bias)),
      axleGripRear: clampGrip(car.tires.gripRear * (1 + bias)),
      corneringStiffnessFront: clampGrip(car.tires.corneringStiffnessPerGrip * (1 - bias)),
      corneringStiffnessRear: clampGrip(car.tires.corneringStiffnessPerGrip * (1 + bias)),
      slideGripRatio: car.tires.slideGripRatio ?? tuning.tires.slideGripRatio,
      longitudinalGripRatio: car.tires.longitudinalGripRatio ?? tuning.tires.longitudinalGripRatio
    };

    // 9.7 nitro tank + 9.9 damage resistance, both authored per car in real
    // units (capacity in "tank percent" seconds of boost, armor as a divisor).
    const nitro = {
      ...car.nitro,
      capacity: Math.max(1, car.nitro?.capacity ?? 100),
      power: Math.max(0.1, car.nitro?.power ?? 1)
    };
    const armor = Math.max(0.05, car.armor ?? 1);

    const ratioTotals = car.drivetrain.gearRatios.map((r) => r * car.drivetrain.finalDrive);
    const reverseRatioTotal = car.drivetrain.reverseRatio * car.drivetrain.finalDrive;
    const toWheelForce = (total) =>
      (total * tuning.drivetrain.finalDriveEfficiency) / car.tires.radiusM;

    // Torque curve sorted by rpm so the piecewise-linear lookup is always valid.
    const curve = [...car.engine.torqueCurveNm].sort((a, b) => a.rpm - b.rpm);
    // Rated power, whether the car came from a 9.11 profile or a classic curve:
    // the peak of torque x omega over the five points (kW).
    const peakPowerKw =
      car.engine.powerKw ??
      Math.max(...curve.map((point) => ((point.nm * point.rpm * Math.PI * 2) / 60) / 1000)) * tuning.drivetrain.finalDriveEfficiency;

    cars.push(
      Object.freeze({
        ...car,
        tires,
        body: Object.freeze({
          ...body,
          wheelbaseM,
          massFrontKg: body.massKg * massFrontShare,
          massRearKg: body.massKg * massRearShare
        }),
        engine: Object.freeze({
          ...car.engine,
          torqueCurve: curve,
          maxTorqueNm: Math.max(...curve.map((p) => p.nm)),
          powerKw: peakPowerKw,
          powerRating: car.engine.powerRating ?? null
        }),
        nitro: Object.freeze(nitro),
        armor,
        // what the profile (or the classic blocks) produced, for tools + HUD
        armorRating: car.armorRating ?? tuning.profile.armorRatingBase / armor,
        nitroSeconds: car.nitro?.seconds ?? nitro.capacity / tuning.nitro.drainPerSecond,
        drivetrain: Object.freeze({
          ...car.drivetrain,
          ratioTotals,
          reverseRatioTotal,
          powerSplitRear: 1 - car.drivetrain.powerSplitFront,
          wheelForcePerNm: ratioTotals.map(toWheelForce),
          reverseWheelForcePerNm: toWheelForce(reverseRatioTotal)
        }),
        steering: Object.freeze({ ...car.steering, maxSteerAngleRad: car.steering.maxSteerAngleDeg * DEG }),
        axleBrakeTorque: Object.freeze({
          front: car.brakes.maxBrakeTorqueNm * car.brakes.brakeBiasFront,
          rear: car.brakes.maxBrakeTorqueNm * (1 - car.brakes.brakeBiasFront)
        })
      })
    );
  }

  if (!cars.length) problems.push('cars.json: at least one car is required');
  if (problems.length) throw new ConfigError(problems);

  const carById = new Map(cars.map((c) => [c.id, c]));

  // Structural sanity warnings (non fatal, but the author should see them).
  if (tuning.tires.model !== 'velocityScaled' && tuning.tires.model !== 'velocity') {
    warnings.push(`tuning.tires.model "${tuning.tires.model}" is unknown - falling back to velocityScaled`);
  }
  for (const car of cars) {
    if (car.engine.revLimiterRpm <= car.engine.redlineRpm) {
      warnings.push(`${car.id}: revLimiterRpm should be above redlineRpm`);
    }
    if (car.drivetrain.layout === 'FWD' && car.drivetrain.powerSplitFront < 1) {
      warnings.push(`${car.id}: FWD car should have powerSplitFront = 1`);
    }
    if (car.drivetrain.layout === 'RWD' && car.drivetrain.powerSplitFront > 0) {
      warnings.push(`${car.id}: RWD car should have powerSplitFront = 0`);
    }
  }

  // 9.4: how much of a car's steering lock is available at a speed, as a
  // fraction. Interpolated from `steering.speedSteerCurve` here, at load time,
  // so no code has to know the shape of the curve.
  const lockCurve = Array.isArray(tuning.steering?.speedSteerCurve) ? tuning.steering.speedSteerCurve : [];
  /**
   * 9.4 / 9.11: the fraction of the steering lock available at a speed. A car
   * with a handling profile gets its own single-number curve (steerSpeedFalloff
   * at steerFalloffRefKph, floored at steerMinLockPct); everything else follows
   * the global speedSteerCurve.
   *
   * @param {number} speedMs
   * @param {object} [carDef] the car, when the caller has one
   */
  const steerLockPct = (speedMs, carDef = null) => {
    const falloff = carDef?.steering?.falloff;
    if (isNum(falloff)) {
      const ref = Math.max(1, carDef.steering.falloffRefKph ?? tuning.profile.steerFalloffRefKph);
      const floor = carDef.steering.minLockPct ?? tuning.profile.steerMinLockPct;
      const t = Math.max(0, Math.min(1, (speedMs * 3.6) / ref));
      return Math.max(floor, 1 + (falloff - 1) * t);
    }
    if (!lockCurve.length) return 1;
    const kph = speedMs * 3.6;
    if (kph <= lockCurve[0].speedKph) return lockCurve[0].pct;
    for (let i = 1; i < lockCurve.length; i++) {
      if (kph <= lockCurve[i].speedKph) {
        const a = lockCurve[i - 1];
        const b = lockCurve[i];
        const t = (kph - a.speedKph) / Math.max(1e-6, b.speedKph - a.speedKph);
        return a.pct + (b.pct - a.pct) * t;
      }
    }
    return lockCurve[lockCurve.length - 1].pct;
  };

  // 9.4: difficulty is a list of levels in tuning.json; each level scales how
  // much mobile steering help the player gets. `master` is 0 - no help at all.
  const difficultyLevels = (tuning.assists?.difficulty?.levels ?? [])
    .map((level, index) => {
      const id = level.id ?? `level${index + 1}`;
      return Object.freeze({
        id,
        label: level.label ?? id,
        assistPct: Math.max(0, Math.min(1, level.assistPct ?? 1))
      });
    });
  if (!difficultyLevels.length) {
    difficultyLevels.push(Object.freeze({ id: 'normal', label: 'Normal', assistPct: 1 }));
  }
  const difficultyFor = (id) => difficultyLevels.find((level) => level.id === id) ?? difficultyLevels[0];
  const defaultDifficulty = difficultyFor(tuning.assists?.difficulty?.default);

  const units = Object.freeze({
    pxPerMeter: tuning.simulation.pxPerMeter,
    /** metres -> world pixels (used by renderer + track builder only). */
    mToPx: (m) => m * tuning.simulation.pxPerMeter,
    pxToM: (px) => px / tuning.simulation.pxPerMeter,
    msToKph: (v) => v * 3.6,
    msToMph: (v) => v * 2.23694
  });

  // The browser build keeps the data unfrozen so the 9.12 tuner panel can write
  // to it live; tests and tools run frozen + strict, where a typo throws.
  const tunable = options.freeze === false;
  const runtimeTuning = tunable ? tuning : Object.freeze(tuning);
  return Object.freeze({
    // Strict mode proxies the un-frozen clone (a proxy over a frozen object breaks
    // the proxy invariants) and is meant for tests: it turns "constant renamed in
    // tuning.json but not in the code" into an exception instead of a NaN.
    tuning: options.strictTuning
      ? strictTuning(structuredClone(raw.tuning), 'tuning.', new Map())
      : runtimeTuning,
    /** 9.12: true when the data is writable (the browser tuner panel). */
    tunable,
    /** A pristine copy of every value, so the tuner can diff and reset. */
    tuningBaseline: structuredClone(runtimeTuning),
    audio: Object.freeze(audio),
    surfaces,
    surfaceList: [...surfaces.values()],
    defaultSurfaceId,
    baseSurfaceId,
    cars: Object.freeze(cars),
    carById,
    /** 9.4 steering-assist difficulty, authored in tuning.assists.difficulty. */
    difficultyLevels: Object.freeze(difficultyLevels),
    defaultDifficulty,
    difficultyFor,
    /** 9.4 speed-sensitive steering: lock available at a speed, 0..1. */
    steerLockPct,
    units,
    warnings: Object.freeze(warnings)
  });
}

/* ------------------------------------------------------------------ *
 * Node-side loader (tests + tooling). The browser fetches the same files.
 * ------------------------------------------------------------------ */

export async function loadConfigFromDisk(dir, options = {}) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const base = path.resolve(dir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'));
  const read = async (name) => JSON.parse(await readFile(path.join(base, name), 'utf8'));
  return createConfig(
    {
      cars: await read('cars.json'),
      surfaces: await read('surfaces.json'),
      tuning: await read('tuning.json'),
      audio: await read('audio.json')
    },
    options
  );
}
