import { EngineAudio } from '../systems/AudioManager';
import { Controls } from '../systems/Input';
import { DriveScene } from '../scenes/DriveScene';
import { catalog, tracks } from '../physics/catalog';
import { clamp, forward } from '../physics/math';
import { Simulation } from '../physics/simulation';
import type { HitZone, SimEvent } from '../physics/types';
import { DebugPanel } from '../utils/DebugPanel';
import { el } from '../utils/dom';

export class HUD {
  private sim: Simulation;
  private scene: DriveScene;
  private controls: Controls;
  private audio: EngineAudio;
  private lastDraw = -1;
  private mapDraw = -1;
  private debug: DebugPanel;

  constructor(sim: Simulation, scene: DriveScene, controls: Controls, audio: EngineAudio) {
    this.sim = sim; this.scene = scene; this.controls = controls; this.audio = audio;
    this.debug = new DebugPanel(sim, message => this.toast(message));
    const carSelect = el<HTMLSelectElement>('car-select');
    const trackSelect = el<HTMLSelectElement>('track-select');
    for (const car of catalog.cars) carSelect.add(new Option(catalog.presentation[car.id].name.toUpperCase(), car.id));
    for (const track of tracks) trackSelect.add(new Option(track.config.name.toUpperCase(), track.config.id));
    carSelect.value = sim.player.profile.id;
    trackSelect.value = sim.track.config.id;
    carSelect.addEventListener('change', () => this.reset());
    trackSelect.addEventListener('change', () => this.reset());
    el('reset-button').addEventListener('click', () => this.reset());
    el('service-button').addEventListener('click', () => this.sim.service());
    el('sound-toggle').addEventListener('click', () => void this.toggleAudio());
    controls.onReset = () => this.reset();
    controls.onDebug = () => this.debug.toggle();
    controls.onToast = message => this.toast(message);
    this.updateVehicle();
    this.drawMap();
    this.update(60, true);
  }

  private async toggleAudio(): Promise<void> {
    try {
      const on = await this.audio.toggle();
      el('sound-label').textContent = on ? 'ON' : 'OFF';
      el('sound-toggle').setAttribute('aria-label', on ? 'Mute engine sound' : 'Turn on engine sound');
    } catch { this.toast('AUDIO UNAVAILABLE'); }
  }

  private reset(): void {
    const carId = el<HTMLSelectElement>('car-select').value;
    const trackId = el<HTMLSelectElement>('track-select').value;
    this.sim.reset(carId, trackId);
    this.scene.rebuild();
    this.updateVehicle();
    this.drawMap();
    this.toast('RUN RESET // GO!');
  }

  private updateVehicle(): void {
    const car = this.sim.player.profile, art = this.sim.player.art;
    const index = catalog.cars.indexOf(car) + 1;
    el('car-counter').textContent = `${String(index).padStart(2, '0')} / ${String(catalog.cars.length).padStart(2, '0')}`;
    el('vehicle-name').textContent = art.name;
    el('vehicle-class').textContent = art.class;
    el('vehicle-tagline').textContent = art.tagline;
    el('vehicle-name').style.textShadow = `0 0 20px ${art.paint}70`;
    el('stat-power').style.width = `${clamp(car.enginePower / 510, 0, 1) * 100}%`;
    el('stat-grip').style.width = `${clamp((car.gripFront + car.gripRear) / 2 / 1.18, 0, 1) * 100}%`;
    el('stat-armor').style.width = `${clamp(car.armor / 9, 0, 1) * 100}%`;
    el('stat-power-label').textContent = `${car.enginePower} hp`;
    el('stat-grip-label').textContent = ((car.gripFront + car.gripRear) / 2).toFixed(2);
    el('stat-armor-label').textContent = String(car.armor);
    el('route-description').textContent = this.sim.track.config.subtitle;
    el('route-id').textContent = this.sim.track.config.code;
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const event of events) {
      this.audio.event(event);
      if (event.carId !== 'player' && event.type !== 'service') continue;
      if (event.type === 'driftStart') this.toast('DRIFT // HOLD IT');
      if (event.type === 'driftBank') this.toast(`${event.text} +${event.value}`, 'gold');
      if (event.type === 'driftCrash') this.toast('COMBO LOST', 'warning');
      if (event.type === 'nearMiss') this.toast('CLOSE CALL! +N₂O', 'gold');
      if (event.type === 'pickup') this.toast('FREE QUICK REPAIR', 'gold');
      if (event.type === 'wreck') this.toast('WRECKED // PRESS R', 'warning');
      if (event.type === 'service' && event.text) this.toast(event.text, event.text.includes('REPAIRED') ? 'gold' : 'warning');
    }
  }

  toast(message: string, kind = ''): void {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    const root = el('toast-container');
    root.append(node);
    if (root.childElementCount > 3) root.firstElementChild?.remove();
    window.setTimeout(() => node.remove(), 1800);
  }

  update(fps: number, force = false): void {
    const now = performance.now();
    this.audio.update(this.sim.player, this.sim.tuning, this.controls.read().throttle);
    if (!force && now - this.lastDraw < 40) return;
    this.lastDraw = now;
    const car = this.sim.player, t = this.sim.tuning;
    const speed = Math.round(Math.hypot(car.velocity.x, car.velocity.y) * 3.6);
    el('speed-value').textContent = String(speed).padStart(3, '0');
    el('rpm-value').textContent = (car.rpm / 1000).toFixed(1);
    el('gear-value').textContent = String(car.gear);
    el('rpm-fill').style.width = `${Math.round(car.rpm / t.engine.redlineRpm * 100)}%`;
    el('rpm-fill').style.opacity = car.limiterOn ? '.3' : '1';
    const health = clamp(car.health / t.damage.maxHealth, 0, 1);
    el('health-fill').style.width = `${Math.round(health * 100)}%`;
    el('health-value').textContent = `${Math.round(health * 100)}%`;
    el('nitro-fill').style.width = `${Math.round(car.nitro / car.profile.nitroCapacity * 100)}%`;
    el('nitro-value').textContent = car.nitroLock > 0 ? 'HOT' : `${Math.round(car.nitro / car.profile.nitroCapacity * 100)}%`;
    el('coin-value').textContent = String(this.sim.coins);
    el('car-status').textContent = car.wrecked ? 'WRECKED · RESET RUN' : health < t.damage.fireAt ? 'ENGINE FIRE · CRITICAL' : health < t.damage.smokeAt ? 'DAMAGE · SMOKE' : car.surface === 'oil' ? 'OIL · NO TRACTION' : 'SYSTEMS NOMINAL';
    el('car-status').style.color = health < t.damage.fireAt ? '#ff4d4d' : '';
    el('surface-label').textContent = `${car.surface.toUpperCase()} // ${Math.round(catalog.surfaces[car.surface].grip * 100)}% GRIP`;
    el('drift-status').innerHTML = car.drifting ? `DRIFT <b>×${car.driftCombo} · ${Math.round(car.driftUnbanked)}</b>` : 'DRIFT <b>—</b>';
    el('style-value').textContent = `STYLE ${String(Math.round(this.sim.styleScore)).padStart(5, '0')}`;
    el('draft-status').textContent = car.drafting ? '◉ SLIPSTREAM +6%' : '◌ NO DRAFT';
    el('draft-status').classList.toggle('active', car.drafting);
    const sec = this.sim.time % 60;
    el('timer-label').textContent = `${String(Math.floor(this.sim.time / 60)).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
    const cost = this.sim.repairCost;
    el('service-cost').textContent = cost ? `${cost} CR` : '—';
    (el('service-button') as HTMLButtonElement).disabled = !cost || this.sim.player.wrecked || cost > this.sim.coins;
    for (const [zone, value] of Object.entries(car.zones)) {
      const indicator = document.querySelector<HTMLElement>(`[data-zone="${zone as HitZone}"]`);
      if (indicator) { indicator.style.backgroundColor = value > .6 ? '#ff4d4d' : value > .22 ? '#ffd23f' : '#7dffb3'; indicator.title = `${zone}: ${Math.round(value * 100)}% damage`; }
    }
    this.debug.update(fps);
    if (force || now - this.mapDraw > 90) { this.mapDraw = now; this.drawMap(); }
  }

  private drawMap(): void {
    const canvas = el<HTMLCanvasElement>('minimap-canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas, track = this.sim.track;
    const bounds = track.bounds;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#081622'; ctx.fillRect(0, 0, width, height);
    const scale = Math.min((width - 14) / (bounds.maxX - bounds.minX), (height - 14) / (bounds.maxY - bounds.minY));
    const left = (width - (bounds.maxX - bounds.minX) * scale) / 2;
    const top = (height - (bounds.maxY - bounds.minY) * scale) / 2;
    const point = (p: { x: number; y: number }) => ({ x: left + (p.x - bounds.minX) * scale, y: top + (p.y - bounds.minY) * scale });
    ctx.beginPath();
    track.points.forEach((p, i) => { const { x, y } = point(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
    ctx.strokeStyle = '#183c4f'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = '#64929b'; ctx.lineWidth = 2; ctx.stroke();
    for (const patch of track.config.patches) {
      const p = point(patch);
      ctx.fillStyle = patch.surface === 'wet' ? '#2ee6ff' : patch.surface === 'oil' ? '#ff2e97' : '#ff8a3d';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI); ctx.fill();
    }
    if (this.sim.repairAvailable) { const p = point(track.config.repair); ctx.fillStyle = '#7dffb3'; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
    for (const car of this.sim.cars) {
      const p = point(car.position);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(car.heading);
      ctx.fillStyle = car.id === 'player' ? '#00e5ff' : car.art.paint;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = car.id === 'player' ? 8 : 2;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // Small heading arrow projected ahead of the player.
    const p = point(this.sim.player.position), f = forward(this.sim.player.heading);
    ctx.strokeStyle = '#00e5ff80'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + f.x * 13, p.y + f.y * 13); ctx.stroke();
  }
}
