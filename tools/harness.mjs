/* Minimal DOM/canvas harness so the real game files can run inside Node.
   Returns the window.NeonChase hook the game exposes (and window.NeonNet
   when src/net.js is loaded too). */
import vm from 'node:vm';

const CTX_METHODS = [
  'save', 'restore', 'setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect',
  'beginPath', 'moveTo', 'lineTo', 'arc', 'quadraticCurveTo', 'closePath', 'fill', 'stroke',
  'drawImage', 'fillText', 'strokeText', 'ellipse', 'rect', 'setLineDash',
];

export function fakeCtx(calls) {
  const ctx = {};
  for (const name of CTX_METHODS) {
    ctx[name] = () => { if (calls) calls.set(name, (calls.get(name) || 0) + 1); };
  }
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  ctx.measureText = (t) => ({ width: String(t || '').length * 6 });
  ctx.filter = 'none';
  return ctx;
}

export function fakeElement(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [],
    innerHTML: '', textContent: '', hidden: false, title: '', value: '',
    width: 672, height: 744,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    getContext() { return fakeCtx(); },
    click() { this.clicked = true; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    addEventListener() {}, removeEventListener() {},
    getAttribute() { return null; }, setAttribute() {},
    getBoundingClientRect() { return { width: 660, height: 700, left: 0, top: 0 }; },
    closest() { return null; },
    querySelector(sel) {
      // the game only ever looks up its own small inputs
      if (!this._q) this._q = new Map();
      if (!this._q.has(sel)) this._q.set(sel, fakeElement('input'));
      return this._q.get(sel);
    },
    focus() {},
  };
}

const ELEMENT_IDS = [
  'game', 'stage', 'overlay', 'dpad', 'score', 'high', 'level', 'lives', 'scores', 'net-badge',
  'btn-sound', 'btn-pause',
];

/**
 * Run the given source(s) in a fresh sandbox.
 * `code` may be a string or an array of strings (net.js first, then game.js).
 */
export function makeHarness(code, opts = {}) {
  const sources = Array.isArray(code) ? code : [code];
  const calls = opts.calls || new Map();
  const registry = new Map(ELEMENT_IDS.map((id) => [id, fakeElement(id === 'game' ? 'canvas' : 'div')]));

  // Some browsers are hostile to file:// pages: storage throws, no clipboard,
  // no WebSocket. `opts.file` reproduces that so "opens anywhere" is testable.
  const strictStorage = !!opts.strictStorage;
  const storage = {
    _s: new Map(),
    getItem(k) {
      if (strictStorage) throw new Error('storage is disabled for this origin');
      return this._s.has(k) ? this._s.get(k) : null;
    },
    setItem(k, v) {
      if (strictStorage) throw new Error('storage is disabled for this origin');
      this._s.set(k, String(v));
    },
    removeItem(k) {
      if (strictStorage) throw new Error('storage is disabled for this origin');
      this._s.delete(k);
    },
  };

  const timers = new Set();
  const sandbox = {
    console, Date, Math, JSON, Number, String, Array, Object, Boolean, Map, Set, Error, Promise, RegExp,
    parseInt, parseFloat, isNaN, isFinite, Int16Array, Uint8Array, Uint32Array, Float64Array,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    URL, URLSearchParams,
    location: opts.location || {
      protocol: 'http:',
      host: 'test.local:3000',
      href: 'http://test.local:3000/',
      search: '',
    },
    navigator: opts.navigator || { clipboard: null, userAgent: 'node-harness' },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.add(t); return t; },
    clearTimeout: (t) => { clearTimeout(t); timers.delete(t); },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; },
    clearInterval: (t) => { clearInterval(t); timers.delete(t); },
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
    devicePixelRatio: 1,
    addEventListener() {},
    innerWidth: 900, innerHeight: 900,
    document: {
      getElementById: (id) => registry.get(id) || fakeElement('div'),
      createElement: (tag) => {
        const el = fakeElement(tag);
        el.getContext = () => fakeCtx(calls);
        return el;
      },
      body: fakeElement('body'),
      addEventListener() {},
      hidden: false,
    },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  if (opts.noWebSocket !== false) delete sandbox.WebSocket;   // default: none, as on file:// mobiles
  if (opts.noClipboard !== false) sandbox.navigator.clipboard = null;

  const context = vm.createContext(sandbox);
  sources.forEach((src, i) => {
    vm.runInContext(src, context, { filename: i === 0 && sources.length > 1 ? 'src/net.js' : 'src/game.js' });
  });

  const api = sandbox.window.NeonChase;
  if (!api) throw new Error('window.NeonChase hook missing');
  api.__calls = calls;
  api.__net = sandbox.window.NeonNet;
  api.__overlay = registry.get('overlay');
  api.__ui = registry;
  return api;
}
