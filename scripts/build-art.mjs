#!/usr/bin/env node
/**
 * Rasterises every SVG under art/ to a PNG under public/assets/ (same relative path).
 *
 *   art/cars/starter.svg  ->  public/assets/cars/starter.png
 *
 * Each SVG is rendered at its own width/height (the PNG is the 1:1 runtime sprite), so the
 * size of the sprite is decided in the SVG. Run with:  npm run art
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'art');
const outDir = join(root, 'public', 'assets');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.svg')) yield path;
  }
}

let count = 0;
for await (const svgPath of walk(srcDir)) {
  const svg = await readFile(svgPath);
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render();
  const outPath = join(outDir, relative(srcDir, svgPath).replace(/\.svg$/, '.png'));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, png.asPng());
  console.log(`${relative(root, svgPath)} -> ${relative(root, outPath)} (${png.width}x${png.height})`);
  count++;
}
console.log(`Rendered ${count} sprite(s).`);
