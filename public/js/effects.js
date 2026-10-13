/**
 * Visual effects: glow sprites, tracers, muzzle flashes, plasma bolts,
 * explosions, sparks and impact marks. Everything pooled / short-lived.
 */
import * as THREE from 'three';

// --- shared textures --------------------------------------------------------
function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace('1)', '0.55)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

const TEX_GLOW = radialTexture();
const TEX_RING = ringTexture();

export function makeGlowSprite(color, scale = 2, opacity = 0.85) {
  const mat = new THREE.SpriteMaterial({
    map: TEX_GLOW,
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    this.quakes = 0;
  }

  _spawn(object, ttl, onUpdate) {
    this.scene.add(object);
    this.active.push({ object, ttl, age: 0, onUpdate });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i];
      fx.age += dt;
      const k = fx.age / fx.ttl;
      if (k >= 1) {
        this.scene.remove(fx.object);
        fx.object.traverse?.((o) => {
          if (o.geometry && o.geometry.dispose && o.userData.tempGeo) o.geometry.dispose();
        });
        this.active.splice(i, 1);
        continue;
      }
      fx.onUpdate?.(fx.object, k, dt);
    }
    if (this.quakes > 0) this.quakes = Math.max(0, this.quakes - dt * 3);
  }

  // --- muzzle flash ---------------------------------------------------------
  muzzleFlash(pos, color = '#ffb223', size = 1.2) {
    const s = makeGlowSprite(color, size, 0.95);
    s.position.copy(pos);
    this._spawn(s, 0.07, (o, k) => {
      o.material.opacity = 0.95 * (1 - k);
      o.scale.setScalar(size * (1 + k * 1.6));
    });
  }

  // --- hitscan tracer -------------------------------------------------------
  tracer(from, to, color = '#23e6ff', width = 0.06) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.1) return;
    const geo = new THREE.CylinderGeometry(width, width, len, 5, 1, true);
    geo.translate(0, len / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.userData.tempGeo = true;
    this._spawn(mesh, 0.09, (o, k) => {
      o.material.opacity = 0.85 * (1 - k);
    });
  }

  // --- plasma bolt (short lived moving glow) ---------------------------------
  plasmaBolt(pos, color = '#26ffd0') {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    core.userData.tempGeo = true;
    const glow = makeGlowSprite(color, 1.5, 0.85);
    group.add(core, glow);
    group.position.copy(pos);
    this._spawn(group, 0.05, () => {});
    return group;
  }

  // --- impact -----------------------------------------------------------------
  impact(pos, normal = new THREE.Vector3(0, 1, 0), color = '#23e6ff', sparks = 6) {
    const s = makeGlowSprite(color, 1.1, 0.9);
    s.position.copy(pos).addScaledVector(normal, 0.05);
    this._spawn(s, 0.16, (o, k) => {
      o.material.opacity = 0.9 * (1 - k);
      o.scale.setScalar(1.1 * (1 + k));
    });
    for (let i = 0; i < sparks; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 4, 4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      spark.userData.tempGeo = true;
      spark.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5,
        (Math.random() - 0.5) * 6
      ).addScaledVector(normal, 3);
      this._spawn(spark, 0.28 + Math.random() * 0.2, (o, k, dt) => {
        o.position.addScaledVector(vel, dt);
        vel.y -= 12 * dt;
        o.material.opacity = 1 - k;
      });
    }
  }

  // --- blood / hit marker on players ------------------------------------------
  hitFlash(pos, color = '#ff2ea6') {
    const s = makeGlowSprite(color, 1.6, 0.9);
    s.position.copy(pos);
    this._spawn(s, 0.2, (o, k) => {
      o.material.opacity = 0.9 * (1 - k);
      o.scale.setScalar(1.6 * (1 + k * 0.8));
    });
  }

  // --- explosion ---------------------------------------------------------------
  explosion(pos, radius = 6, color = '#ff8c1a') {
    const flash = makeGlowSprite('#ffffff', radius * 0.9, 1);
    flash.position.copy(pos);
    this._spawn(flash, 0.12, (o, k) => {
      o.material.opacity = 1 - k;
      o.scale.setScalar(radius * (0.7 + k * 1.4));
    });

    const fire = makeGlowSprite(color, radius * 1.5, 0.95);
    fire.position.copy(pos);
    this._spawn(fire, 0.5, (o, k) => {
      o.material.opacity = 0.95 * (1 - k);
      o.scale.setScalar(radius * (1 + k * 1.6));
    });

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.75, 28),
      new THREE.MeshBasicMaterial({
        map: TEX_RING,
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.position.copy(pos).setY(pos.y + 0.3);
    ring.rotation.x = -Math.PI / 2;
    this._spawn(ring, 0.55, (o, k) => {
      o.scale.setScalar(1 + k * radius * 1.1);
      o.material.opacity = 0.9 * (1 - k);
    });

    for (let i = 0; i < 18; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.1 + Math.random() * 0.12, 5, 5),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(Math.random() > 0.4 ? color : '#ffe08a'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      p.userData.tempGeo = true;
      p.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        Math.random() * 12,
        (Math.random() - 0.5) * 18
      );
      this._spawn(p, 0.5 + Math.random() * 0.4, (o, k, dt) => {
        o.position.addScaledVector(vel, dt);
        vel.y -= 18 * dt;
        vel.multiplyScalar(1 - dt * 1.4);
        o.material.opacity = 1 - k;
      });
    }
    this.quakes = 1;
  }

  // --- grenade trail -------------------------------------------------------------
  nadeTrail(pos, color = '#ffb223') {
    const s = makeGlowSprite(color, 0.55, 0.6);
    s.position.copy(pos);
    this._spawn(s, 0.25, (o, k) => {
      o.material.opacity = 0.6 * (1 - k);
      o.scale.setScalar(0.55 * (1 - k * 0.5));
    });
  }

  // --- respawn portal look --------------------------------------------------------
  respawnFlash(pos, color = '#23e6ff') {
    const s = makeGlowSprite(color, 3, 0.9);
    s.position.copy(pos);
    this._spawn(s, 0.7, (o, k) => {
      o.material.opacity = 0.9 * (1 - k);
      o.scale.setScalar(3 * (1 - k * 0.6));
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 24),
      new THREE.MeshBasicMaterial({
        map: TEX_RING,
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.position.copy(pos);
    ring.rotation.x = -Math.PI / 2;
    this._spawn(ring, 0.7, (o, k) => {
      o.scale.setScalar(1 + k * 6);
      o.material.opacity = 0.9 * (1 - k);
    });
  }
}
