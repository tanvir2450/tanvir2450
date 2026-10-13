#!/usr/bin/env node
/* =====================================================================
   NEON CHASE — game server
   ---------------------------------------------------------------------
   Serves the game and relays multiplayer traffic. No dependencies: the
   WebSocket protocol (RFC 6455 handshake + framing) is implemented here
   on top of node:http so `node server.js` is all it takes.

   The server knows nothing about the game — it hands out room codes,
   tracks membership, and forwards opaque messages between the players
   in a room. The host's browser is the authority on game state.

       node server.js                 # http://localhost:3000
       PORT=8080 node server.js
       HOST=0.0.0.0 node server.js    # also reachable from the LAN
   ===================================================================== */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const MAX_ROOM = 4;              // four discs share the maze
const MAX_PAYLOAD = 256 * 1024;  // a snapshot is ~1 KB; 256 KB is plenty
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ==================================================================
   Static files
   ================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function serveFile(req, res, relPath) {
  const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(ROOT, safe);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': data.length,
    }).end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size }));
    return;
  }
  if (url.pathname === '/rooms') {
    const list = [...rooms].map(([code, r]) => ({ code, players: r.members.length }));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  serveFile(req, res, rel);
});

/* ==================================================================
   Rooms
   ================================================================== */
/** code -> { code, hostId, members: Set<client> } */
const rooms = new Map();
/** id -> client */
const clients = new Map();

let nextId = 1;
const makeId = () => 'p' + (nextId++);

function makeRoomCode() {
  for (let attempt = 0; attempt < 400; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('no free room codes');
}

function peerList(room) {
  return room.members.map((c) => ({
    id: c.id,
    name: c.name,
    host: c.id === room.hostId,
  }));
}

function roomBroadcast(room, msg, exceptId) {
  for (const c of room.members) {
    if (exceptId && c.id === exceptId) continue;
    c.send(msg);
  }
}

function announcePeers(room) {
  roomBroadcast(room, { t: 'peers', peers: peerList(room) });
}

function leaveRoom(client, reason) {
  const room = client.room ? rooms.get(client.room) : null;
  client.room = null;
  if (!room) return;
  room.members = room.members.filter((c) => c !== client);
  if (!room.members.length) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === client.id) {
    // The host owns the simulation, so the room cannot continue without it.
    for (const c of room.members) {
      c.room = null;
      c.send({ t: 'ended', why: reason || 'host-left' });
    }
    rooms.delete(room.code);
    return;
  }
  announcePeers(room);
}

/* ==================================================================
   Minimal WebSocket (RFC 6455)
   ================================================================== */
function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, data]);
}

function makeClient(socket, meta) {
  const client = {
    id: meta.id,
    name: meta.name || 'Disc',
    socket,
    room: null,
    alive: true,
    send(obj) {
      if (!client.alive) return;
      try {
        socket.write(encodeFrame(JSON.stringify(obj), 0x1));
      } catch (err) {
        client.close();
      }
    },
    close() {
      if (!client.alive) return;
      client.alive = false;
      try { socket.end(encodeFrame(Buffer.alloc(0), 0x8)); } catch (err) { /* ignore */ }
    },
  };
  return client;
}

/* Frame reader: handles masking, fragmentation and control frames. */
function attachReader(socket, onMessage, onClose) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentOp = 0;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < offset + 2) return;
        len = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (buffer.length < offset + 8) return;
        const big = buffer.readBigUInt64BE(offset);
        if (big > BigInt(MAX_PAYLOAD)) { onClose('too-big'); return; }
        len = Number(big);
        offset += 8;
      }
      if (len > MAX_PAYLOAD) { onClose('too-big'); return; }
      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + len) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + len));
      buffer = buffer.subarray(offset + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

      if (opcode === 0x8) { onClose('bye'); return; }
      if (opcode === 0x9) { socket.write(encodeFrame(payload, 0xa)); continue; }  // ping -> pong
      if (opcode === 0xa) continue;                                               // pong
      if (opcode === 0x0) {
        fragments.push(payload);
        if (fragments.reduce((a, b) => a + b.length, 0) > MAX_PAYLOAD) { onClose('too-big'); return; }
        if (!fin) continue;
        const full = Buffer.concat(fragments);
        fragments = [];
        if (fragmentOp === 0x1) onMessage(full.toString('utf8'));
        continue;
      }
      if (!fin) { fragmentOp = opcode; fragments = [payload]; continue; }
      if (opcode === 0x1) onMessage(payload.toString('utf8'));
      // binary frames are not used by the game; ignore them
    }
  });

  socket.on('error', () => onClose('error'));
  socket.on('close', () => onClose('closed'));
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '\r\n',
  ].join('\r\n'));

  const id = makeId();
  const client = makeClient(socket, { id });
  clients.set(id, client);
  socket.setNoDelay(true);

  let greeting = false;
  const send = (obj) => client.send(obj);

  attachReader(socket, (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch (err) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'hello': {
        greeting = true;
        client.name = String(msg.name || 'Disc').slice(0, 18) || 'Disc';
        send({ t: 'welcome', id: client.id, name: client.name });
        break;
      }
      case 'create': {
        if (!greeting) return;
        leaveRoom(client);
        const room = { code: makeRoomCode(), hostId: client.id, members: [] };
        rooms.set(room.code, room);
        room.members.push(client);
        client.room = room.code;
        send({ t: 'room', code: room.code, host: true, peers: peerList(room) });
        break;
      }
      case 'join': {
        if (!greeting) return;
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) { send({ t: 'error', why: 'no-room' }); return; }
        if (room.members.length >= MAX_ROOM) { send({ t: 'error', why: 'full' }); return; }
        if (room.members.some((c) => c.id === client.id)) { send({ t: 'error', why: 'already' }); return; }
        leaveRoom(client);
        room.members.push(client);
        client.room = room.code;
        send({ t: 'room', code: room.code, host: room.hostId === client.id, peers: peerList(room) });
        announcePeers(room);
        break;
      }
      case 'relay': {
        const room = client.room ? rooms.get(client.room) : null;
        if (!room) return;
        roomBroadcast(room, { t: 'relay', from: client.id, data: msg.data }, client.id);
        break;
      }
      case 'leave':
        leaveRoom(client);
        break;
      default:
        break;
    }
  }, () => {
    leaveRoom(client);
    clients.delete(client.id);
    client.alive = false;
    try { socket.destroy(); } catch (err) { /* ignore */ }
  });
});

/* ==================================================================
   Go
   ================================================================== */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🟡 NEON CHASE server');
  console.log(`     local     http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`     network   http://${ip}:${PORT}   (same wifi / phone)`);
  console.log('     online    share the URL above once this is hosted, or use the preview link');
  console.log('');
  console.log('  Solo play needs no server. To play together, open the URL above on');
  console.log('  both devices, press PLAY ONLINE, then HOST and send the room link.');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  bye');
  process.exit(0);
});
