import type { CarState, SimEvent, Tuning } from '../physics/types';

// Tiny synthesized engine: no downloads, RPM drives oscillator pitch directly.
// AudioContext is created only after an explicit click (browser autoplay policy).
export class EngineAudio {
  private context?: AudioContext;
  private engine?: OscillatorNode;
  private turbo?: OscillatorNode;
  private engineGain?: GainNode;
  private turboGain?: GainNode;
  private filter?: BiquadFilterNode;
  enabled = false;

  async toggle(): Promise<boolean> {
    if (!this.context) {
      this.context = new AudioContext();
      const context = this.context;
      this.engine = context.createOscillator();
      this.engine.type = 'sawtooth';
      this.turbo = context.createOscillator();
      this.turbo.type = 'triangle';
      this.engineGain = context.createGain();
      this.turboGain = context.createGain();
      this.filter = context.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 440;
      this.engineGain.gain.value = 0;
      this.turboGain.gain.value = 0;
      this.engine.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(context.destination);
      this.turbo.connect(this.turboGain);
      this.turboGain.connect(context.destination);
      this.engine.start();
      this.turbo.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.engineGain?.gain.setTargetAtTime(0, this.context.currentTime, .04);
      this.turboGain?.gain.setTargetAtTime(0, this.context.currentTime, .04);
    }
    return this.enabled;
  }

  update(car: CarState, tuning: Tuning, throttle: number): void {
    if (!this.enabled || !this.context || !this.engine || !this.engineGain || !this.turbo || !this.turboGain || !this.filter) return;
    const now = this.context.currentTime;
    const ratio = car.rpm / tuning.engine.redlineRpm;
    // Four-cylinder firing frequency + subharmonic. The shift cut dips both
    // pitch and gain for 120 ms; limiter briefly cuts gain at redline.
    const shiftDip = car.shiftCut > 0 ? .73 : 1;
    this.engine.frequency.setTargetAtTime((65 + car.rpm * .024) * shiftDip, now, .025);
    this.filter.frequency.setTargetAtTime(280 + ratio * 1050, now, .06);
    this.engineGain.gain.setTargetAtTime(car.limiterOn || car.wrecked ? 0 : (0.007 + .019 * throttle + .007 * ratio) * (car.shiftCut > 0 ? .28 : 1), now, .025);
    this.turbo.frequency.setTargetAtTime(160 + car.rpm * .03, now, .03);
    this.turboGain.gain.setTargetAtTime(car.nitroActive ? .012 : 0, now, .06);
  }

  event(event: SimEvent): void {
    if (!this.enabled || !this.context || event.carId !== 'player') return;
    if (!['nearMiss', 'driftBank', 'impact', 'pickup', 'wreck'].includes(event.type)) return;
    const ctx = this.context, now = ctx.currentTime;
    const gain = ctx.createGain(), osc = ctx.createOscillator();
    osc.type = event.type === 'impact' || event.type === 'wreck' ? 'sawtooth' : 'sine';
    const frequency = event.type === 'impact' ? 85 : event.type === 'wreck' ? 60 : event.type === 'pickup' ? 820 : 540;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * (event.type === 'impact' ? .4 : 1.3)), now + .18);
    gain.gain.setValueAtTime(.055, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + .23);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
}
