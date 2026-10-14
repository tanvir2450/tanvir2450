#!/usr/bin/env node
/**
 * shot.mjs - renders real game frames to a PNG, headlessly.
 *
 * The test suite boots the front-end against a stub DOM with a *fake* 2D
 * context, so nothing in it can tell you what the game looks like. This tool
 * swaps that fake context for a real one (`@napi-rs/canvas`, an optional
 * dependency) and renders the actual `Renderer`, so a visual change can be
 * checked - and screenshotted for a report - without a browser.
 *
 * Usage:
 *   node tools/shot.mjs                                  # Apex Loop, demo, 10 s in
 *   node tools/shot.mjs --track grounds --seconds 6 --out shot.png
 *   node tools/shot.mjs --width 900 --height 480 --dpr 2 --zoom wide
 *
 * If `@napi-rs/canvas` is not installed the tool explains how to add it and
 * exits cleanly - it is a nicety, not a dependency of the game.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let createCanvas;
let Path2D;
try {
  ({ createCanvas, Path2D } = await import('@napi-rs/canvas'));
} catch {
  console.log('tools/shot.mjs needs a real 2D canvas backend. Install it with:\n  npm install --no-save @napi-rs/canvas\n');
  process.exit(0);
}

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const width = Number(arg('width', 900));
const height = Number(arg('height', 480));
const dpr = Number(arg('dpr', 2));
const seconds = Number(arg('seconds', 10));
const trackId = arg('track', null);
const zoom = arg('zoom', null);
const out = arg('out', path.join(ROOT, '.scratch', `shot-${trackId ?? 'apex'}.png`));

const { setupDom, stubFetch } = await import('../tests/dom-stub.mjs');
const dom = setupDom();

// Real canvases for everything the renderer creates (the game canvas, the
// minimap, the tachometer, and the offscreen canvases it builds internally).
const realCanvases = new Map();
const realCreateElement = globalThis.document.createElement.bind(globalThis.document);
globalThis.document.createElement = (tag) => (String(tag).toLowerCase() === 'canvas' ? createCanvas(64, 64) : realCreateElement(tag));
globalThis.Path2D = Path2D;
globalThis.fetch = stubFetch(readFileSync, ROOT);
globalThis.window.devicePixelRatio = dpr;

const realContextFor = (element, w, h) => {
  let canvas = realCanvases.get(element);
  if (!canvas) {
    canvas = createCanvas(w * dpr, h * dpr);
    realCanvases.set(element, canvas);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  element._ctx = ctx;
  element.width = w * dpr;
  element.height = h * dpr;
  element._clientWidth = w;
  element._clientHeight = h;
  return canvas;
};

const { boot } = await import('../src/boot.js');
const apex = await boot();
if (!apex) {
  console.error('the game failed to boot');
  process.exit(1);
}
const G = () => apex.game;

const gameCanvas = realContextFor(document.getElementById('game'), width, height);
realContextFor(document.getElementById('minimap'), 190, 120);
realContextFor(document.getElementById('tach'), 170, 150);
apex.renderer.ctx = document.getElementById('game').getContext('2d');
apex.renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
G().onResize();

if (trackId) {
  const list = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tracks.json'), 'utf8')).tracks;
  const wanted = list.find((t) => t.id === trackId);
  if (!wanted) {
    console.error(`no track "${trackId}" in data/tracks.json (${list.map((t) => t.id).join(', ')})`);
    process.exit(1);
  }
  for (let i = 0; i < list.length && G().track.name !== wanted.name; i++) await apex.switchCircuit(1);
}
if (zoom === 'close' || zoom === 'wide') G().handleActions(['camera']);

// Drive it: the autopilot, so the shot is mid-corner rather than on the grid.
G().handleActions(['autopilot']);
const frames = Math.max(1, Math.round((seconds * 1000) / 16.7));
let clock = 1000;
for (let i = 0; i < frames; i++) {
  clock += 16.7;
  G().frame(clock);
}

writeFileSync(out, await gameCanvas.encode('png'));
const car = G().car;
console.log(
  `${out} - ${G().track.name}, ${(car.speedMs * 3.6).toFixed(0)} kph, slip ${car.slipAngleBodyDeg.toFixed(1)}deg, ` +
    `${car.telemetry().engine.gear} gear, surface ${car.currentSurface?.id}, ${frames} frames`
);
dom.restore();
