/**
 * game.js - SECTION 9.1's loop.
 *
 *   fixed physics timestep at tuning.simulation.physicsHz (accumulator loop)
 *   rendering interpolated between the last two physics states
 *   -> identical feel on 30, 60, 120 and 144 Hz displays.
 *
 * The loop clamps the frame time so a stalled tab cannot spiral, and the
 * accumulator guarantees that a slow frame runs the physics several times
 * instead of running it with a bigger dt.
 */

import { Car } from './car.js';
import { Camera } from './camera.js';
import { Effects, DriftScore } from './fx.js';
import { LapTimer } from './track.js';
import { Autopilot } from './ai.js';

export class Game {
  constructor({ config, track, renderer, hud, input, audio, canvas }) {
    this.config = config;
    this.track = track;
    this.renderer = renderer;
    this.hud = hud;
    this.input = input;
    this.audio = audio;
    this.canvas = canvas;

    this.physicsDt = 1 / config.tuning.simulation.physicsHz;
    this.maxFrameTime = config.tuning.simulation.maxFrameTimeMs / 1000;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.paused = false;
    this.assists = true;
    this.debug = config.tuning.debug.showForcesByDefault;
    this.carIndex = 0;
    this.alpha = 0;
    this.lapJustCompleted = 0;
    this.fps = 0;
    this.fpsSmoothed = 60;

    this.camera = new Camera(config);
    this.effects = new Effects(config);
    this.drift = new DriftScore(config);
    this.lapTimer = new LapTimer(track);
    // Demo driver (press O): the same autopilot the tests and the lap-time
    // tooling use, so what the game shows is what the tools measure.
    this.autopilot = new Autopilot(track, config);
    this.demo = false;
    this.demoLockout = 0;
    this.spawnCar();
  }

  spawnCar() {
    const def = this.config.cars[this.carIndex];
    this.car = new Car(def, this.config, { assists: this.assists });
    this.reset();
    this.audio?.setCar?.(def);
  }

  selectCar(id) {
    const index = this.config.cars.findIndex((c) => c.id === id);
    if (index < 0) return;
    this.carIndex = index;
    this.spawnCar();
    this.hud?.message(`${this.car.name} ready`);
  }

  nextCar(step = 1) {
    this.carIndex = (this.carIndex + step + this.config.cars.length) % this.config.cars.length;
    this.spawnCar();
    this.hud?.message(`${this.car.name} ready`);
  }

  reset() {
    const pose = this.track.startPose;
    this.car.reset({ x: pose.x, y: pose.y, heading: pose.heading });
    this.effects.reset();
    this.drift.reset();
    this.lapTimer.reset();
    this.autopilot.reset();
    this.camera.reset(this.car);
    this.accumulator = 0;
  }

  onResize() {
    this.renderer.resize();
    this.camera.setViewport(this.renderer.viewport.width, this.renderer.viewport.height);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.onResize();
    const tick = (now) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  togglePause() {
    this.paused = !this.paused;
    this.hud?.message(this.paused ? 'Paused' : 'Go!', this.paused ? 6 : 1);
  }

  /** One animation frame: sample input, run the fixed steps, then interpolate. */
  frame(now) {
    const frameSeconds = Math.min((now - this.lastTime) / 1000, this.maxFrameTime);
    this.lastTime = now;
    this.fpsSmoothed += (1 / Math.max(frameSeconds, 1e-3) - this.fpsSmoothed) * 0.08;
    this.fps = this.fpsSmoothed;

    this.handleActions(this.input.takeActions());
    let input = this.input.sample();
    this.lapJustCompleted = Math.max(0, this.lapJustCompleted - frameSeconds);

    // In demo mode the autopilot drives; touching the controls takes the car
    // back (after a short lockout so the key press that started it cannot end it).
    this.demoLockout = Math.max(0, this.demoLockout - frameSeconds);
    if (this.demo && this.demoLockout === 0 && (input.steer || input.throttle || input.brake || input.handbrake)) {
      this.demo = false;
      this.autopilot.reset();
      this.hud?.message('You have the wheel', 2);
    }
    const driven = this.demo;

    this.accumulator += this.paused ? 0 : frameSeconds;
    let steps = 0;
    while (this.accumulator >= this.physicsDt && steps < this.config.tuning.simulation.maxSubSteps * 4) {
      // The driver thinks once per fixed step, so the demo is frame-rate
      // independent in exactly the same way the physics is.
      const stepInput = driven ? this.autopilot.update(this.physicsDt, this.car) : input;
      this.step(this.physicsDt, stepInput);
      if (driven) input = stepInput;
      this.accumulator -= this.physicsDt;
      steps++;
    }
    if (steps >= this.config.tuning.simulation.maxSubSteps * 4) this.accumulator = 0;
    this.alpha = this.accumulator / this.physicsDt;

    const telemetry = this.car.telemetry();
    this.renderer.draw({
      car: this.car,
      camera: this.camera,
      alpha: this.alpha,
      effects: this.effects,
      input,
      hud: { nextGateIndex: this.lapTimer.nextGate }
    });
    this.hud?.update(frameSeconds, telemetry, {
      lapTimer: this.lapTimer,
      drift: this.drift,
      assists: this.assists,
      muted: this.audio?.muted ?? false,
      debug: this.debug,
      fps: this.fps,
      lapJustCompleted: this.lapJustCompleted
    });
    this.audio?.update(frameSeconds, telemetry, input);
  }

  /** One fixed physics tick. */
  step(dt, input) {
    const car = this.car;
    const prevX = car.x;
    const prevY = car.y;
    car.step(dt, input, this.track.world);
    this.camera.update(dt, car);
    this.effects.update(dt, car);
    this.drift.update(dt, car);
    this.lapTimer.update(dt, car, prevX, prevY);
    if (this.lapTimer.lastLap !== null && this.lapTimer.splits.length === 0 && this.lapTimer.lapTime < 0.2) {
      this.lapJustCompleted = 1.2;
    }

    for (const event of car.impactEvents) {
      const strength = Math.min(1, event.speedMs / 8);
      this.camera.addShake(strength * this.config.tuning.collision.impactShakeScale);
      this.audio?.playImpact?.(strength);
      if (strength > 0.35) this.drift.events.push({ type: 'impact', strength });
    }

    for (const event of this.drift.events) {
      if (event.type === 'bank' && event.points > 25) this.hud?.message(`+${event.points} drift  x${event.combo.toFixed(2)}`, 1.1);
      if (event.type === 'spin') this.hud?.message(`Spin! -${event.lost}`, 1.6);
    }
    this.drift.events.length = 0;
  }

  handleActions(actions) {
    for (const action of actions) {
      switch (action) {
        case 'reset':
          this.reset();
          this.hud?.message('Back to the grid');
          break;
        case 'assists':
          this.assists = !this.assists;
          this.car.assistsEnabled = this.assists;
          if (typeof this.onAssistsChanged === 'function') this.onAssistsChanged(this.assists);
          this.hud?.message(`Assists ${this.assists ? 'on' : 'off'}`);
          break;
        case 'mute':
          this.audio?.setMuted(!this.audio.muted);
          this.hud?.message(this.audio?.muted ? 'Muted' : 'Sound on');
          break;
        case 'pause':
          this.togglePause();
          break;
        case 'debug':
          this.debug = !this.debug;
          this.renderer.debug = this.debug;
          break;
        case 'camera': {
          const zoom = this.camera.cycleZoom();
          this.hud?.message(zoom > 1 ? 'Camera close' : zoom < 1 ? 'Camera wide' : 'Camera normal', 1.4);
          break;
        }
        case 'autopilot':
          this.demo = !this.demo;
          this.demoLockout = 0.6;
          this.autopilot.reset();
          this.hud?.message(this.demo ? 'Demo: autopilot driving (O to take over)' : 'You have the wheel', this.demo ? 3.2 : 2);
          break;
        case 'help':
          this.hud?.message('W/S or arrows drive, Space handbrake, R reset, T assists, M mute, O demo', 5);
          break;
        default:
          break;
      }
    }
  }
}
