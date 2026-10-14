import { clamp } from '../physics/math';
import type { DriveInput } from '../physics/types';

export class Controls {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private pointerSteer = 0;
  private pointerActive = false;
  private tiltActive = false;
  private tiltValue = 0;
  private assist = 1;
  onReset: () => void = () => {};
  onDebug: () => void = () => {};
  onToast: (message: string) => void = () => {};

  constructor() {
    window.addEventListener('keydown', event => {
      if (this.isEditing(event.target)) return;
      const key = event.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
      if (!event.repeat && key === 'r') this.onReset();
      if (!event.repeat && (key === 't' || key === '`')) this.onDebug();
      this.keys.add(key);
    });
    window.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.pressed.clear(); this.pointerActive = false; this.pointerSteer = 0; this.updateSteerThumb(); });
    const pad = document.getElementById('steer-pad')!;
    const update = (event: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      this.pointerSteer = clamp(((event.clientX - rect.left) / rect.width - .5) * 2.5, -1, 1);
      this.updateSteerThumb();
    };
    pad.addEventListener('pointerdown', event => {
      event.preventDefault();
      pad.setPointerCapture(event.pointerId);
      this.pointerActive = true;
      update(event);
    });
    pad.addEventListener('pointermove', event => { if (this.pointerActive && pad.hasPointerCapture(event.pointerId)) update(event); });
    const releasePad = () => { this.pointerActive = false; this.pointerSteer = 0; this.updateSteerThumb(); };
    pad.addEventListener('pointerup', releasePad);
    pad.addEventListener('pointercancel', releasePad);
    pad.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.pointerActive = true; this.pointerSteer = event.key === 'ArrowLeft' ? -.65 : .65; this.updateSteerThumb(); }
    });
    pad.addEventListener('keyup', releasePad);
    document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
      const name = button.dataset.control!;
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.pressed.add(name);
        button.classList.add('pressed');
      });
      const release = () => { this.pressed.delete(name); button.classList.remove('pressed'); };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
    });
    document.getElementById('assist-select')?.addEventListener('change', event => {
      this.assist = Number((event.target as HTMLSelectElement).value);
      this.updateAssistButton();
    });
    document.getElementById('assist-cycle')?.addEventListener('click', () => {
      const levels = [1, .4, 0];
      const next = levels[(levels.indexOf(this.assist) + 1) % levels.length];
      const select = document.getElementById('assist-select') as HTMLSelectElement;
      select.value = String(next);
      select.dispatchEvent(new Event('change'));
      this.onToast(`STEERING ASSIST // ${next === 1 ? 'NOVICE' : next ? 'STREET' : 'PRO'}`);
    });
    document.getElementById('tilt-toggle')?.addEventListener('click', () => void this.toggleTilt());
    window.addEventListener('deviceorientation', event => {
      if (this.tiltActive && event.gamma !== null) this.tiltValue = clamp(event.gamma / 27, -1, 1);
    });
  }

  private isEditing(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, [contenteditable]'));
  }

  private updateSteerThumb(): void {
    const thumb = document.getElementById('steer-thumb')!;
    thumb.style.transform = `translateX(${this.pointerSteer * 40}px)`;
    document.getElementById('steer-pad')!.setAttribute('aria-valuenow', String(Math.round(this.pointerSteer * 100)));
  }

  private updateAssistButton(): void {
    const button = document.getElementById('assist-cycle');
    if (!button) return;
    button.textContent = this.assist === 1 ? 'A:ON' : this.assist ? 'A:LT' : 'A:OFF';
    button.setAttribute('aria-label', `Steering assist: ${this.assist === 1 ? 'novice' : this.assist ? 'street' : 'pro'}. Tap to cycle difficulty`);
    button.classList.toggle('active', this.assist > 0);
  }

  private async toggleTilt(): Promise<void> {
    if (!('DeviceOrientationEvent' in window)) { this.onToast('TILT NOT AVAILABLE'); return; }
    if (!this.tiltActive) {
      // iOS requires a user-gesture permission request; Android does not.
      const orientationType = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
      if (orientationType.requestPermission) {
        try {
          if (await orientationType.requestPermission() !== 'granted') { this.onToast('TILT PERMISSION DENIED'); return; }
        } catch { this.onToast('TILT PERMISSION DENIED'); return; }
      }
    }
    this.tiltActive = !this.tiltActive;
    document.getElementById('tilt-toggle')?.classList.toggle('active', this.tiltActive);
    this.onToast(this.tiltActive ? 'TILT STEERING ON' : 'TILT STEERING OFF');
  }

  read(): DriveInput {
    const keySteer = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
    const touchDriving = this.pointerActive || this.tiltActive || this.pressed.size > 0;
    return {
      steer: this.pointerActive ? this.pointerSteer : this.tiltActive ? this.tiltValue : keySteer,
      throttle: Number(this.keys.has('w') || this.keys.has('arrowup') || this.pressed.has('throttle')),
      brake: Number(this.keys.has('s') || this.keys.has('arrowdown') || this.pressed.has('brake')),
      handbrake: this.keys.has(' ') || this.pressed.has('handbrake'),
      nitro: this.keys.has('shift') || this.pressed.has('nitro'),
      source: touchDriving ? 'analog' : 'keyboard',
      assist: touchDriving ? this.assist : 0,
    };
  }
}
