# Apex 2D — Section 9: Car Mechanics (Professional 2D Model)

An arcade-racer where the car physics is treated like a real engineering
problem: a fixed 60 Hz simulation, a torque-curve drivetrain with a five-speed
autobox, and a per-axle tire model with a friction ellipse. It feels like an
arcade game to play and like a vehicle model when you measure it.

Everything the tires, engine, gearbox and chassis do is data. There is no magic
number in the engine code: `data/tuning.json` holds the global constants and
`data/cars.json` holds the five cars, all in real units.

```
npm start          # http://localhost:8000  (zero-dependency static server)
npm test           # boots the real front-end headless and drives a lap
npm run bench      # measures every car: accel, braking, cornering, drift, limits
npm run track      # re-generates data/track.json from tools/build-track.mjs
```

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake (reverse when stopped) |
| `A` `D` / `←` `→` | steer |
| `Space` / `Shift` | handbrake |
| `R` | reset to the grid |
| `T` | driving assists on/off |
| `O` | demo mode — the autopilot drives, any control takes the car back |
| `V` | camera zoom (normal / close / wide) |
| `G` | debug vectors (forces, slip, gate) |
| `M` `P` `H` | mute / pause / help |

Touch buttons and a gamepad are also wired (`input.js`); keyboard steering is
full-lock and rate-limited by the car, analog sticks stay analog.

## The cars

Measured with `npm run bench` (asphalt, 60 Hz, no assists). These are the
numbers `tools/bench.mjs` asserts are believable, so they double as a
regression test for the tire model.

| | Kalos GT | Sabre 240 | Vandal V8 | Terra RX | Vortex 9 |
| --- | --- | --- | --- | --- | --- |
| layout | FWD | RWD | RWD | AWD | AWD |
| mass | 1180 kg | 1320 kg | 1700 kg | 1330 kg | 1090 kg |
| 0–100 km/h | 6.87 s | 3.97 s | 4.23 s | 3.87 s | 2.05 s |
| 400 m | 14.73 s | 12.00 s | 12.45 s | 12.15 s | 9.05 s |
| top speed | 234 km/h | 273 km/h | 261 km/h | 257 km/h | 330 km/h |
| 100–0 km/h | 40.0 m | 39.9 m | 44.1 m | 42.0 m | 29.3 m |
| corner 120 km/h, dry | 0.75 g | 0.91 g | 0.75 g | 0.85 g | 1.06 g |
| corner 80 km/h, full lock | 0.79 g | 0.83 g | 0.70 g | 0.82 g | 0.97 g |
| corner 100 km/h, wet | 0.61 g | 0.62 g | 0.51 g | spin | 0.71 g |
| handbrake drift, avg slip | 53° | 33° | 43° | 51° | 37° |
| donut wheelspin | 0.00 | 0.98 | 0.63 | 0.30 | 0.83 |

Read the last two rows as character: the front-drive hatch cannot donut (it
washes out and drags you straight), the rally car spins on a wet lap because it
always has drive to the rear, the hyper car brakes at 1.33 g, and the muscle car
is the one that will bite you on a trailing throttle.

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

## Data

| File | What lives there |
| --- | --- |
| `data/tuning.json` | every global constant: world/grid, collision, tire model, drivetrain, simulation, assists, skid, camera, debug |
| `data/cars.json` | the five cars in real units: body, inertia, CG, tires, wheels, torque curve, drivetrain, steering, brakes, audio |
| `data/surfaces.json` | per-surface grip/drag, skid intensity, particle type, render colours |
| `data/audio.json` | every WebAudio constant (engine harmonics, dips, limiter gate, screech, wind) |
| `data/track.json` | the circuit — generated by `tools/build-track.mjs` (edit its `DESIGN` block, then re-run) |

`config.js` merges the files, derives the values that must not be recomputed per
frame, and — with `{strictTuning: true}` — refuses to start if a required tuning
number is missing. That is how "nothing is hardcoded" is enforced rather than
promised: delete a key from the JSON and the app tells you which one.

## Tools & tests

* `tools/bench.mjs` — headless meters. Accel, braking, three steady-state
  cornering cases, handbrake drift, donut, and limit handling on wet/dirt/grass,
  for every car, plus `validate()` which fails the run on anything not
  believable (0–100 under 1.6 s, cornering above 1.75 g, more grip on wet than
  dry, a top speed the gearing cannot reach...). `--json` for scripting.
* `tools/build-track.mjs` — writes `data/track.json` from a design block.
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

## Known limitations

* 2D only: no load-transfer-driven camber changes, no per-wheel throttle
  differentiation (a driven axle is modelled as one lump), and the steering
  geometry is a single effective angle, not Ackermann.
* The automatic gearbox has no torque converter model — the clutch is a
  lock-up blend.
* `data/track.json` has one hand-authored circuit; everything else (cars,
  surfaces, tuning) is already set up for more.
