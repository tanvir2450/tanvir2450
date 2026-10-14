#!/usr/bin/env node
/**
 * render-track.mjs - draws a data/track.json to a PNG so a layout can be
 * eyeballed without launching the game (SECTION 9.12: tune the geometry, then
 * the car).
 *
 * It is deliberately dependency-free: the image is written by hand (zlib +
 * PNG chunks) and the road is stamped as discs along the centre line, so the
 * preview shows exactly the geometry the world builder will derive - road
 * width, run-off, verge, every surface patch and every scenery item.
 *
 * Usage:
 *   node tools/render-track.mjs                     # every track in data/
 *   node tools/render-track.mjs data/test-track.json --out .scratch/test-track.png
 *   node tools/render-track.mjs --width 1400
 */

import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

/* ------------------------------------------------------------------ *
 * a very small PNG writer (RGBA, no filtering)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ *
 * a tiny raster surface
 * ------------------------------------------------------------------ */

function createSurface(width, height, background) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = background[0];
    pixels[i * 4 + 1] = background[1];
    pixels[i * 4 + 2] = background[2];
    pixels[i * 4 + 3] = 255;
  }
  return { width, height, pixels };
}

function blend(surface, x, y, color, alpha = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const i = (y * surface.width + x) * 4;
  const p = surface.pixels;
  p[i] = Math.round(p[i] + (color[0] - p[i]) * alpha);
  p[i + 1] = Math.round(p[i + 1] + (color[1] - p[i + 1]) * alpha);
  p[i + 2] = Math.round(p[i + 2] + (color[2] - p[i + 2]) * alpha);
}

function disc(surface, cx, cy, radius, color) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(surface.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(surface.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) blend(surface, x, y, color);
    }
  }
}

/** Stamp a thick polyline: the same trick the world builder uses for a road. */
function thickPath(surface, points, radiusM, color, scale) {
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * scale));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(surface, (ax + (bx - ax) * t) * scale + surface.offsetX, (ay + (by - ay) * t) * scale + surface.offsetY, radiusM * scale, color);
    }
  }
}

function rect(surface, cx, cy, lengthM, widthM, angleRad, color, alpha = 0.85) {
  const scale = surface.scale;
  const cos = Math.cos(-angleRad);
  const sin = Math.sin(-angleRad);
  const halfL = (lengthM / 2) * scale;
  const halfW = (widthM / 2) * scale;
  const px = cx * scale + surface.offsetX;
  const py = cy * scale + surface.offsetY;
  for (let u = -halfL; u <= halfL; u += 0.7) {
    for (let v = -halfW; v <= halfW; v += 0.7) {
      const x = px + u * cos - v * sin;
      const y = py + u * sin + v * cos;
      blend(surface, x, y, color, alpha);
    }
  }
}

/* ------------------------------------------------------------------ */

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

async function render(trackPath, outPath, width) {
  const track = JSON.parse(await readFile(trackPath, 'utf8'));
  const surfaces = JSON.parse(await readFile(path.join(DATA, 'surfaces.json'), 'utf8')).surfaces;

  const xs = track.centreline.map((p) => p.x);
  const ys = track.centreline.map((p) => p.y);
  const margin = (track.widthM / 2 + track.runoffM + track.grassM) * 2;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  const scale = width / (maxX - minX);
  const height = Math.max(64, Math.round((maxY - minY) * scale));

  const surface = createSurface(width, height, hexToRgb(surfaces.grass?.render?.fill ?? '#1e2a1e'));
  surface.scale = scale;
  surface.offsetX = -minX * scale;
  surface.offsetY = -minY * scale;

  const centre = track.centreline.map((p) => [p.x, p.y]);
  const roadColor = hexToRgb(surfaces[track.baseSurface]?.render?.fill ?? '#3a3f46');
  const runoffColor = hexToRgb(surfaces[track.runoffSurface]?.render?.fill ?? '#6b5a44');

  // verge, run-off, then the road itself: widest first, exactly like the world
  thickPath(surface, centre, track.widthM / 2 + track.runoffM + track.grassM, hexToRgb('#25301f'), scale);
  thickPath(surface, centre, track.widthM / 2 + track.runoffM, runoffColor, scale);
  thickPath(surface, centre, track.widthM / 2, roadColor, scale);

  // centre line, so the racing line is readable
  for (let i = 0; i < centre.length; i++) {
    const a = centre[i];
    const b = centre[(i + 1) % centre.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * scale));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      blend(surface, (a[0] + (b[0] - a[0]) * t) * scale + surface.offsetX, (a[1] + (b[1] - a[1]) * t) * scale + surface.offsetY, [255, 255, 255], 0.35);
    }
  }

  // surface patches, in the track's own order (later ones win, like the grid)
  for (const patch of track.patches ?? []) {
    const def = surfaces[patch.surface];
    const color = hexToRgb(def?.render?.fill ?? '#888888');
    rect(surface, patch.x, patch.y, patch.lengthM, patch.widthM, ((patch.angleDeg ?? 0) * Math.PI) / 180, color, 0.9);
  }

  // scenery: cones in the surface accent colour, tyres brighter
  for (const item of track.decor ?? []) {
    const color = item.type === 'cone' ? [255, 138, 61] : [210, 210, 220];
    disc(surface, item.x * scale + surface.offsetX, item.y * scale + surface.offsetY, Math.max(1.5, 1.1 * scale), color);
  }

  // start/finish: a white bar across the road plus an arrow for the heading
  const heading = ((track.start.headingDeg ?? 0) * Math.PI) / 180;
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  for (let t = -track.widthM / 2; t <= track.widthM / 2; t += 0.4) {
    const x = (track.start.x + nx * t) * scale + surface.offsetX;
    const y = (track.start.y + ny * t) * scale + surface.offsetY;
    disc(surface, x, y, Math.max(1.5, 0.9 * scale), [255, 255, 255]);
  }
  for (let t = 0; t <= 12; t += 0.5) {
    disc(
      surface,
      (track.start.x + Math.cos(heading) * t) * scale + surface.offsetX,
      (track.start.y + Math.sin(heading) * t) * scale + surface.offsetY,
      Math.max(1.5, 1.1 * scale),
      [46, 230, 255]
    );
  }

  await writeFile(outPath, encodePng(width, height, surface.pixels));
  const length = centre.reduce((sum, p, i) => sum + Math.hypot(centre[(i + 1) % centre.length][0] - p[0], centre[(i + 1) % centre.length][1] - p[1]), 0);
  console.log(`${track.name}: ${Math.round(length)} m lap, ${(track.patches ?? []).length} patches -> ${outPath} (${width}x${height})`);
}

const args = process.argv.slice(2);
const widthIndex = args.indexOf('--width');
const width = widthIndex >= 0 ? Number(args[widthIndex + 1]) : 900;
const outIndex = args.indexOf('--out');
const files = args.filter((a, i) => !a.startsWith('--') && i !== widthIndex + 1 && i !== outIndex + 1);
const targets = files.length ? files : [path.join(DATA, 'track.json'), path.join(DATA, 'test-track.json')];

for (const file of targets) {
  const base = path.basename(file).replace(/\.json$/, '');
  const out = outIndex >= 0 && targets.length === 1 ? args[outIndex + 1] : path.join(HERE, '..', '.scratch', `${base}.png`);
  await render(path.resolve(file), path.resolve(out), width);
}
