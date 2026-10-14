/**
 * debug.js - SECTION 9.12's tuning panel.
 *
 * Toggle with `T`... no: `T` is the driver assists, so the panel is on `H`'s
 * neighbour, the backtick/quote key. It shows the numbers you actually tune
 * against (speed, rpm, gear, slip angle, grip per axle, FPS) and it has live
 * sliders for the constants - move one and the car changes under your hands.
 *
 * Two kinds of row, because they have very different costs:
 *
 *   GLOBAL   a value in tuning.json that the simulation reads every tick
 *            (steering rates, slide grip, drift scoring, nitro, collision,
 *            traffic...). Editing it is a straight write - no rebuild.
 *
 *   CAR      a value that is converted once at load time into the car's model
 *            (mass, engine power, grip, steering lock, brake force, drag,
 *            armor, nitro tank - the 9.11 handling profile). Editing one marks
 *            the world dirty and the panel asks the host to rebuild it, which
 *            takes a frame and keeps your place on the track.
 *
 * "Copy JSON" prints the diff against the values the game booted with: paste it
 * into data/tuning.json / data/cars.json when the feel is right.
 */

const READOUTS = [
  { key: 'speed', label: 'speed', unit: 'km/h', digits: 0 },
  { key: 'rpm', label: 'rpm', unit: '', digits: 0 },
  { key: 'gear', label: 'gear', unit: '', digits: 0 },
  { key: 'slip', label: 'slip', unit: 'deg', digits: 1 },
  { key: 'gripFront', label: 'use F', unit: 'g', digits: 2 },
  { key: 'gripRear', label: 'use R', unit: 'g', digits: 2 },
  { key: 'latG', label: 'lat g', unit: 'g', digits: 2 },
  { key: 'steer', label: 'steer', unit: 'deg', digits: 1 },
  { key: 'surface', label: 'surface', unit: '', text: true },
  { key: 'nitro', label: 'nitro', unit: '%', digits: 0 },
  { key: 'health', label: 'health', unit: '%', digits: 0 },
  { key: 'fps', label: 'fps', unit: '', digits: 0 }
];

/**
 * The live sliders. `path` is a path inside the object; `car` rows are the 9.11
 * profile inputs, `tuning` rows are global constants.
 */
export const TUNER_ROWS = [
  // --- 9.11 handling profile (needs a rebuild) -------------------------
  { group: 'car', path: 'body.massKg', label: 'mass', unit: 'kg', min: 700, max: 2600, step: 10 },
  { group: 'car', path: 'profile.enginePower', label: 'power', unit: 'PS', min: 60, max: 700, step: 5 },
  { group: 'car', path: 'tires.gripFront', label: 'grip front', unit: 'g', min: 0.6, max: 1.6, step: 0.01 },
  { group: 'car', path: 'tires.gripRear', label: 'grip rear', unit: 'g', min: 0.6, max: 1.6, step: 0.01 },
  { group: 'car', path: 'tires.slideGripRatio', label: 'slide grip', unit: '', min: 0.3, max: 1, step: 0.01 },
  { group: 'car', path: 'steering.maxSteerAngleDeg', label: 'steer max', unit: 'deg', min: 18, max: 45, step: 0.5 },
  { group: 'car', path: 'drivetrain.balance', label: 'balance', unit: '', min: -0.4, max: 0.4, step: 0.01 },
  { group: 'car', path: 'brakes.maxBrakeTorqueNm', label: 'brake torque', unit: 'Nm', min: 1200, max: 8000, step: 50 },
  { group: 'car', path: 'brakes.brakeBiasFront', label: 'brake bias', unit: '', min: 0.4, max: 0.85, step: 0.01 },
  { group: 'car', path: 'body.dragAreaCdA', label: 'drag CdA', unit: '', min: 0.3, max: 1.6, step: 0.01 },
  { group: 'car', path: 'body.downforceCoeff', label: 'downforce', unit: '', min: 0, max: 1.2, step: 0.01 },
  { group: 'car', path: 'drivetrain.finalDrive', label: 'final drive', unit: '', min: 2.4, max: 5.2, step: 0.01 },
  { group: 'car', path: 'armor', label: 'armor', unit: '/', min: 0.5, max: 2, step: 0.01 },
  { group: 'car', path: 'nitro.capacity', label: 'nitro tank', unit: '', min: 20, max: 220, step: 2 },

  // --- global constants (no rebuild) -----------------------------------
  { group: 'tuning', path: 'steering.steerRateDegPerSec', label: 'steer rate', unit: 'deg/s', min: 80, max: 600, step: 5 },
  { group: 'tuning', path: 'steering.returnRateDegPerSec', label: 'return rate', unit: 'deg/s', min: 60, max: 600, step: 5 },
  { group: 'tuning', path: 'steering.handbrakeSteerBoostDeg', label: 'handbrake steer', unit: 'deg', min: 0, max: 12, step: 0.5 },
  { group: 'tuning', path: 'tires.slideGripRatio', label: 'slide grip', unit: '', min: 0.3, max: 1, step: 0.01 },
  { group: 'tuning', path: 'tires.wheelspinGripLoss', label: 'wheelspin loss', unit: '', min: 0, max: 0.9, step: 0.01 },
  { group: 'tuning', path: 'tires.longitudinalGripRatio', label: 'drive grip', unit: '', min: 0.6, max: 1.5, step: 0.01 },
  { group: 'tuning', path: 'chassis.loadTransferFactor', label: 'load transfer', unit: '', min: 0, max: 1.4, step: 0.01 },
  { group: 'tuning', path: 'drift.minSlipAngleDeg', label: 'drift entry', unit: 'deg', min: 6, max: 30, step: 0.5 },
  { group: 'tuning', path: 'drift.scorePerSecondAtFullSlide', label: 'drift score', unit: 'pts/s', min: 50, max: 1200, step: 10 },
  { group: 'tuning', path: 'drift.minSpeedFactor', label: 'drift slow gain', unit: '', min: 0, max: 1, step: 0.01 },
  { group: 'tuning', path: 'nitro.forceMultiplier', label: 'nitro force', unit: 'x', min: 1, max: 2, step: 0.01 },
  { group: 'tuning', path: 'nitro.topSpeedMultiplier', label: 'nitro top', unit: 'x', min: 1, max: 1.6, step: 0.01 },
  { group: 'tuning', path: 'nitro.drainPerSecond', label: 'nitro drain', unit: '/s', min: 5, max: 80, step: 1 },
  { group: 'tuning', path: 'collision.carRestitution', label: 'bounce', unit: '', min: 0, max: 0.8, step: 0.01 },
  { group: 'tuning', path: 'collision.hitStopMs', label: 'hit-stop', unit: 'ms', min: 0, max: 140, step: 5 },
  { group: 'tuning', path: 'damage.armorScale', label: 'damage scale', unit: '', min: 0, max: 0.001, step: 0.00001 },
  { group: 'tuning', path: 'damage.smokeAtHealthPct', label: 'smoke at', unit: '%', min: 10, max: 90, step: 1 },
  { group: 'tuning', path: 'traffic.nearMissDistanceM', label: 'near miss', unit: 'm', min: 1, max: 5, step: 0.1 },
  { group: 'tuning', path: 'traffic.slipstreamRangeM', label: 'slipstream', unit: 'm', min: 10, max: 70, step: 1 },
  { group: 'tuning', path: 'camera.followLerpPerSecond', label: 'cam follow', unit: '/s', min: 1, max: 20, step: 0.5 },
  { group: 'tuning', path: 'camera.speedZoomPct', label: 'speed zoom', unit: '', min: 0, max: 0.5, step: 0.01 },
  { group: 'tuning', path: 'camera.fitWidthPx', label: 'screen fit', unit: 'px', min: 0, max: 1600, step: 20 },
  { group: 'tuning', path: 'camera.minFitZoom', label: 'fit floor', unit: '', min: 0.2, max: 1, step: 0.05 },
  { group: 'tuning', path: 'assists.stabilityAssistStrength', label: 'stability aid', unit: '', min: 0, max: 0.8, step: 0.01 }
];

const getPath = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
  if (target) target[last] = value;
};

export class Tuner {
  /**
   * @param {object} deps
   * @param {object} deps.config resolved config (tuning must be writable)
   * @param {() => object} deps.getGame the live game (rebuilt on a car edit)
   * @param {(reason:string) => void} [deps.onRebuild] ask the host to rebuild the world
   * @param {HTMLElement} deps.root the panel element from index.html
   */
  constructor({ config, getGame, onRebuild, root }) {
    this.config = config;
    this.tracks = null;
    this.getGame = getGame;
    this.onRebuild = onRebuild ?? (() => {});
    this.root = root;
    this.visible = false;
    this.dirtyCar = false;
    this.rebuildTimer = null;
    this.rebuilds = 0;
    this.pendingProfiles = new Map();
    this.rows = [];
    this.samples = { speed: 0, rpm: 0, gear: 1, slip: 0, gripFront: 0, gripRear: 0, latG: 0, steer: 0, surface: 'asphalt', nitro: 0, health: 100, fps: 0 };
    this.build();
    this.setVisible(false);
  }

  /* ---- DOM -------------------------------------------------------- */

  build() {
    if (!this.root) return;
    this.root.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'tuner-title';
    const titleLabel = document.createElement('b');
    titleLabel.textContent = '9.12 TUNER';
    // kept as a direct reference: the panel is also built by the headless DOM
    // stub in the tests, which has no HTML parser to query into.
    this.context = document.createElement('span');
    this.context.id = 'tuner-context';
    title.appendChild(titleLabel);
    title.appendChild(this.context);
    this.root.appendChild(title);

    const readout = document.createElement('div');
    readout.className = 'tuner-readout';
    this.readoutCells = {};
    for (const item of READOUTS) {
      const cell = document.createElement('div');
      cell.className = 'tuner-cell';
      const label = document.createElement('span');
      label.className = 'tuner-label';
      label.textContent = item.label;
      const value = document.createElement('b');
      value.textContent = '-';
      cell.appendChild(label);
      cell.appendChild(value);
      readout.appendChild(cell);
      this.readoutCells[item.key] = { value, item };
    }
    this.root.appendChild(readout);

    const list = document.createElement('div');
    list.className = 'tuner-list';
    let currentGroup = null;
    for (const row of TUNER_ROWS) {
      if (row.group !== currentGroup) {
        currentGroup = row.group;
        const heading = document.createElement('div');
        heading.className = 'tuner-group';
        heading.textContent =
          row.group === 'car'
            ? 'CAR PROFILE - 9.11 (edits rebuild the world; a classic car switches to profile values)'
            : 'GLOBAL CONSTANTS - live, no rebuild';
        list.appendChild(heading);
      }
      list.appendChild(this.buildRow(row));
    }
    this.root.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'tuner-footer';
    const mkButton = (label, title2, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title2;
      button.addEventListener('click', onClick);
      footer.appendChild(button);
      return button;
    };
    mkButton('Reset all', 'Back to the values the game booted with', () => this.resetAll());
    this.copyButton = mkButton('Copy JSON', 'Print the diff (tuning + car profiles) for data/*.json', () => this.copyJson());
    mkButton('Close', 'Hide the panel', () => this.setVisible(false));
    this.status = document.createElement('span');
    this.status.className = 'tuner-status';
    footer.appendChild(this.status);
    this.root.appendChild(footer);
  }

  /** One slider row bound to a path in the tuning object or the car def. */
  buildRow(row) {
    const wrapper = document.createElement('label');
    wrapper.className = 'tuner-row';
    const name = document.createElement('span');
    name.className = 'tuner-name';
    name.textContent = row.label;
    const value = document.createElement('b');
    value.className = 'tuner-value';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(row.min);
    slider.max = String(row.max);
    slider.step = String(row.step);
    slider.id = `tuner-${row.group}-${row.path.replace(/\./g, '-')}`;
    name.setAttribute('for', slider.id);
    wrapper.appendChild(slider);
    wrapper.appendChild(name);
    wrapper.appendChild(value);
    const entry = { ...row, slider, value: value, element: wrapper };
    this.rows.push(entry);
    slider.addEventListener('input', () => {
      const number = Number(slider.value);
      this.write(entry, number);
      value.textContent = this.format(entry, number);
      // a car profile change needs a rebuild: debounce so dragging is smooth
      if (entry.group === 'car') {
        this.dirtyCar = true;
        if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => this.flushRebuild(), 220);
      }
      this.setStatus(entry.group === 'car' ? 'car rebuild queued' : 'live');
      this.refresh();
    });
    return wrapper;
  }

  /* ---- reads / writes --------------------------------------------- */

  format(entry, number) {
    const digits = entry.step < 0.01 ? 5 : entry.step < 0.1 ? 2 : entry.step < 1 ? 1 : 0;
    return `${number.toFixed(digits)}`;
  }

  /** Source object a row reads and writes. */
  sourceFor(entry) {
    const game = this.getGame();
    const def = game?.car?.def ?? this.config.cars[0];
    return entry.group === 'car' ? def : this.config.tuning;
  }

  write(entry, value) {
    if (entry.group === 'car') {
      const game = this.getGame();
      const id = game?.car?.id ?? this.config.cars[0].id;
      const patch = this.pendingProfiles.get(id) ?? {};
      patch[entry.path] = value;
      this.pendingProfiles.set(id, patch);
      return;
    }
    setPath(this.config.tuning, entry.path, value);
  }

  /** Current value of a row (car rows prefer a pending edit). */
  currentValue(entry) {
    const game = this.getGame();
    if (entry.group === 'car') {
      const id = game?.car?.id ?? this.config.cars[0].id;
      const pending = this.pendingProfiles.get(id)?.[entry.path];
      if (pending !== undefined) return pending;
    }
    return getPath(this.sourceFor(entry), entry.path);
  }

  refresh() {
    for (const entry of this.rows) {
      const value = Number(this.currentValue(entry));
      if (!Number.isFinite(value)) {
        entry.value.textContent = '-';
        continue;
      }
      const clamped = Math.min(entry.max, Math.max(entry.min, value));
      if (Number(entry.slider.value) !== clamped) entry.slider.value = String(clamped);
      entry.value.textContent = this.format(entry, value);
    }
    const game = this.getGame();
    const def = game?.car?.def;
    if (this.context && def) {
      const profile = def.profile?.mass || def.profile?.enginePower ? ' · profile' : '';
      this.context.textContent = `${def.name}${profile} · ${game.track?.name ?? 'track'} · ${this.rebuilds} rebuilds`;
    }
  }

  /** The pending per-car edits, as a patch object keyed by car id. */
  profilePatch() {
    const out = {};
    for (const [id, patch] of this.pendingProfiles) out[id] = { ...patch };
    return out;
  }

  /* ---- lifecycle -------------------------------------------------- */

  setVisible(visible) {
    this.visible = visible;
    this.root?.classList.toggle('visible', visible);
    if (visible) this.refresh();
  }

  toggle() {
    this.setVisible(!this.visible);
    return this.visible;
  }

  /** Called every frame while visible; cheap because it only writes text. */
  sample() {
    if (!this.visible) return;
    const game = this.getGame();
    const car = game?.car;
    if (!car) return;
    const t = car.telemetry();
    // grip per axle as the tire model sees it: how much of the axle's grip
    // budget is being used (1.0 = on the limit, above = sliding)
    const front = car.frontAxle?.usageLat ?? 0;
    const rear = car.rearAxle?.usageLat ?? 0;
    const s = this.samples;
    s.speed = t.speedKph;
    s.rpm = t.engine?.rpmDisplay ?? t.engine?.rpm ?? 0;
    s.gear = t.engine?.gear ?? 1;
    s.slip = t.bodySlipDeg ?? 0;
    s.gripFront = front;
    s.gripRear = rear;
    s.latG = t.lateralG ?? 0;
    s.steer = ((t.steerAngleRad ?? 0) * 180) / Math.PI;
    s.surface = `${t.surface}${t.onTrack ? '' : ' (off)'}`;
    s.nitro = (t.nitro?.pct ?? 0) * 100;
    s.health = (t.damage?.healthPct ?? 1) * 100;
    s.fps = game.fps ?? 0;
    for (const item of READOUTS) {
      const cell = this.readoutCells[item.key];
      if (!cell) continue;
      const value = s[item.key];
      cell.value.textContent = item.text ? String(value) : Number(value).toFixed(item.digits);
    }
  }

  setStatus(text) {
    if (!this.status) return;
    this.status.textContent = text;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      if (this.status) this.status.textContent = '';
    }, 2000);
  }

  /** After the host rebuilt the world, re-read the values (now from the def). */
  onRebuilt(reason = '') {
    this.rebuilds += 1;
    this.dirtyCar = false;
    this.setStatus(reason ? `rebuilt (${reason})` : 'rebuilt');
    this.refresh();
  }

  flushRebuild() {
    this.rebuildTimer = null;
    if (!this.dirtyCar) return;
    this.onRebuild('car profile');
  }

  /** Stop the debounce and hide: used when the world is torn down. */
  dispose() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.rebuildTimer = null;
    this.dirtyCar = false;
    this.setVisible(false);
  }

  resetAll() {
    // globals: write the boot values back
    for (const entry of this.rows) {
      if (entry.group !== 'tuning') continue;
      const baseline = getPath(this.config.tuningBaseline ?? {}, entry.path);
      if (baseline !== undefined) setPath(this.config.tuning, entry.path, baseline);
    }
    // car profiles: drop the pending edits and rebuild from the JSON on disk
    this.pendingProfiles.clear();
    this.dirtyCar = true;
    this.onRebuild('reset');
  }

  /** The diff against the boot values - paste into data/tuning.json. */
  diff() {
    const tuning = {};
    for (const entry of this.rows) {
      if (entry.group !== 'tuning') continue;
      const baseline = getPath(this.config.tuningBaseline ?? {}, entry.path);
      const now = getPath(this.config.tuning, entry.path);
      if (baseline !== undefined && now !== baseline) tuning[entry.path] = now;
    }
    return { tuning, carProfiles: this.profilePatch() };
  }

  copyJson() {
    const json = JSON.stringify(this.diff(), null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).catch(() => {});
    }
    // Also log it: the clipboard is blocked in some embeds, the console is not.
    console.log('[tuner] diff (paste into data/tuning.json / data/cars.json)\n' + json);
    this.setStatus('diff printed to the console');
    return json;
  }
}
