/* Regenerates assets/icon-192.png, the home-screen icon that the single-file
   build inlines. Needs the optional dev dependency @napi-rs/canvas:
       npm i --no-save @napi-rs/canvas && node tools/make-icon.mjs
   The generated PNG is committed, so building does not require this tool. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let createCanvas;
try {
  ({ createCanvas } = await import('@napi-rs/canvas'));
} catch (err) {
  console.error('This tool needs @napi-rs/canvas:  npm i --no-save @napi-rs/canvas');
  process.exit(1);
}

const S = 192;
const c = createCanvas(S, S);
const g = c.getContext('2d');

// background
const bg = g.createLinearGradient(0, 0, 0, S);
bg.addColorStop(0, '#0b1030');
bg.addColorStop(1, '#04050c');
g.fillStyle = bg;
g.fillRect(0, 0, S, S);

// frame
g.strokeStyle = 'rgba(70,224,255,0.5)';
g.lineWidth = 6;
g.strokeRect(3, 3, S - 6, S - 6);

// neon ring, drawn twice: blurred bloom then crisp
const ring = () => {
  g.beginPath();
  g.arc(S / 2, S / 2, 62, 0, Math.PI * 2);
  g.stroke();
};
g.strokeStyle = '#46e0ff';
g.lineWidth = 9;
g.filter = 'blur(9px)';
g.globalAlpha = 0.9;
ring();
g.filter = 'none';
g.globalAlpha = 1;
ring();

// dots on the ring
g.fillStyle = '#3f57ff';
for (const a of [0.35, 0.75, 1.15]) {
  g.beginPath();
  g.arc(S / 2 + Math.cos(Math.PI * 2 * a) * 62, S / 2 + Math.sin(Math.PI * 2 * a) * 62, 7, 0, Math.PI * 2);
  g.fill();
}

// the disc, mouth open
g.save();
g.translate(S / 2, S / 2);
g.fillStyle = '#ffe14d';
g.shadowColor = 'rgba(255,225,77,0.95)';
g.shadowBlur = 26;
g.beginPath();
g.moveTo(0, 0);
g.arc(0, 0, 36, 0.34, Math.PI * 2 - 0.34);
g.closePath();
g.fill();
g.restore();

const out = path.join(root, 'assets/icon-192.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log('wrote', path.relative(root, out), fs.statSync(out).size, 'bytes');
