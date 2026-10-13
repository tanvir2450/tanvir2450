/* =====================================================================
   NEON CHASE — network session
   ---------------------------------------------------------------------
   Transport and protocol only; the game lives in game.js.

   The server (server.js) is a dumb room relay: it hands out room codes,
   tracks who is in the room, and forwards opaque `relay` messages
   between peers. All game authority sits with the host's browser, which
   means no game logic has to be duplicated server-side.

   Wire protocol (client -> server):
     { t: 'hello',  name, v: 1 }      identify yourself
     { t: 'create' }                  open a room, become host
     { t: 'join',   code }            join an existing room
     { t: 'relay',  data }            forward `data` to everyone else
     { t: 'leave' }                   leave the room (socket may stay up)

   Server -> client:
     { t: 'welcome', id, name }       you are connected
     { t: 'room',    code, host, peers }   you are in a room (host: you?)
     { t: 'peers',   peers }          room membership changed
     { t: 'relay',   from, data }     someone else's message
     { t: 'error',   why, msg }       no-room / full / bad-version / ...
     { t: 'ended',   why }            the room is gone (host left)
   ===================================================================== */
(function () {
  'use strict';

  const VERSION = 1;

  /* Injected for tests: (url) => WebSocket-like object */
  let wsFactory = null;
  function useWebSocket(fn) { wsFactory = fn; }

  function defaultSocket(url) {
    const WS = typeof WebSocket !== 'undefined' ? WebSocket : null;
    if (!WS) throw new Error('WebSockets are not available in this browser');
    return new WS(url);
  }

  /** Where should the online game connect to? */
  function defaultUrl() {
    try {
      if (typeof location !== 'undefined' && location.protocol && /^https?:$/.test(location.protocol)) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${location.host}`;
      }
      // Opened straight from disk (file://) — remember whichever server the
      // player used last, they can type a new one in the lobby.
      const saved = localStorage.getItem('neonchase.server');
      return saved || '';
    } catch (err) {
      return '';
    }
  }

  function saveUrl(url) {
    try {
      if (url) localStorage.setItem('neonchase.server', url);
      else localStorage.removeItem('neonchase.server');
    } catch (err) { /* private mode, whatever */ }
  }

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  function randomName() {
    const n = 1 + Math.floor(Math.random() * 98);
    return 'Disc ' + n;
  }

  /**
   * Open a session. Events arrive through `onEvent`:
   *   { type: 'open' }                          socket connected
   *   { type: 'welcome', id, name }
   *   { type: 'room', code, host, peers, self }  in a room (host: am I host?)
   *   { type: 'peers', peers }
   *   { type: 'data', from, data }              a peer's game message
   *   { type: 'ping', ms }                      round-trip time to the server
   *   { type: 'error', why, msg }
   *   { type: 'ended', why }
   *   { type: 'closed', code }
   */
  function createSession(opts) {
    const onEvent = opts.onEvent || function () {};
    const name = opts.name || randomName();
    let url = opts.url || defaultUrl();
    let ws = null;
    let selfId = null;
    let role = 'idle';          // idle | host | guest
    let rooms = { code: null, peers: [], host: false };
    let pingTimer = null;
    let pingSentAt = 0;
    let closed = false;

    function emit(ev) { try { onEvent(ev); } catch (err) { console.error(err); } }

    function send(obj) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch (err) { return false; }
    }

    function startPing() {
      stopPing();
      pingTimer = setInterval(() => {
        if (!ws || ws.readyState !== 1) return;
        pingSentAt = Date.now();
        send({ t: 'relay', data: { t: '_ping' } });
      }, 2000);
    }
    function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } }

    function open(newUrl) {
      if (newUrl) url = newUrl;
      if (!url) { emit({ type: 'error', why: 'no-server' }); return false; }
      saveUrl(url);
      closed = false;
      try {
        const socket = (wsFactory || defaultSocket)(url);
        ws = socket;
      } catch (err) {
        emit({ type: 'error', why: 'nosocket', msg: String(err && err.message || err) });
        return false;
      }

      ws.onopen = () => {
        send({ t: 'hello', name, v: VERSION });
        startPing();
        emit({ type: 'open' });
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (err) { return; }
        handle(m);
      };
      ws.onclose = () => {
        stopPing();
        role = 'idle';
        rooms = { code: null, peers: [], host: false };
        if (!closed) emit({ type: 'closed' });
      };
      ws.onerror = () => {
        emit({ type: 'error', why: 'connect' });
      };
      return true;
    }

    function handle(m) {
      switch (m.t) {
        case 'welcome':
          selfId = m.id;
          emit({ type: 'welcome', id: m.id, name: m.name });
          break;
        case 'room':
          role = m.host ? 'host' : 'guest';
          rooms = { code: m.code, peers: m.peers || [], host: !!m.host };
          emit({ type: 'room', code: m.code, host: !!m.host, peers: rooms.peers, self: selfId });
          break;
        case 'peers':
          rooms.peers = m.peers || [];
          emit({ type: 'peers', peers: rooms.peers });
          break;
        case 'relay':
          if (m.data && m.data.t === '_ping') {
            send({ t: 'relay', data: { t: '_pong' } });
            return;
          }
          if (m.data && m.data.t === '_pong') {
            emit({ type: 'ping', ms: Date.now() - pingSentAt });
            return;
          }
          emit({ type: 'data', from: m.from, data: m.data });
          break;
        case 'error':
          emit({ type: 'error', why: m.why, msg: m.msg });
          break;
        case 'ended':
          role = 'idle';
          rooms = { code: null, peers: [], host: false };
          emit({ type: 'ended', why: m.why });
          break;
        default:
          break;
      }
    }

    return {
      get role() { return role; },
      get url() { return url; },
      get selfId() { return selfId; },
      get peers() { return rooms.peers; },
      get code() { return rooms.code; },
      get connected() { return !!ws && ws.readyState === 1; },
      get name() { return name; },
      setUrl(u) { url = u; saveUrl(u); },
      open,
      host() { return send({ t: 'create' }); },
      join(code) { return send({ t: 'join', code: String(code || '').toUpperCase().trim() }); },
      send,
      leave() {
        stopPing();
        send({ t: 'leave' });
        if (ws) { try { ws.close(); } catch (err) { /* ignore */ } }
        ws = null;
        role = 'idle';
        rooms = { code: null, peers: [], host: false };
      },
      /** Tell the other players why the session ended and shut down. */
      shutdown() {
        closed = true;
        this.leave();
      },
    };
  }

  /** Build a shareable link to a room (works with any host URL). */
  function inviteLink(code) {
    try {
      if (typeof location === 'undefined' || !location.href) return '?room=' + code;
      const u = new URL(location.href);
      u.searchParams.set('room', code);
      u.hash = '';
      return u.toString();
    } catch (err) {
      return '?room=' + code;
    }
  }

  function roomFromUrl() {
    try {
      const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
      const code = q.get('room');
      return code ? code.toUpperCase().trim() : null;
    } catch (err) {
      return null;
    }
  }

  window.NeonNet = {
    VERSION,
    createSession,
    defaultUrl,
    saveUrl,
    useWebSocket,
    randomName,
    inviteLink,
    roomFromUrl,
    CODE_ALPHABET,
  };
})();
