/**
 * input.js - one place that turns keyboard / gamepad / touch into the car's
 * input state. Analog sources (gamepad sticks, touch sliders) stay analog;
 * keyboard steering is full-lock and smoothed by the car's steering rate, which
 * is how the handling stays consistent between devices.
 *
 * Keys: W/S or arrows drive, Space handbrake, R reset, T assists, M mute,
 * P pause, H help, G debug vectors, V camera zoom, O let the autopilot drive.
 */

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
  KeyR: 'reset',
  KeyT: 'assists',
  KeyM: 'mute',
  KeyP: 'pause',
  KeyH: 'help',
  KeyG: 'debug',
  KeyV: 'camera',
  KeyO: 'autopilot'
};

export class InputManager {
  constructor(target = window) {
    this.target = target;
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    this.actions = [];
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.gamepadIndex = null;
    this.useGamepad = false;
    this.anyInputAt = 0;
    this.lastDevice = 'keyboard';
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
        if (!['throttle', 'brake', 'left', 'right', 'handbrake'].includes(action)) this.actions.push(action);
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

  /** Returns the input object the car expects. */
  sample() {
    const pad = this.pollGamepad();
    const keyLeft = this.keys.has('left');
    const keyRight = this.keys.has('right');
    const keySteer = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0) + this.touch.steer;

    if (pad && pad.steer !== 0) this.steer = pad.steer;
    else if (keySteer !== 0) this.steer = Math.max(-1, Math.min(1, keySteer));
    else this.steer = 0;

    const keyThrottle = this.keys.has('throttle') ? 1 : 0;
    const keyBrake = this.keys.has('brake') ? 1 : 0;
    this.throttle = Math.max(keyThrottle, this.touch.throttle, pad?.throttle ?? 0);
    this.brake = Math.max(keyBrake, this.touch.brake, pad?.brake ?? 0);
    this.handbrake = this.keys.has('handbrake') || this.touch.handbrake || (pad?.handbrake ?? false);

    if (this.steer || this.throttle || this.brake || this.handbrake) {
      this.anyInputAt = performance.now();
    }
    return {
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.handbrake
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
  }
}
