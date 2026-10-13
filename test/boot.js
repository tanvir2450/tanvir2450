/* Shared jsdom bootstrap: loads index.html + game scripts with a stubbed canvas. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { install, stubAudio, pump } = require('./canvasAdapter');

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
  const adapter = install(window);
  stubAudio(window);
  const frame = pump(window);
  Object.defineProperty(window, 'innerWidth', { value: 960, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 540, writable: true, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true });
  const errors = [];
  window.addEventListener('error', e => errors.push('error: ' + e.message));
  for (const f of files) window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  window.dispatchEvent(new window.Event('load'));
  return { window, frame, GAME: window.GAME, dom, adapter, errors };
}
module.exports = { boot };
