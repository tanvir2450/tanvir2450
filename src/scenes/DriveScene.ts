import Phaser from 'phaser';
import { forward, interpolateAngle, lerp, right, type Vec2 } from '../physics/math';
import type { Track } from '../physics/track';
import { drawTrackTile, TILE_SIZE } from '../utils/TrackArt';
import { CAR_ATLAS_KEY } from './BootScene';
import { Simulation } from '../physics/simulation';
import type { CarState, DriveInput, SimEvent } from '../physics/types';

interface ActorArt {
  container: Phaser.GameObjects.Container;
  frontWheels: Phaser.GameObjects.Rectangle[];
  brakeLights: Phaser.GameObjects.Rectangle[];
  flame: Phaser.GameObjects.Graphics;
  scratches: Phaser.GameObjects.Graphics;
}
interface Particle {
  circle: Phaser.GameObjects.Arc;
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; radius: number;
}
interface Skid { x: number; y: number; age: number; angle: number }

const hex = (value: string): number => parseInt(value.slice(1), 16);
const oppositeColor = (h: string) => (h === '#e9eefc' ? 0x0c1827 : 0xffffff);

// Phaser renders only. All forces, timers, collisions and rewards are in Simulation.
export class DriveScene extends Phaser.Scene {
  private sim: Simulation;
  private getInput: () => DriveInput;
  private onFrame: (fps: number) => void;
  private onEvents: (events: SimEvent[]) => void;
  private accumulator = 0;
  private worldObjects: Phaser.GameObjects.GameObject[] = [];
  private tiles = new Map<string, { image: Phaser.GameObjects.Image; texture: string }>();
  private repairGraphic?: Phaser.GameObjects.Graphics;
  private actors = new Map<string, ActorArt>();
  private particles: Particle[] = [];
  private skids: Skid[] = [];
  private skidGraphics!: Phaser.GameObjects.Graphics;
  private draftGraphics!: Phaser.GameObjects.Graphics;
  private effectsClock = 0;
  private nitroClock = 0;
  private damageClock = 0;
  private cameraPoint = { x: 0, y: 0 };
  private initialized = false;

  constructor(sim: Simulation, getInput: () => DriveInput, onFrame: (fps: number) => void, onEvents: (events: SimEvent[]) => void) {
    super('Drive');
    this.sim = sim;
    this.getInput = getInput;
    this.onFrame = onFrame;
    this.onEvents = onEvents;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#101c29');
    this.skidGraphics = this.add.graphics().setDepth(4);
    this.draftGraphics = this.add.graphics().setDepth(7);
    this.particles = Array.from({ length: 150 }, () => ({
      circle: this.add.circle(0, 0, 5, 0xe2e6ed).setAlpha(0).setDepth(13).setVisible(false),
      x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, radius: 0,
    }));
    this.rebuild();
    this.initialized = true;
  }

  rebuild(): void {
    if (!this.skidGraphics) return;
    for (const object of this.worldObjects) object.destroy();
    this.worldObjects = [];
    for (const tile of this.tiles.values()) { tile.image.destroy(); this.textures.remove(tile.texture); }
    this.tiles.clear();
    for (const art of this.actors.values()) art.container.destroy();
    this.actors.clear();
    this.skids = [];
    this.accumulator = 0;
    this.skidGraphics.clear();
    this.draftGraphics.clear();
    for (const p of this.particles) { p.life = 0; p.circle.setVisible(false); }
    this.drawWorld(this.sim.track);
    for (const car of this.sim.cars) this.actors.set(car.id, this.createActor(car));
    const ppm = this.sim.tuning.simulation.pixelsPerMeter;
    const b = this.sim.track.bounds;
    this.cameras.main.setBounds(b.minX * ppm, b.minY * ppm, (b.maxX - b.minX) * ppm, (b.maxY - b.minY) * ppm);
    this.cameraPoint = { x: this.sim.player.position.x * ppm, y: this.sim.player.position.y * ppm };
    this.cameras.main.centerOn(this.cameraPoint.x, this.cameraPoint.y);
    this.refreshTiles(true);
    this.effectsClock = 0;
    this.nitroClock = 0;
    this.damageClock = 0;
  }

  update(_time: number, deltaMs: number): void {
    if (!this.initialized) return;
    const { simulation: config } = this.sim.tuning;
    const dt = 1 / config.hz;
    const frameDelta = Math.min(deltaMs / 1000, config.maxFrameSeconds);
    this.accumulator += frameDelta;
    let steps = 0;
    while (this.accumulator >= dt && steps < config.maxStepsPerFrame) {
      this.sim.step(this.getInput(), dt);
      this.accumulator -= dt;
      steps++;
    }
    if (steps === config.maxStepsPerFrame) this.accumulator = Math.min(this.accumulator, dt);
    const alpha = Math.min(1, this.accumulator / dt);
    this.renderCars(alpha);
    this.renderSkids(frameDelta);
    this.renderDraft();
    this.renderParticles(frameDelta);
    this.followCamera(alpha, frameDelta);
    this.refreshTiles();
    this.repairGraphic?.setVisible(this.sim.repairAvailable);
    const events = this.sim.consumeEvents();
    if (events.length) { this.playEffects(events); this.onEvents(events); }
    this.onFrame(this.game.loop.actualFps || 60);
  }

  private px(m: number): number { return m * this.sim.tuning.simulation.pixelsPerMeter; }
  private register<T extends Phaser.GameObjects.GameObject>(object: T): T { this.worldObjects.push(object); return object; }

  private drawWorld(track: Track): void {
    const repair = track.config.repair;
    const g = this.register(this.add.graphics().setDepth(3));
    g.fillStyle(0x1c8d64, 1).fillCircle(this.px(repair.x), this.px(repair.y), 17);
    g.lineStyle(3, 0x7dffb3, .85).strokeCircle(this.px(repair.x), this.px(repair.y), 19);
    g.lineStyle(5, 0xecfff5, 1);
    g.lineBetween(this.px(repair.x - .34), this.px(repair.y), this.px(repair.x + .34), this.px(repair.y));
    g.lineBetween(this.px(repair.x), this.px(repair.y - .34), this.px(repair.x), this.px(repair.y + .34));
    this.repairGraphic = g;
    for (const marker of track.config.markers) {
      const label = this.register(this.add.text(this.px(marker.x), this.px(marker.y), marker.text, {
        fontFamily: 'Rajdhani, sans-serif', fontSize: '17px', color: '#8ea9b8', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(3).setAlpha(.8));
      label.setStroke('#0d1e2c', 3);
    }
    for (const patch of track.config.patches) {
      if (patch.surface === 'oil') continue;
      this.register(this.add.text(this.px(patch.x), this.px(patch.y - patch.ry - 3), patch.label, {
        fontFamily: 'Rajdhani, sans-serif', fontSize: '16px', color: patch.surface === 'wet' ? '#78cfe3' : '#dbac69', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(3).setAlpha(.8));
    }
  }

  private refreshTiles(complete = false): void {
    let budget = complete ? Infinity : 1;
    const zoom = Math.max(.38, this.cameras.main.zoom);
    const halfW = this.scale.width / zoom / 2, halfH = this.scale.height / zoom / 2;
    const margin = TILE_SIZE * .25;
    const minX = Math.floor((this.cameraPoint.x - halfW - margin) / TILE_SIZE);
    const maxX = Math.floor((this.cameraPoint.x + halfW + margin) / TILE_SIZE);
    const minY = Math.floor((this.cameraPoint.y - halfH - margin) / TILE_SIZE);
    const maxY = Math.floor((this.cameraPoint.y + halfH + margin) / TILE_SIZE);
    const desired = new Set<string>();
    const b = this.sim.track.bounds;
    const ppm = this.sim.tuning.simulation.pixelsPerMeter;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (x * TILE_SIZE > b.maxX * ppm || (x + 1) * TILE_SIZE < b.minX * ppm || y * TILE_SIZE > b.maxY * ppm || (y + 1) * TILE_SIZE < b.minY * ppm) continue;
      const id = `${x}:${y}`;
      desired.add(id);
      if (this.tiles.has(id) || budget <= 0) continue;
      budget--;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      drawTrackTile(ctx, this.sim.track, ppm, x, y);
      const texture = `lab-${this.sim.track.config.id}-${x}-${y}`;
      this.textures.addCanvas(texture, canvas);
      const image = this.add.image(x * TILE_SIZE, y * TILE_SIZE, texture).setOrigin(0, 0).setDepth(0);
      this.tiles.set(id, { image, texture });
    }
    for (const [id, tile] of this.tiles) {
      if (!desired.has(id)) {
        tile.image.destroy();
        this.textures.remove(tile.texture);
        this.tiles.delete(id);
      }
    }
  }

  private createActor(car: CarState): ActorArt {
    const ppm = this.sim.tuning.simulation.pixelsPerMeter;
    const L = car.art.length * ppm, W = car.art.width * ppm;
    const paint = hex(car.art.paint), accent = hex(car.art.accent);
    const container = this.add.container(this.px(car.position.x), this.px(car.position.y)).setDepth(10);
    // Fixed top-left light direction; each vehicle has a slightly offset shadow.
    const shadow = this.add.graphics();
    shadow.fillStyle(0x040811, .55).fillRoundedRect(-L / 2 + 5, -W / 2 + 7, L, W, 12);
    container.add(shadow);
    const frontWheels: Phaser.GameObjects.Rectangle[] = [];
    const layers = car.profile.art;
    const atlas = this.textures.exists(CAR_ATLAS_KEY) ? this.textures.get(CAR_ATLAS_KEY) : null;
    const layered = layers && atlas && Object.values(layers).every(frame => atlas.has(frame));
    if (layered && layers) {
      const wheelsImage = this.add.image(0, 0, CAR_ATLAS_KEY, layers.wheels).setDisplaySize(L, W);
      const bodyImage = this.add.image(0, 0, CAR_ATLAS_KEY, layers.body).setDisplaySize(L, W).setTint(paint);
      container.add([wheelsImage, bodyImage]);
      if (layers.decals) container.add(this.add.image(0, 0, CAR_ATLAS_KEY, layers.decals).setDisplaySize(L, W));
      for (const y of [-W * .47, W * .47]) {
        const wheel = this.add.rectangle(L * .33, y, L * .17, W * .17, 0x070b12).setStrokeStyle(1, 0x98a3aa);
        frontWheels.push(wheel);
        container.add(wheel);
      }
      container.add(this.add.image(0, 0, CAR_ATLAS_KEY, layers.lights).setDisplaySize(L, W));
    } else {
      const wheels: Phaser.GameObjects.Rectangle[] = [];
      for (const x of [-L * .33, L * .33]) for (const y of [-W * .51, W * .51]) {
        const wheel = this.add.rectangle(x, y, L * .17, W * .16, 0x070b12).setStrokeStyle(1, 0x98a3aa);
        wheels.push(wheel);
        if (x > 0) frontWheels.push(wheel);
      }
      container.add(wheels);
      const body = this.add.graphics();
      // Distinct silhouettes by class, all facing right in source orientation.
      const nose = car.art.body === 'super' ? .48 : car.art.body === 'hatch' ? .43 : .49;
      const rear = car.art.body === 'muscle' ? .48 : .44;
      body.fillStyle(paint, 1);
      body.lineStyle(2, 0x08121e, 1);
      body.fillPoints([
        { x: -L * rear, y: -W * .30 }, { x: -L * .37, y: -W * .47 },
        { x: L * .22, y: -W * .47 }, { x: L * nose, y: -W * .32 },
        { x: L * nose, y: W * .32 }, { x: L * .22, y: W * .47 },
        { x: -L * .37, y: W * .47 }, { x: -L * rear, y: W * .30 },
      ], true); body.strokePath();
      // Top-facing highlights and glass canopy (no texture downloads needed).
      body.lineStyle(2, accent, .72);
      body.lineBetween(-L * .34, -W * .42, L * .19, -W * .42);
      body.fillStyle(0x0b1a29, 1);
      const cabinFront = car.art.body === 'muscle' ? L * .03 : L * .16;
      const cabinRear = car.art.body === 'hatch' ? -L * .30 : -L * .22;
      body.fillPoints([
        { x: cabinRear, y: -W * .3 }, { x: cabinFront, y: -W * .31 },
        { x: cabinFront + L * .08, y: -W * .21 }, { x: cabinFront + L * .08, y: W * .21 },
        { x: cabinFront, y: W * .31 }, { x: cabinRear, y: W * .3 },
      ], true);
      body.lineStyle(2, accent, .55);
      body.lineBetween(cabinFront, -W * .3, cabinFront, W * .3);
      body.lineStyle(1, accent, .35);
      body.lineBetween(cabinRear, -W * .3, cabinRear, W * .3);
      body.lineStyle(2, 0xffffff, .27);
      body.lineBetween(L * .28, -W * .25, L * .28, W * .25);
      if (car.art.body === 'muscle' || car.art.body === 'super') {
        body.lineStyle(5, 0x0c1726, .8);
        body.lineBetween(-L * .43, -W * .47, -L * .43, W * .47);
      }
      body.fillStyle(0xe8ffff, 1);
      body.fillRect(L * .43, -W * .3, 5, 9);
      body.fillRect(L * .43, W * .16, 5, 9);
      container.add(body);
    }
    const scratches = this.add.graphics();
    scratches.lineStyle(1.5, oppositeColor(car.art.paint), .7);
    scratches.lineBetween(-L * .09, -W * .19, L * .12, -W * .30);
    scratches.lineBetween(-L * .03, W * .2, L * .21, W * .15);
    scratches.lineBetween(-L * .33, W * .13, -L * .17, W * .23);
    scratches.setVisible(false);
    container.add(scratches);
    const brakeLights = [-W * .25, W * .18].map(y => this.add.rectangle(-L * .445, y, 5, 8, 0xff4d4d).setAlpha(.36));
    container.add(brakeLights);
    const flame = this.add.graphics();
    flame.fillStyle(0x00e5ff, 1);
    flame.fillTriangle(-L * .43, -W * .17, -L * .43, W * .17, -L * .78, 0);
    flame.fillStyle(0xffffff, 1);
    flame.fillTriangle(-L * .46, -W * .075, -L * .46, W * .075, -L * .63, 0);
    flame.setVisible(false);
    container.addAt(flame, 1);
    return { container, frontWheels, brakeLights, flame, scratches };
  }

  private renderCars(alpha: number): void {
    for (const car of this.sim.cars) {
      const art = this.actors.get(car.id);
      if (!art) continue;
      art.container.setPosition(this.px(lerp(car.previousPosition.x, car.position.x, alpha)), this.px(lerp(car.previousPosition.y, car.position.y, alpha)));
      art.container.setRotation(interpolateAngle(car.previousHeading, car.heading, alpha));
      art.container.setDepth(10 + car.position.y / 1000);
      for (const wheel of art.frontWheels) wheel.rotation = car.steering;
      for (const light of art.brakeLights) light.setAlpha(car.handbrakeTime > 0 || car.id === 'player' && this.getInput().brake > 0 ? 1 : .36);
      art.flame.setVisible(car.nitroActive);
      art.flame.setAlpha(.7 + .25 * Math.sin(this.sim.time * 30));
      art.scratches.setVisible(car.health < this.sim.tuning.damage.maxHealth * .72);
      if (car.wrecked) art.container.setAlpha(.5);
      else art.container.setAlpha(1);
    }
  }

  private renderSkids(dt: number): void {
    this.effectsClock += dt;
    if (this.sim.player.drifting && this.effectsClock >= .065) {
      this.effectsClock = 0;
      const car = this.sim.player, back = forward(car.heading), side = right(car.heading);
      for (const sign of [-1, 1]) this.skids.push({
        x: car.position.x - back.x * car.art.length * .32 + side.x * sign * car.art.width * .43,
        y: car.position.y - back.y * car.art.length * .32 + side.y * sign * car.art.width * .43,
        angle: car.heading, age: 0,
      });
      this.skids = this.skids.slice(-280);
      this.spawnSmoke(car);
    }
    this.skidGraphics.clear();
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const skid = this.skids[i];
      skid.age += dt;
      if (skid.age > 8) { this.skids.splice(i, 1); continue; }
      this.skidGraphics.lineStyle(4, 0x020a12, .65 * (1 - skid.age / 8));
      const f = forward(skid.angle);
      this.skidGraphics.lineBetween(this.px(skid.x - f.x * .35), this.px(skid.y - f.y * .35), this.px(skid.x + f.x * .35), this.px(skid.y + f.y * .35));
    }
    this.nitroClock += dt;
    if (this.sim.player.nitroActive && this.nitroClock >= .05) {
      this.nitroClock = 0;
      const p = this.sim.player, f = forward(p.heading), n = right(p.heading);
      for (const side of [-1, 1]) {
        this.spawnParticle(p.position.x - f.x * (p.art.length * .45 + Math.random() * .7) + n.x * side * p.art.width * .3,
          p.position.y - f.y * (p.art.length * .45 + Math.random() * .7) + n.y * side * p.art.width * .3,
          -f.x * 12, -f.y * 12, .22, 0x77f5ff, 2.4);
      }
    }
    this.damageClock += dt;
    if (this.damageClock > .12 && this.sim.player.health < this.sim.tuning.damage.maxHealth * this.sim.tuning.damage.smokeAt && !this.sim.player.wrecked) {
      this.damageClock = 0;
      const p = this.sim.player;
      const front = forward(p.heading);
      this.spawnParticle(p.position.x + front.x * p.art.length * .34, p.position.y + front.y * p.art.length * .34, .2, -.4, .9, p.health < this.sim.tuning.damage.maxHealth * this.sim.tuning.damage.fireAt ? 0xff603e : 0xb4c2c6, 13);
    }
  }

  private renderDraft(): void {
    this.draftGraphics.clear();
    if (!this.sim.player.drafting) return;
    const p = this.sim.player;
    const f = forward(p.heading), side = right(p.heading);
    this.draftGraphics.lineStyle(2, 0x9df4ff, .33);
    for (const offset of [-1.5, 0, 1.5]) {
      const x = p.position.x + side.x * offset, y = p.position.y + side.y * offset;
      this.draftGraphics.lineBetween(this.px(x + f.x * 2), this.px(y + f.y * 2),
        this.px(x + f.x * Math.min(this.sim.tuning.draft.maxRange, 10)),
        this.px(y + f.y * Math.min(this.sim.tuning.draft.maxRange, 10)));
    }
  }

  private spawnSmoke(car: CarState): void {
    const f = forward(car.heading), side = right(car.heading);
    for (const sign of [-1, 1]) {
      const x = car.position.x - f.x * car.art.length * .37 + side.x * sign * car.art.width * .4;
      const y = car.position.y - f.y * car.art.length * .37 + side.y * sign * car.art.width * .4;
      this.spawnParticle(x, y, (Math.random() - .5) * 2, (Math.random() - .5) * 2, .75, 0xc0ccd1, 10);
    }
  }

  private spawnParticle(x: number, y: number, vx: number, vy: number, life: number, color: number, radius: number): void {
    const p = this.particles.find(item => item.life === 0);
    if (!p) return;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.age = 0; p.life = life; p.radius = radius;
    p.circle.setFillStyle(color).setRadius(radius).setPosition(this.px(x), this.px(y)).setAlpha(.65).setVisible(true);
  }

  private renderParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.life) continue;
      p.age += dt;
      if (p.age >= p.life) { p.life = 0; p.circle.setVisible(false); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.circle.setPosition(this.px(p.x), this.px(p.y));
      p.circle.setRadius(p.radius * (1 + p.age / p.life * .75));
      p.circle.setAlpha(.6 * (1 - p.age / p.life));
    }
  }

  private playEffects(events: SimEvent[]): void {
    for (const event of events) {
      if ((event.type === 'impact' || event.type === 'scrape') && event.position) {
        const count = event.type === 'impact' ? Math.ceil((event.intensity ?? .3) * 12) : 2;
        for (let i = 0; i < count; i++) this.spawnParticle(event.position.x, event.position.y, (Math.random() - .5) * 12, (Math.random() - .5) * 12, .28 + Math.random() * .28, 0xffd23f, 2.5);
        if (event.type === 'impact' && (event.intensity ?? 0) > .35) this.cameras.main.shake(80, .001 + (event.intensity ?? 0) * .002);
      }
      if (event.type === 'wreck' && event.position) {
        for (let i = 0; i < 35; i++) this.spawnParticle(event.position.x, event.position.y, (Math.random() - .5) * 13, (Math.random() - .5) * 13, .8, i % 3 ? 0xff603e : 0xffd23f, 4);
        this.cameras.main.shake(240, .007);
      }
      if (event.type === 'pickup' && event.position) {
        for (let i = 0; i < 12; i++) this.spawnParticle(event.position.x, event.position.y, (Math.random() - .5) * 8, (Math.random() - .5) * 8, .55, 0x7dffb3, 3);
      }
    }
  }

  private followCamera(alpha: number, dt: number): void {
    const p = this.sim.player, speed = Math.hypot(p.velocity.x, p.velocity.y);
    const pos = { x: lerp(p.previousPosition.x, p.position.x, alpha), y: lerp(p.previousPosition.y, p.position.y, alpha) };
    const velocityDirection: Vec2 = speed > 2 ? { x: p.velocity.x / speed, y: p.velocity.y / speed } : forward(p.heading);
    const target = { x: this.px(pos.x + velocityDirection.x * Math.min(8, speed * .2)), y: this.px(pos.y + velocityDirection.y * Math.min(8, speed * .2)) };
    const smoothing = 1 - Math.exp(-5 * dt);
    this.cameraPoint.x = lerp(this.cameraPoint.x, target.x, smoothing);
    this.cameraPoint.y = lerp(this.cameraPoint.y, target.y, smoothing);
    const base = Math.min(this.scale.width / 1200, this.scale.height / 780) * .95;
    const speedZoom = .12 * Math.min(1, speed / p.profile.topSpeed);
    const targetZoom = Math.max(.38, Math.min(1.3, base * (1 - speedZoom - (p.nitroActive ? .06 : 0))));
    this.cameras.main.setZoom(lerp(this.cameras.main.zoom, targetZoom, 1 - Math.exp(-2.4 * dt)));
    this.cameras.main.centerOn(this.cameraPoint.x, this.cameraPoint.y);
  }
}
