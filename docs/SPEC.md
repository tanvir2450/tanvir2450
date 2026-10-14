# Racing-Action Browser Game: Design & Build Spec

> **This is a condensed copy.** It was rebuilt from working notes of the original spec, not copied
> word for word, and it adds no requirements of its own. If you have the original text, paste it
> over this file so the repo holds the exact wording. Where the two differ, the original wins.

## 1. Overview

A cross-device racing-action game that runs in the browser with no install: street racing, combat
and pursuit. It must work on phones in portrait and landscape and scale up to widescreen desktop.
Missions last 3–8 minutes.

## 2. Story and world

- A fictional coastal city with 5–6 districts: docks, downtown, industrial, hills, old town and a
  highway belt. Each district has its own palette, traffic and police density.
- The player is an ex-racer framed by a syndicate.
- Beating each district's boss unlocks the next district.
- Dialogue text plays between missions.
- The story ends with a final race/chase against the syndicate leader.

## 3. Missions and game loop

Mission types:

- Circuit Race
- Point-to-Point (through traffic)
- Pursuit / Evade
- Takedown
- Delivery Run
- Boss Showdown

The results screen shows coins, XP and 1–3 stars.

Loop: **map → mission → coins/XP → shop → unlocks → next mission.**

## 4. Difficulty and stars

| Setting | AI aggression                 | Car damage | Time limits |
| ------- | ----------------------------- | ---------- | ----------- |
| Easy    | Low                           | Reduced    | Loose       |
| Normal  | Moderate                      | Standard   | Standard    |
| Hard    | High (ram, block, use gadgets) | Full       | Tight       |

- Stars are independent of difficulty. They come from bonus objectives such as no crash, target
  time and no weapon hits.
- Higher stars and higher difficulty both raise coin and XP rewards and the chance of rare parts.

## 5. Progression

- Player level (from XP) unlocks tiers, cars and items.
- Each district has 6–10 missions plus side races.
- A reputation meter unlocks cosmetics and elite/boss races.
- MVP saves to `localStorage`. Account sync comes later.

## 6. Cars

- Classes: Starter → Sport → Muscle → Super → Syndicate (the Syndicate class is story-locked).
- Stats: Top Speed, Acceleration, Handling, Armor, Nitro.
- 10–12 cars in total. The Starter car is free; the others are bought or unlocked.
- 3–5 skins per car.

## 7. Upgrades and gadgets

- Upgrade categories, each with tiers 1–5: Engine, Turbo/Nitro, Suspension, Armor, Brakes.
- Gadgets: Nitro charges, Oil Slick, EMP Pulse, Ram Bumper, Spike Strip.
- Currency: coins now. Gems may come later, for cosmetics and time-savers only.

## 8. Combat

- Collision damage drains an armor bar. At 0 the car is disabled, and the mission fails or restarts.
- Police use wanted-star escalation: patrol cars, then roadblocks, then spike strips.
- Rival AI uses moderate rubber-banding.

## 9. Art direction

- Top-down or 3/4 isometric view.
- Neon-noir, saturated, vector style, with a palette per district.
- Light sprite-based particles.
- Minimal HUD: speed, nitro, pursuit level and objective.

## 10. Technical requirements

- **Stack:** Phaser 3 + TypeScript, Phaser Arcade Physics (velocity, friction, steering angle).
- **Assets:** PNG sprite sheets, JSON mission/level data, MP3/OGG audio. District assets are
  lazy-loaded.
- **Performance and compatibility targets:**
  - 60 fps on mid-range phones.
  - Initial load under 10 MB.
  - Chrome, Safari and Firefox, on mobile and desktop.
  - No crashes and no asset pop-in.
  - Touch lag under 100 ms.
- **Hosting:** static (Vercel, Netlify or Cloudflare Pages). A backend only comes later, for
  account sync.

## 11. Controls

- **Touch:** tilt, or a virtual joystick / left-right buttons for steering; accelerate and brake;
  tap for nitro and gadgets.
- **Keyboard:** arrow keys or WASD; Space for nitro; number keys for gadgets.
- **Gamepad:** a stretch goal.

## 12. Monetization

None in the MVP.

## 13. Build order

Each step ends with a playable, testable milestone.

| #   | Milestone           | What must exist at the end                                                             |
| --- | ------------------- | -------------------------------------------------------------------------------------- |
| 1   | Setup               | TypeScript + Phaser 3 scaffold, hosting config, a placeholder scene rendering a car sprite |
| 2   | Core driving        | Test track, Arcade Physics, camera follow, speed HUD: "drive a car around a track"      |
| 3   | Single race         | Waypoint AI, laps, win/lose, coin reward                                                |
| 4   | Progression         | Level/XP, `localStorage` coins, a shop with one upgrade that changes real stats         |
| 5   | Combat              | Oil Slick, damage and armor bar, one Pursuit mission with police AI                     |
| 6   | Content expansion   | The other mission types, gadgets, more cars, a second district                          |
| 7   | Difficulty + stars  | Easy/Normal/Hard and 1–3 star scoring                                                   |
| 8   | Story and finale    | Story scenes, bosses, the remaining districts, the final showdown                       |
| 9   | Polish              | Mobile performance profiling, touch tuning, audio, UI                                   |

## 14. Rules for the agent

1. Produce a working, testable build at every milestone before adding the next layer.
2. Never build all systems in parallel before anything is playable.
3. Keep mission and level data (waypoints, AI difficulty parameters, rewards) in external JSON
   files, not hardcoded.

## 15. Instruction from the requester

Start at step 1 and do not move on until each milestone actually runs on a phone browser.
(See [MILESTONES.md](MILESTONES.md) for how that gate is applied.)
