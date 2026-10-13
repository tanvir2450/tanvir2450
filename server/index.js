/**
 * Crossroads — Future Desert
 * Game server: static client hosting + WebSocket multiplayer relay.
 *
 * Rooms are joined with short codes. The server is authoritative for health,
 * kills, deaths and respawns; clients own their movement and report hits.
 */
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const MAX_HP = 100;
const RESPAWN_MS = 3000;
const STATE_TIMEOUT_MS = 15000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ARENA_HALF = 140; // keep in sync with client world bounds

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// three.js is vendored straight from node_modules — no build step required.
const threeRoot = path.join(ROOT, 'node_modules', 'three');
const threeBuild = path.join(threeRoot, 'build');
app.get('/vendor/three.module.js', (_req, res) => {
  res.sendFile(path.join(threeBuild, 'three.module.js'));
});
// postprocessing modules (bloom) + their relative shader imports
app.use('/vendor/examples', express.static(path.join(threeRoot, 'examples')));

app.use(express.static(path.join(ROOT, 'public')));

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
const rooms = new Map(); // code -> room
let nextPlayerId = 1;

function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(code)) return code;
  }
}

function randomSpawn() {
  const angle = Math.random() * Math.PI * 2;
  const radius = 30 + Math.random() * 90;
  return [
    Math.cos(angle) * radius,
    2, // ground height approx; client corrects
    Math.sin(angle) * radius,
  ];
}

function createRoom(code = null) {
  const room = {
    code: code || makeCode(),
    players: new Map(), // id -> player record
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function roomSummary(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      hp: p.hp,
      kills: p.kills,
      deaths: p.deaths,
      alive: p.alive,
    })),
  };
}

function broadcast(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sanitizeName(raw) {
  const name = String(raw || '').replace(/[^\w\- ]/g, '').trim().slice(0, 16);
  return name || 'DesertRat';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function insideArena(p) {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(p[0]) <= ARENA_HALF + 20 &&
    Math.abs(p[2]) <= ARENA_HALF + 20
  );
}

function leaveRoom(player) {
  const room = player.room;
  if (!room) return;
  room.players.delete(player.id);
  player.room = null;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    console.log(`[rooms] ${room.code} closed (empty)`);
  } else {
    broadcast(room, { t: 'leave', id: player.id });
    broadcast(room, { t: 'scores', players: [...room.players.values()].map(scoreRow) });
    console.log(`[rooms] ${room.code} ${player.name}#${player.id} left (${room.players.size} left)`);
  }
}

function scoreRow(p) {
  return { id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, hp: p.hp, alive: p.alive };
}

function joinRoom(ws, room, name) {
  const player = {
    id: nextPlayerId++,
    name: sanitizeName(name),
    ws,
    room,
    hp: MAX_HP,
    kills: 0,
    deaths: 0,
    alive: true,
    lastState: 0,
    lastHitAt: 0,
    spawn: randomSpawn(),
  };
  room.players.set(player.id, player);
  ws.player = player;

  send(ws, {
    t: 'welcome',
    id: player.id,
    name: player.name,
    room: roomSummary(room),
    spawn: player.spawn,
    maxHp: MAX_HP,
    arenaHalf: ARENA_HALF,
  });
  broadcast(room, { t: 'join', player: scoreRow(player), spawn: player.spawn }, player.id);
  broadcast(room, { t: 'scores', players: [...room.players.values()].map(scoreRow) });
  console.log(`[rooms] ${room.code} ${player.name}#${player.id} joined (${room.players.size} total)`);
  return player;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const player = ws.player;

    switch (msg.t) {
      // ---- lobby ---------------------------------------------------------
      case 'create': {
        if (player) leaveRoom(player);
        const room = createRoom();
        joinRoom(ws, room, msg.name);
        break;
      }
      case 'join': {
        if (player) leaveRoom(player);
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', msg: `Room ${code || '??'} not found` });
        if (room.players.size >= 12) return send(ws, { t: 'error', msg: 'Room is full' });
        joinRoom(ws, room, msg.name);
        break;
      }
      case 'quick': {
        if (player) leaveRoom(player);
        // Smallest non-full room, otherwise a fresh one.
        let best = null;
        for (const room of rooms.values()) {
          if (room.players.size >= 12) continue;
          if (!best || room.players.size < best.players.size) best = room;
        }
        joinRoom(ws, best || createRoom(), msg.name);
        break;
      }
      case 'leave': {
        if (player) leaveRoom(player);
        break;
      }

      // ---- gameplay ------------------------------------------------------
      case 'state': {
        if (!player || !player.room) return;
        player.lastState = Date.now();
        if (insideArena(msg.p)) {
          player.pos = msg.p;
          broadcast(
            player.room,
            {
              t: 'state',
              id: player.id,
              p: msg.p,
              ry: clamp(Number(msg.ry) || 0, -Math.PI * 2, Math.PI * 2),
              rx: clamp(Number(msg.rx) || 0, -1.5, 1.5),
              w: clamp(Number(msg.w) | 0, 0, 4),
              mv: clamp(Number(msg.mv) || 0, 0, 3),
              gr: msg.gr ? 1 : 0,
            },
            player.id
          );
        }
        break;
      }
      case 'fire': {
        if (!player || !player.room || !player.alive) return;
        broadcast(
          player.room,
          {
            t: 'fire',
            id: player.id,
            w: clamp(Number(msg.w) | 0, 0, 4),
            o: insideArena(msg.o) ? msg.o : null,
            d: msg.d,
          },
          player.id
        );
        break;
      }
      case 'hit': {
        if (!player || !player.room || !player.alive) return;
        const now = Date.now();
        if (now - player.lastHitAt < 30) return; // basic rate limit
        player.lastHitAt = now;

        const target = player.room.players.get(Number(msg.target) | 0);
        if (!target || !target.alive || target.id === player.id) return;

        const weapon = clamp(Number(msg.w) | 0, 0, 4);
        const baseDmg = [12, 85, 20, 8, 110][weapon] ?? 10;
        let dmg = clamp(Number(msg.dmg) || baseDmg, 1, 200);
        if (msg.head) dmg = Math.min(200, dmg * 2);

        target.hp = clamp(target.hp - dmg, 0, MAX_HP);
        broadcast(player.room, {
          t: 'hp',
          id: target.id,
          hp: target.hp,
          by: player.id,
          head: !!msg.head,
          w: weapon,
        });

        if (target.hp <= 0) {
          target.alive = false;
          target.deaths += 1;
          player.kills += 1;
          broadcast(player.room, {
            t: 'kill',
            killer: player.id,
            victim: target.id,
            w: weapon,
            head: !!msg.head,
          });
          broadcast(player.room, { t: 'scores', players: [...player.room.players.values()].map(scoreRow) });
          setTimeout(() => {
            if (!target.room) return;
            target.alive = true;
            target.hp = MAX_HP;
            target.spawn = randomSpawn();
            broadcast(target.room, {
              t: 'respawn',
              id: target.id,
              hp: MAX_HP,
              spawn: target.spawn,
            });
            broadcast(target.room, { t: 'scores', players: [...target.room.players.values()].map(scoreRow) });
          }, RESPAWN_MS);
        }
        break;
      }
      case 'nade': {
        if (!player || !player.room || !player.alive) return;
        broadcast(
          player.room,
          { t: 'nade', id: player.id, o: msg.o, v: msg.v },
          player.id
        );
        break;
      }
      case 'pos': {
        // cheap presence heartbeat used while dead/spectating
        if (!player || !player.room) return;
        player.lastState = Date.now();
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.player) leaveRoom(ws.player);
  });
  ws.on('error', () => {
    if (ws.player) leaveRoom(ws.player);
  });
});

// Drop dead sockets.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      if (ws.player) leaveRoom(ws.player);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

// Drop players that stopped sending state (network loss without close).
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.lastState && now - p.lastState > STATE_TIMEOUT_MS) {
        try {
          p.ws.close();
        } catch {
          /* ignore */
        }
        leaveRoom(p);
      }
    }
  }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Crossroads — Future Desert`);
  console.log(`  http://0.0.0.0:${PORT}`);
  console.log(`  multiplayer: ws on same port | rooms: ${rooms.size}`);
});
