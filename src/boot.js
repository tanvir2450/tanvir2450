/**
 * boot.js - wiring: fetch the JSON data, build the config/track, create the
 * renderer / HUD / input / audio, and start the game loop.
 *
 * Kept separate from main.js so tooling and tests can import this module
 * without touching the DOM.
 */

import { createConfig } from './config.js';
import { buildTrack } from './track.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { InputManager } from './input.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';

/** Every DOM id the HUD touches. tests/hud.test.js checks them against index.html. */
export const HUD_ELEMENT_IDS = {
  game: 'game',
  tach: 'tach',
  speed: 'speed',
  gear: 'gear',
  rpmDigital: 'rpm-digital',
  power: 'power',
  lapTime: 'lap-time',
  bestLap: 'best-lap',
  lastLap: 'last-lap',
  lastLapRow: 'last-lap-row',
  lapCount: 'lap-count',
  gripFront: 'grip-front',
  gripRear: 'grip-rear',
  surface: 'surface',
  wheelspin: 'wheelspin',
  nitroFill: 'nitro-fill',
  nitroState: 'nitro-state',
  healthFill: 'health-fill',
  healthValue: 'health-value',
  zoneFront: 'zone-front',
  zoneRear: 'zone-rear',
  zoneLeft: 'zone-left',
  zoneRight: 'zone-right',
  damageNote: 'damage-note',
  coins: 'coins',
  stars: 'stars',
  challengeNote: 'challenge-note',
  closeCall: 'close-call',
  driftPanel: 'drift-panel',
  driftScore: 'drift-score',
  driftCombo: 'drift-combo',
  driftPending: 'drift-pending',
  carName: 'car-name',
  carClass: 'car-class',
  assists: 'assists',
  mute: 'mute',
  debugNote: 'debug-note',
  carButtons: 'car-buttons',
  minimap: 'minimap',
  message: 'message',
  loading: 'loading',
  loadingNote: 'loading-note',
  error: 'error'
};

const DATA_FILES = ['cars.json', 'surfaces.json', 'tuning.json', 'audio.json', 'track.json'];

export async function loadGameData(base = 'data') {
  const entries = await Promise.all(
    DATA_FILES.map(async (name) => {
      const response = await fetch(`${base}/${name}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`could not load ${base}/${name} (${response.status})`);
      return [name.replace('.json', ''), await response.json()];
    })
  );
  return Object.fromEntries(entries);
}

function collectElements(ids) {
  const elements = {};
  for (const [key, id] of Object.entries(ids)) {
    elements[key] = document.getElementById(id);
  }
  return elements;
}

export async function boot() {
  const els = collectElements(HUD_ELEMENT_IDS);
  const setLoadingNote = (text) => {
    if (els.loadingNote) els.loadingNote.textContent = text;
  };

  try {
    setLoadingNote('loading data/cars.json …');
    const data = await loadGameData('data');
    const config = createConfig({ cars: data.cars, surfaces: data.surfaces, tuning: data.tuning, audio: data.audio });
    for (const warning of config.warnings) console.warn('[config]', warning);

    setLoadingNote('building the circuit …');
    const track = buildTrack(data.track, config);

    const renderer = new Renderer(els.game, config, track);
    // 9.4: the analog input sources are configured from data/tuning.json.
    const input = new InputManager(window, config.tuning.input);
    const audio = new AudioEngine(config.audio);
    const hud = new Hud(els, config, track);

    const game = new Game({ config, track, renderer, hud, input, audio, canvas: els.game });
    game.onAssistsChanged = () => {};

    /* ---- car picker ------------------------------------------- */
    if (els.carButtons) {
      els.carButtons.innerHTML = '';
      config.cars.forEach((car, index) => {
        const button = document.createElement('button');
        button.textContent = car.name.split(' ')[0];
        button.title = `${car.name} - ${car.klass}\n${car.description}`;
        button.dataset.carId = car.id;
        button.addEventListener('click', () => {
          game.selectCar(car.id);
          updateCarButtons();
        });
        els.carButtons.appendChild(button);
        if (index === 0) button.classList.add('active');
      });
    }
    const updateCarButtons = () => {
      els.carButtons?.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('active', button.dataset.carId === game.car.id);
      });
    };

    /* ---- touch controls --------------------------------------- */
    input.bindTouch(document.getElementById('touch-left-btn'), 'left');
    input.bindTouch(document.getElementById('touch-right-btn'), 'right');
    input.bindTouch(document.getElementById('touch-throttle'), 'throttle');
    input.bindTouch(document.getElementById('touch-brake'), 'brake');
    input.bindTouch(document.getElementById('touch-handbrake'), 'handbrake');
    input.bindTouch(document.getElementById('touch-nitro'), 'nitro');
    const steerLeft = document.getElementById('touch-left-btn');
    const steerRight = document.getElementById('touch-right-btn');
    for (const [element, sign] of [
      [steerLeft, -1],
      [steerRight, 1]
    ]) {
      if (!element) continue;
      element.addEventListener('pointerdown', () => {
        input.touch.steer = sign;
        input.lastDevice = 'touch';
      });
      const release = () => {
        input.touch.steer = 0;
      };
      element.addEventListener('pointerup', release);
      element.addEventListener('pointercancel', release);
      element.addEventListener('pointerleave', release);
    }

    // 9.4: drag anywhere on the stage to steer (analog), or tilt the device.
    input.bindSteerPad(document.getElementById('touch-steer-pad'));
    const tiltButton = document.getElementById('touch-tilt');
    tiltButton?.addEventListener('click', async () => {
      if (input.tilt.enabled) {
        input.disableTilt();
        hud.message('Tilt steering off', 2);
        return;
      }
      const ok = await input.enableTilt(tiltButton);
      hud.message(ok ? 'Tilt steering on - hold the phone level' : 'Tilt steering needs a device with a motion sensor', 3);
    });

    /* ---- audio needs a gesture --------------------------------- */
    const unlockAudio = async () => {
      const ok = await audio.resume();
      if (ok) audio.setCar(game.car.def);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: false });
    window.addEventListener('keydown', unlockAudio, { once: false });

    /* ---- resize ------------------------------------------------ */
    const onResize = () => game.onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => game.onResize()).observe(els.game.parentElement ?? document.body);
    }

    /* ---- go ---------------------------------------------------- */
    game.start();
    els.loading?.classList.add('hidden');
    hud.message('Apex Loop - set a lap time', 3);

    // expose for debugging in the console / automated smoke tests
    window.__apex = { game, config, track, renderer, input, audio, hud };
    return window.__apex;
  } catch (error) {
    console.error(error);
    if (els.error) {
      els.error.hidden = false;
      els.error.textContent = `Apex 2D failed to start\n\n${error?.message ?? error}\n\nIf you opened index.html directly, serve the folder instead: npm start`;
    }
    return null;
  }
}
