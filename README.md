# Neon Chase

A neon maze-chase arcade game. You are the glowing disc; four hunters want you.
Clear every dot on the board to advance — grab a power orb and the chase flips:
for a few seconds, *you* hunt *them*.

**The whole game is one file: `neon-chase.html`** (identical to `index.html`).
No install, no build step, no server, no internet. Open it anywhere:

| where | how |
| --- | --- |
| **PC / laptop** | double-click the file. Done. |
| **Android** | send it to yourself (email, Drive, Telegram, USB) and tap it. Or serve the folder and tap **Save this game for offline play**. |
| **iPhone / iPad** | put the file in iCloud Drive or Files, tap it to open in Safari, then Share → *Add to Home Screen* for an icon that launches offline. |
| **Served over a network** | `node server.js`, then open the printed address on any device — this is also how you play together. |

It is a single HTML file with the game, its icon and its sound engine inlined:
180 KB, zero external requests, and it plays fine with storage and WebSockets
blocked (both are common on phones). Progress and settings are saved when the
browser allows it and silently skipped when it doesn't.

```
# solo: just open the file
open neon-chase.html          # macOS
xdg-open neon-chase.html      # Linux
start neon-chase.html         # Windows

# with online multiplayer
node server.js                # then visit http://localhost:3000
PORT=8080 node server.js      # different port
HOST=0.0.0.0 node server.js   # also reachable from your LAN
```

`node server.js` prints the local and LAN addresses. Open one of them on each
device, press **PLAY ONLINE**, one player presses **HOST**, the others type the
4-letter room code (or open the invite link). Same wifi? Use the LAN address
(`http://192.168.x.x:3000`) and it works on phones with no hosting at all.

## Play

| Action | Keys |
| --- | --- |
| Move | `←` `↑` `↓` `→` or `W` `A` `S` `D` |
| Pause / menu | `P` or `Esc` |
| Sound on/off | `M` |
| Start / restart | `Space` or `Enter` |

On a phone: swipe anywhere on the board, or use the on-screen d-pad.

## Rules

- **Dots** — 10 points each. Clear the board to advance a level.
- **Power orbs** (4 per level, one near each corner) — 50 points, and every
  hunter turns blue and runs away for ~8 seconds (less at higher levels).
- **Eat a scared hunter** — 200 → 400 → 800 → 1600 points for the same orb, and
  its eyes sprint home to respawn.
- **Extra life** at 10,000 points. **Bonus gem** appears after 70 and 170 dots.
- **Every level re-lights the maze** with a new neon hue as it gets harder —
  hunters speed up, scatters shorten, and the power orbs stop lasting as long.
- Solo: three lives, then it's over. Best score is saved locally.

### The four hunters

They patrol in *scatter* bursts (each heads for its own corner) between longer
*chase* bursts, and each one schemes differently:

| Hunter | Colour | Style |
| --- | --- | --- |
| Blinky | red | hunts you head-on — leaves the pen first |
| Pinky | pink | aims four tiles *ahead* of you to cut you off |
| Inky | cyan | flanks from behind, using Blinky's position |
| Clyde | orange | wanders near his corner, then pounces when close |

In a race they chase whoever is nearest, so the pressure keeps moving around the
table. Hunters are slower than a disc (about 80% of your speed at level 1,
closing in as the levels climb) and slow right down inside the side tunnels. You
can turn instantly — including reversing mid-corridor — so corners are your
friend.

## Online races (1–4 players)

- One maze, everyone's own score and three lives. Clear all the dots and the
  race continues into the next level; the standings screen ranks the discs.
- Fall behind and it is not over: each disc respawns after a short puff of
  smoke, with a moment of spawn protection. **Eat another disc's frightened
  hunter** and you take the points — every disc for itself.
- The host's browser is the referee: it simulates the maze and the hunters and
  streams snapshots ~12×/second; guests send their input and smooth the rest.
  Each guest predicts its own disc, so the controls feel local.
- Points awarded to a disc stay with it even if it gets caught — the scoreboard
  is what ranks you at the end.

### How the network side works

```
index.html          the whole game, self-contained (net + game inlined)
src/net.js          session/transport: rooms, relay messages, ping
server.js           HTTP file server + WebSocket relay + room codes
```

- `server.js` implements the WebSocket protocol (RFC 6455 handshake and frames)
  on top of `node:http` — there is no dependency to install.
- The server knows nothing about the game. It hands out room codes, tracks who
  is in a room, and forwards opaque messages between those players. Because the
  host's browser is the authority, no game logic is duplicated server-side.
- Wire protocol, client → server: `hello`, `create`, `join`, `relay`, `leave`.
  Server → client: `welcome`, `room`, `peers`, `relay`, `error`, `ended`.
  Inside `relay`, the game speaks its own dialect: snapshots (`s`), input
  (`input`), start/roster, one-shot effects (`fx`) and race over (`over`).
- Rooms hold up to 4 discs and are dropped when the host leaves (the host owns
  the simulation, so there is nothing to continue without it).

### Playing with people who are not on your wifi

Hosting the game somewhere with a TLS certificate is what makes `https://` pages
(and therefore phone browsers on mobile data) able to connect. Any of these
gives you a URL you can send to a friend:

- a small VPS: `node server.js` behind Caddy/nginx,
- a tunnel from your laptop: `cloudflared tunnel --url http://localhost:3000`
  or `ngrok http 3000` — paste the `wss://…` address it prints into the game's
  **Game server** field,
- any Node host that can run this one file (Render, Fly, Railway, a Raspberry Pi
  on your LAN).

A page served over `https://` can only open `wss://` sockets, so if you opened
the game from a https preview or host, use a `wss://` server address. The game
says so in the lobby when a connection fails, and remembers the last address you
used.

## Layout

```
neon-chase.html         the built, self-contained game (open this) — same bytes as index.html
index.html              the same file under the name a web server expects
index.template.html     the shell it is built from (markup + CSS)
src/game.js             maze, movement, hunter AI, rules, rendering, sound
src/net.js              online session layer (rooms, protocol, smoothing)
server.js               game server: static files + multiplayer relay
assets/icon-192.png     home-screen icon, inlined by the build
tools/maze-check.mjs    maze validator (symmetry, connectivity, pellets, pen)
tools/smoke-test.mjs    headless play-through: rules, states, collisions, render
tools/balance-test.mjs  scripted player measures fairness and difficulty
tools/validate.mjs      the built file is current, self-contained and playable
tools/mp-test.mjs       two/three clients racing over a fake relay
tools/net-test.mjs      the real server over a real socket, end to end
tools/bot.mjs           the scripted player used by the balance test
tools/fake-relay.mjs    in-memory stand-in for server.js
tools/harness.mjs       DOM/canvas stub so the game runs under Node
tools/build.mjs         inlines net + game + icon into index.html
tools/make-icon.mjs     regenerates assets/icon-192.png (dev only)
```

The maze is plain ASCII inside `src/game.js`:

```
#  wall      .  dot      o  power orb      -  pen door      (space) floor
```

Edit it and run `node tools/maze-check.mjs` — it verifies the board is
symmetric, that every dot and orb is reachable from the spawn tile, and that
the hunters' pen is properly sealed.

## Building and testing

`index.html` is generated from `index.template.html`, `src/net.js`,
`src/game.js` and the icon. After editing a source, rebuild:

```
npm run build       # node tools/build.mjs
npm test            # all six suites
```

Or one at a time:

```
node tools/maze-check.mjs
node tools/smoke-test.mjs
node tools/balance-test.mjs
node tools/validate.mjs
node tools/mp-test.mjs
node tools/net-test.mjs
```

What the suites actually check:

- **maze-check** — row lengths, mirror symmetry, connectivity, every pellet
  reachable from the spawn tile, no accidental dead ends, pen sealed.
- **smoke-test** — boots the real game file in a stubbed DOM and plays it:
  the READY → playing → dying → game over flow, orb fright, eating hunters,
  life loss, level advance, pause, and that the renderer is really drawing.
  It plays *without any WebSocket available*, which is the "solo must always
  work" guarantee.
- **balance-test** — plays full games with a scripted player and asserts the
  chase is fair: progress is possible while hunted, nobody dies seconds after
  spawning, the hunters do catch people — and it measures hunter speed exactly
  (a 6.1 tile/s hunter travels 6.10 tiles in one second, and so on).
- **validate** — `index.html` and `neon-chase.html` are identical and match the
  sources (no stale build), have zero external references, carry both inlined
  scripts in the right order, and the build boots, plays and can open every
  online screen. It also plays a full game as a **`file://` page with storage
  disabled, no WebSocket and no clipboard** — the phone case.
- **mp-test** — two and three clients over the in-memory relay: create, join by
  code, start, score, mid-race join, input relay, effect relay, race over, host
  departure, bogus codes.
- **net-test** — spawns the real `server.js` and talks to it over TCP: static
  files, content types, 404s, traversal attempts, the WebSocket handshake,
  room codes, peer lists, a 70 KB relayed snapshot, the 4-disc capacity limit,
  and finally **two real game clients racing over a real socket**.

The game exposes `window.NeonChase` (state, `step(dt)`, `setDir`, `start`,
`pause`, `setRng`, the net hooks, plus `tile`/`pellet`/`grid`) so the tests can
drive it deterministically.
