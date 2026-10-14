import * as Phaser from 'phaser';

const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 2;

/**
 * Canvas pixels rendered per CSS pixel.
 *
 * Phaser 3 has no built-in high-DPI support (the `resolution` option was removed in 3.60), so
 * we size the canvas ourselves: game size = CSS size x render scale, canvas zoom = 1 / render
 * scale. Scenes then set their camera zoom to the render scale, which keeps **world units equal
 * to CSS pixels** in game code while the picture stays crisp on retina screens.
 *
 * Capped at 2: a 3x phone would push 2.25x the pixels of a 2x one for almost no visible gain,
 * and fill-rate is the main thing a mid-range phone GPU runs out of.
 * `?dpr=1.5` overrides the device value (useful when profiling performance).
 */
export function getRenderScale(): number {
  const override = Number.parseFloat(new URLSearchParams(window.location.search).get('dpr') ?? '');
  const wanted = Number.isFinite(override) && override > 0 ? override : window.devicePixelRatio || 1;
  return Phaser.Math.Clamp(wanted, MIN_RENDER_SCALE, MAX_RENDER_SCALE);
}

/**
 * Re-rasterise a Text object for a new render scale.
 *
 * Create Text with `resolution: getRenderScale()` in its style. Use this helper only when the
 * scale changes later (browser zoom): Phaser's own `setResolution()` updates what the WebGL
 * renderer reads (`style.resolution`) but not what the Canvas renderer reads
 * (`frame.source.resolution`, captured in the constructor), so on the Canvas fallback the text
 * would be drawn at the wrong size.
 */
export function setTextResolution(text: Phaser.GameObjects.Text, scale: number): void {
  text.setResolution(scale);
  text.frame.source.resolution = scale;
}

/** Canvas size in device pixels for a container, at the current render scale. */
export function measureGameSize(container: HTMLElement): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const scale = getRenderScale();
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

/**
 * Keeps the canvas matched to its container: window resizes, phone rotation, iOS toolbars
 * sliding in and out, browser zoom. Fires Phaser's `resize` event, which scenes listen to
 * (see PlaceholderScene.layout) to re-centre themselves.
 */
export function keepCanvasFitted(game: Phaser.Game, container: HTMLElement): void {
  let applied = '';

  const fit = (): void => {
    const scale = getRenderScale();
    const { width, height } = measureGameSize(container);
    const key = `${width}x${height}@${scale}`;
    if (key === applied) return;
    applied = key;

    if (game.scale.zoom !== 1 / scale) game.scale.setZoom(1 / scale);
    game.scale.resize(width, height);
  };

  new ResizeObserver(fit).observe(container);
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  fit();
}
