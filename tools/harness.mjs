/* Minimal DOM/canvas harness so src/game.js can run inside Node for tests.
   Returns the window.NeonChase hook the game exposes. */
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
  ctx.canvas = null;
  return ctx;
}

export function fakeElement(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [],
    innerHTML: '', textContent: '', hidden: false, title: '',
    width: 672, height: 744,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    getContext() { return fakeCtx(); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    getAttribute() { return null; }, setAttribute() {},
    getBoundingClientRect() { return { width: 660, height: 700, left: 0, top: 0 }; },
    closest() { return null; },
  };
}

export function makeHarness(code, opts = {}) {
  const calls = opts.calls || new Map();
  const ids = ['game', 'stage', 'overlay', 'dpad', 'score', 'high', 'level', 'lives', 'btn-sound', 'btn-pause'];
  const registry = new Map(ids.map((id) => [id, fakeElement(id === 'game' ? 'canvas' : 'div')]));

  const sandbox = {
    console, Date, Math, JSON, Number, String, Array, Object, Boolean, Map, Set,
    parseInt, parseFloat, isNaN, Int16Array, Uint8Array,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: {
      _s: new Map(),
      getItem(k) { return this._s.has(k) ? this._s.get(k) : null; },
      setItem(k, v) { this._s.set(k, String(v)); },
    },
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
      addEventListener() {},
      hidden: false,
    },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.globalThis = sandbox;

  vm.runInContext(code, vm.createContext(sandbox), { filename: 'src/game.js' });
  const api = sandbox.window.NeonChase;
  if (!api) throw new Error('window.NeonChase hook missing');
  api.__calls = calls;
  return api;
}
