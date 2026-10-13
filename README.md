# CROSSROADS — FUTURE DESERT

**3D Multiplayer Action Shooter** · mobile-optimized web engine with full touch controls.

A neon-drenched future desert. Glowing stickman operatives. Five kinds of hurt.
Create a room code and fight friends online — or drop into offline practice
against bots anywhere, no connection required.

---

## Design brief → implementation

| Brief | In the game |
| --- | --- |
| **Title** | Crossroads — Future Desert |
| **Genre** | 3D multiplayer action shooter (third person, deathmatch) |
| **Engine** | Mobile-optimized 3D web engine (Three.js) with touch controls, quality presets, capped pixel ratio |
| **Setting** | Neon-lit future desert: dunes, twin moons, holographic billboards, neon cacti, and the glowing central **Crossroads** plaza with a beacon tower |
| **Characters** | Stickman-inspired avatars with additive glow outlines, visor bands and procedural walk/aim/death animation |
| **Weaponry** | AK Assault Rifle · Advanced Kinetic Sniper · Plasma Pistol · Rapid Fire Machine Gun · Tactical Grenades |
| **Connectivity** | Online multiplayer with **room codes** + **offline practice vs bots** (works with zero connectivity). Local Wi-Fi / hotspot play: run the server on one device on the hotspot and every device on that network joins the same rooms |

---

## Run it

```bash
npm install
npm start          # → http://localhost:3000
```

Open the URL on desktop or phone. For a phone on the same network, open
`http://<host-lan-ip>:3000`.

No build step — the client is plain ES modules and Three.js is served straight
from `node_modules`.

---

## Game modes

- **PRACTICE — SOLO vs BOTS** — fully offline. Five hunting bots, respawn loop,
  first to 20 kills wins.
- **QUICK MATCH** — drops you into the smallest live room (or a fresh one).
- **CREATE ROOM** — makes a private room and shows its **5-letter code** at the
  top of the HUD. Share it.
- **JOIN** — type a friend's room code and drop in.

Rooms hold up to 12 players. Health/kills/respawns are server-authoritative;
first to **20 kills** wins the match.

---

## Controls

### Touch (phones / tablets)

| Control | Action |
| --- | --- |
| **Left half drag** | Move (dynamic virtual stick) |
| **Right half drag** | Look / aim |
| **FIRE** (big pink) | Shoot (hold for auto weapons) |
| **ADS** | Aim down sights — sniper gets a 3.2× zoom |
| **JUMP / RELOAD / GRENADE** | As labeled (grenade works from any weapon) |
| **1–5 strip** (top) | Switch weapons |
| **K/D pill** | Toggle scoreboard |
| **✕ LEAVE** | Back to menu |

### Desktop

| Control | Action |
| --- | --- |
| **WASD** + mouse | Move + look (click canvas for pointer lock) |
| **Left / Right mouse** | Fire / ADS |
| **R** / **G** / **Space** | Reload / grenade / jump |
| **1–5** | Weapons · **Shift** sprint · **Tab** scoreboard · **Esc** menu |

---

## Armory

| # | Weapon | Type | Mag | Damage | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | **AK Assault Rifle** | Hitscan auto | 30 | 12 | All-rounder, 600 RPM |
| 2 | **Advanced Kinetic Sniper** | Hitscan semi | 5 | 85 (2.2× headshot) | Near-perfect accuracy when aiming |
| 3 | **Plasma Pistol** | Energy bolt | 14 | 20 | Visible glowing projectiles |
| 4 | **Rapid Fire Machine Gun** | Hitscan auto | 100 | 8 | 900 RPM, wide spread |
| 5 | **Tactical Grenades** | Throwable | 3 | up to 110 | 7.5 m blast, bounces, physics fuse |

Headshots deal double damage (and look great in the kill feed: **☠ HEADSHOT**).

---

## Architecture

```
server/index.js        HTTP + WebSocket game server
                       · rooms & 5-letter codes (server-authoritative HP, kills, respawns)
                       · serves the client and vendored three.js
public/
  index.html           menus, HUD, touch controls
  css/style.css        neon UI
  js/
    main.js            bootstrap, settings, HUD glue
    game.js            runtime: movement, camera, weapons, projectiles, net sync
    world.js           desert arena (terrain heightfield, crossroads, props, fence)
    player.js          glowing stickman avatars + procedural animation
    weapons.js         5 weapon definitions + per-player weapon state
    effects.js         tracers, muzzle flashes, explosions, glow sprites
    bots.js            offline practice AI + capsule hit math
    input.js           unified touch / keyboard / mouse
    network.js         WebSocket client (auto-reconnect)
    audio.js           procedural WebAudio SFX (zero audio assets)
scripts/
  smoke-test.mjs       multiplayer protocol test (node scripts/smoke-test.mjs)
  headless-check.mjs   headless scene/bot/avatar construction test
```

### Networking model

Clients own their movement (12 Hz state broadcasts, interpolated remotely) and
report hits; the server clamps damage, applies HP, and broadcasts kills and
respawns. Practice mode never touches the network.

### Local Wi-Fi / hotspot play

1. One device runs `npm start` (the host).
2. Others connect to the host's hotspot / LAN and open `http://<host-ip>:3000`.
3. Create a room on one device; join its code on the others — LAN-IP latency,
   no internet involved.

---

## Tests

```bash
node scripts/smoke-test.mjs     # room codes, join, relay, damage, kill, respawn
node scripts/headless-check.mjs # world/avatar/weapon/bot construction checks
```

---

*Neon dunes. Glowing guns. No mercy.* 🌵
