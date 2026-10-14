import { defaultTuning } from '../physics/catalog';
import { degrees } from '../physics/math';
import type { Simulation } from '../physics/simulation';
import type { Tuning } from '../physics/types';
import { el } from './dom';

interface SliderDefinition { label: string; section: keyof Tuning; key: string; min: number; max: number; step: number; unit?: string }
const sliders: SliderDefinition[] = [
  { label: 'OVERALL TIRE GRIP', section: 'tires', key: 'gripScale', min: .3, max: 1.6, step: .01, unit: '×' },
  { label: 'FRONT STIFFNESS', section: 'tires', key: 'frontStiffness', min: 1, max: 6, step: .05 },
  { label: 'REAR STIFFNESS', section: 'tires', key: 'rearStiffness', min: 1, max: 6, step: .05 },
  { label: 'YAW DAMPING', section: 'tires', key: 'yawDamping', min: .25, max: 4.5, step: .05 },
  { label: 'ENGINE FORCE', section: 'engine', key: 'forceScale', min: .4, max: 1.7, step: .01, unit: '×' },
  { label: 'STEER RATE', section: 'steering', key: 'turnRateDeg', min: 120, max: 450, step: 5, unit: '°/s' },
  { label: 'BRAKE DECEL', section: 'braking', key: 'deceleration', min: 6, max: 18, step: .25, unit: 'm/s²' },
  { label: 'ASSIST GAIN', section: 'steering', key: 'assistGain', min: 0, max: 1, step: .02 },
];

/** Section 9.12 diagnostics; sliders edit in-memory tuning, never source JSON. */
export class DebugPanel {
  private open = false;
  private sliderInputs: HTMLInputElement[] = [];

  constructor(private sim: Simulation, private toast: (text: string) => void) {
    el('debug-toggle').addEventListener('click', () => this.toggle());
    el('debug-close').addEventListener('click', () => this.toggle(false));
    el('tuning-reset').addEventListener('click', () => this.resetTuning());
    this.makeSliders();
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    el('debug-panel').hidden = !this.open;
    el('debug-toggle').setAttribute('aria-expanded', String(this.open));
  }

  update(fps: number): void {
    if (!this.open) return;
    const car = this.sim.player;
    const speed = Math.round(Math.hypot(car.velocity.x, car.velocity.y) * 3.6);
    el('dbg-speed').textContent = String(speed);
    el('dbg-rpm').textContent = String(Math.round(car.rpm));
    el('dbg-gear').textContent = `${car.gear} / 5`;
    el('dbg-fps').textContent = String(Math.round(fps));
    el('dbg-slip').textContent = `${degrees(car.slipAngle).toFixed(1)}°`;
    el('dbg-surface').textContent = car.surface.toUpperCase();
    el('dbg-front').textContent = `${Math.round(car.frontGripUsage * 100)}%${car.frontSliding ? ' SLIDE' : ''}`;
    el('dbg-rear').textContent = `${Math.round(car.rearGripUsage * 100)}%${car.rearSliding ? ' SLIDE' : ''}`;
    el('front-grip-fill').style.width = `${Math.min(100, car.frontGripUsage * 100)}%`;
    el('rear-grip-fill').style.width = `${Math.min(100, car.rearGripUsage * 100)}%`;
  }

  private setting(section: keyof Tuning, key: string, value?: number): number {
    const group = this.sim.tuning[section] as unknown as Record<string, number>;
    if (value !== undefined) group[key] = value;
    return group[key];
  }

  private makeSliders(): void {
    const root = el('tuning-sliders');
    for (const def of sliders) {
      const row = document.createElement('label');
      row.className = 'slider-row';
      const caption = document.createElement('span');
      const title = document.createElement('span'); title.textContent = def.label;
      const output = document.createElement('output');
      caption.append(title, output);
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(def.min); input.max = String(def.max); input.step = String(def.step);
      input.value = String(this.setting(def.section, def.key));
      output.textContent = `${Number(input.value).toFixed(def.step < 1 ? 2 : 0)}${def.unit ?? ''}`;
      input.addEventListener('input', () => {
        this.setting(def.section, def.key, Number(input.value));
        output.textContent = `${Number(input.value).toFixed(def.step < 1 ? 2 : 0)}${def.unit ?? ''}`;
      });
      row.append(caption, input);
      root.append(row);
      this.sliderInputs.push(input);
    }
  }

  private resetTuning(): void {
    const baseline = defaultTuning();
    for (const [index, def] of sliders.entries()) {
      const reference = (baseline[def.section] as unknown as Record<string, number>)[def.key];
      this.setting(def.section, def.key, reference);
      const input = this.sliderInputs[index];
      input.value = String(reference);
      input.dispatchEvent(new Event('input'));
    }
    this.toast('TUNING DEFAULTS RESTORED');
  }
}
