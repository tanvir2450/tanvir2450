/* Renders the same battle at several device shapes to check view framing. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { install, stubAudio, pump } = require('./canvasAdapter');
const root = path.join(__dirname, '..');
const files = ['js/data.js', 'js/audio.js', 'js/art.js', 'js/fx.js', 'js/fighter.js', 'js/ai.js', 'js/battle.js', 'js/ui.js', 'js/game.js'];
const DEVICES = [
  { name: 'iphone-portrait', w: 390, h: 844, dpr: 3 },
  { name: 'iphone-landscape', w: 844, h: 390, dpr: 3 },
  { name: 'tablet', w: 834, h: 1112, dpr: 2 },
  { name: 'desktop', w: 1280, h: 720, dpr: 1 },
  { name: 'small-android', w: 360, h: 640, dpr: 3 },
];

function boot(W, H, DPR) {
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, ''),
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://e.test/' });
  const { window } = dom;
  const adapter = install(window);
  stubAudio(window);
  Object.defineProperty(window, 'innerWidth', { value: W, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: H, writable: true, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: DPR, writable: true, configurable: true });
  const frame = pump(window);
  for (const f of files) window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  window.dispatchEvent(new window.Event('load'));
  const GAME = window.GAME;
  return { window, GAME, frame, adapter, canvas: window.document.getElementById('game-canvas') };
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
for (const d of DEVICES) {
  const { window, GAME, frame, adapter, canvas } = boot(d.w, d.h, d.dpr);
  GAME.save.upgrades.luffy = { vitality: 3, power: 4, spirit: 2 };
  GAME.selectedChar = 'luffy';
  GAME.startBattle(0, 5);
  GAME.world.introTimer = 0;
  frame(75);
  GAME.world.player.hurtFlash = 0;          // no flash in the still
  GAME.render();
  const shot = adapter.createCanvas(GAME.canvas.width, GAME.canvas.height);
  shot.getContext('2d').drawImage(adapter.get(canvas), 0, 0);   // backing matches canvas.width/height
  const small = adapter.createCanvas(d.w, d.h);
  small.getContext('2d').drawImage(shot, 0, 0, shot.width, shot.height, 0, 0, d.w, d.h);
  fs.writeFileSync(path.join(__dirname, 'out', 'device-' + d.name + '.png'), small.toBuffer('image/png'));
  console.log(`${d.name.padEnd(18)} css ${d.w}x${d.h} dpr${d.dpr} -> view ${GAME.view.w.toFixed(0)}x${GAME.view.h.toFixed(0)} units, yOffset ${GAME.view.yOffset.toFixed(0)}, scale ${GAME.scale.toFixed(2)}`);
}
process.exit(0);
