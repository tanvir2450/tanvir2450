import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets');
const carData = JSON.parse(await readFile(path.join(root, 'data/cars.json'), 'utf8'));
const WIDTH = 128; // 2x source for a nominal 64 px car (11.2)
const HEIGHT = 64;
const PADDING = 2;
const MAX_ATLAS = 2048;
const MAX_INITIAL_BYTES = 8 * 1024 * 1024;
const requiredLayers = ['body', 'wheels', 'lights'];
const references = new Set();

for (const car of carData.cars) {
  if (!car.art) continue; // Procedural car during the Step 2 → 10 art migration.
  for (const layer of requiredLayers) if (!car.art[layer]) throw new Error(`${car.id}: missing ${layer} layer`);
  for (const [layer, relative] of Object.entries(car.art)) {
    if (![...requiredLayers, 'decals'].includes(layer)) throw new Error(`${car.id}: unknown art layer ${layer}`);
    if (!/^cars\/[a-z0-9_]+\.png$/.test(relative)) throw new Error(`${car.id}: bad ${layer} path: ${relative}`);
    if (references.has(relative)) throw new Error(`Duplicate art reference: ${relative}`);
    references.add(relative);
    const source = path.join(assets, 'cars/source', path.basename(relative, '.png') + '.svg');
    const target = path.join(assets, relative);
    const svg = await readFile(source); // Fail instead of silently packing missing art.
    const png = await sharp(svg).resize(WIDTH, HEIGHT, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(target, png);
  }
}
if (!references.size) throw new Error('No car art references found; refusing to write an empty atlas');

const frames = [...references].sort();
const columns = Math.max(1, Math.ceil(Math.sqrt(frames.length * (HEIGHT + PADDING * 2) / (WIDTH + PADDING * 2))));
const rows = Math.ceil(frames.length / columns);
const powerOfTwo = (n) => 2 ** Math.ceil(Math.log2(n));
const atlasWidth = powerOfTwo(columns * (WIDTH + PADDING * 2));
const atlasHeight = powerOfTwo(rows * (HEIGHT + PADDING * 2));
if (atlasWidth > MAX_ATLAS || atlasHeight > MAX_ATLAS) throw new Error(`Atlas ${atlasWidth}x${atlasHeight} exceeds mobile 2048px limit; split into district atlases`);

const atlasFrames = {};
const composites = frames.map((name, index) => {
  const x = PADDING + (index % columns) * (WIDTH + PADDING * 2);
  const y = PADDING + Math.floor(index / columns) * (HEIGHT + PADDING * 2);
  atlasFrames[name] = {
    frame: { x, y, w: WIDTH, h: HEIGHT }, rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: WIDTH, h: HEIGHT }, sourceSize: { w: WIDTH, h: HEIGHT },
  };
  return { input: path.join(assets, name), left: x, top: y };
});
const output = path.join(assets, 'textures');
await mkdir(output, { recursive: true });
await sharp({ create: { width: atlasWidth, height: atlasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(path.join(output, 'atlas.png'));
const atlas = {
  frames: atlasFrames,
  meta: { app: 'Neon Drive asset packer', version: '1.0', image: 'atlas.png', format: 'RGBA8888', size: { w: atlasWidth, h: atlasHeight }, scale: '1' },
};
await writeFile(path.join(output, 'atlas.json'), JSON.stringify(atlas, null, 2) + '\n');
const bytes = (await stat(path.join(output, 'atlas.png'))).size;
if (bytes > MAX_INITIAL_BYTES) throw new Error(`Initial atlas exceeds 8 MB: ${bytes} bytes`);
console.log(`Packed ${frames.length} layers for ${carData.cars.filter(car => car.art).length} cars → ${atlasWidth}x${atlasHeight} (${(bytes / 1024).toFixed(1)} KiB)`);
