import Phaser from 'phaser';

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

/**
 * Phaser renders, but it does NOT run the car physics. No Arcade/Matter plugin
 * is configured: Phaser does not recognize `physics.default: 'custom'`, and
 * `physicsStep` is not a Phaser GameConfig option. The 60 Hz accumulator lives
 * in DriveScene and reads data/tuning.json (simulation.hz).
 *
 * We use RESIZE rather than FIT so landscape touch controls and the DOM HUD
 * remain usable on both phones and desktop. WebGL is the default for future
 * lighting pipelines (11.5); ?renderer=canvas is the low-end fallback.
 */
export function createGameConfig(scenes: Phaser.Scene[]): Phaser.Types.Core.GameConfig {
  const canvasRequested = new URLSearchParams(window.location.search).get('renderer') === 'canvas';
  return {
    type: canvasRequested || !canUseWebGL() ? Phaser.CANVAS : Phaser.WEBGL,
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: '#0B0F1A',
    antialias: true,
    fps: { target: 60, forceSetTimeOut: false }, // render cadence; NOT physics cadence
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { pixelArt: false, roundPixels: false },
    scene: scenes,
  };
}
