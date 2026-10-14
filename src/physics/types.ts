import type { Vec2 } from './math';

export type SurfaceId = 'asphalt' | 'wet' | 'dirt' | 'grass' | 'oil';
export type HitZone = 'front' | 'rear' | 'left' | 'right';
export type BodyShape = 'hatch' | 'coupe' | 'muscle' | 'super';

export interface CarArtLayers {
  body: string;           // path relative to /assets, e.g. cars/falcon_body.png
  wheels: string;
  lights: string;
  decals?: string;        // optional separate damage/trim pass when authored
}

export interface CarProfile {
  id: string;
  name: string;
  class: string;
  mass: number;             // kg
  enginePower: number;      // mechanical hp at peakPowerRpm
  torqueCurve: [number, number, number, number, number];
  gearRatios: [number, number, number, number, number];
  topSpeed: number;         // m/s
  gripFront: number;
  gripRear: number;
  slideGrip: number;
  steerMax: number;         // degrees
  steerSpeedFalloff: number;
  brakeForce: number;
  dragCoeff: number;
  armor: number;
  nitroCapacity: number;    // seconds at full burn
  art?: CarArtLayers;       // optional during migration; missing art uses vector fallback
  visual: Omit<CarPresentation, 'name' | 'class'>;
}

export interface CarPresentation {
  name: string;
  class: string;
  body: BodyShape;
  paint: string;
  accent: string;
  length: number;           // collision length, m
  width: number;            // collision width, m
  tagline: string;
}

export interface SurfaceProperties { grip: number; drag: number }
export interface CarCatalog {
  cars: CarProfile[];
  presentation: Record<string, CarPresentation>;
  surfaces: Record<SurfaceId, SurfaceProperties>;
}

export interface Tuning {
  simulation: { hz: number; pixelsPerMeter: number; maxFrameSeconds: number; maxStepsPerFrame: number };
  engine: { idleRpm: number; redlineRpm: number; peakPowerRpm: number; launchRpmBonus: number; shiftUpRatio: number; shiftDownRatio: number; shiftCutSeconds: number; shiftMinInterval: number; limiterPeriod: number; limiterStartRatio: number; wheelRadius: number; finalDrive: number; drivetrainEfficiency: number; horsepowerWatts: number; forceScale: number };
  tires: { gravity: number; frontLoad: number; frontStiffness: number; rearStiffness: number; powerGripShare: number; powerGripReferenceSpeed: number; brakeGripShare: number; maxCombinedGripShare: number; gripScale: number; yawInertiaScale: number; axleOffsetFraction: number; yawDamping: number; maxYawRate: number; lowSpeedLateralDamping: number };
  steering: { turnRateDeg: number; returnRateDeg: number; keyboardRampSeconds: number; nitroScale: number; assistGain: number; assistMax: number; assistLookAhead: number; sideDamagePull: number };
  braking: { deceleration: number; frontBias: number; handbrakeSeconds: number; handbrakeCooldown: number; handbrakeRearGrip: number; handbrakeDeceleration: number; handbrakeYawAssist: number };
  aero: { airDensity: number; frontalArea: number; rollingCoefficient: number; speedSoftCap: number };
  drift: { startAngleDeg: number; endAngleDeg: number; minSpeed: number; cleanExitSeconds: number; boostMps: number; scorePerSecond: number; secondsPerCombo: number; maxCombo: number; coinsPerPoints: number };
  nitro: { forceMultiplier: number; speedMultiplier: number; drainPerSecond: number; driftChargePerSecond: number; startFraction: number; nearMissCharge: number; slipstreamChargePerSecond: number; lockoutSeconds: number };
  ai: {
    traffic: { carId: string; laneOffset: number; spawnAhead: number; initialSpeed: number; targetSpeed: number }[];
    lookAhead: number; lookAheadSpeedFactor: number; steerErrorScale: number;
    turnLookAhead: number; tightTurnAngle: number; tightTurnSpeedScale: number;
    brakeMargin: number; brakeInput: number; throttleInput: number;
  };
  draft: { maxRange: number; maxLateral: number; minHeadingDot: number; speedBoost: number; dragReduction: number };
  nearMiss: { maxSeparation: number; rearmSeparation: number; minRelativeSpeed: number; stylePoints: number; coinReward: number };
  damage: { maxHealth: number; impactScale: number; zoneScale: number; frontTopSpeedPenalty: number; rearPowerPenalty: number; smokeAt: number; fireAt: number; quickRepairHealth: number; repairCostPerHealth: number; startingCoins: number; repairPickupRadius: number; repairPickupMinDamage: number; wreckLinearDamping: number; wreckYawDamping: number };
  collision: { restitution: number; wallRestitution: number; wallFriction: number; positionalCorrection: number; penetrationSlop: number; minImpactSpeed: number; bigImpactSpeed: number; hitStopSeconds: number; wallScrapeSpeed: number; wallScrapeDamagePerSecond: number; spinTransfer: number; maxSpinKick: number };
}

export interface DriveInput {
  steer: number;        // -1 left, +1 right; analog range supported
  throttle: number;     // 0..1
  brake: number;        // 0..1
  handbrake: boolean;   // button edge starts 0.4 s lock
  nitro: boolean;
  source: 'keyboard' | 'analog' | 'ai';
  assist: number;       // 0 = off, 1 = novice/mobile
}

export interface CarState {
  id: string;
  profile: CarProfile;
  art: CarPresentation;
  position: Vec2;
  previousPosition: Vec2;
  heading: number;
  previousHeading: number;
  velocity: Vec2;
  angularVelocity: number;
  steerInput: number;
  steering: number;         // current wheel angle, radians
  gear: number;             // 1..5
  rpm: number;
  shiftCut: number;
  shiftCooldown: number;
  limiterOn: boolean;
  handbrakeTime: number;
  handbrakeCooldown: number;
  handbrakeHeld: boolean;
  nitro: number;
  nitroLock: number;
  nitroActive: boolean;
  health: number;
  zones: Record<HitZone, number>;  // 0 pristine, 1 destroyed
  surface: SurfaceId;
  slipAngle: number;        // radians
  frontGripUsage: number;   // ratio; >1 means sliding
  rearGripUsage: number;
  frontSliding: boolean;
  rearSliding: boolean;
  drifting: boolean;
  driftSeconds: number;
  driftPoints: number;
  driftCombo: number;
  driftUnbanked: number;
  drafting: boolean;
  sparkCooldown: number;
  wrecked: boolean;
}

export type EventType = 'shift' | 'limiter' | 'driftStart' | 'driftBank' | 'driftCrash' | 'nitro' | 'nearMiss' | 'impact' | 'scrape' | 'repair' | 'service' | 'wreck' | 'pickup';
export interface SimEvent {
  type: EventType;
  carId?: string;
  position?: Vec2;
  value?: number;
  text?: string;
  intensity?: number;
}
