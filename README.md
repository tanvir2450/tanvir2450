# Neon Chase

A neon maze-chase arcade game. You are the glowing disc; four hunters want you.
Clear every dot on the board to advance — grab a power orb and the chase flips:
for a few seconds, *you* hunt *them*.

Zero dependencies, no build step: one HTML shell, one plain-JS game file.

```
open index.html          # or:
python3 -m http.server 4173   # then visit http://localhost:4173
```

## Play

| Action | Keys |
| --- | --- |
| Move | `←` `↑` `↓` `→` or `W` `A` `S` `D` |
| Pause / resume | `P` or `Esc` |
| Sound on/off | `M` |
| Start / restart | `Space` or `Enter` |

On a phone: swipe anywhere on the board, or use the on-screen d-pad.

## Rules

- **Dots** — 10 points each. Clear the board to advance a level.
- **Power orbs** (4 per level, one near each corner) — 50 points, and every
  hunter turns blue and runs away for ~8 seconds (less at higher levels).
- **Eat a scared hunter** — 200 → 400 → 800 points for the same orb, and its
  eyes sprint home to respawn.
- **Extra life** at 10,000 points. **Bonus gem** appears after 70 and 170 dots.
- Touching a hunter costs a life. Three lives, then it's over. Best score is
  saved locally.

### The four hunters

They patrol in *scatter* bursts (each heads for its own corner) between longer
*chase* bursts, and each one schemes differently:

| Hunter | Colour | Style |
| --- | --- | --- |
| Blinky | red | hunts you head-on — leaves the pen first |
| Pinky | pink | aims four tiles *ahead* of you to cut you off |
| Inky | cyan | flanks from behind, using Blinky's position |
| Clyde | orange | wanders near his corner, then pounces when close |

They are slower than you (about 80% of your speed at level 1, closing in as the
levels climb) and they slow right down inside the side tunnels. You can turn
instantly — including reversing mid-corridor — so corners are your friend.

## Layout

```
index.html          UI shell: HUD, overlays, canvas, touch pad, all styling
src/game.js         the game: maze data, movement, AI, rules, rendering, sound
tools/maze-check.mjs    maze validator (symmetry, connectivity, pellets, pen)
tools/smoke-test.mjs    headless play-through: rules, states, collisions, render
tools/balance-test.mjs  scripted player measures fairness and difficulty
tools/bot.mjs           the scripted player used by the balance test
tools/harness.mjs       DOM/canvas stub so the game runs under Node
```

The maze is plain ASCII inside `src/game.js`:

```
#  wall      .  dot      o  power orb      -  pen door      (space) floor
```

Edit it and run `node tools/maze-check.mjs` — it verifies the board is
symmetric, that every dot and orb is reachable from the spawn tile, and that
the hunters' pen is properly sealed.

## Tests

```
npm test          # or run them one at a time:
node tools/maze-check.mjs
node tools/smoke-test.mjs
node tools/balance-test.mjs
```

`smoke-test` boots the real game file inside a stubbed DOM and plays it: it
checks the READY → playing → catching → dying → game over flow, orb fright,
eating hunters, level ups, pause, and that the renderer is actually drawing —
and fails on any crash over several simulated minutes. `balance-test` plays
real games with a scripted player and asserts the chase is fair: progress is
possible while hunted, nobody dies seconds after spawning, and slowing the
hunters down measurably extends lives.

The game exposes `window.NeonChase` (the live state, `step(dt)`, `setDir`,
`start`, `pause`, plus `tile`/`pellet`/`grid` accessors) so tooling can drive it
deterministically.
