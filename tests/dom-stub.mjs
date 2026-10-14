/**
 * dom-stub.mjs - the smallest DOM + canvas stand-in that lets the real
 * front-end modules (boot / render / hud / game / input) run inside node so the
 * integration tests can exercise them. It is deliberately dumb: no layout, no
 * painting, no CSS - just enough API surface for the code paths to execute.
 */

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    names.forEach((n) => this.set.add(n));
  }
  remove(...names) {
    names.forEach((n) => this.set.delete(n));
  }
  toggle(name, force) {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name) {
    return this.set.has(name);
  }
  get value() {
    return [...this.set].join(' ');
  }
}

function makeContext2D(canvas) {
  const gradient = { addColorStop() {} };
  const target = {
    canvas,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    save() {},
    restore() {}
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return () => {};
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    }
  });
}

export class StubElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = new ClassList();
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.listeners = new Map();
    this.attributes = {};
    this.width = 300;
    this.height = 150;
    this.parentElement = null;
  }

  get clientWidth() {
    return this._clientWidth ?? 300;
  }
  set clientWidth(v) {
    this._clientWidth = v;
  }
  get clientHeight() {
    return this._clientHeight ?? 150;
  }
  set clientHeight(v) {
    this._clientHeight = v;
  }

  getContext() {
    this._ctx = this._ctx ?? makeContext2D(this);
    return this._ctx;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, width: this._clientWidth ?? 1280, height: this._clientHeight ?? 720, right: this._clientWidth ?? 1280, bottom: this._clientHeight ?? 720 };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }

  querySelectorAll(selector) {
    const wanted = selector.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
    return this.children.filter((c) => c.tagName === wanted || c.classList.contains(selector.replace('.', '')));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type, event = {}) {
    const payload = { type, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(payload);
    return payload;
  }

  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
}

export class StubWindow extends StubElement {
  constructor() {
    super('window', 'window');
    this.devicePixelRatio = 1;
    this.innerWidth = 1280;
    this.innerHeight = 720;
    this.rafCallbacks = [];
  }

  requestAnimationFrame(fn) {
    this.rafCallbacks.push(fn);
    return this.rafCallbacks.length;
  }

  cancelAnimationFrame(id) {
    this.rafCallbacks = this.rafCallbacks.filter((_, i) => i + 1 !== id);
  }
}

/**
 * Install the stubs on globalThis. Returns handles so a test can drive the
 * keyboard / inspect elements.
 *
 * @param {{canvasWidth?:number, canvasHeight?:number}} [options]
 */
export function setupDom(options = {}) {
  const elements = new Map();
  const document = {
    body: new StubElement('body', 'body'),
    elementById: elements,
    getElementById(id) {
      if (!elements.has(id)) {
        const tag = id === 'game' || id === 'tach' || id === 'minimap' ? 'canvas' : 'div';
        const element = new StubElement(tag, id);
        element.clientWidth = options.canvasWidth ?? (tag === 'canvas' ? 1280 : 200);
        element.clientHeight = options.canvasHeight ?? (tag === 'canvas' ? 720 : 160);
        elements.set(id, element);
      }
      return elements.get(id);
    },
    createElement(tag) {
      const element = new StubElement(tag);
      element.clientWidth = 64;
      element.clientHeight = 64;
      return element;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const window = new StubWindow();
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    Path2D: globalThis.Path2D
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.Path2D = class {
    constructor() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
    arc() {}
    rect() {}
    roundRect() {}
    quadraticCurveTo() {}
    bezierCurveTo() {}
  };
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (fn) => window.requestAnimationFrame(fn);
    globalThis.cancelAnimationFrame = (id) => window.cancelAnimationFrame(id);
  }

  return {
    window,
    document,
    elements,
    keydown(code) {
      window.dispatch('keydown', { code, repeat: false });
    },
    keyup(code) {
      window.dispatch('keyup', { code, repeat: false });
    },
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.fetch = previous.fetch;
      globalThis.Path2D = previous.Path2D;
    }
  };
}

/** A fetch() that reads from the repository, so boot() can load data/*.json. */
export function stubFetch(readFileSync, root) {
  return async (url) => {
    const clean = String(url).replace(/^\.?\//, '');
    const path = `${root}/${clean}`;
    try {
      const text = readFileSync(path, 'utf8');
      return {
        ok: true,
        status: 200,
        async json() {
          return JSON.parse(text);
        },
        async text() {
          return text;
        }
      };
    } catch (error) {
      return { ok: false, status: 404, async text() { return String(error.message); } };
    }
  };
}
