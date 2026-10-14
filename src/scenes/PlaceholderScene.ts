import * as Phaser from 'phaser';
import { assetUrl } from '../core/assets';
import { markReady, showFatalError } from '../core/boot';
import { debugEnabled } from '../core/debug';
import { getRenderScale, setTextResolution } from '../core/display';

const CAR_TEXTURE = 'car-starter';
const GLOW_TEXTURE = 'glow';

const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Milestone 1 placeholder: proves the toolchain end to end on a real device.
 *
 *   load a PNG through Phaser's loader -> draw it -> animate it -> react to touch/mouse,
 *   at the right size and sharpness for the screen, in portrait and landscape.
 *
 * Coordinates: world units are CSS pixels (the camera zoom is the render scale, see
 * src/core/display.ts), with (0,0) at the top-left of the screen.
 */
export class PlaceholderScene extends Phaser.Scene {
  private car!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.Image;
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private panel?: Phaser.GameObjects.Text;
  private readonly texts: Phaser.GameObjects.Text[] = [];
  private textScale = 1;

  /** Extra heading (degrees) added by the tap-to-spin tween. */
  private readonly pose = { spin: 0 };
  private spinTween?: Phaser.Tweens.Tween;
  private taps = 0;
  private centerX = 0;
  private centerY = 0;

  constructor() {
    super({ key: 'Placeholder' });
  }

  preload(): void {
    // A missing file must be loud: show it on screen instead of a blank canvas.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      showFatalError(`Could not load ${file.key} (${String(file.url)})`);
    });
    this.load.image(CAR_TEXTURE, assetUrl('cars/starter.png'));
  }

  create(): void {
    if (!this.textures.exists(CAR_TEXTURE)) return; // load failed; the error is already on screen

    createGlowTexture(this, '255,46,136');
    this.glow = this.add.image(0, 0, GLOW_TEXTURE).setBlendMode(Phaser.BlendModes.ADD);
    this.car = this.add.image(0, 0, CAR_TEXTURE);

    this.title = this.makeText('RACING-ACTION GAME', {
      fontFamily: UI_FONT,
      fontStyle: '800',
      color: '#ffffff',
    })
      .setOrigin(0.5)
      .setShadow(0, 0, '#ff2e88', 14, true, true);
    this.subtitle = this.makeText('MILESTONE 1 · PROJECT SETUP', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#5fe3ff',
    }).setOrigin(0.5);
    this.hint = this.makeText(this.sys.game.device.input.touch ? 'TAP ANYWHERE' : 'CLICK ANYWHERE', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#9aa7d6',
    })
      .setOrigin(0.5)
      .setAlpha(0.8);

    if (debugEnabled) {
      this.panel = this.makeText('', {
        fontFamily: MONO_FONT,
        fontSize: '12px',
        color: '#7fe9ff',
        lineSpacing: 4,
      })
        .setOrigin(0, 1)
        .setAlpha(0.85);
      this.time.addEvent({ delay: 250, loop: true, callback: this.updatePanel, callbackScope: this });
    }

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onTap, this);

    this.updatePanel();
    markReady();
  }

  override update(time: number): void {
    if (!this.car) return;
    const t = time / 1000;
    // Idle "cruising" motion: a steady loop makes dropped frames easy to spot by eye.
    this.car.setPosition(this.centerX, this.centerY + Math.sin(t * 2.4) * 4);
    this.car.setAngle(this.pose.spin + Math.sin(t * 1.3) * 3);
    this.glow.setAlpha(0.55 + Math.sin(t * 2) * 0.12);
  }

  /** Re-centre everything for the current screen size / orientation / render scale. */
  private layout(): void {
    const scale = getRenderScale();
    const w = this.scale.width / scale;
    const h = this.scale.height / scale;

    const camera = this.cameras.main;
    camera.setZoom(scale);
    camera.centerOn(w / 2, h / 2);

    this.centerX = w / 2;
    this.centerY = h / 2;

    const carWidth = Phaser.Math.Clamp(Math.min(w, h) * 0.62, 150, 420);
    this.car.setScale(carWidth / this.car.width);
    this.glow.setPosition(this.centerX, this.centerY).setDisplaySize(carWidth * 1.9, carWidth * 1.1);

    const titleSize = Phaser.Math.Clamp(Math.round(w * 0.06), 20, 34);
    this.title.setFontSize(titleSize).setPosition(w / 2, Math.max(52, h * 0.14));
    this.subtitle.setPosition(w / 2, this.title.y + titleSize * 0.85 + 8);
    this.hint.setPosition(w / 2, this.centerY + carWidth / 4 + 64);
    this.panel?.setPosition(12, h - 12);

    // Text is rasterised once at its own resolution: keep it matched to the render scale.
    if (scale !== this.textScale) {
      this.textScale = scale;
      for (const text of this.texts) setTextResolution(text, scale);
    }
  }

  /** Text that stays sharp on high-DPI screens (rasterised at the render scale). */
  private makeText(
    content: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
  ): Phaser.GameObjects.Text {
    this.textScale = getRenderScale();
    const text = this.add.text(0, 0, content, { ...style, resolution: this.textScale });
    this.texts.push(text);
    return text;
  }

  private onTap(): void {
    this.taps++;
    if (this.spinTween?.isPlaying()) return;
    this.spinTween = this.tweens.add({
      targets: this.pose,
      spin: this.pose.spin + 360,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.pose.spin = 0;
      },
    });
  }

  private updatePanel(): void {
    if (!this.panel) return;
    const game = this.sys.game;
    const scale = getRenderScale();
    const renderer = game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
    const touching = game.input.pointers.filter((pointer) => pointer.isDown).length;
    const pointerKind = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
    const dpr = Number(window.devicePixelRatio.toFixed(3));

    // Short lines on purpose: a 320 px wide phone must fit them in a monospace font.
    this.panel.setText([
      `build ${__BUILD_ID__} · Phaser ${Phaser.VERSION}`,
      `${renderer} · canvas ${this.scale.width}x${this.scale.height}px`,
      `view ${Math.round(this.scale.width / scale)}x${Math.round(this.scale.height / scale)} css · x${scale} (dpr ${dpr})`,
      `${pointerKind} · fingers ${touching} · taps ${this.taps}`,
      `fps ${Math.round(game.loop.actualFps)}`,
    ]);
  }
}

/**
 * Soft radial gradient: the neon glow under the car. The colour is baked into the texture
 * (not applied with setTint) because Phaser's Canvas fallback renderer ignores tints.
 */
function createGlowTexture(scene: Phaser.Scene, rgb: string): void {
  if (scene.textures.exists(GLOW_TEXTURE)) return;
  const size = 256;
  const texture = scene.textures.createCanvas(GLOW_TEXTURE, size, size);
  if (!texture) return;
  const ctx = texture.getContext();
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${rgb},0.9)`);
  gradient.addColorStop(0.35, `rgba(${rgb},0.35)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.refresh();
}
