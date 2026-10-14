import * as Phaser from 'phaser';
import { debugEnabled } from './core/debug';
import { getRenderScale, keepCanvasFitted, measureGameSize } from './core/display';
import { PlaceholderScene } from './scenes/PlaceholderScene';

// Keep the browser's own gestures out of the way so every touch reaches the game.
document.addEventListener('gesturestart', (event) => event.preventDefault()); // iOS pinch-zoom
document.addEventListener('contextmenu', (event) => event.preventDefault()); // long-press / right-click menu

const container = document.getElementById('game');
if (!container) throw new Error('Missing #game container in index.html');

const game = new Phaser.Game({
  type: Phaser.AUTO, // WebGL where available, Canvas 2D as the fallback
  parent: container,
  backgroundColor: '#070a14',

  // NONE + zoom = we own the canvas size (device pixels), see src/core/display.ts.
  scale: {
    mode: Phaser.Scale.NONE,
    ...measureGameSize(container),
    zoom: 1 / getRenderScale(),
  },

  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },

  // Steering and nitro/gadget buttons are used at the same time: allow several fingers.
  input: { activePointers: 3 },

  // No sound until milestone 9. Skipping audio also avoids browsers' "AudioContext was not
  // allowed to start" warning before the first tap.
  audio: { noAudio: true },

  scene: [PlaceholderScene],
});

keepCanvasFitted(game, container);

if (debugEnabled) window.__game = game;
