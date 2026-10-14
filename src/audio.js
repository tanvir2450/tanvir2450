/**
 * audio.js - SECTION 9.2's audio half.
 *
 * The engine note is synthesised from the telemetry the drivetrain reports:
 *   pitch  <- rpm (rpmDisplay, so wheelspin and the limiter are audible)
 *   level  <- rpm + throttle/overrun
 *   dip    <- a short gain/pitch dip on every gear change
 *   cutoff <- the rev limiter gates the tone in short cycles at redline
 * Tyre screech (band-passed noise) follows the tire grip utilisation and the
 * surface, and wind follows speed. Every constant comes from data/audio.json.
 *
 * If WebAudio is unavailable (tests, headless) every method is a no-op.
 */

import { clamp, clamp01 } from './mathx.js';

export class AudioEngine {
  /**
   * @param {object} audio resolved data/audio.json
   */
  constructor(audio, options = {}) {
    this.cfg = audio;
    this.muted = options.muted ?? audio.master.muteByDefault ?? false;
    this.ready = false;
    this.context = null;
    this.nodes = null;
    this.forcedDip = 0;
    this.lastGear = 1;
    this.lastLimiterCut = false;
  }

  get supported() {
    return typeof window !== 'undefined' && typeof (window.AudioContext ?? window.webkitAudioContext) === 'function';
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async resume() {
    if (!this.supported) return false;
    if (!this.context) {
      const Ctor = window.AudioContext ?? window.webkitAudioContext;
      this.context = new Ctor();
      this.build();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.ready = true;
    return true;
  }

  build() {
    const ctx = this.context;
    const cfg = this.cfg;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : cfg.master.volume;
    master.connect(ctx.destination);

    const engineBus = ctx.createGain();
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = cfg.engine.lowpassIdleHz;
    engineFilter.Q.value = 0.7;
    engineBus.connect(engineFilter);
    engineFilter.connect(master);

    const harmonics = cfg.engine.harmonics.map((h) => {
      const osc = ctx.createOscillator();
      osc.type = h.waveform;
      osc.frequency.value = 40 * h.multiple;
      const gain = ctx.createGain();
      gain.gain.value = h.gain;
      osc.connect(gain);
      gain.connect(engineBus);
      osc.start();
      return { osc, gain, multiple: h.multiple, base: h.gain };
    });

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const makeNoise = (type, frequency, q, gainValue) => {
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start();
      return { source, filter, gain };
    };

    const tire = makeNoise('bandpass', (cfg.tires.screechBandHz[0] + cfg.tires.screechBandHz[1]) / 2, cfg.tires.screechQ, 0);
    const surface = makeNoise('bandpass', (cfg.surface.dustBandHz[0] + cfg.surface.dustBandHz[1]) / 2, 1.1, 0);
    const wind = makeNoise('bandpass', (cfg.surface.windBandHz[0] + cfg.surface.windBandHz[1]) / 2, 0.8, 0);

    this.nodes = { master, engineBus, engineFilter, harmonics, tire, surface, wind };
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.nodes) {
      this.nodes.master.gain.setTargetAtTime(muted ? 0 : this.cfg.master.volume, this.context.currentTime, 0.05);
    }
  }

  /** Engine tone for a car - every car sounds different. */
  setCar(car, sampleRate = 1) {
    this.carAudio = { ...car.engine.audio, redlineRpm: car.engine.redlineRpm };
    if (!this.nodes) return;
    this.nodes.harmonics.forEach((h, i) => {
      h.base = this.cfg.engine.harmonics[i].gain * (0.6 + 0.7 * (car.engine.audio.brightness ?? 0.5)) * sampleRate;
    });
  }

  playImpact(strength = 0.5) {
    if (!this.ready || !this.nodes || this.muted) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 120;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(clamp01(strength) * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.2);
    osc.connect(gain);
    gain.connect(this.nodes.master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * @param {number} dt
   * @param {object} telemetry car.telemetry()
   * @param {{throttle:number, brake:number, handbrake:boolean}} input
   */
  update(dt, telemetry, input) {
    if (!this.ready || !this.nodes) return;
    const cfg = this.cfg;
    const ctx = this.context;
    const now = ctx.currentTime;
    const engine = telemetry.engine;
    const carAudio = this.carAudio ?? { toneHz: 50, brightness: 0.5, redlineRpm: 7000 };
    const rpm = engine?.rpmDisplay ?? 0;
    const rpmPct = engine?.rpmPct ?? 0;

    /* ---- gear change dip --------------------------------------- */
    if (engine && engine.gear !== this.lastGear) {
      this.forcedDip = cfg.engine.shiftDipMs / 1000;
      this.lastGear = engine.gear;
    }
    this.forcedDip = Math.max(0, this.forcedDip - dt);

    /* ---- engine pitch + level ---------------------------------- */
    const baseFreq = carAudio.toneHz * (rpm / 1000);
    const pitchScale = this.forcedDip > 0 ? 1 - cfg.engine.shiftDipPitchPct : 1;
    for (const h of this.nodes.harmonics) {
      const freq = Math.max(20, baseFreq * h.multiple * pitchScale);
      h.osc.frequency.setTargetAtTime(freq, now, 0.03);
    }
    const filterFreq =
      cfg.engine.lowpassIdleHz + (cfg.engine.lowpassRedlineHz - cfg.engine.lowpassIdleHz) * clamp01(rpmPct * (0.5 + 0.5 * (carAudio.brightness ?? 0.5)));
    this.nodes.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.06);

    const loadScale = input.throttle > 0.05 ? 1 : cfg.engine.gainOffThrottlePct;
    const limiterGate =
      engine?.limiterCut === true ? cfg.engine.limiterCutGainPct : engine?.limiterActive ? 0.72 + 0.28 * ((Math.sin(now * cfg.engine.limiterGateHz) + 1) / 2) : 1;
    const dip = this.forcedDip > 0 ? cfg.engine.shiftDipPct : 1;
    const volume = (cfg.engine.gainIdlePct + (cfg.engine.gainRedlinePct - cfg.engine.gainIdlePct) * clamp01(rpmPct)) * loadScale * limiterGate * dip;
    this.nodes.engineBus.gain.setTargetAtTime(clamp(volume, 0, 1.4) * 0.5, now, 0.04);

    /* ---- tyre screech ------------------------------------------ */
    const front = telemetry.front;
    const rear = telemetry.rear;
    const asphalt = telemetry.surface === 'asphalt' || telemetry.surface === 'wet';
    const usage = Math.max(front?.usageLat ?? 0, rear?.usageLat ?? 0, (rear?.wheelspin ?? 0) * 1.4);
    const screech = asphalt ? clamp01((usage - cfg.tires.screechUsageThreshold) / 0.9) : 0;
    this.nodes.tire.gain.gain.setTargetAtTime(screech * cfg.tires.volumeAtFullSlip, now, 0.05);
    const jitter = 1 + cfg.tires.pitchJitterPct * Math.sin(now * 37);
    this.nodes.tire.filter.frequency.setTargetAtTime(
      (cfg.tires.screechBandHz[0] + (cfg.tires.screechBandHz[1] - cfg.tires.screechBandHz[0]) * clamp01(usage * 0.5)) * jitter,
      now,
      0.08
    );

    /* ---- dust / spray / wind ----------------------------------- */
    const loose = !asphalt && usage > 0.8;
    const looseGain = clamp01((usage - 0.8) / 1.2) * cfg.surface.volumeAtFullSlip;
    this.nodes.surface.gain.gain.setTargetAtTime(loose ? looseGain : 0, now, 0.08);
    const windPct = clamp01((telemetry.speedMs - cfg.surface.windStartSpeedMs) / Math.max(1, cfg.surface.windFullSpeedMs - cfg.surface.windStartSpeedMs));
    this.nodes.wind.gain.gain.setTargetAtTime(windPct * cfg.surface.windVolume, now, 0.15);
  }

  dispose() {
    if (this.context) this.context.close?.();
    this.context = null;
    this.nodes = null;
    this.ready = false;
  }
}
