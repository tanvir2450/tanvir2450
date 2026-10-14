import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { catalog } from '../src/physics/catalog';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets');
const atlas = JSON.parse(readFileSync(path.join(assets, 'textures/atlas.json'), 'utf8')) as {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number } };
};
const atlasImage = path.join(assets, 'textures/atlas.png');
const references = catalog.cars.flatMap(car => car.art ? Object.values(car.art) : []);

describe('2x car art and core atlas', () => {
  it('backs every art reference with a named SVG source and exported 2x PNG', async () => {
    expect(references).toHaveLength(6);
    expect(new Set(references).size).toBe(references.length);
    for (const reference of references) {
      expect(reference).toMatch(/^cars\/(falcon|tank)_(body|wheels|lights)\.png$/);
      expect(existsSync(path.join(assets, 'cars/source', path.basename(reference, '.png') + '.svg'))).toBe(true);
      const png = path.join(assets, reference);
      expect(existsSync(png)).toBe(true);
      expect((await sharp(png).metadata()).width).toBe(128);
      expect((await sharp(png).metadata()).height).toBe(64);
    }
  });

  it('packs all referenced layers into nonempty, in-bounds atlas frames', async () => {
    expect(Object.keys(atlas.frames).sort()).toEqual([...references].sort());
    expect(atlas.meta.image).toBe('atlas.png');
    const meta = await sharp(atlasImage).metadata();
    expect(meta.width).toBe(atlas.meta.size.w);
    expect(meta.height).toBe(atlas.meta.size.h);
    expect(meta.width).toBeLessThanOrEqual(2048);
    expect(meta.height).toBeLessThanOrEqual(2048);
    for (const reference of references) {
      const { x, y, w, h } = atlas.frames[reference].frame;
      expect(w).toBe(128); expect(h).toBe(64);
      expect(x).toBeGreaterThanOrEqual(2); expect(y).toBeGreaterThanOrEqual(2);
      expect(x + w).toBeLessThanOrEqual(meta.width!);
      expect(y + h).toBeLessThanOrEqual(meta.height!);
      const pixels = await sharp(atlasImage).extract({ left: x, top: y, width: w, height: h }).ensureAlpha().raw().toBuffer();
      expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    }
  });

  it('keeps the core car atlas well below the 8 MiB initial-load budget', () => {
    expect(statSync(atlasImage).size + statSync(path.join(assets, 'textures/atlas.json')).size).toBeLessThan(8 * 1024 * 1024);
  });
});
