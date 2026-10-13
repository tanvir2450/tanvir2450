/* Shared jsdom canvas adapter: gives every HTMLCanvasElement a real
   @napi-rs/canvas 2D context that survives resizing (the game sets
   canvas.width/height after grabbing the context).
   Usage: const adapter = install(window);  adapter.get(canvas) -> napi canvas */
const { createCanvas } = require('@napi-rs/canvas');

/* --- browser fidelity --------------------------------------------------------
   @napi-rs/canvas (like the jsdom stub) quietly accepts several things every real
   browser rejects: negative arc/ellipse radii, negative radial-gradient radii,
   non-finite gradients and transforms, out-of-range colour-stop offsets, unknown
   pattern repetitions.  A real browser throws on those, which aborts the whole
   render frame, so they have to be caught in tests instead of on a player's phone.
   Pass { strict: true, onViolation(fn) } to install() to emulate that. */
const FINITE_ARGS = {
  arc: [0, 1, 2, 3, 4], arcTo: [0, 1, 2, 3, 4], ellipse: [0, 1, 2, 3, 4, 5, 6],
  moveTo: [0, 1], lineTo: [0, 1], quadraticCurveTo: [0, 1, 2, 3], bezierCurveTo: [0, 1, 2, 3, 4, 5],
  rect: [0, 1, 2, 3], roundRect: [0, 1, 2, 3, 4], fillRect: [0, 1, 2, 3], strokeRect: [0, 1, 2, 3],
  clearRect: [0, 1, 2, 3], translate: [0, 1], scale: [0, 1], rotate: [0], transform: [0, 1, 2, 3, 4, 5],
  setTransform: [0, 1, 2, 3, 4, 5], resetTransform: [], createLinearGradient: [0, 1, 2, 3],
  createRadialGradient: [0, 1, 2, 3, 4, 5], createConicGradient: [1, 2, 3, 4],
  fillText: [1, 2], strokeText: [1, 2], isPointInPath: [0, 1], setLineDash: null,
};
const NEGATIVE_RADIUS = { arc: [2], arcTo: [4], ellipse: [2, 3], createRadialGradient: [2, 5] };
const COLOR_SETTERS = ['fillStyle', 'strokeStyle', 'shadowColor'];
const REPETITIONS = ['repeat', 'repeat-x', 'repeat-y', 'no-repeat', ''];

function makeValidator(window, report) {
  const probe = window.document.createElement('span');
  function validColor(v) {
    if (typeof v !== 'string') return true;             // gradient / pattern objects
    if (v === 'none' || v === 'currentColor') return true;
    const st = probe.style;
    st.color = '';
    st.color = v;
    return st.color !== '';
  }
  const isNum = v => typeof v === 'number';
  const bad = v => isNum(v) && !Number.isFinite(v);

  return {
    // returns true if the call would throw in a real browser
    check(method, args) {
      const stack = new Error().stack;
      const flag = msg => { report({ method, args: args.map(a => (typeof a === 'object' ? typeof a : a)), msg, stack }); return true; };
      if (method === 'addColorStop') {
        const off = args[0], col = args[1];
        if (bad(off) || (isNum(off) && (off < 0 || off > 1))) return flag('addColorStop offset outside 0..1: ' + off);
        if (!validColor(col)) return flag('addColorStop with invalid colour: ' + JSON.stringify(col));
        return false;
      }
      if (method === 'createPattern') {
        const rep = args[1];
        if (typeof rep === 'string' && REPETITIONS.indexOf(rep) < 0) return flag('createPattern repetition: ' + JSON.stringify(rep));
        return false;
      }
      const idx = FINITE_ARGS[method];
      if (method === 'setLineDash' && Array.isArray(args[0]) && args[0].some(bad)) return flag('setLineDash with a non-finite value');
      if (idx) {
        for (const i of idx) if (bad(args[i])) return flag('non-finite argument ' + i + ': ' + args[i]);
      }
      const neg = NEGATIVE_RADIUS[method];
      if (neg) {
        for (const i of neg) if (isNum(args[i]) && args[i] < 0) return flag('negative radius argument ' + i + ': ' + args[i]);
      }
      return false;
    },
    checkSet(prop, value) {
      if (COLOR_SETTERS.indexOf(prop) >= 0 && !validColor(value)) {
        report({ method: prop + ' =', args: [value], msg: prop + ' set to an invalid colour (browser ignores it, so the shape is drawn in the old colour)', stack: new Error().stack });
        return true;
      }
      if ((prop === 'globalAlpha' || prop === 'lineWidth' || prop === 'shadowBlur' || prop === 'lineDashOffset' || prop === 'miterLimit') && bad(value)) {
        report({ method: prop + ' =', args: [value], msg: prop + ' set to a non-finite value', stack: new Error().stack });
        return true;
      }
      return false;
    },
  };
}

function install(window, opts) {
  opts = opts || {};
  const store = new Map();
  const violator = opts.strict ? makeValidator(window, opts.onViolation || (() => { })) : null;

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
          return typeof v === 'function' ? (...a) => {
            if (violator) violator.check(k, a);
            return v.apply(c, a);
          } : v;
        },
        set(_, k, v) {
          if (violator) violator.checkSet(k, v);
          if (holder.ctx) holder.ctx[k] = v;
          return true;
        },
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
