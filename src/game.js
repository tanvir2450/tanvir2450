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
import { Effects } from './fx.js';
import { DriftScore } from './drift.js';
import { LapTimer, headingAt } from './track.js';
import { Autopilot } from './ai.js';
import { Traffic } from './traffic.js';
import { Economy } from './economy.js';

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
    // 9.4: difficulty scales the mobile steering assist (data, not code).
    this.difficulty = this.config.defaultDifficulty ?? { id: 'normal', label: 'Normal', assistPct: 1 };
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
    // 9.10 traffic: rivals are real cars driven by the same autopilot.
    this.traffic = new Traffic(config, track, { makeCar: (def) => new Car(def, config, { assists: false }) });
    this.traffic.spawn(config.cars.filter((c) => c.id !== config.cars[this.carIndex].id));
    this.traffic.attachAutopilot(() => new Autopilot(track, config));
    // Coins, star challenges and the repair sink (9.6 / 9.9).
    this.economy = new Economy(config);
    // 9.8 hit-stop: a short world freeze on a big impact.
    this.hitStopTimer = 0;
    this.hitStopDuration = 0;
    this.nearMisses = 0;
    this.lastNearMiss = null;
    this.spawnCar();
  }

  spawnCar() {
    const def = this.config.cars[this.carIndex];
    this.car = new Car(def, this.config, { assists: this.assists });
    this.reset();
    this.audio?.setCar?.(def);
    // Rivals never drive the car the player picked: seeing your own livery in
    // the mirrors is confusing, and it would give the player a clone to race.
    this.traffic?.spawn(this.config.cars.filter((c) => c.id !== def.id));
    this.traffic?.attachAutopilot(() => new Autopilot(this.track, this.config));
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
    this.traffic?.reset();
    this.hitStopTimer = 0;
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
    let input = this.input.sample(frameSeconds);
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
    // 9.4: the mobile steering assist needs the road direction, which is a track
    // query, so the game computes it and passes it in as `input.assist`.
    const assistActive = this.assists && (this.input.lastDevice === 'touch' || this.input.touchOnly === true);
    this.assistSteer = assistActive
      ? this.car.steering.updateAssist(frameSeconds, {
          active: true,
          heading: this.car.heading,
          desiredHeading: headingAt(this.track, this.car.x, this.car.y),
          speedMs: this.car.speedMs,
          drifting: this.drift.drifting,
          // 9.4: harder difficulty -> less help. Master is 0.
          strengthPct: this.config.tuning.steering.assistSteerPct * this.difficulty.assistPct
        })
      : this.car.steering.updateAssist(frameSeconds, { active: false });

    this.accumulator += this.paused ? 0 : frameSeconds;
    let steps = 0;
    while (this.accumulator >= this.physicsDt && steps < this.config.tuning.simulation.maxSubSteps * 4) {
      // The driver thinks once per fixed step, so the demo is frame-rate
      // independent in exactly the same way the physics is.
      const stepInput = driven
        ? { ...this.autopilot.update(this.physicsDt, this.car, { obstacles: this.traffic.obstacles() }) }
        : { ...input };
      stepInput.assist = this.assistSteer;
      stepInput.nitro = driven ? Boolean(stepInput.throttle > 0.9 && this.car.speedMs > 26) : Boolean(input.nitro);
      stepInput.driftBoost = this.drift.boostMultiplier;
      stepInput.slipstream = this.traffic.slipstream?.active ? this.traffic.slipstream.strength : 0;
      this.camera.boostZoom = this.car.nitroState?.active ? 1 - this.config.tuning.nitro.cameraZoomOutPct : 1;
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
      traffic: this.traffic,
      hud: {
        nextGateIndex: this.lapTimer.nextGate,
        nearMiss: this.nearMissFlash > 0 ? this.lastNearMiss : null
      }
    });
    this.hud?.update(frameSeconds, telemetry, {
      lapTimer: this.lapTimer,
      drift: this.drift,
      assists: this.assists,
      muted: this.audio?.muted ?? false,
      debug: this.debug,
      fps: this.fps,
      lapJustCompleted: this.lapJustCompleted,
      economy: this.economy,
      traffic: this.traffic,
      nearMiss: this.nearMissFlash > 0 ? this.lastNearMiss : null,
      demo: this.demo
    });
    this.audio?.update(frameSeconds, telemetry, input);
    this.nearMissFlash = Math.max(0, (this.nearMissFlash ?? 0) - frameSeconds);
    this.renderer.speedLinePhase = (this.renderer.speedLinePhase + frameSeconds * 3.2) % (Math.PI * 2);
  }

  /** One fixed physics tick. */
  step(dt, input) {
    const car = this.car;
    const prevX = car.x;
    const prevY = car.y;

    /* ---- 9.8 hit-stop ------------------------------------------ */
    // A big impact freezes the whole simulation for a few frames. The camera
    // keeps shaking and the effects keep settling, so the freeze reads as weight
    // rather than as a dropped frame.
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      this.camera.update(dt, car);
      return;
    }

    car.step(dt, input, this.track.world);

    /* ---- 9.10 traffic: rivals drive, and the player is rewarded - */
    const traffic = this.traffic.update(dt, car);
    if (traffic.slipstream.active) {
      car.nitro.fillFromSlipstream(dt, traffic.slipstream.strength);
    }
    for (const nearMiss of traffic.nearMisses) {
      car.nitro.fillFromNearMiss();
      const stars = this.economy.bankNearMiss();
      this.nearMisses += 1;
      this.lastNearMiss = { ...nearMiss, at: this.lapTimer.lapTime };
      this.nearMissFlash = 1.6;
      const strength = Math.min(1, car.speedMs / 25);
      this.camera.addShake(0.06 * strength);
      this.effects.spawnNearMiss?.(nearMiss, car);
      this.hud?.message(stars.length ? `Close Call!  ★ ${stars[0].name}` : `Close Call!  +${this.config.tuning.economy.coinsPerNearMiss}`, 1.4);
      this.audio?.playNearMiss?.(strength);
    }

    /* ---- 9.9 damage from every impact, both cars -------------- */
    for (const event of car.impactEvents) this.onImpact(event, car, dt);
    for (const rival of this.traffic.rivals) {
      for (const event of rival.car.impactEvents) this.onImpact(event, rival.car, dt, true);
    }

    /* ---- 9.6 drift: score, nitro charge, coins, clean exit ----- */
    const driftGain = this.drift.update(dt, car);
    if (driftGain.nitroCharge > 0) car.nitro.fillFromDrift(driftGain.nitroCharge);
    if (driftGain.coins > 0) {
      const banked = this.economy.bankDrift(this.drift.bestBank > 0 ? this.drift.bestBank : driftGain.coins);
      for (const star of banked.stars) this.hud?.message(`★ ${star.name}!  +${star.reward} coins`, 3);
    }

    this.camera.update(dt, car);
    this.effects.update(dt, car);
    this.lapTimer.update(dt, car, prevX, prevY);
    if (this.lapTimer.lastLap !== null && this.lapTimer.splits.length === 0 && this.lapTimer.lapTime < 0.2) {
      this.lapJustCompleted = 1.2;
      // A finished lap pays coins and re-checks the lap challenge.
      const stars = this.economy.bankLap(this.lapTimer.lastLap);
      for (const star of stars) this.hud?.message(`★ ${star.name}!  +${star.reward} coins`, 3);
    }
    // Speed and total-health challenges are checked (and announced) every tick;
    // the economy only fires the message on the tick a star is actually earned.
    for (const star of this.economy.bankSpeed(car.speedMs * 3.6)) {
      this.hud?.message(`★ ${star.name}!  +${star.reward} coins`, 3);
    }
    this.economy.bankHealth(car.damage.healthPct);

    for (const event of this.drift.events) {
      if (event.type === 'bank' && event.points > 25) this.hud?.message(`+${event.points} drift  x${event.combo.toFixed(2)}`, 1.1);
      if (event.type === 'spin') this.hud?.message(`Spin! -${event.lost}`, 1.6);
      if (event.type === 'cleanExit') this.hud?.message(`Clean exit!  +${Math.round(event.boost * 100)}% boost`, 1.2);
      if (event.type === 'crashCancel') this.hud?.message(`Combo lost! -${event.lost}`, 1.4);
    }
    this.drift.events.length = 0;

    for (const event of this.economy.takeEvents()) {
      if (event.type === 'star') this.hud?.message(`★ ${event.name}!  +${event.reward} coins`, 3);
    }

    // Wreck: the car is out for damage.wreckSeconds and then returns repaired
    // enough to drive (a game never leaves the player watching a corpse).
    if (car.damage.wrecked && car.damage.wreckTimer > this.config.tuning.damage.wreckSeconds) {
      const result = this.economy.repair(car.damage);
      if (result.ok) {
        this.hud?.message(result.free ? 'Quick repair used' : `Towed + repaired (-${result.cost} coins)`, 3);
      } else {
        this.pendingRepair = true;
        this.hud?.message(`Not enough coins to repair (${car.damage.repairCost()}) - F to try again`, 4);
      }
      car.damage.wreckTimer = 0;
    }
  }

  /** One impact event from the collision solver -> damage, hit-stop, FX, audio. */
  onImpact(event, target, dt, isRival = false) {
    const c = this.config.tuning.collision;
    const speed = event.speedMs ?? 0;
    const strength = Math.min(1, speed / 8);
    // Light rub: scrape damage and sparks, no impulse to speak of.
    if (speed > 0 && speed < c.hitStopMinImpactMs) {
      target.damage.applyScrape(dt, speed);
      if (speed > c.scrapeSparkSpeedMs) this.effects.spawnSparks?.(event, Math.min(1, speed / 8));
      if (!isRival) this.camera.addShake(0.035 * Math.min(1, speed / 6));
      return;
    }
    const hit = target.damage.applyImpact(event, target);
    if (!isRival) {
      // 9.6: a crash inside the drift window cancels the combo.
      if (hit && hit.speedMs > 2.5) this.drift.crash(Math.min(1, hit.speedMs / 10));
      this.camera.addShake((strength + (hit?.heavy ? 0.3 : 0)) * c.impactShakeScale);
      this.audio?.playImpact?.(strength, hit?.zone ?? 'front');
      this.effects.spawnImpact?.(event, strength);
      // 9.8: the freeze scales with how hard it was, up to hitStopMaxMs.
      if (speed >= c.hitStopMinImpactMs) {
        const scaled = (c.hitStopMs * speed) / Math.max(1, c.hitStopImpactMs);
        const duration = Math.min(c.hitStopMaxMs, Math.max(c.hitStopMs, scaled)) / 1000;
        if (duration > this.hitStopTimer) {
          this.hitStopTimer = duration;
          this.hitStopDuration = duration;
          this.car.hitStop = Math.max(this.car.hitStop, duration * 1000);
        }
      }
    }
    if (hit && hit.damage > 4) {
      this.hud?.message(
        isRival ? `${this.rivalName(target)} hit a wall` : `${hit.zone.toUpperCase()} damage  -${Math.round(hit.damage)}`,
        1.6
      );
    }
    if (hit?.wrecked) {
      this.effects.spawnWreck?.(target);
      this.audio?.playImpact?.(1, 'wreck');
      if (!isRival) this.camera.addShake(1.2);
      this.hud?.message('Wrecked!', 3);
    }
  }

  /** 9.4: pick a steering-assist difficulty by id (see tuning.assists.difficulty). */
  setDifficulty(id) {
    const level = this.config.difficultyFor ? this.config.difficultyFor(id) : this.difficulty;
    this.difficulty = level;
    if (typeof this.onDifficultyChanged === 'function') this.onDifficultyChanged(level);
    return level;
  }

  cycleDifficulty() {
    const levels = this.config.difficultyLevels ?? [this.difficulty];
    const index = levels.findIndex((level) => level.id === this.difficulty?.id);
    return this.setDifficulty(levels[(index + 1) % levels.length].id);
  }

  rivalName(car) {
    return car.name ?? car.id ?? 'rival';
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
        case 'difficulty': {
          const level = this.cycleDifficulty();
          this.hud?.message(`Difficulty: ${level.label}${level.assistPct > 0 ? ' - steering help on' : ' - no steering help'}`, 2.4);
          break;
        }
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
        case 'car1':
        case 'car2':
        case 'car3':
        case 'car4':
        case 'car5': {
          const index = Number(action.slice(3)) - 1;
          const def = this.config.cars[index];
          if (def) this.selectCar(def.id);
          break;
        }
        case 'repair': {
          // 9.9: repair costs coins, with one free quick repair per session.
          const result = this.economy.repair(this.car.damage);
          if (result.ok && result.restored > 0) {
            this.hud?.message(result.free ? 'Quick repair used (free)' : `Repaired -${result.cost} coins`, 2.4);
          } else if (result.ok) {
            this.hud?.message('Nothing to repair', 1.6);
          } else {
            this.hud?.message(`Repair costs ${result.cost} coins - you have ${Math.round(this.economy.coins)}`, 2.6);
          }
          break;
        }
        case 'help':
          this.hud?.message('W/S drive, Space handbrake, N nitro, F repair, R reset, T assists, Y difficulty, O demo, V camera, 1-5 car', 5);
          break;
        default:
          break;
      }
    }
  }
}
