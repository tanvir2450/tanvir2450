# Game Specification — v2

> **Change note (2026-10-14):** Section 9 (Driving Physics) and Section 11
> (Art Direction) have been replaced with the professional versions below.
> A new short **Section 11B (Visual Polish / "Game Feel")** has been added.
> No previous spec file existed in this repository, so the unaffected
> sections are listed as placeholders in the contents — fill them in from
> the v1/v2 draft rather than treating their absence as a deletion.

## Contents

| Section | Title | Status |
|---|---|---|
| 1–8 | *(unchanged from previous draft — to be restored here)* | Placeholder |
| **9** | **Car Mechanics (Professional 2D Model)** | **Replaced — see below** |
| 10 | *(unchanged from previous draft — to be restored here)* | Placeholder |
| **11** | **Graphics & Art Direction (Professional)** | **Replaced — see below** |
| **11B** | **Visual Polish & Game Feel ("Juice")** | **New — see below** |
| 12+ | *(unchanged from previous draft — to be restored here)* | Placeholder |
| — | Build Plan | Updated — see end of document |

---

# SECTION 9: CAR MECHANICS (Professional 2D Model)

**Goal:** Arcade feel with believable weight, grip and speed. Easy to learn, hard to master. All values live in `/data/cars.json` and tuning constants, never hardcoded.

## 9.1 Simulation Setup
- Fixed physics timestep: 60 Hz (accumulator loop), rendering interpolated, so the game feels identical on 30, 60 and 120 Hz screens
- Units: 1 meter = 32 pixels. Define all car values in real units (m/s, kg), convert once
- Each car is a rigid body with: position, heading angle, velocity vector, angular velocity, mass, and a collision shape (rotated rectangle or capsule)

## 9.2 Engine, RPM and Gears (simplified drivetrain)
- Engine torque follows a curve (stored per car as a 5-point lookup table: low-end, mid, peak, high, redline)
- Simulate RPM from wheel speed and current gear
- 5 automatic gears with shift points near 90% of redline; a short 120 ms torque cut on each shift gives a realistic "pull and shift" feel
- Engine audio pitch is driven directly by RPM, with a brief dip on gear shift
- Rev limiter bounce at redline (visual flicker on the tachometer, short sound cutoff)

## 9.3 Tire Grip Model (the core of the feel)
Use a simplified slip-based model instead of "just rotate the sprite":
- Split velocity into **forward** and **lateral** (sideways) components relative to the car's heading
- Lateral velocity is cancelled by tire grip each frame:
  `lateralForce = -lateralVelocity × gripFactor` (clamped to a max grip limit)
- When demanded lateral force exceeds the grip limit, the tires **slide** (drift). The car keeps moving sideways, and grip drops to about 70% of max (sliding grip)
- Grip depends on surface:

| Surface | Grip multiplier | Drag multiplier |
|---|---|---|
| Asphalt (dry) | 1.00 | 1.0 |
| Wet road | 0.70 | 1.0 |
| Dirt/Sand | 0.55 | 1.6 |
| Grass | 0.45 | 2.0 |
| Oil slick | 0.20 | 1.0 |

- Front and rear axle grip are modeled separately (2-wheel "bicycle model"):
  - Rear grip lost first = oversteer (fun drifts)
  - Front grip lost first = understeer (the car pushes wide)
  - Each car has an oversteer/understeer bias value, so a muscle car and a sport car handle differently

## 9.4 Steering
- Steering input is smoothed, not instant: the wheel turns toward the target angle at a fixed rate (about 300 degrees/sec), returning to center slower
- **Speed-sensitive steering:** max steering angle shrinks as speed rises (about 32 degrees at standstill down to about 8 degrees at top speed)
- Touch/tilt input maps to an analog value, not just left/right; keyboard input ramps up over about 120 ms to avoid twitchy steering
- **Steering assist (mobile):** a gentle auto-correct toward the road direction, reducing at higher difficulty, so touch players aren't punished

## 9.5 Braking and Handbrake
- Brakes apply deceleration with a front-bias; brake lights light up on the sprite
- ABS-style limit: braking force capped by tire grip, so heavy braking while turning causes a slide
- **Handbrake (button/swipe):** locks rear grip to 35% for about 0.4 s, allowing sharp drift turns. Has a short cooldown to prevent abuse

## 9.6 Drift Mechanic
- A drift begins when slip angle exceeds about 15 degrees
- While drifting: nitro charges faster, a drift score and combo multiplier build, and tire smoke and skid marks appear
- Ending a drift with a clean exit gives a small speed boost (the "drift boost"); crashing during a drift cancels the combo
- Drift score feeds star challenges and bonus coins

## 9.7 Nitro System
- Nitro tank (capacity per car stat). Fills from drifting, near misses and slipstreaming behind other cars
- Active nitro: +40% engine force, +20% top speed, slightly reduced steering so it needs control
- Visual: flame trail, FOV-style camera pull-back (zoom out 6%), speed lines, engine sound layer
- Cooldown/overheat: if held to empty, 1.5 s lockout

## 9.8 Weight, Mass and Collisions
- Each car has mass (e.g. 1100 kg compact, 1900 kg muscle). Heavier cars push lighter ones in crashes
- Collision uses impulse resolution: bounce depends on relative speed, mass ratio and angle
- Damage = impact energy × armor factor, applied to the **hit zone** (see 9.9)
- Add a tiny hit-stop (about 40–60 ms freeze) and camera shake on big impacts; this is what makes crashes feel heavy
- Walls: scrape damage and sparks when rubbing along them at speed, slowdown instead of a hard stop

## 9.9 Damage Model
- Total health bar for HUD, plus 4 hit zones: front, rear, left, right
- Damage affects performance:
  - Heavy front damage: engine smoke, reduced top speed
  - Side damage: steering pulls slightly to one side
  - Rear damage: lower acceleration
- Visual states: scratches, dents (overlay sprites), smoke at 50% health, fire at 20%, wreck explosion at 0
- Repair between missions costs coins (adds an economy sink); one free quick repair per mission as a pickup

## 9.10 Slipstream and Traffic
- Driving close behind another car gives a slipstream boost (+6% speed and nitro charge) with visible air-line effect
- Near misses with traffic or rivals add small nitro and style points (a "Close Call!" popup)

## 9.11 Per-Car Handling Profiles
Each car in `cars.json` defines these tuning values, so every car feels distinct:

```json
{
  "id": "falcon",
  "mass": 1250,
  "enginePower": 310,
  "torqueCurve": [0.55, 0.85, 1.0, 0.9, 0.7],
  "gearRatios": [3.2, 2.2, 1.6, 1.2, 0.95],
  "topSpeed": 62,
  "gripFront": 1.05,
  "gripRear": 0.95,
  "slideGrip": 0.7,
  "steerMax": 32,
  "steerSpeedFalloff": 0.75,
  "brakeForce": 1.0,
  "dragCoeff": 0.35,
  "armor": 4,
  "nitroCapacity": 5
}
```

> The Falcon's 14 fields above remain unchanged in [`/data/cars.json`](../data/cars.json),
> alongside seven additional selectable profiles and the surface table.
> The playable Step 2 implementation and outstanding gates are tracked in
> [the Step 2 guide](STEP2.md).

## 9.12 Tuning and Testing Tools (important for quality)
Build a **debug panel** (toggle with a key) that shows: speed, RPM, gear, slip angle, grip per axle, FPS, and sliders to tweak constants live. This lets you tune the feel in minutes instead of hours. Add a **test track** (straights, hairpin, S-curves, ovals, off-road patch) for tuning each car.

**Feel targets:**
- 0–100 km/h in about 6 s for sport cars, about 9 s for starters
- A moderate-speed turn should feel controllable, a high-speed turn with throttle should drift
- A good player can hold a long drift; a beginner can still finish the race without spinning out

---

# SECTION 11: GRAPHICS & ART DIRECTION (Professional)

## 11.1 Art Style Decision
**Style: "Neon Noir Vector"**, a stylized top-down look with clean shapes, bold outlines and glowing neon accents, over dark detailed city environments. It's cheaper than realistic art, looks premium, and stays sharp at any phone resolution.

**Rules for consistency (the biggest difference between amateur and pro):**
- One light direction everywhere (top-left, 45 degrees)
- One outline weight (2 px on cars, 1 px on props)
- A limited palette per district (see 11.3); nothing outside it
- Same level of detail on every asset
- All assets exported at 2x resolution and downscaled for crisp edges

## 11.2 Car Art
- **Sprite size:** 128×64 px source (shown at 64×32 on 1x screens), top-down, facing right
- **Layered construction** so one car can change visually without re-drawing:
  1. Shadow layer (soft, offset by light direction)
  2. Body base (paint color is tintable)
  3. Details layer (windows, trim, lights)
  4. Decal layer (liveries, numbers)
  5. Damage overlay layers (scratches, dents, burn marks)
  6. Effects: brake lights, headlight cones, underglow
- **Headlights:** soft light cones projected ahead, visible at night districts
- **Underglow:** neon strip color per car (a customization item)
- **Wheels:** 4 separate small sprites that visibly turn when steering (front wheels angle up to 25 degrees)
- **Body roll illusion:** a very slight sprite scale/skew shift in hard corners
- Car silhouette must be distinct for each class (readable at a glance during a chase)

## 11.3 District Palettes (hex)
| District | Dominant | Accent | Mood |
|---|---|---|---|
| Docks | #1B2A34 deep teal-grey | #FF8A3D sodium orange | Industrial, hazy |
| Downtown | #0E1030 midnight blue | #FF2E97 magenta, #2EE6FF cyan | Neon, wet streets |
| Industrial | #2A2522 warm charcoal | #E0572B rust orange | Gritty, smoky |
| Hillside | #1A1A33 dusk purple | #7DFFB3 mint, #FFD36B warm | Calm, scenic |
| Highway Belt | #0B0B0F near black | #FF3B3B red, #FFFFFF white | Speed, high contrast |

UI always uses a fixed brand palette: **#0B0F1A background, #00E5FF primary cyan, #FF2E97 secondary magenta, #FFD23F reward gold, #FF4D4D danger**.

## 11.4 Environment & Track Art
- **Tilemap-based** with 64×64 tiles; road tiles with lane markings, curbs, manholes, cracks, tire marks that persist briefly
- **Layered depth (parallax illusion in top-down):**
  - Layer 0: ground (road, grass, water)
  - Layer 1: road decals (skid marks, oil, puddles with reflections)
  - Layer 2: cars and dynamic objects
  - Layer 3: props (barriers, cones, lamp posts)
  - Layer 4: tall objects drawn **above** the cars with offset shadows (rooftops, billboards, bridges, tree canopies) to sell height
- **Buildings:** drawn as rooftops with soft long shadows, glowing signs, AC units, helipads, details that make the city feel alive
- **Moving world life:** ambient traffic, pedestrians on sidewalks in downtown, ships and cranes in the docks, trains passing in the industrial zone
- **Weather/time of day:** each district has a time of day. Optional rain layer (wet road reflections, lower grip, splash particles) for variety
- **Each track has a landmark** (a bridge, a big neon sign, a shipyard) so players recognize it

## 11.5 Lighting & Post-Processing (the pro look)
Use Phaser's WebGL pipelines/shaders, with a **quality setting (Low / Medium / High)** and auto-detection on first launch.

| Effect | Description | Low | Med | High |
|---|---|---|---|---|
| Bloom / glow | Neon lights and nitro glow softly | off | on (cheap) | on |
| Dynamic lights | Headlights, brake lights, streetlights cast light on the ground | baked only | few | many |
| Soft shadows | Cars and props cast directional shadows | blob | soft | soft + stretch |
| Vignette | Darken the screen edges, focus on action | on | on | on |
| Motion blur / speed lines | Speed sensation | lines only | lines | lines + blur |
| Wet reflections | Reflect neon on wet roads | off | fake (gradient) | fake + blur |
| Chromatic aberration | Brief on nitro / big crash | off | off | on |

## 11.6 Particles & Effects (all pooled for performance)
| Effect | Details |
|---|---|
| Tire smoke | Soft white-grey puffs, size grows and fades, spawn at the rear wheels while drifting |
| Skid marks | Dark fading decals following the tires, last about 8 s |
| Nitro | Blue-white flame cone with a glowing core, plus light streaks behind the car |
| Crash sparks | Bright yellow-orange sparks, bounce off the ground, short life |
| Debris | Small body-part sprites and glass fragments on heavy hits |
| Engine smoke/fire | Grey smoke under 50% health, fire flicker under 20% |
| Explosion | Fireball sprite sheet + shockwave ring + smoke column + screen shake |
| Gadgets | Oil: glossy black puddle with rainbow sheen. EMP: expanding cyan ring + electric arcs. Spike strip: metallic glint |
| Water/rain | Splashes when driving through puddles |
| Pickups | Coins spin with a glint, a small burst on collect |

Cap particles on mobile (for example 150 active at once) and use Phaser object pools.

## 11.7 Camera (professional feel)
- Smooth follow with **look-ahead**: the camera shifts forward in the direction of travel
- **Speed zoom:** zoom out slowly as speed rises (up to 12%), pull back more during nitro
- Dynamic framing in chases: nudges slightly toward the nearest pursuer
- Screen shake with trauma-based decay (small hits = small shake, big hits = big shake)
- Short slow-motion on key moments (boss final hit, photo-finish), about 0.4 s at 35% speed
- Intro "flyover" camera at race start, then a snap to the player with a 3-2-1-GO countdown

## 11.8 UI/UX Design System
- **Fonts:** one bold display font for titles/numbers (e.g. "Orbitron", "Rajdhani" or "Audiowide") and one clean readable font for body text (e.g. "Inter" or "Roboto"). Use web fonts with a system fallback
- **Components:** buttons with 3 states (normal, pressed, disabled), glowing outline on hover/focus, slight scale-down on press, soft click sound
- **HUD layout (landscape):**
  - Top-left: position (1/6) and lap counter
  - Top-center: mission objective / timer
  - Top-right: minimap (circular or rounded square, rotates with the car or fixed north, set in options)
  - Bottom-left: speedometer + tachometer (analog-style arc with a digital number) and gear indicator
  - Bottom-center: health bar (with hit-zone mini car icon) and nitro bar
  - Right side: gadget buttons with circular cooldown rings
  - Center popups: "Drift x3!", "Close Call!", "Busted 50%", short and fading
- **HUD rules:** never cover the road ahead, keep safe margins for phone notches, scale with screen size, and allow HUD opacity in settings
- **Menus:** animated backgrounds (slowly moving city lights), parallax on the garage with a rotating car showcase (use pre-rendered angle sprites or a turntable via rotation), smooth transitions of about 250 ms
- **Garage screen:** car shown large with stat bars comparing before/after upgrade, paint picker, decal picker, underglow picker with a live preview
- **Results screen:** animated count-up of coins and XP, stars popping in one by one with sound, and a "new best" highlight
- **Accessibility:** colorblind-friendly mode, adjustable HUD size, reduce-screen-shake and reduce-flash toggles

## 11.9 Animation & Juice Checklist
- Cars: suspension squash on landing from jumps, wheel turn, brake-light flash, exhaust pops on shift down
- UI: every button, number and reward has a small animation (scale pop, count-up, glow pulse)
- Coins/XP fly toward the HUD counter
- Level-up and unlock moments have a short celebratory effect and sound
- Transitions between scenes use a quick wipe or fade, never a hard cut
- Idle animations in menus (blinking neon signs, moving clouds, spinning car in garage)

## 11.10 Asset Pipeline & Performance Rules
- Draw in vector (Illustrator/Inkscape/Figma) or pixel tools, export PNG at 2x, pack into **texture atlases** (TexturePacker or free-tex-packer)
- Max atlas size 2048×2048 for mobile compatibility
- Compress textures (WebP where supported) and audio (OGG + MP3 fallback)
- Naming convention: `car_falcon_body.png`, `fx_smoke_01.png`, `ui_btn_primary.png`
- Total initial load under 8 MB; the rest lazy-loaded by district
- Use object pooling, avoid creating objects every frame, batch draw calls, and test on a real mid-range phone, not just the PC browser

## 11.11 Visual Quality Checklist (must pass)
- Every car is recognizable in 1 second
- Road edges are always clear, even at top speed and in night districts
- No text smaller than 14 px equivalent on a phone
- Effects never hide the road or the car
- Consistent lighting direction, outline weight and palette across all assets
- Same look on Low and High quality (High just adds polish)
- 60 fps maintained during nitro + police + particles all at once

---

# SECTION 11B: VISUAL POLISH & GAME FEEL ("Juice")

*Short section — this is what makes the game look and feel professional.
It collects the polish requirements already implied by 9.6–9.8 and
11.5–11.9 into one pass/fail checklist, applied in Step 10 (Polish).*

## 11B.1 Principles
- Every player action gets an immediate visual **and** audio response — no silent inputs.
- Polish never hides information: effects must never cover the road or the car (11.11).
- Same look on Low and High quality — High only adds polish, never different art (11.11).
- Everything is pooled and capped (e.g. ~150 active particles on mobile, 11.6); juice must hold 60 fps during nitro + police + particles at once.

## 11B.2 The Feel Moments (each must be implemented and checked)

| Moment | Required feedback |
|---|---|
| Big impact | 40–60 ms hit-stop, trauma-based camera shake, sparks/debris, damage overlay update (9.8, 11.6) |
| Wall scrape | Sparks + scrape damage + slowdown instead of a hard stop (9.8) |
| Drift | Tire smoke at rear wheels, skid marks (~8 s), drift score + combo popup, faster nitro charge (9.6, 11.6) |
| Clean drift exit | Small "drift boost" speed kick (9.6) |
| Nitro | Flame trail, camera zoom-out 6%, speed lines, engine sound layer; chromatic aberration on High (9.7, 11.5, 11.7) |
| Near miss / slipstream | "Close Call!" popup, air-line effect, small nitro + style points (9.10) |
| Damage states | Smoke at 50% health, fire at 20%, explosion at 0; tachometer flicker at redline (9.2, 9.9) |
| Pickups & rewards | Coin spin + glint + collect burst; coins/XP fly to the HUD counter; count-up numbers (11.6, 11.9) |
| Key story moments | ~0.4 s slow-motion at 35% speed (boss final hit, photo-finish) (11.7) |
| Race start / transitions | Camera flyover → snap to player → 3-2-1-GO; scene changes use a wipe/fade, never a hard cut (11.7, 11.9) |
| UI interaction | Button scale-down on press, glow on hover/focus, click sound; stars pop in one by one on results (11.8, 11.9) |

## 11B.3 Camera & Motion Feel
- Look-ahead follow, speed zoom (up to 12%), chase framing toward the nearest pursuer (11.7).
- Shake uses trauma-based decay; respect the **reduce-screen-shake** and **reduce-flash** accessibility toggles (11.8).

## 11B.4 Polish Pass Checklist (must pass before release)
- [ ] No silent inputs — throttle, brake, handbrake, drift, nitro, crash and pickup all visibly/audibly respond within one frame
- [ ] Hit-stop and shake fire on big impacts only — small touches stay subtle
- [ ] Skid marks, smoke and nitro never obscure road edges at top speed
- [ ] All popups ("Drift x3!", "Close Call!") are short, fading, and never cover the road ahead
- [ ] HUD respects notch safe margins; HUD opacity/size settings work
- [ ] Low quality keeps the identical look with effects reduced, per the 11.5 table
- [ ] 60 fps held on a real mid-range phone with nitro + police + particles active

---

# BUILD PLAN — Implementation Notes

> "In Step 2 (Driving), implement Section 9 fully, including the debug tuning panel (9.12), before moving to Step 3. In Step 10 (Polish), implement Section 11.5 to 11.9."

**Status:** Step 2 playable driving lab is in progress ([details and remaining gates](STEP2.md)); Step 3 has not started.

| Build step | Spec sections | Gate before moving on |
|---|---|---|
| Step 2 — Driving | Section 9 in full, incl. debug tuning panel + test track (9.12) | Feel targets in 9.12 pass on the test track |
| Step 10 — Polish | Sections 11.5–11.9, plus the Section 11B checklist | 11.11 and 11B.4 checklists pass at 60 fps |
