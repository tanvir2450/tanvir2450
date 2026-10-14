import Phaser from 'phaser';
import './style.css';
import { EngineAudio } from './audio';
import { Controls } from './controls';
import { HUD } from './hud';
import { DriveScene } from './scene';
import { validateCatalog } from './sim/catalog';
import { Simulation } from './sim/simulation';

validateCatalog();
const sim = new Simulation();
const controls = new Controls();
const audio = new EngineAudio();
let hud: HUD | undefined;
const scene = new DriveScene(sim, () => controls.read(), fps => hud?.update(fps), events => hud?.onEvents(events));
// Optional Canvas fallback for older/mobile devices (or ?renderer=canvas for QA).
const forceCanvas = new URLSearchParams(window.location.search).get('renderer') === 'canvas';
new Phaser.Game({
  type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0f1a',
  antialias: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { pixelArt: false, roundPixels: false },
  scene: [scene],
});
hud = new HUD(sim, scene, controls, audio);
