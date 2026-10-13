/* An in-memory stand-in for server.js, so the multiplayer client logic can
   be tested without a network. It speaks the same protocol and pairs with
   NeonNet through its `useWebSocket` hook.

   Delivery is asynchronous (setImmediate) just like a real socket, so tests
   see realistic ordering rather than synchronous re-entrancy. */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

export function createFakeRelay(opts = {}) {
  const maxRoom = opts.maxRoom || 4;
  const rooms = new Map();   // code -> { code, hostId, members:Set }
  const sockets = new Set();
  let nextId = 1;
  let closed = false;

  function deliver(socket, obj) {
    if (closed || socket.readyState !== 1) return;
    setImmediate(() => {
      if (socket.readyState !== 1) return;
      try {
        socket.onmessage({ data: JSON.stringify(obj) });
      } catch (err) { /* a throwing client must not break the relay */ }
    });
  }

  function peerList(room) {
    return [...room.members].map((s) => ({ id: s.id, name: s.name, host: s.id === room.hostId }));
  }

  function broadcast(room, obj, except) {
    for (const s of room.members) if (s !== except) deliver(s, obj);
  }

  function leaveRoom(socket, reason) {
    const room = socket.room ? rooms.get(socket.room) : null;
    socket.room = null;
    if (!room) return;
    room.members.delete(socket);
    if (!room.members.size) { rooms.delete(room.code); return; }
    if (room.hostId === socket.id) {
      for (const s of room.members) {
        s.room = null;
        deliver(s, { t: 'ended', why: reason || 'host-left' });
      }
      rooms.delete(room.code);
      return;
    }
    broadcast(room, { t: 'peers', peers: peerList(room) });
  }

  function handle(socket, msg) {
    switch (msg.t) {
      case 'hello':
        socket.name = String(msg.name || 'Disc').slice(0, 18) || 'Disc';
        deliver(socket, { t: 'welcome', id: socket.id, name: socket.name });
        break;
      case 'create': {
        leaveRoom(socket);
        let code = makeCode();
        while (rooms.has(code)) code = makeCode();
        const room = { code, hostId: socket.id, members: new Set([socket]) };
        rooms.set(code, room);
        socket.room = code;
        deliver(socket, { t: 'room', code, host: true, peers: peerList(room) });
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) { deliver(socket, { t: 'error', why: 'no-room' }); return; }
        if (room.members.size >= maxRoom) { deliver(socket, { t: 'error', why: 'full' }); return; }
        leaveRoom(socket);
        room.members.add(socket);
        socket.room = code;
        deliver(socket, { t: 'room', code, host: room.hostId === socket.id, peers: peerList(room) });
        broadcast(room, { t: 'peers', peers: peerList(room) });
        break;
      }
      case 'relay': {
        const room = socket.room ? rooms.get(socket.room) : null;
        if (!room) return;
        broadcast(room, { t: 'relay', from: socket.id, data: msg.data }, socket);
        break;
      }
      case 'leave':
        leaveRoom(socket);
        break;
      default:
        break;
    }
  }

  /** A WebSocket-like object for NeonNet.useWebSocket(). */
  function connect() {
    const socket = {
      id: 'p' + (nextId++),
      name: 'Disc',
      room: null,
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      sent: [],
      send(text) {
        if (socket.readyState !== 1) return;
        let msg;
        try { msg = JSON.parse(text); } catch (err) { return; }
        socket.sent.push(msg);
        setImmediate(() => handle(socket, msg));
      },
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        leaveRoom(socket, 'closed');
        sockets.delete(socket);
        setImmediate(() => { if (socket.onclose) socket.onclose({ code: 1000 }); });
      },
    };
    sockets.add(socket);
    setImmediate(() => {
      if (socket.readyState !== 0) return;
      socket.readyState = 1;
      if (socket.onopen) socket.onopen({});
    });
    return socket;
  }

  return {
    connect,
    rooms,
    sockets,
    get roomCount() { return rooms.size; },
    shutdown() {
      closed = true;
      for (const s of sockets) { s.readyState = 3; }
      for (const r of rooms.values()) {
        for (const s of r.members) deliver(s, { t: 'ended', why: 'server-closed' });
      }
      rooms.clear();
    },
  };
}

/** Let every queued setImmediate callback run. */
export const settle = (rounds = 8) => new Promise((resolve) => {
  let n = 0;
  const step = () => (++n >= rounds ? resolve() : setImmediate(step));
  setImmediate(step);
});
