/* Shared jsdom canvas adapter: gives every HTMLCanvasElement a real
   @napi-rs/canvas 2D context that survives resizing (the game sets
   canvas.width/height after grabbing the context).
   Usage: const adapter = install(window);  adapter.get(canvas) -> napi canvas */
const { createCanvas } = require('@napi-rs/canvas');

function install(window, opts) {
  opts = opts || {};
  const store = new Map();

  function dim(el, prop, fallback) {
    const v = el['__' + prop];
    if (v !== undefined && v !== null) return v;
    const attr = el.getAttribute ? Number(el.getAttribute(prop)) : NaN;
    if (attr) return attr;
    return fallback;
  }

  function allocate(el) {
    const w = Math.max(1, Math.round(dim(el, 'width', 300)));
    const h = Math.max(1, Math.round(dim(el, 'height', 150)));
    const st = store.get(el);
    if (!st) return null;
    st.holder.canvas = createCanvas(w, h);
    st.holder.ctx = st.holder.canvas.getContext('2d');
    return st.holder.canvas;
  }

  const proto = window.HTMLCanvasElement.prototype;
  proto.getContext = function (kind) {
    if (kind !== '2d') return null;
    if (!store.has(this)) {
      const holder = { canvas: null, ctx: null };
      store.set(this, { holder, proxy: null });
      allocate(this);
      const proxy = new Proxy({}, {
        get(_, k) {
          if (k === '__holder') return holder;
          const c = holder.ctx;
          if (!c) return undefined;
          const v = c[k];
          return typeof v === 'function' ? (...a) => v.apply(c, a) : v;
        },
        set(_, k, v) { if (holder.ctx) holder.ctx[k] = v; return true; },
        has(_, k) { return holder.ctx ? k in holder.ctx : false; },
      });
      store.get(this).proxy = proxy;
    }
    return store.get(this).proxy;
  };

  ['width', 'height'].forEach(prop => {
    Object.defineProperty(proto, prop, {
      configurable: true,
      get() { return dim(this, prop, prop === 'width' ? 300 : 150); },
      set(v) { this['__' + prop] = v; if (store.has(this)) allocate(this); },
    });
  });

  return {
    get(el) { const st = store.get(el); return st ? st.holder.canvas : null; },
    ctxOf(el) { const st = store.get(el); return st ? st.holder.ctx : null; },
    createCanvas,
  };
}

/* Minimal WebAudio stub */
function stubAudio(window) {
  class P { constructor() { this.value = 0; } setValueAtTime() { } linearRampToValueAtTime() { } exponentialRampToValueAtTime() { } cancelScheduledValues() { } }
  class N {
    constructor() { this.gain = new P(); this.frequency = new P(); this.detune = new P(); this.Q = new P(); this.pan = new P(); }
    connect() { } disconnect() { } start() { } stop() { }
  }
  window.AudioContext = class {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = new N(); }
    resume() { } createGain() { return new N(); } createOscillator() { return new N(); }
    createBiquadFilter() { return new N(); } createBufferSource() { return new N(); }
    createStereoPanner() { return new N(); }
    createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }
  };
}

/* Deterministic rAF pump */
function pump(window) {
  const queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => { };
  if (!window.PointerEvent) {
    window.PointerEvent = class extends window.MouseEvent {
      constructor(t, o = {}) { super(t, o); this.pointerId = o.pointerId || 1; this.pointerType = o.pointerType || 'touch'; }
    };
  }
  let t = 0;
  return function frame(n = 1, dt = 16.7) {
    for (let i = 0; i < n; i++) {
      t += dt;
      const q = queue.splice(0, queue.length);
      for (const cb of q) cb(t);
    }
  };
}

module.exports = { install, stubAudio, pump };
