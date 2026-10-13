# One Piece Fight

A 2D side-scrolling fighting game that runs in the mobile browser, built entirely from
code — no image, audio or font assets are loaded from the network.

**Play:** open `index.html` (or serve the folder — `python3 -m http.server 8000`).

---

## What's in the game

### Roster — 6 playable characters, each with a unique fighting style

| Character | Style | Special powers (unlock at character Lv 3 / 5 / 7 / 9) |
|---|---|---|
| **Luffy** | Rubber melee, stretchy reach, in-match transformations | Gum-Gum Pistol · Gum-Gum Gatling · **Gear Second** · **Gear Third** |
| **Zoro** | Close-range Santoryu, huge single hits, long recovery | Oni Giri · Tatsumaki · **Ashura** · Sanzen Sekai |
| **Sanji** | Fastest legs, aerial kick chains | Party Table Kick Course · **Diable Jambe** · **Hell Memories** · Anti-Manner Kick Course |
| **Usopp** | Long-range sniping, traps, evasion | Firebird Star · Smoke Star (reposition) · Kaen Boshi · Impact Reject |
| **Franky** | Heavy, slow, armoured, high damage | Strong Right (pull) · Fresh Fire · Coup de Vent · **Franky Radical Beam** |
| **Brook** | Lightning fencing thrusts, ice & soul powers | Yahazu Giri · Gaikotsu Giri (freeze) · **Soul Solid** · Hueco Mundo |

Transformations are real buffs applied mid-battle with visual auras, screen shake and a
shout announcer — Gear Second/Third, Ashura, Diable Jambe, Hell Memories, Soul Solid,
Shadow Asgard and Leopard Form all change speed, damage, size and on-hit effects.

### Combat
- **3–4 hit combo chains** per character (tap Attack rhythmically to chain, each stage has
  its own reach, damage, startup and recovery).
- **Mana system** — mana is spent on specials, regenerates over time and *gains on hit*
  (basic attacks refund mana, so aggression keeps your powers available).
- **Blocking** (75% damage reduction + mana on block), **dash** (i-frames + reposition),
  **jump**, **crouch**, plus **hitstop**, **knockback**, **launch/juggle**, combo counter
  and crits.
- **Status effects:** burn (Diable Jambe, Fresh Fire), freeze (Brook), poison (Magellan),
  plus pulling attacks (Kurozu, Strong Right) and destructible hazards (candle walls,
  air doors, Blackbeard's vortex).

### Enemies & bosses — 32 archetypes, 15 bosses
Every arc's grunts are its own faction (Marines, Buggy's crew, Krieg pirates, fishmen,
Baroque Works, desert warriors, Galley-La, CP9, Marine guards, zombies, spider monkeys,
Blugori, jailer beasts, Demon Guards, Blackbeard's crew…). Bosses run a move pattern with
**telegraphed wind-ups** (warning ring + `!`) and a **phase-2 rage state** at ~45% HP that
speeds up their AI and hits.

### Content
- **5 arcs × 30 levels = 150 battles**
- Each arc: 3 blocks of 9 grunt levels + 3 bosses at levels 10, 20, 30
  - East Blue: Buggy → Don Krieg → Arlong
  - Alabasta: Mr. 3 → Mr. 1 → Crocodile
  - Water Seven / Enies Lobby: Blueno → Jabra → Rob Lucci
  - Thriller Bark: Absalom → Ryuma → Gecko Moria
  - Impel Down: Hannyabal → Magellan → Marshall D. Teach
- Multi-wave grunt levels that get longer and denser as the arc progresses, with a
  difficulty curve scaling HP, attack and speed by arc and level.

### Economy & progression
- **Coins** from every cleared level; first clears pay full, replays pay 60% (farm runs),
  and a performance multiplier rewards high combos / low damage taken.
- **3 upgrade tracks per character** (Vitality, Power, Spirit), each 1–10, with
  escalating costs and per-character pricing. Overall character level 1–10 is derived
  from total points spent and **gates the four special powers**.
- **Consumables:** Health Potion, Mana Potion (usable mid-battle), plus Attack Tonic,
  Iron Draught and Revive Scroll (auto-applied for one battle).
- **Codex** that unlocks enemy/boss entries as you meet them.
- Progress, coins, upgrades, bag and codex save to `localStorage`.

### Controls
- **Touch:** left joystick (move / crouch by pulling down / jump by pushing up) and
  right-side buttons — **Attack, Jump, Dash, Block** and four numbered **special** buttons
  with live mana affordability states. Item buttons sit above the joystick.
- **Keyboard (desktop):** `A/D` move, `W` jump, `S` block, `J/Z` attack, `K` jump,
  `L/Shift` dash, `1–4` specials, `Q/E` potions, `P/Esc` pause.

---

## Visuals: fully procedural

There are no sprite sheets or downloaded art. Everything is drawn with the Canvas 2D API:

- A **skeletal rig** (hip → shoulder → head with 2-segment limbs) driven by a pose
  system — `idle, walk, run, jump, fall, crouch, dash, hurt, block, ko, victory` plus 17
  attack animations interpolated through keyframes.
- Per-character costumes, weapons and auras built from layered primitives
  (straw hat, three katanas, cyborg forearms, top hat + cane, fur collar, horns…).
- **Five hand-built parallax backgrounds** (East Blue sea & docks, Alabasta dunes &
  palace, Water Seven canal city, Thriller Bark mansion, Impel Down prison) with sky,
  clouds, silhouettes, fog and matching ground planes.
- **Effects:** particles, impact sparks, slash arcs, shockwave rings, beams, fire cones,
  ice novas, screen shake, screen flash, floating damage numbers and combo counters.

Audio is generated with the WebAudio API: a full SFX bank (hits, slashes, guns, lasers,
ice, fire, coins, level-up jingles) plus an adaptive minor-key pirate score whose tempo and
layers rise with the fight's intensity.

---

## Project layout

```
index.html          shell, all UI screens & HUD markup, CSS
js/data.js          CONFIG, characters, specials, enemies, bosses, arcs, level gen, economy
js/audio.js         procedural WebAudio SFX + adaptive music
js/art.js           pose system, procedural fighters, costumes, backgrounds, portraits
js/fx.js            particles, impacts, beams, shake, damage numbers
js/fighter.js       Fighter state machine, combos, special powers, physics
js/ai.js            grunt AI profiles + boss move-pattern brain
js/battle.js        World: waves, hit resolution, projectiles, hazards, camera, win/lose
js/ui.js            HUD, virtual joystick, action buttons, menus, shop, codex
js/game.js          canvas/view scaling, fixed-timestep loop, save data, screen flow
tools/serve.js      zero-dependency static server used by `npm start`
test/               headless test + render harnesses (see below)
```

`npm start` serves the game on <http://localhost:8000> through `tools/serve.js`, which
always sends `Cache-Control: no-store`. Plain `python3 -m http.server` sends no cache
headers at all, so a browser will happily keep running the *previous* build of `js/*.js`
for a while after a fix — which looks exactly like "the fix didn't work". Every script
tag is also cache-busted (`js/game.js?v=1.0.1`) and the main menu shows a **build stamp**,
so you can always tell which build you are actually running.

Simulation runs on a **fixed 60 Hz timestep** with interpolated rendering; the view is a
virtual unit space that adapts from portrait phones to desktop (the visible arena width is
clamped so the fight is always readable).

---

## Tests

The game is verified headlessly in jsdom with a stubbed canvas, and separately rendered to
real PNGs with `@napi-rs/canvas` so the procedural art can be inspected.

```bash
npm install jsdom @napi-rs/canvas

npm test                  # node test/harness.js — the full regression suite
npm run nav               # level-select routing, win/return flow, shop, pause, CSS
npm run touch             # on-screen controls: joystick, action buttons, specials, items
npm run layout            # control sizing: parses the CSS and checks it on 8 device sizes
npm run bosses            # boss-clearance probe (a reasonably played, correctly levelled hero)
npm run levels            # per-level fight length across 30 sampled levels
npm run neverend          # stress probe: hunts for battles that refuse to resolve
npm run balance           # difficulty curve across the game (SAMPLE=full for all cases)
npm run dps               # player damage output vs. boss HP / grunt clear times
npm run savecheck         # canvas save()/restore() balance audit (catches visual corruption)
npm run devices           # renders a battle at 5 device shapes -> test/out/device-*.png
npm run render            # renders pose/attack/portrait galleries + stage stills
```

All probes run headless (jsdom + @napi-rs/canvas) and each one exits by itself.

`test/strictcanvas.js` is the browser-fidelity audit: it plays the whole game (every
screen, all six fighters with all four specials, every stage, all fifteen bosses with
their phase-2 patterns) through a context that rejects what Chrome and Safari reject —
negative arc/ellipse/radial-gradient radii, non-finite gradients and transforms,
out-of-range colour-stop offsets, unknown pattern repetitions and invalid colour
strings. `@napi-rs/canvas` accepts all of those silently, and a real browser throwing
mid-frame is a frozen game, so the audit exists to catch that class of bug headlessly.

`test/touch.js` drives the HUD the way a thumb does: it dispatches real pointer events at
the joystick (push right/left/up/down, release, and a stick held up *through* a stun) and at
every action, special and item button, then asserts the fighter actually moved, jumped,
crouched, dashed, blocked, spent mana or healed. Nothing else in the suite proves the
controls a phone user touches are wired to the fight.

### If it misbehaves on a device

The page reports its own errors: anything uncaught (or reported through
`window.reportGameError`) is shown in a red banner at the top of the screen with the
message and the build number. If something breaks on your phone, that banner is the
thing to quote — a black canvas on its own is undiagnosable. Character-card portraits
are drawn in a guarded helper for the same reason: a failure there is logged and
surfaced instead of silently leaving blank cards.

### What the probes currently report

| probe | expected result |
| --- | --- |
| `npm test` | `ALL CHECKS PASSED`, 30/30 sampled battles resolve, no runtime errors |
| `npm run bosses` | 11–12 / 15 bosses; all 9 arc 1–3 bosses fall at the level you'd naturally be |
| `npm run levels` | ~28/30 sampled levels won, median win 30–34 s, no early-arc loss |
| `npm run neverend` | 15/15 battles resolve — no fight can hang |
| `npm run touch` | 26/26 — stick moves/crouches/jumps, every button drives the fight |
| `npm run layout` | all 8 device sizes fit; controls never exceed 45 % of screen height |
| `npm run strict` | no browser-fatal canvas calls (~85 s, deep audit) |

The arc 4–5 bosses are deliberately a coin-grind gate: you clear the grunt levels
around them, spend the coins on upgrades, then come back. Grunt scaling is kept
*below* boss scaling so the levels between bosses never outweigh the boss itself —
`test/levels.js` guards this: for every arc it compares the heaviest grunt level in
each block against that block's boss and fails above 1.4x (the pre-fix arc 5 sat at
1.45x; healthy blocks run 0.6-1.3x).

`test/out/*.png` and `node_modules/` are gitignored build artefacts.

## License / attribution

Original code and original procedural artwork — nothing is copied or traced from the
anime, manga or any existing game; the character and place names follow the design
document's story outline.
