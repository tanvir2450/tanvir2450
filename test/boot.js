/* Shared jsdom bootstrap: loads index.html + game scripts with a stubbed canvas. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function makeCtx() {
  const grad = { addColorStop() { } };
  return {
    canvas: null, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', filter: 'none',
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null,
    measureText: (t) => ({ width: String(t).length * 6 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    save() { }, restore() { }, translate() { }, scale() { }, rotate() { }, transform() { }, setTransform() { }, resetTransform() { },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, quadraticCurveTo() { }, bezierCurveTo() { },
    arc() { }, arcTo() { }, ellipse() { }, rect() { }, roundRect() { }, fill() { }, stroke() { }, clip() { },
    fillRect() { }, strokeRect() { }, clearRect() { }, fillText() { }, strokeText() { },
    drawImage() { }, setLineDash() { }, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    isPointInPath: () => false,
  };
}

function boot() {
  const root = path.join(__dirname, '..');
  const files = ['js/data.js', 'js/audio.js', 'js/art.js', 'js/fx.js', 'js/fighter.js', 'js/ai.js', 'js/battle.js', 'js/ui.js', 'js/game.js'];
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) { this.__ctx = makeCtx(); this.__ctx.canvas = this; }
    return this.__ctx;
  };
  class FakeParam { constructor() { this.value = 0; } setValueAtTime() { } linearRampToValueAtTime() { } exponentialRampToValueAtTime() { } cancelScheduledValues() { } }
  class FakeNode { constructor() { this.gain = new FakeParam(); this.frequency = new FakeParam(); this.detune = new FakeParam(); this.Q = new FakeParam(); this.pan = new FakeParam(); } connect() { } disconnect() { } start() { } stop() { } }
  window.AudioContext = class {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = new FakeNode(); }
    resume() { } createGain() { return new FakeNode(); } createOscillator() { return new FakeNode(); }
    createBiquadFilter() { return new FakeNode(); } createBufferSource() { return new FakeNode(); }
    createStereoPanner() { return new FakeNode(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  };
  const rafQueue = [];
  window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  window.cancelAnimationFrame = () => { };
  if (!window.PointerEvent) window.PointerEvent = class extends window.MouseEvent { constructor(t, o = {}) { super(t, o); this.pointerId = o.pointerId || 1; this.pointerType = o.pointerType || 'touch'; } };
  for (const f of files) window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  const errors = [];
  window.addEventListener('error', e => errors.push('error: ' + e.message));
  window.dispatchEvent(new window.Event('load'));
  let t = 0;
  function frame(n = 1, dt = 16.7) {
    for (let i = 0; i < n; i++) {
      t += dt;
      const q = rafQueue.splice(0, rafQueue.length);
      for (const cb of q) cb(t);
    }
  }
  return { window, frame, GAME: window.GAME, dom, errors };
}
module.exports = { boot };
