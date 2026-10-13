/**
 * WebSocket client for Crossroads multiplayer.
 * Auto-reconnects while in a room; degrades gracefully when offline.
 */
export class Network {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.handlers = {};
    this.playerId = null;
    this.roomCode = null;
    this.ping = 0;
    this._wantOpen = true;
    this._retry = 0;
    this._pingTimer = null;
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }

  _emit(type, msg) {
    for (const fn of this.handlers[type] || []) fn(msg);
    for (const fn of this.handlers['*'] || []) fn(type, msg);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${proto}//${location.host}`);
    } catch {
      this._emit('status', { connected: false });
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._retry = 0;
      this._emit('status', { connected: true });
      if (this.roomCode && this._rejoin) {
        this.send({ t: 'join', code: this.roomCode, name: this._rejoin });
      }
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => {
        this.send({ t: 'ping', ts: performance.now() });
      }, 4000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.ping = Math.round(performance.now() - msg.ts);
        return;
      }
      if (msg.t === 'welcome') {
        this.playerId = msg.id;
        this.roomCode = msg.room?.code || null;
      }
      this._emit(msg.t, msg);
    };

    ws.onclose = () => {
      this.connected = false;
      clearInterval(this._pingTimer);
      this._emit('status', { connected: false });
      if (this._wantOpen && this._retry < 8) {
        const delay = Math.min(8000, 500 * 2 ** this._retry++);
        setTimeout(() => this.connect(), delay);
      }
    };

    ws.onerror = () => {
      /* onclose will follow */
    };
  }

  createRoom(name) {
    this._rejoin = name;
    this.connect();
    this._waitOpen(() => this.send({ t: 'create', name }));
  }

  joinRoom(code, name) {
    this._rejoin = name;
    this.roomCode = code.toUpperCase();
    this.connect();
    this._waitOpen(() => this.send({ t: 'join', code: this.roomCode, name }));
  }

  quickMatch(name) {
    this._rejoin = name;
    this.connect();
    this._waitOpen(() => this.send({ t: 'quick', name }));
  }

  _waitOpen(fn) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      fn();
      return;
    }
    const check = () => {
      if (!this.ws) return;
      if (this.ws.readyState === WebSocket.OPEN) fn();
      else if (this.ws.readyState === WebSocket.CONNECTING) setTimeout(check, 60);
    };
    setTimeout(check, 30);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  leaveRoom() {
    this.send({ t: 'leave' });
    this.roomCode = null;
    this._rejoin = null;
    this.playerId = null;
  }

  disconnect() {
    this._wantOpen = false;
    clearInterval(this._pingTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.connected = false;
    this.ws = null;
  }
}
