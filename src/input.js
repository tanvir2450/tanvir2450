/**
 * input.js - one place that turns keyboard / gamepad / touch / tilt into the
 * car's input state.
 *
 * Section 9.4 asks for analog steering wherever the device can give it, so
 * there are four sources with an explicit priority (gamepad > touch pad >
 * keys/buttons > tilt):
 *
 *   - the KEYBOARD is on/off. It stays full-lock and the car's own ramp
 *     (`steering.keyboardRampMs`) turns it into an analog target;
 *   - the TOUCH PAD (`bindSteerPad`) is a real analog control: the horizontal
 *     distance the finger has travelled from where it landed *is* the steering
 *     angle, dead-zoned and clamped by `tuning.input`;
 *   - TILT (`enableTilt`) reads the device's roll angle, dead-zoned around the
 *     angle it was zeroed at, and is permission-gated for iOS;
 *   - a GAMEPAD stick stays analog and wins outright.
 *
 * Analog sources are rate-limited on release (`input.padReleasePerSecond`), so
 * letting go centres the wheel instead of snapping it.
 *
 * Keys: W/S or arrows drive, Space handbrake, N nitro, R reset, T assists,
 * Y difficulty, C circuit, K the 9.12 tuning panel (the "debug panel"),
 * M mute, P pause, H help, G debug vectors, V camera zoom, F repair,
 * O let the autopilot drive, 1-5 pick a car.
 */

import { clamp, rateApproach } from './mathx.js';

const KEY_MAP = {
  ArrowUp: 'throttle',
  KeyW: 'throttle',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'handbrake',
  ShiftLeft: 'handbrake',
  KeyN: 'nitro',
  KeyF: 'repair',
  KeyR: 'reset',
  KeyT: 'assists',
  KeyY: 'difficulty',
  KeyC: 'circuit',
  KeyK: 'tuner',
  KeyM: 'mute',
  KeyP: 'pause',
  KeyH: 'help',
  KeyG: 'debug',
  KeyV: 'camera',
  KeyO: 'autopilot',
  Digit1: 'car1',
  Digit2: 'car2',
  Digit3: 'car3',
  Digit4: 'car4',
  Digit5: 'car5'
};

/**
 * Follow an analog target immediately while the input grows, but let it fall
 * back at `ratePerSecond` when the player eases off or reverses, so an analog
 * control never snaps to centre.
 */
function analogApproach(current, target, ratePerSecond, dt) {
  const sameWay = current === 0 || Math.sign(target) === Math.sign(current);
  if (sameWay && Math.abs(target) >= Math.abs(current)) return target;
  return rateApproach(current, target, ratePerSecond, dt);
}

/**
 * 9.4: finger travel (px) since the drag started -> steering, -1..1.
 *
 * Inside `padDeadZonePx` nothing happens (a thumb resting on the glass must not
 * steer); between the dead zone and `padFullLockPx` the value rises on a gentle
 * curve (`padResponseExponent` < 1 makes small corrections easier than a raw
 * linear map); past full lock it clamps.
 *
 * @param {number} dxPx horizontal travel from the touch-down point
 * @param {object} tuning `tuning.input`
 * @returns {number} -1..1
 */
export function padSteerFrom(dxPx, tuning = {}) {
  const dead = Math.max(0, tuning.padDeadZonePx ?? 0);
  const full = Math.max(dead + 1e-3, tuning.padFullLockPx ?? dead + 1);
  const magnitude = Math.abs(dxPx);
  if (magnitude <= dead) return 0;
  const pct = Math.min(1, (magnitude - dead) / (full - dead));
  const shaped = Math.pow(pct, Math.max(0.2, tuning.padResponseExponent ?? 1));
  return Math.sign(dxPx) * shaped;
}

/**
 * 9.4: device roll (`gamma`, degrees) -> steering, -1..1.
 *
 * `zeroDeg` is the roll angle the device was calibrated at (the angle it is
 * being held at), so the player steers by tilting *from* their neutral pose
 * rather than from the world's horizontal.
 *
 * @param {number} gammaDeg deviceorientation gamma in degrees
 * @param {object} tuning `tuning.input`
 * @param {number} [zeroDeg] calibrated neutral, degrees
 * @returns {number} -1..1
 */
export function tiltSteerFrom(gammaDeg, tuning = {}, zeroDeg = 0) {
  if (!Number.isFinite(gammaDeg)) return 0;
  const dead = Math.max(0, tuning.tiltDeadZoneDeg ?? 0);
  const full = Math.max(dead + 1e-3, tuning.tiltFullLockDeg ?? dead + 1);
  const sign = tuning.tiltInvert ? -1 : 1;
  const deg = (gammaDeg - (Number.isFinite(zeroDeg) ? zeroDeg : 0)) * sign;
  const magnitude = Math.abs(deg);
  if (magnitude <= dead) return 0;
  return Math.sign(deg) * Math.min(1, (magnitude - dead) / (full - dead));
}

export class InputManager {
  /**
   * @param {object} [target] window-like event target
   * @param {object} [inputTuning] `tuning.input` from data/tuning.json
   */
  constructor(target = window, inputTuning = {}) {
    this.target = target;
    this.tuning = inputTuning;
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: 0 };
    // 9.4 knows whether to offer the touch steering assist: a device that has
    // touched the screen (or is being steered by tilt) is a touch device.
    this.touchOnly = false;
    this.actions = [];
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.gamepadIndex = null;
    this.useGamepad = false;
    this.anyInputAt = 0;
    this.lastDevice = 'keyboard';
    // 9.4 analog sources.
    this.pad = { active: false, pointerId: null, originX: 0, target: 0, value: 0 };
    this.tilt = { enabled: false, listening: false, zeroDeg: null, target: 0, value: 0, available: false };
    this.tiltButton = null;
    this.bind();
  }

  bind() {
    if (!this.target?.addEventListener) return;
    this.onKeyDown = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(action);
        if (!['throttle', 'brake', 'left', 'right', 'handbrake', 'nitro'].includes(action)) this.lastDevice = 'keyboard';
        if (!['throttle', 'brake', 'left', 'right', 'handbrake', 'nitro'].includes(action)) this.actions.push(action);
      }
    };
    this.onKeyUp = (e) => {
      const action = KEY_MAP[e.code];
      if (action) this.keys.delete(action);
    };
    this.onBlur = () => this.keys.clear();
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  /** Physical touch buttons wired up by the HUD. */
  bindTouch(element, control) {
    if (!element) return;
    const set = (value) => {
      this.touch[control] = value;
      this.lastDevice = 'touch';
      this.touchOnly = true;
    };
    const start = (e) => {
      e.preventDefault();
      element.setPointerCapture?.(e.pointerId);
      set(control === 'handbrake' ? true : 1);
    };
    const end = (e) => {
      e.preventDefault();
      set(control === 'handbrake' ? false : 0);
    };
    element.addEventListener('pointerdown', start);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('pointerleave', end);
  }

  /**
   * 9.4: drag anywhere to steer, analog. The finger goes down (`pointerdown`),
   * its travel from that point is the steering angle (`pointermove`), and
   * lifting off lets the value fall back through zero at
   * `input.padReleasePerSecond`.
   */
  bindSteerPad(element) {
    if (!element?.addEventListener) return;
    this.padElement = element;
    const down = (e) => {
      e.preventDefault?.();
      element.setPointerCapture?.(e.pointerId);
      this.pad.active = true;
      this.pad.pointerId = e.pointerId ?? 0;
      this.pad.originX = e.clientX ?? 0;
      this.pad.target = 0;
      this.lastDevice = 'touch';
      this.touchOnly = true;
      element.classList?.add('active');
    };
    const move = (e) => {
      if (!this.pad.active) return;
      if (this.pad.pointerId != null && e.pointerId != null && e.pointerId !== this.pad.pointerId) return;
      this.pad.target = padSteerFrom((e.clientX ?? 0) - this.pad.originX, this.tuning);
    };
    const up = (e) => {
      if (!this.pad.active) return;
      if (this.pad.pointerId != null && e.pointerId != null && e.pointerId !== this.pad.pointerId) return;
      this.pad.active = false;
      this.pad.pointerId = null;
      this.pad.target = 0;
      element.classList?.remove('active');
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('pointerleave', up);
  }

  /**
   * 9.4: tilt steering. Must be called from a user gesture (iOS asks for
   * permission); with no `DeviceOrientationEvent` it simply reports false and
   * the caller can leave the touch pad as the analog source.
   *
   * @returns {Promise<boolean>} whether tilt steering is now live
   */
  async enableTilt(button = null) {
    if (this.tuning.tiltEnabled === false) return false;
    const Ctor = this.target?.DeviceOrientationEvent ?? globalThis.DeviceOrientationEvent;
    if (typeof Ctor !== 'function') return false;
    if (typeof Ctor.requestPermission === 'function') {
      try {
        const result = await Ctor.requestPermission();
        if (result !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.tilt.listening && this.target?.addEventListener) {
      this.onOrientation = (e) => {
        if (!Number.isFinite(e?.gamma)) return;
        if (this.tilt.zeroDeg == null) this.tilt.zeroDeg = e.gamma;
        this.tilt.available = true;
        this.tilt.target = tiltSteerFrom(e.gamma, this.tuning, this.tilt.zeroDeg);
      };
      this.target.addEventListener('deviceorientation', this.onOrientation);
      this.tilt.listening = true;
    }
    this.tilt.enabled = true;
    this.tiltButton = button ?? this.tiltButton;
    this.tiltButton?.classList?.add('active');
    // Tilt is a touch device as far as 9.4's steering assist is concerned.
    this.touchOnly = true;
    this.lastDevice = 'touch';
    return true;
  }

  disableTilt() {
    this.tilt.enabled = false;
    this.tilt.target = 0;
    this.tiltButton?.classList?.remove('active');
  }

  /** Re-zero the tilt to the angle the device is being held at right now. */
  calibrateTilt() {
    this.tilt.zeroDeg = null;
  }

  pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const steerAxis = pad.axes[0] ?? 0;
      const throttle = pad.buttons[7]?.value ?? 0;
      const brake = pad.buttons[6]?.value ?? 0;
      const handbrake = (pad.buttons[0]?.value ?? 0) > 0.5 || (pad.buttons[1]?.value ?? 0) > 0.5;
      const active = Math.abs(steerAxis) > 0.08 || throttle > 0.02 || brake > 0.02 || handbrake;
      if (active && !this.useGamepad) {
        this.actions.push('gamepad-connected');
      }
      this.useGamepad = active;
      if (active) this.lastDevice = 'gamepad';
      return { steer: steerAxis, throttle, brake, handbrake };
    }
    return null;
  }

  /**
   * Returns the input object the car expects.
   * @param {number} [dt] seconds since the last sample (for analog smoothing)
   */
  sample(dt = 1 / 60) {
    const pad = this.pollGamepad();
    const keyLeft = this.keys.has('left');
    const keyRight = this.keys.has('right');
    const keySteer = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0) + this.touch.steer;

    // analog sources are rate-limited so a release centres the wheel smoothly
    this.pad.value = analogApproach(this.pad.value, this.pad.target, Math.max(1e-3, this.tuning.padReleasePerSecond ?? 3), dt);
    const tiltTarget = this.tilt.enabled ? this.tilt.target : 0;
    this.tilt.value = analogApproach(this.tilt.value, tiltTarget, Math.max(1e-3, this.tuning.tiltSmoothPerSecond ?? 8), dt);

    if (pad && pad.steer !== 0) this.steer = pad.steer;
    else if (this.pad.active) this.steer = clamp(this.pad.value, -1, 1);
    else if (keySteer !== 0) this.steer = clamp(keySteer, -1, 1);
    // the tail of a released drag: keep centring the wheel over a few frames
    else if (Math.abs(this.pad.value) > 1e-3) this.steer = clamp(this.pad.value, -1, 1);
    else if (Math.abs(this.tilt.value) > 1e-3) this.steer = clamp(this.tilt.value, -1, 1);
    else this.steer = 0;

    const keyThrottle = this.keys.has('throttle') ? 1 : 0;
    const keyBrake = this.keys.has('brake') ? 1 : 0;
    this.throttle = Math.max(keyThrottle, this.touch.throttle, pad?.throttle ?? 0);
    this.brake = Math.max(keyBrake, this.touch.brake, pad?.brake ?? 0);
    this.handbrake = this.keys.has('handbrake') || this.touch.handbrake || (pad?.handbrake ?? false);
    const nitro = this.keys.has('nitro') || this.touch.nitro > 0.5;

    if (this.steer || this.throttle || this.brake || this.handbrake) {
      this.anyInputAt = typeof performance !== 'undefined' ? performance.now() : 0;
    }
    return {
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.handbrake,
      nitro
    };
  }

  takeActions() {
    const actions = this.actions;
    this.actions = [];
    return actions;
  }

  dispose() {
    if (!this.target?.removeEventListener) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    if (this.onOrientation) this.target.removeEventListener('deviceorientation', this.onOrientation);
  }
}
