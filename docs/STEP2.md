# Step 2 — Driving Lab (in progress)

A playable, local-only Phaser + TypeScript proving ground for **Section 9** of [SPEC_V2.md](SPEC_V2.md). This is the driving vertical slice, not a finished mission game; Steps 3–10 have not been started. It runs entirely in the browser and requires no account, API, or downloaded art/audio.

## Run

```bash
npm install
npm run dev       # Vite on 0.0.0.0:5173 (for local use: http://localhost:5173)
npm test          # headless deterministic simulation checks
npm run build     # TypeScript + production bundle
```

A slow/old WebGL browser can use `?renderer=canvas` for the Phaser Canvas fallback. The default is auto-detected WebGL/Canvas. Engine audio starts muted until the user presses **♪ OFF** (browser audio gesture requirement).

### Controls

| Action | Keyboard | Touch / mobile |
|---|---|---|
| Throttle | W / ↑ | GAS (hold) |
| Brake | S / ↓ | BRAKE (hold) |
| Steer | A,D / ←,→ | Drag the **STEER** pad horizontally (analog); optional **TILT** permission button |
| Handbrake drift | Space | DRIFT (tap/hold; 0.4 s lock with cooldown) |
| Nitro | Shift | N₂O (hold while accelerating) |
| Telemetry | T or ` | Telemetry button |
| Reset run | R | Reset Run button |

**Garage panel:** choose from 8 cars; choose Proving Grounds (straight / S-curves / hairpin / wet / dirt / oil), Night Oval, or the dry 400 m Launch Strip. Novice/Street/Pro steering assist is selectable (assist applies to analog touch/tilt input). The mobile view collapses the panel to vehicle and route selectors; tap **A:ON / A:LT / A:OFF** above the steer pad to cycle assist difficulty. If the car is damaged, drive over the green **+** once per run or spend credits with **SERVICE**.

## Implementation map

| Spec | Shipped in this Step 2 slice |
|---|---|
| 9.1 | Fixed 60 Hz accumulator (bounded catch-up), render interpolation, simulation in meters/kg; render converts at 32 px/m. Each car has position, heading, velocity, yaw, mass, OBB collider. |
| 9.2 | 5-point torque interpolation; `enginePower` in **mechanical hp**, converted to W/Nm at the configured power RPM; wheel-speed RPM, 5 auto ratios, 90%-redline upshift, 120 ms cut, downshift, limiter flicker; optional Web Audio oscillator tracks RPM/shift/limiter. |
| 9.3 | Front/rear bicycle axle slip, force saturation/sliding grip, friction circles sharing budget with braking/throttle. Dry, wet, dirt, grass, oil multipliers come from `data/cars.json`. |
| 9.4–9.5 | Smoothed speed-sensitive steer (120 ms keyboard ramp), analog touch/tilt, difficulty-scaled mobile road assist; front-biased ABS-style braking; rear grip to 35% for 0.4 s on handbrake, cooldown. |
| 9.6–9.7 | Slip-angle drift threshold and hysteresis, combo/score/credits, nitro from drift/near miss/slipstream, clean-exit boost and crash cancellation; +40% engine force / +20% cap nitro, reduced steering, 1.5 s overheat lockout. Smoke, 8 s skid marks, flame, camera pullback, speed streaks. |
| 9.8–9.9 | SAT on rotated car/wall rectangles; mass-aware impulses and impact-energy damage in 4 hit zones; small hit-stop/shake, wall scrape slowdown/sparks; front/rear/side performance penalties; visual scratches/smoke/fire/wreck; credit service hook and one quick-repair pickup per test run. |
| 9.10–9.11 | Three AI traffic cars with collision/drafting/near-miss rewards; eight stat profiles loaded from `data/cars.json` with distinct body silhouettes/armor/handling. **Falcon's original 14 values are unchanged.** |
| 9.12 | Toggleable telemetry (speed, RPM, gear, slip, axle grip usage, FPS, surface); eight live sliders with reset; 3 selectable handling tracks. |

**Architecture:** `src/sim/` is pure deterministic TypeScript, with no Phaser or DOM dependency. `src/scene.ts` owns rendering, pooling, interpolation and camera; `src/trackArt.ts` draws only camera-local 1024 px terrain tiles, keeping large tracks out of the per-frame graphics path. `src/controls.ts` owns keyboard/touch/tilt, `src/hud.ts` owns UI and sliders, `src/audio.ts` owns opt-in sound. Physical constants and AI traffic settings live in `data/tuning.json`; vehicle stats and surface tables in `data/cars.json`; track control points/zones/barriers in `data/tracks.json`.

## Verification / tuning baseline

The test suite checks Falcon's exact stats, all three courses/five surfaces, consistent fixed-step results with **30/60/120 Hz render frame cadences**, gearbox/shift cut, drift banking/countersteering, ABS grip tradeoff, oil/wet slip, nitro lockout/drafting, mass-weighted collisions, front-zone impact/hit-stop, near-miss one-shot reward, free repair/service, and AI route following.

Calibrated dry, empty launch-strip **0–100 km/h** (60 Hz simulation, full throttle): **Metro 9.0 s**, **Falcon 6.2 s**, **Spectre RS 6.1 s**. These are automated baseline numbers, **not** real-phone measurements. Adjust `data/tuning.json` or the in-game sliders for different feel; gameplay sliders are in-memory and don't rewrite JSON.

## Remaining before Step 3 / release

- Integrate drift score into actual star/mission challenges when those systems exist. The current repository has no mission, garage progression or complete spec Sections 1–8/10/12+, so **SERVICE** and the one-use pickup are a test-session economy hook, not final between-mission persistence.
- Run hands-on tuning for each of the eight cars across hairpin/off-road/oval; the five new profiles remain **provisional**. Add device-specific performance and accessibility QA, especially a real mid-range phone under nitro + police + particles. Headless software WebGL is not representative of hardware performance; Canvas fallback is available.
- Section 11's advanced lighting, quality levels, UI accessibility settings and Section 11B polish pass belong to Step 10, not this Step 2 slice. Do **not** move to Step 3 until Section 9's remaining integration and device feel gate are satisfied.
