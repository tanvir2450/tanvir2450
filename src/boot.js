/**
 * boot.js - wiring: fetch the JSON data, build the config/track, create the
 * renderer / HUD / input / audio, and start the game loop.
 *
 * Kept separate from main.js so tooling and tests can import this module
 * without touching the DOM.
 */

import { createConfig } from './config.js';
import { Tuner } from './debug.js';
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

const DATA_FILES = ['cars.json', 'surfaces.json', 'tuning.json', 'audio.json', 'tracks.json'];

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

/**
 * 9.12: fetch one circuit by id from data/tracks.json (or its raw file path).
 * @param {object} catalogue data/tracks.json
 * @param {string} id track id
 */
export async function loadTrackFile(catalogue, id, base = 'data') {
  const entry = (catalogue?.tracks ?? []).find((t) => t.id === id) ?? (catalogue?.tracks ?? [])[0];
  if (!entry) throw new Error('data/tracks.json lists no circuits');
  const file = entry.file ?? `${base}/${entry.id}.json`;
  const response = await fetch(file, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`could not load ${file} (${response.status})`);
  return { entry, json: await response.json() };
}

export async function boot() {
  const els = collectElements(HUD_ELEMENT_IDS);
  const setLoadingNote = (text) => {
    if (els.loadingNote) els.loadingNote.textContent = text;
  };

  try {
    setLoadingNote('loading data/cars.json …');
    const data = await loadGameData('data');
    // 9.12: the browser build keeps the data writable so the tuning panel can
    // change it live; tests and tools stay frozen + strict.
    const buildConfig = (profilePatch = {}) => {
      const cars = structuredClone(data.cars);
      for (const car of cars.cars) {
        const patch = profilePatch[car.id];
        if (!patch) continue;
        for (const [path, value] of Object.entries(patch)) {
          const keys = path.split('.');
          const last = keys.pop();
          const target = keys.reduce((acc, key) => (acc?.[key] ?? (acc[key] = {}), acc[key]), car);
          target[last] = value;
          // a profile row edited as a nested model value (tires.gripFront) has
          // to travel as the 9.11 profile key as well, or the conversion wins
          if (path === 'tires.gripFront') car.gripFront = value;
          if (path === 'tires.gripRear') car.gripRear = value;
          if (path === 'tires.slideGripRatio') car.slideGrip = value;
          if (path === 'steering.maxSteerAngleDeg') car.steerMax = value;
          if (path === 'brakes.maxBrakeTorqueNm') car.brakeForce = value / (car.body.massKg * data.tuning.profile.brakeTorquePerKgNm);
          if (path === 'body.massKg') car.mass = value;
          if (path === 'body.dragAreaCdA') car.dragCoeff = value / (car.body.frontalAreaM2 ?? data.tuning.profile.frontalAreaM2);
          if (path === 'nitro.capacity') car.nitroCapacity = value / data.tuning.nitro.drainPerSecond;
        }
      }
      return createConfig({ cars, surfaces: data.surfaces, tuning: data.tuning, audio: data.audio }, { freeze: false });
    };

    setLoadingNote('building the circuit …');
    const catalogue = data.tracks;
    const wanted = new URLSearchParams(window.location?.search ?? '').get('track');
    let trackId = wanted && catalogue.tracks.some((t) => t.id === wanted) ? wanted : catalogue.default ?? catalogue.tracks[0].id;
    let loaded = await loadTrackFile(catalogue, trackId);

    let config = buildConfig();
    for (const warning of config.warnings) console.warn('[config]', warning);
    let track = buildTrack(loaded.json, config);

    const renderer = new Renderer(els.game, config, track);
    // 9.4: the analog input sources are configured from data/tuning.json.
    const input = new InputManager(window, config.tuning.input);
    const audio = new AudioEngine(config.audio);
    let hud = new Hud(els, config, track);

    let game = new Game({ config, track, renderer, hud, input, audio, canvas: els.game });
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

    /* ---- 9.12: circuit switching + the tuning panel ------------- */
    const tuner = new Tuner({
      config,
      getGame: () => game,
      root: document.getElementById('tuner'),
      onRebuild: (reason) => rebuildWorld(reason)
    });

    /**
     * 9.12: rebuild the world in place - a new circuit, or a car whose profile
     * was just edited in the panel. The wallet, the car choice, the difficulty
     * and the assists survive; everything derived from the data is rebuilt.
     */
    async function rebuildWorld(reason = '') {
      const keep = {
        carId: game?.car?.id,
        coins: game?.economy?.coins,
        stars: game?.economy?.earned,
        difficulty: game?.difficulty?.id,
        assists: game?.assists,
        paused: game?.paused
      };
      game?.stop();
      config = buildConfig(tuner.profilePatch());
      const rebuiltTrack = reason === 'circuit' ? buildTrack(loaded.json, config) : buildTrack(loaded.json, config);
      track = rebuiltTrack;
      renderer.setTrack?.(track);
      hud = new Hud(els, config, track);
      game = new Game({ config, track, renderer, hud, input, audio, canvas: els.game });
      wireGame();
      if (keep.carId && config.carById.has(keep.carId)) game.selectCar(keep.carId);
      if (keep.coins !== undefined) {
        game.economy.coins = keep.coins;
        game.economy.earned = keep.stars ?? 0;
      }
      if (keep.difficulty) game.setDifficulty(keep.difficulty);
      if (keep.assists !== undefined) {
        game.assists = keep.assists;
        game.car.assistsEnabled = keep.assists;
      }
      game.start();
      tuner.onRebuilt(reason);
      return game;
    }

    async function switchCircuit(step = 1) {
      const list = catalogue.tracks;
      const index = list.findIndex((t) => t.id === trackId);
      trackId = list[(index + step + list.length) % list.length].id;
      loaded = await loadTrackFile(catalogue, trackId);
      await rebuildWorld('circuit');
      hud.message(`${track.name} - ${loaded.entry.description}`, 4);
    }

    function wireGame() {
      game.onAssistsChanged = () => {};
      game.onFrame = () => tuner.sample();
      game.onTunerRequested = () => {
        const visible = tuner.toggle();
        game.paused = false;
        hud.message(visible ? 'Tuning panel: sliders change the car live (K)' : 'Tuning panel closed', 2);
      };
      game.onCircuitRequested = () => {
        switchCircuit(1).catch((error) => console.error(error));
      };
      updateCarButtons();
    }

    /* ---- go ---------------------------------------------------- */
    wireGame();
    game.start();
    els.loading?.classList.add('hidden');
    hud.message(`${track.name} - set a lap time`, 3);

    // Expose the live objects (getters, so a rebuilt world is visible to the
    // console and to the tests without them holding a stale reference).
    const apex = { input, audio, tuner, rebuildWorld, switchCircuit };
    for (const key of ['game', 'config', 'track', 'renderer', 'hud']) {
      Object.defineProperty(apex, key, { get: () => ({ game, config, track, renderer, hud })[key], enumerable: true });
    }
    window.__apex = apex;
    return apex;
  } catch (error) {
    console.error(error);
    if (els.error) {
      els.error.hidden = false;
      const advice = globalThis.__APEX_SINGLE_FILE
        ? 'The single-file build (apex-2d.html) failed to boot - the message above is the bug, not a missing server.'
        : 'If you opened index.html directly, serve the folder instead: npm start';
      els.error.textContent = `Apex 2D failed to start\n\n${error?.message ?? error}\n\n${advice}`;
    }
    return null;
  }
}
