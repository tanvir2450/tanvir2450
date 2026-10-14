# Apex 2D — Section 9: Car Mechanics (Professional 2D Model)

An arcade-racer where the car physics is treated like a real engineering
problem: a fixed 60 Hz simulation, a torque-curve drivetrain with a five-speed
autobox, and a per-axle tire model with a friction ellipse. It feels like an
arcade game to play and like a vehicle model when you measure it.

On top of the vehicle sit the mechanics the arcade layer needs — speed-sensitive
steering, front-biased brakes, scored drifts, per-car nitro, mass-driven
collisions, hit-zone damage and rivals to slipstream past (sections 9.4-9.10
below) — plus the two things that make all of it tunable: a per-car *handling
profile* (9.11) that is the whole car in a dozen numbers, and a live tuning panel
with its own test track (9.12). Every number any of them uses lives in `data/`.

Everything the tires, engine, gearbox and chassis do is data. There is no magic
number in the engine code: `data/tuning.json` holds the global constants and
`data/cars.json` holds the five cars, all in real units.

```
npm start          # http://localhost:8000  (zero-dependency static server)
npm test           # boots the real front-end headless and drives a lap
                   #   + the 9.4-9.12 mechanics/tuning suites
npm run bench      # measures every car: accel, braking, cornering, drift, limits
npm run laps       # the autopilot laps every car (--track grounds, --car falcon)
npm run track      # rebuilds data/track.json + data/test-track.json
npm run track:preview   # draws a track to a PNG so you can see the layout
```

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake (reverse when stopped) |
| `A` `D` / `←` `→` | steer |
| `Space` / `Shift` | handbrake (locks the rear for 0.4 s) |
| `N` | nitro |
| `F` | repair (first quick repair of a session is free) |
| `R` | reset to the grid |
| `T` | driving assists on/off |
| `Y` | difficulty - how much steering help touch players get |
| `K` | the 9.12 tuning panel (live sliders + "Copy JSON" for the diff) |
| `C` | switch circuit (Apex Loop / Tuning Grounds) |
| `O` | demo mode — the autopilot drives, any control takes the car back |
| `V` | camera zoom (normal / close / wide) |
| `G` | debug vectors (forces, slip, gate) |
| `M` `P` `H` | mute / pause / help |

Touch buttons and a gamepad are also wired (`input.js`). Steering is analog on
every device that can give it a real value: drag anywhere on the glass (the
horizontal travel from where the finger landed is the steering angle), tilt the
device (the `TILT` button permissions + zeros it), or move a gamepad stick.
Keyboard steering is on/off, so it goes full-lock and is shaped by the car's own
ramp - that is what stops keyboard steering from being twitchy.

## The cars

Measured with `npm run bench` (asphalt, 60 Hz, no assists). These are the
numbers `tools/bench.mjs` asserts are believable, so they double as a
regression test for the tire model.

| | Kalos GT | Sabre 240 | Vandal V8 | Terra RX | Vortex 9 | Falcon GT | Cadet 1.4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| class | Sport Compact | Sport Coupe | Muscle | Rally | Hyper | Sport Coupe | Starter |
| layout | FWD | RWD | RWD | AWD | AWD | RWD | FWD |
| authored as | blocks | blocks | blocks | blocks | blocks | 9.11 profile | 9.11 profile |
| mass | 1120 kg | 1320 kg | 1900 kg | 1330 kg | 1090 kg | 1250 kg | 1050 kg |
| 0–100 km/h | 6.87 s | 3.97 s | 4.72 s | 3.87 s | 2.05 s | 5.98 s | 8.98 s |
| 400 m | 14.67 s | 12.00 s | 12.97 s | 12.15 s | 9.05 s | 14.30 s | 16.70 s |
| top speed | 235 km/h | 273 km/h | 258 km/h | 257 km/h | 330 km/h | 216 km/h | 170 km/h |
| 100–0 km/h | 39.0 m | 39.9 m | 49.3 m | 42.0 m | 29.3 m | 42.8 m | 45.1 m |
| corner 120 km/h, dry | 0.81 g | 0.90 g | 0.74 g | 0.84 g | 1.06 g | 0.85 g | 0.66 g |
| corner 80 km/h, full lock | 0.79 g | 0.82 g | 0.69 g | 0.81 g | 0.96 g | 0.79 g | 0.66 g |
| corner 100 km/h, wet | 0.60 g | 0.61 g | 0.51 g | spin | 0.71 g | 0.58 g | 0.45 g |
| handbrake drift, avg slip | 52° | 33° | 44° | 51° | 37° | 45° | 51° |
| donut wheelspin | 0.00 | 0.98 | 0.49 | 0.30 | 0.83 | 0.35 | 0.00 |
| power-on slip, 120 km/h | 3° | 88° | 88° | 43° | 57° | 49° | 11° |
| nitro tank / power | 88 / 0.95x | 104 / 1.05x | 92 / 1.00x | 100 / 1.00x | 122 / 1.15x | 150 / 1.05x | 105 / 0.90x |
| armor | 1.00 | 0.95 | 1.25 | 1.10 | 0.90 | 1.00 | 1.33 |
| autopilot lap (Apex) | 56.10 s | 48.67 s | 51.53 s | 52.05 s | 45.52 s | 47.60 s | 59.62 s |

Read the drift, donut and power-on rows as character: the front-drive hatch and
the starter cannot donut (they wash out and drag you straight), the rally car
spins on a wet lap because it always has drive to the rear, the hyper car brakes
at 1.33 g, and the muscle car is the one that will bite you on a trailing
throttle. The nitro/armor rows are 9.7/9.9 data (the hyper car carries the
biggest tank and the thinnest armor, the muscle car shrugs off a hit), and the
last row is the 9.12 autopilot lap (`npm run laps`) — a quick regression test for
any handling change.

## Section 9.1 — Setup

* **Fixed timestep.** `simulation.physicsHz` (60 Hz) with an accumulator in
  `Game.frame()`: a 30 Hz display runs two physics ticks per frame, a 144 Hz
  display runs one every other frame, and the car behaves identically. The
  accumulator is clamped by `simulation.maxFrameTimeMs` so a stalled tab cannot
  spiral, and is dropped if it ever exceeds `maxSubSteps`.
* **Interpolated rendering.** `Car.step()` keeps the previous and current state
  (`prevX/prevY/prevHeading` → `interpX/interpY/interpHeading`) and the renderer
  draws at `lerp(previous, current, alpha)` with `alpha = accumulator /
  physicsDt`. Motion is smooth at any refresh rate without the physics ever
  seeing a variable dt.
* **Sub-stepping inside the tick.** Even a fixed 16.7 ms tick is too coarse to
  resolve a wall or a tire at 300 km/h, so each tick is split into sub-steps by
  `simulation.maxSubStepTravelM` and `simulation.maxSubStepSeconds` — travel so
  nothing tunnels through a barrier, time so the stiff lateral solve stays
  stable at low speed.
* **Units.** `units.pxPerMeter = 32`, `units.metersPerPixel = 1/32`. Every
  physical quantity in the simulation is SI (metres, m/s, kg, N, Nm, radians);
  pixels exist only inside `render.js` and the camera. `config.js` converts once
  at load time (axle loads, wheel radius ratio, gear ratio totals, steering
  authority) and stores the derived values, so no per-frame conversion happens.
* **Rigid body.** `Car` carries position, heading, a velocity vector, angular
  velocity, mass, the yaw inertia and the centre of gravity
  (`yawInertiaKgM2`, `cgToFrontM`, `cgToRearM`, `cgHeightM`). Forces are summed
  in the body frame and turned back into world coordinates by
  `bodyToWorld`/`worldToBody`; yaw dynamics come from the moment arms of the two
  axle force pairs.
* **Collision shape.** A rotated rectangle (`lengthM` x `widthM`) resolved
  against the axis-aligned-or-rotated boxes of the world, with a capsule-ish
  single contact per overlap, restitution and friction from
  `tuning.collision`, and an impulse reported as an `impactEvent` so the camera
  can shake and the audio layer can bang.

## Section 9.2 — Drivetrain

`src/engine.js` (`Drivetrain`), driven by each car's `engine` + `drivetrain`
blocks.

* **Five-point torque curve.** `torqueCurveNm` lists (rpm, Nm) at low-end, mid,
  peak, high and redline; `sampleTorqueCurve()` interpolates between them, so the
  engine has a real shape instead of a flat number.
* **RPM from wheel speed.** In gear, `rpm = wheelSpeed / ratioTotals[gear] *
  60/(2πr)`; the clutch blends that with the engine's own inertia while it is
  slipping, which is what makes a standing start possible without stalling.
* **Automatic gearbox.** Five ratios plus a reverse gear; upshifts happen at
  `shiftUpAtRedlinePct` (90 % of the redline), downshifts at
  `shiftDownAtRedlinePct` (44 %), with a kickdown on heavy throttle.
* **Torque cut.** Every shift cuts the torque for
  `drivetrain.shiftTorqueCutMs` (120 ms) and holds the clutch partly open for
  `shiftTotalMs` (260 ms): the car noses over, the revs drop, and then it pulls
  again — the "pull and shift" feel.
* **Audio pitch straight from RPM.** `AudioEngine` sets each harmonic's
  frequency from `rpmDisplay`, so the engine note *is* the tachometer, with a
  `shiftDipMs` gain dip and a `shiftDipPitchPct` pitch dip on every gear change.
* **Rev limiter.** At `revLimiterRpm` the torque is cut for `revLimiterCutMs`,
  restored for `revLimiterRecoverMs`, and the tachometer is fed a `rpmDisplay`
  that includes a `limiterBouncePct` bounce plus a `limiterCutGainPct` audio gate
  — the needle flickers and the sound stutters exactly like a real limiter.

## Section 9.3 — Tire grip (the core feel)

`src/tires.js`, with the per-axle state in `tires.js`'s `createAxle()` and the
body integration in `car.js`.

* **Split velocity.** The velocity at each axle is split into forward and
  lateral components relative to that tire's rolling direction (steering angle
  removed from the front), in `car.js`.
* **Lateral force.** `lateralForce = -lateralVelocity * gripFactor`, clamped to
  the axle's grip limit (`mu * axleLoad`). Inside the limit the tire behaves like
  a spring-damper, so the car builds grip progressively; past it, the force
  saturates and the car keeps sliding sideways.
* **Slide.** When the demanded force exceeds the limit, `updateSlideState()`
  drops the axle's grip to `tires.slideGripRatio` (70 %) — with hysteresis
  (`slideEnterUsage` 1.0 / `slideExitUsage` 0.82) so the tire does not chatter on
  the limit — and recovers when the demand falls away. Sliding axles feed smoke,
  skid marks and screech.
* **Friction ellipse.** Grip is one budget: `combinedSlipScale()` shrinks the
  longitudinal capacity by how much grip the tire is using sideways, and
  `solveLateral()` shrinks the lateral capacity by the drive/brake demand. That
  is what makes power-on oversteer and handbrake entries work, and what stops a
  locked wheel from steering.
* **Surface table.** `data/surfaces.json` gives every surface a grip and a drag
  multiplier (asphalt 1.00/1.0, wet 0.70/1.0, dirt 0.55/1.6, grass 0.45/2.0,
  oil 0.20/1.0) plus skid/particle/render settings. The world grid resolves the
  surface under each axle every tick, so a car with one wheel on the dirt and one
  on the tarmac really is asymmetric.
* **Two-wheel bicycle model.** Front and rear are solved separately at their own
  slip angles from the yaw rate and steering angle, and turned into yaw moment by
  their moment arms. Rear-grip loss is oversteer (all the fun drifts and donuts
  above), front-grip loss is understeer (the hatch pushing wide at full lock).
* **Oversteer / understeer bias.** Each car's `drivetrain.balance` shifts grip
  between the axles at load time: negative biases front grip (safe, front-drive
  hatch), positive biases the rear (looser, rear-drive coupé and muscle car).

## Section 9.4 — Steering

`src/steering.js`, configured by `tuning.steering` + `tuning.input`, locked by
each car's `steering` block.

* **The wheel is not a switch.** The input is ramped (`keyboardRampMs`, 120 ms),
  then the wheel travels toward the target at `steerRateDegPerSec` (300 °/s) and
  returns at `returnRateDegPerSec` (220 °/s). Both are divided by the car's own
  lock, so a quicker rack turns at the same rate *in input space*.
* **Speed-sensitive lock.** `speedSteerCurve` gives the fraction of lock
  available at a speed: full lock at a standstill, about a quarter of it at
  320 km/h. The hatch goes from ~32° of steering at rest to ~8° flat out. A
  handbrake entry adds `handbrakeSteerBoostDeg`, nitro takes `steerAnglePct`
  (0.85) away, and side damage (9.9) adds a pull to one side.
* **Analog on touch, not just on/off.** The whole stage is a steering pad
  (`input.padDeadZonePx` 6 px, `padFullLockPx` 74 px, a `padResponseExponent`
  0.85 curve), and releasing lets the wheel centre at `padReleasePerSecond`
  instead of snapping. Tilt steering reads the device roll, dead-zoned and
  zeroed at the angle it is being held at, behind the `TILT` button (iOS asks
  for permission there, which is why it must be a button).
* **Touch assist.** On touch devices a gentle nudge blends toward the road
  direction - faded in only after `assistHoldSeconds` (0.85 s) of a held input,
  so it is help and not autopilot, never while drifting (it releases at
  `assistDriftReleasePerSecond`, eight times faster than the normal
  `assistReleasePerSecond`), and capped at `assistMaxSteerPct`. `Y` cycles the difficulty and harder levels help *less*:
  `tuning.assists.difficulty.levels` authors it (casual 1.0, normal 0.68, pro
  0.38, master 0 - no help).

## Section 9.5 — Brakes

`brakes` in `data/tuning.json` and `cars.json`, solved in `car.js` through the
same friction ellipse as the tires.

* **Front-biased.** `brakeBiasFront` (0.55-0.68 per car) splits the torque;
  the load transfer of the stop keeps feeding the front, so trail braking
  rotates the car while straight-line braking does not.
* **Capped by grip, never by the pedal.** The brake force runs through
  `combinedSlipScale()`, so it is capped by what the tires can take. `absEnabled`
  holds the demand at `absUsageTarget` (0.96) to stay just under the lock, which
  is why 100-0 km/h is a believable 39-49 m and why braking while turning
  slides both axles instead of ploughing straight on.
* **Brake lights on the sprite.** `brakeLight` follows the pedal (over
  `brakeLightOnThreshold`) with a short latch, and the renderer draws two red
  lights on the car.
* **Handbrake.** Pulls the rear brake and drops rear grip to
  `handbrakeRearGripScale` (0.30); for `handbrakeLockSeconds` (0.4 s) the rear is
  *locked* at `handbrakeLockGripScale` (0.35) grip, which is the window in which
  a slide actually starts. Re-triggering while held is blocked, and a
  `handbrakeCooldownSeconds` (1.2 s) cooldown stops the lock from being spammed
  into a free drift button.

## Section 9.6 — Drift

`src/drift.js` (`DriftScore`), `tuning.drift`.

A drift starts above `minSlipAngleDeg` (15°) at over `minSpeedMs` and lasts
while the slide does:

* **Score.** Points accrue at up to `scorePerSecondAtFullSlide` (520/s), scaled
  by how far past `minSlipAngleDeg` the slide is (saturating
  `fullSlideAngleSpanDeg` 40° later) and by speed (full marks at
  `fullScoreSpeedMs` 35 m/s, never below `minSpeedFactor` 0.35), times the
  combo. They are held as `pending` until the drift ends; a slide shorter than
  `minBankSeconds` (0.35 s) is not worth banking.
* **Combo.** Chaining slides inside `comboWindowSeconds` (2.6 s) adds
  `comboStep` (0.25) per chain, capped at `comboMax` (6x).
* **Nitro charges faster.** Pending points convert at `nitroPerPoint` (0.05)
  into the tank as the drift runs, so a long slide is how you refill.
* **Clean exit.** Leave the slide with at least `cleanExitMinPoints` (300)
  banked and the score is added to the total and a `cleanExitBoostPct` (9 %)
  boost of engine force and top speed is paid for `cleanExitBoostSeconds`
  (0.7 s).
* **Crashing cancels it.** A crash inside `crashCancelWindowSeconds` of the
  drift (or a spin above `spinOutYawRateRadS` with `spinMinSpeedMs`) throws the
  pending points and the combo away - as does a bare `cancelMinPoints` of them
  when the car spins.
* **It pays.** Smoke, skid marks and screech come from the effects layer off the
  same slip signal, and the banked score feeds the wallet: `coinsPerPoint`,
  `stylePerPoint`, the star challenges in `tuning.economy.challenges` and the
  repair fund for 9.9.

## Section 9.7 — Nitro

`src/nitro.js`, per-car tank in `cars.json` (`nitro.capacity` 88-122 units,
`nitro.power` 0.95-1.15x).

* **Boost.** Active: +40 % engine force (`forceMultiplier`) and +20 % top speed
  (`topSpeedMultiplier`) through `engine.js`'s `powerScale`/`speedCapScale`, with
  the steering lock reduced to `steerAnglePct` (0.85) so the extra speed still
  has to be driven. Drains at `drainPerSecond` (30/s): a full tank is ~3-4 s.
* **Tank fill.** Drifting (9.6), near misses (`fillFromNearMissPct`, 14 %),
  slipstreaming (`fillFromSlipstreamPerSecond`, capped at
  `fillFromSlipstreamMaxPct`). Needs `minToActivatePct` (12 %) to light.
* **Empty = overheat.** Held to empty it locks out for `overheatLockoutMs`
  (1.5 s) and cannot be re-lit inside the lockout even if it has refilled.
* **Presentation.** A flame trail, `speedLinesPerSecond` speed lines, a
  `cameraZoomOutPct` (6 %) pull-back and an audio layer (a hiss plus a whine
  that rises with speed) - all driven from the tank's `active`/`pct`.

## Section 9.8 — Collisions

`resolveCarCollision()` in `src/world.js` plus `tuning.collision`.

* **Mass decides.** Every car carries its real mass (1090-1900 kg). Contact is
  a SAT test; the separation is split by mass ratio, so the muscle car shoves
  the hyper car and barely notices. Two-body impulses include the rotational
  term at the contact point, so a hit off-centre spins the car.
* **The bounce is relative.** Restitution is `carRestitution` (0.22) for
  car-to-car and `wallRestitution` (0.28) for walls, applied to the *relative*
  velocity along the normal: a gentle touch slides, a square hit at speed
  bounces. Friction along the tangent is what makes an angled hit scrub speed.
* **Impact energy is the currency.** The solver reports the closing speed and
  the kinetic energy of the collision (reduced mass, half-v-squared); that
  energy feeds 9.9's damage, and its `speedMs` decides hit-stop, shake and audio.
* **Hit-stop and shake.** Impacts over `hitStopMinImpactMs` (6 m/s) freeze the
  sim for `hitStopMs` (55 ms, scaled up to `hitStopMaxMs` 90 ms for the biggest
  hits) - the car does not move, the camera does - and the camera shakes with
  `hitStopShakeScale`.
* **Wall scrapes.** Rubbing a wall above `scrapeSparkSpeedMs` (3.2 m/s) takes
  `wallScrapeSpeedLoss` (16 %) of the speed loss as a scrape rather than a hard
  stop, sprays sparks and grinds `damage.scrapeDamagePerSecond` off the car, so
  a clip on an apex costs you a little instead of ending the lap.

## Section 9.9 — Damage

`src/damage.js` (`DamageModel`), `tuning.damage` + `tuning.economy`.

* **Hit zones.** Every impact is sorted into front / rear / left / right from
  the impact normal against the car's heading (with a `zoneBias` weighting:
  a side hit hurts more), and turned into damage by
  `damage = energy * armorScale / armor`. Armor is per car - a hyper car bends
  where a muscle car shrugs.
* **Health and effects.** Health is 100 over four 25-point zones. Front damage
  past `frontEffectAtZonePct` (55 %) costs top speed (up to
  `topSpeedLossMaxPct` 35 %) and starts engine smoke; side damage past 45 %
  pulls the wheel up to `steerPullMaxDeg` (3.2°); rear damage past 45 % costs up
  to `accelLossMaxPct` (40 %) of the acceleration. Total health drives the rest:
  scratches and dents, smoke at 50 %, fire at 20 %, a wreck at 0.
* **Repair.** `F` repairs: `repairCostPerDamage` (7 coins per point, minimum
  40) from the wallet, or the first `freeQuickRepairs` (1) of a session is free
  and restores `quickRepairHealthPct` (55 %). Coins come from laps, drifts, near
  misses and stars.
* **HUD.** A health bar plus one chip per zone, and a note naming what the car
  is currently suffering from.

## Section 9.10 — Slipstream & traffic

`src/traffic.js`, `tuning.traffic`.

* **Rivals are real cars.** `count` (3) of them, driven by the same autopilot
  and the same Car class as the player, on a pace ceiling (`pacePct`
  0.74/0.83/0.9) with a lane offset. A rival that drops below `stuckSpeedMs`
  (1.5 m/s) for `respawnSeconds` is put back on the line `respawnAheadM` (12 m)
  further on at `respawnSpeedMs`, so a road block never becomes permanent.
* **Slipstream.** Inside `slipstreamRangeM` (34 m) and a
  `slipstreamHalfAngleDeg` (24°) cone behind a rival at over
  `slipstreamMinSpeedMs` (12 m/s) the car gets +`slipstreamSpeedPct` (6 %) of
  engine force and charges nitro, with air lines drawn between the two cars.
* **Near misses.** Passing a rival or track-side object within
  `nearMissDistanceM` (2.7 m) at speed pops a "Close Call!" popup, pays style
  points and coins and adds `fillFromNearMissPct` (14 %) to the tank, with a
  `nearMissCooldownSeconds` (1.1 s) cooldown per object.
* **They can be hit.** A collision with a rival runs 9.8's impulse and 9.9's
  damage on both cars, scaled by `contactDamageScale`.

## Section 9.11 — Per-car handling profiles

A car can be authored as a **handling profile**: the dozen numbers a designer
actually tunes, in the spec's own shape and units, at the top level of the car
(or inside a `profile` block — same keys). `config.js` converts it once, at load
time, into the internal model, and keeps the derived result on the car so tools
and the tuning panel can show what the profile produced.

```json
{
  "id": "falcon", "mass": 1250, "enginePower": 310,
  "torqueCurve": [0.55, 0.85, 1.0, 0.9, 0.7],
  "gearRatios": [3.2, 2.2, 1.6, 1.2, 0.95], "topSpeed": 62,
  "gripFront": 1.05, "gripRear": 0.95, "slideGrip": 0.7,
  "steerMax": 32, "steerSpeedFalloff": 0.75, "brakeForce": 1.0,
  "dragCoeff": 0.35, "armor": 4, "nitroCapacity": 5
}
```

| profile | becomes | how |
| --- | --- | --- |
| `mass` | `body.massKg` | straight through; inertia is derived from the car's own length/width box (`profile.yawInertiaFactor`) |
| `enginePower` | a 5-point torque curve | author in metric hp (PS) or kW (`profile.powerToKw`); peak power is matched exactly |
| `torqueCurve` | `engine.torqueCurveNm` | 5 shape factors across idle→redline (low/mid/peak/high/redline) |
| `gearRatios` | `drivetrain.gearRatios` | straight through |
| `topSpeed` | `drivetrain.finalDrive` | solved so top gear hits the number at the rev limiter |
| `gripFront` / `gripRear` | `tires.gripFront/Rear` | tire friction coefficients, then the car's balance is applied as for every other car |
| `slideGrip` | `tires.slideGripRatio` | how much grip is left once an axle breaks away |
| `steerMax` | `steering.maxSteerAngleDeg` | the lock |
| `steerSpeedFalloff` | a per-car lock curve | fraction of the lock gone at `profile.steerFalloffRefKph`, floored at `profile.steerMinLockPct` |
| `brakeForce` | `brakes.maxBrakeTorqueNm` | `mass x profile.brakeTorquePerKgNm x brakeForce` |
| `dragCoeff` | `body.dragAreaCdA` | Cd x the car's frontal area |
| `armor` | the damage divisor | `profile.armorRatingBase / armor`, so a *higher* rating takes *less* damage |
| `nitroCapacity` | `nitro.capacity` | authored in seconds of boost (x `nitro.drainPerSecond`) |

The car still authors its geometry, engine rpm range, drivetrain layout, wheel
radius, balance and brake bias — the profile fills in everything a handling
designer cares about, and a car may set **one** profile value (the 9.12 panel
does exactly that) or none at all: the five original cars are still authored as
classic blocks and are untouched by this path.

Two cars in `data/cars.json` are authored as profiles, and they are the two ends
of the 9.12 feel ladder:

* **Falcon GT** — sport coupé, `enginePower` 310 PS on 1250 kg, RWD, top speed
  62 m/s (223 km/h): **5.98 s** to 100 km/h. Its spec grip pair (1.05 / 0.95)
  was measured against this tire model and *spun the car* at 120 km/h (0.4 g,
  rear axle sliding, radius 19 m) — 310 PS on a 0.95 mu rear axle lights the
  tires up mid-corner. The car keeps the spec's character and its 310 PS, but
  the grip pair sits in the model's calibrated band with wide rear tires, and the
  reason is written into `data/cars.json` next to the values.
* **Cadet 1.4** — the starter: 105 PS on 1050 kg, FWD, **8.98 s** to 100 km/h,
  0.66 g, and it cannot donut. It is the car that "can still finish the race
  without spinning out".

Both declare their own `targets.zeroTo100` window, and `tools/bench.mjs` checks
the car against *that* (falling back to the windows in `tuning.feel` for every
other car), which is how "0-100 in about 6 s for sport cars, about 9 s for
starters" is enforced instead of promised.

## Section 9.12 — Tuning and testing tools

### The tuning panel (`K`)

`src/debug.js`. It shows what you tune against — speed, rpm, gear, slip angle,
grip utilisation per axle, lateral g, steering angle, surface, nitro, health,
fps — and has live sliders for the constants, in two groups:

* **Car profile rows** (mass, power, grip front/rear, slide grip, steer lock,
  balance, brake torque/bias, drag, downforce, final drive, armor, nitro tank):
  these are the 9.11 inputs, so changing one **rebuilds the world** — a new
  config from the edited data, a fresh car, the same place on the track. The
  rebuild is debounced (220 ms) so dragging a slider is smooth, and the wallet,
  car choice, difficulty and assists survive it.
* **Global constant rows** (steering rates, slide grip, wheelspin loss, load
  transfer, drift entry/score, nitro force/drain, restitution, hit-stop, damage
  scale, near-miss distance, slipstream range, camera follow/zoom, stability
  aid): the simulation reads these every tick, so they are written straight into
  the live tuning object. No rebuild, no reload.

**Copy JSON** prints the diff against the values the game booted with, ready to
paste into `data/tuning.json` (globals) and `data/cars.json` (profiles); *Reset
all* writes the boot values back. Node keeps the data frozen and strict — a
typo throws — while the browser build is deliberately writable so the panel can
do its job.

### The test track (`C`)

`data/test-track.json` — **Tuning Grounds**, 1433 m, generated by
`tools/build-track.mjs` — holds every situation a car is tuned in, in a known
order: a 240 m start/finish straight, a fast right hander with a gravel trap, two
linked S-curves, a tight (r34) hairpin with a wide gravel apron, a back straight
with a gravel crossing, and a long constant-radius oval turn with a wet section.
`?track=grounds` in the URL starts there directly.

`tools/laps.mjs` drives every car round it (or the race circuit) with the real
autopilot and prints lap times, off-track time and a surface histogram — the
regression test for a handling change. On the grounds the cars spend 3-4 s a lap
on gravel, wet or oil exactly as intended.

Three things keep the tools honest:

* `tools/render-track.mjs` draws any `data/track.json` to a PNG (dependency-free
  PNG writer) so a layout can be checked without launching the game;
* `build-track.mjs` refuses to ship a road that folds: it relaxes the sampled
  centre line until no corner is tighter than `minRadiusM` (default 2.5x the road
  width), and the generated track is byte-identical when re-run if nothing
  changed;
* `src/track.js` re-checks the shipped centre line against
  `world.minRadiusToWidth` and warns when a corner is tighter than the road can
  carry — that check found the fold in the first draft of the test track.

### Feel targets (`tuning.feel`)

| target | measured (worst car) |
| --- | --- |
| sport car 0-100 in ~6 s, starter ~9 s | falcon 5.98 s, cadet 8.98 s (declared, and checked) |
| a moderate turn stays controllable | 90 km/h at 0.35 steer: max slip 18° (kalos), no spins |
| a high-speed turn on the throttle drifts | 120 km/h full throttle: 49-88° of slip on every RWD/AWD car |
| a good player can hold a long drift | 33-52° average slip, 62-87 % of the handbrake test held |
| a beginner can finish without spinning | every car completes the autopilot lap; wet/gravel spins are the loose ones only |

## Data

| File | What lives there |
| --- | --- |
| `data/tuning.json` | every global constant: world/grid, collision, tire model, drivetrain, simulation, assists, skid, camera, debug, plus the 9.4-9.10 mechanics (steering/input, brakes, drift, nitro, damage, traffic, economy) |
| `data/cars.json` | the seven cars: body, inertia, CG, tires, wheels, torque curve, drivetrain, steering, brakes, audio — or a 9.11 handling profile (falcon, cadet) |
| `data/surfaces.json` | per-surface grip/drag, skid intensity, particle type, render colours |
| `data/audio.json` | every WebAudio constant (engine harmonics, dips, limiter gate, screech, wind) |
| `data/tracks.json` | the circuit catalogue (id, file, description) that `C` cycles and `?track=` selects |
| `data/track.json` | Apex Loop — the race circuit, generated by `tools/build-track.mjs` (edit its `DESIGNS` block, then re-run) |
| `data/test-track.json` | Tuning Grounds — the 9.12 test track, generated by the same tool |

`config.js` merges the files (including the steering-lock curve, the nitro
tanks and the damage resistances per car, and the difficulty levels), derives the
values that must not be recomputed per frame, and — with `{strictTuning: true}` — refuses to start if a required tuning
number is missing. That is how "nothing is hardcoded" is enforced rather than
promised: delete a key from the JSON and the app tells you which one.

## Tools & tests

* `tools/bench.mjs` — headless meters. Accel, braking, three steady-state
  cornering cases, handbrake drift, donut, and limit handling on wet/dirt/grass,
  for every car, plus `validate()` which fails the run on anything not
  believable (0–100 under 1.6 s, cornering above 1.75 g, more grip on wet than
  dry, a top speed the gearing cannot reach...). `--json` for scripting.
* `tools/build-track.mjs` — writes the circuits from a design block, relaxing
  any corner tighter than the road can carry.
* `tools/render-track.mjs` — a track to PNG, for checking a layout by eye.
* `tools/laps.mjs` — the autopilot laps every car on any circuit, with lap times,
  off-track seconds and a surface histogram.
* `tests/tuning.test.js` — the 9.11 conversion contract (profile in, model out,
  including that the conversion constants are data) and the 9.12 tools (the panel
  edits live data, a car rebuild keeps your race, the circuit switch keeps your
  car, the test track has the corners and surfaces it promises, and a folded
  track is reported instead of shipped).
* `tests/mechanics.test.js` — the 9.4-9.10 mechanics, measured: steering lock
  and rates, the analog touch/tilt mapping, brake bias and the handbrake lock
  window, drift scoring/clean exit, nitro force and overheat, two-body collision
  momentum, hit zones and repair, slipstream and near misses. It runs the real
  modules against a flat asphalt world, so a failure names the mechanic rather
  than the scenery. `node --test tests/mechanics.test.js` (a few seconds;
  `npm test` runs everything).
* `tests/integration.test.js` + `tests/dom-stub.mjs` — boots the real
  `boot.js`/`render.js`/`hud.js`/`game.js` against a stub DOM and a file-backed
  `fetch`, then: checks every HUD id exists in `index.html`, drives with the
  keyboard, checks a handbrake slide leaves skid marks, runs demo mode until it
  completes a lap, and drives the tooling autopilot through the keyboard path for
  a second lap. `npm test`.
* `src/ai.js` — the autopilot: a backward speed plan down the road that uses the
  grip of the *surface* under each point, pure-pursuit steering with a
  cross-track term, trail braking, counter-steer blended in as the slip angle
  grows, and un-stick recovery. It drives through the same input object a player
  does, which is why it is a useful test.

## Driving notes (what the model rewards)

The tire model has no magic steering assist, so the racing line matters: brake
in a straight line, feed the lock in, then use the throttle to place the car.
Front-wheel drive understeers on power and takes a handbrake well; rear-drive
cars rotate on the throttle and need a lift when the rear steps out; the AWD
rally car will always find drive and is the fastest way to learn a wet lap.
`T` toggles the assists (a mild counter-steer and stability aid on top of the
raw model) for anyone who wants them.

For tuning, `C` over to the Tuning Grounds and press `K`: the panel's car rows
rebuild the car under you, the global rows change the rules mid-corner, and Copy
JSON gives you the diff to paste into `data/`.

The arcade layer rewards the same things. Drift scoring wants a *held* slide
above 15° finished cleanly: bank the points and the car gets a small boost, bail
out or crash and they are gone, so the fastest line and the showiest line are
not the same lap. Nitro is not a button you press on the straight - it is paid
for by drifting, sitting in a slipstream and passing close, so the fast lap uses
the traffic. And damage is a real cost: a rear hit that takes 40 % of your
acceleration is worth more than the half-second you saved on the kerb, which is
what makes `F` (repair) and the free quick repair a decision rather than a
formality.

## Known limitations

* 2D only: no load-transfer-driven camber changes, no per-wheel throttle
  differentiation (a driven axle is modelled as one lump), and the steering
  geometry is a single effective angle, not Ackermann.
* The automatic gearbox has no torque converter model — the clutch is a
  lock-up blend.
* `data/track.json` has one hand-authored circuit; everything else (cars,
  surfaces, tuning) is already set up for more.
* Damage is a performance model, not a deformation model: the body is drawn
  with scratches, dents, smoke and fire, but the collision shape never changes.
* Tilt steering needs a device with a motion sensor and (on iOS) a user gesture
  to grant permission; on a desktop the drag pad and the stick replace it.
* The tuning panel edits `tuning.json` and the 9.11 profile inputs. The classic
  blocks a car authors directly (its gear ratios outside a profile, its engine
  rpm range, its brake bias is exposed but its handbrake torque is not) are
  edited in the JSON rather than by a slider.
* A car profile is a *handling* description: the geometry (length, width, CG
  position, wheel radius) still has to be authored as blocks, since nothing in
  a handling profile can imply it.
* The WebAudio layer (engine, tires, impacts, nitro) needs a user gesture
  before the browser will let it start, so the first click or key press is what
  turns the sound on.
