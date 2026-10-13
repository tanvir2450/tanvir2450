/**
 * Stickman avatar with glowing neon outline.
 * Procedural animation: walk cycle, aim pitch, jump pose, death fall.
 */
import * as THREE from 'three';
import { makeGlowSprite } from './effects.js';

const BODY_DARK = 0x0b0b1c;

function bodyMaterial(colorHex) {
  return new THREE.MeshStandardMaterial({
    color: BODY_DARK,
    emissive: new THREE.Color(colorHex),
    emissiveIntensity: 0.95,
    roughness: 0.35,
    metalness: 0.25,
  });
}

function outlineMaterial(colorHex) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/** mesh + additive backside shell = cheap neon outline */
function glowPart(geo, colorHex, outlineScale = 1.22) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, bodyMaterial(colorHex));
  const shell = new THREE.Mesh(geo, outlineMaterial(colorHex));
  shell.scale.setScalar(outlineScale);
  shell.renderOrder = 2;
  group.add(shell, mesh);
  return group;
}

function makeGunModel(slot, colorHex) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({
    color: 0x12122a,
    emissive: new THREE.Color(colorHex),
    emissiveIntensity: 0.35,
    roughness: 0.45,
    metalness: 0.55,
  });
  const accent = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };

  switch (slot) {
    case 0: { // AK
      add(new THREE.BoxGeometry(0.09, 0.12, 0.78), dark, 0, 0, -0.32);
      add(new THREE.BoxGeometry(0.07, 0.26, 0.16), dark, 0, -0.16, -0.12, 0.35);
      add(new THREE.BoxGeometry(0.08, 0.1, 0.3), dark, 0, -0.02, 0.22);
      add(new THREE.BoxGeometry(0.1, 0.03, 0.5), accent, 0, 0.08, -0.3);
      break;
    }
    case 1: { // sniper
      add(new THREE.BoxGeometry(0.08, 0.11, 1.15), dark, 0, 0, -0.45);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), dark, 0, 0.12, -0.25, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), accent, 0, 0.12, -0.25, Math.PI / 2);
      add(new THREE.BoxGeometry(0.08, 0.22, 0.14), dark, 0, -0.15, -0.05, 0.3);
      break;
    }
    case 2: { // plasma pistol
      add(new THREE.BoxGeometry(0.09, 0.14, 0.42), dark, 0, 0, -0.16);
      add(new THREE.BoxGeometry(0.07, 0.24, 0.12), dark, 0, -0.16, 0.02, 0.25);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), accent);
      orb.position.set(0, 0.03, -0.38);
      g.add(orb);
      break;
    }
    case 3: { // MG
      add(new THREE.BoxGeometry(0.11, 0.13, 0.95), dark, 0, 0, -0.38);
      add(new THREE.BoxGeometry(0.13, 0.2, 0.22), dark, 0, -0.14, -0.12);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), dark, 0, -0.1, 0.16, Math.PI / 2);
      add(new THREE.BoxGeometry(0.12, 0.03, 0.6), accent, 0, 0.09, -0.36);
      break;
    }
    default: { // grenade prop
      const nade = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), dark);
      nade.position.set(0, 0, -0.1);
      g.add(nade);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), accent);
      glow.position.copy(nade.position);
      g.add(glow);
      break;
    }
  }

  // muzzle reference
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, slot === 1 ? -1.02 : slot === 2 ? -0.42 : -0.72);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

export class Avatar {
  /**
   * @param {number|string} colorHex team / player glow color
   * @param {boolean} isLocal used to hide some details when in close 3rd person
   */
  constructor(colorHex, isLocal = false) {
    this.color = colorHex;
    this.root = new THREE.Group(); // world position at feet
    this.visual = new THREE.Group(); // rotates on death
    this.root.add(this.visual);

    this.gunSlot = 0;
    this.walkPhase = 0;
    this.deathT = -1;
    this.isLocal = isLocal;

    // --- torso / head ------------------------------------------------------
    this.torso = glowPart(new THREE.CapsuleGeometry(0.21, 0.62, 4, 10), colorHex, 1.28);
    this.torso.position.y = 1.32;
    this.visual.add(this.torso);

    this.head = glowPart(new THREE.SphereGeometry(0.27, 14, 12), colorHex, 1.22);
    this.head.position.y = 1.97;
    this.visual.add(this.head);

    // visor band
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.07, 0.08),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    visor.position.set(0, 2.0, -0.22);
    this.visual.add(visor);

    // --- arms ---------------------------------------------------------------
    this.armL = new THREE.Group();
    this.armL.position.set(-0.34, 1.62, 0);
    const armLM = glowPart(new THREE.CapsuleGeometry(0.085, 0.55, 3, 8), colorHex, 1.35);
    armLM.position.y = -0.32;
    this.armL.add(armLM);

    this.armR = new THREE.Group();
    this.armR.position.set(0.34, 1.62, 0);
    const armRM = glowPart(new THREE.CapsuleGeometry(0.085, 0.55, 3, 8), colorHex, 1.35);
    armRM.position.y = -0.32;
    this.armR.add(armRM);

    // --- legs ---------------------------------------------------------------
    this.legL = new THREE.Group();
    this.legL.position.set(-0.15, 0.98, 0);
    const legLM = glowPart(new THREE.CapsuleGeometry(0.1, 0.66, 3, 8), colorHex, 1.3);
    legLM.position.y = -0.42;
    this.legL.add(legLM);

    this.legR = new THREE.Group();
    this.legR.position.set(0.15, 0.98, 0);
    const legRM = glowPart(new THREE.CapsuleGeometry(0.1, 0.66, 3, 8), colorHex, 1.3);
    legRM.position.y = -0.42;
    this.legR.add(legRM);

    // --- gun pivot (arms + gun follow aim pitch) ----------------------------
    this.gunPivot = new THREE.Group();
    this.gunPivot.position.set(0, 1.55, 0);
    this.gun = makeGunModel(0, colorHex);
    this.gun.position.set(0.18, -0.1, -0.35);
    this.gunPivot.add(this.gun);

    // arms are attached to pivot so they pitch with the weapon
    this.gunPivot.add(this.armL, this.armR);
    this.armL.position.set(-0.3, 0.07, -0.15);
    this.armR.position.set(0.3, 0.07, -0.15);
    this.armL.rotation.x = -1.25;
    this.armR.rotation.x = -1.35;

    this.visual.add(this.torso, this.head, this.legL, this.legR, this.gunPivot);

    // soft glow halo
    this.halo = makeGlowSprite(colorHex, 2.4, 0.22);
    this.halo.position.y = 1.35;
    this.visual.add(this.halo);

    // ground shadow blob
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 18),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    this.root.add(shadow);
  }

  get muzzle() {
    return this.gun.userData.muzzle;
  }

  setWeapon(slot) {
    if (slot === this.gunSlot) return;
    this.gunSlot = slot;
    this.gunPivot.remove(this.gun);
    this.gun = makeGunModel(slot, this.color);
    this.gun.position.set(0.18, -0.1, -0.35);
    this.gunPivot.add(this.gun);
  }

  setGlowColor(colorHex) {
    this.color = colorHex;
    this.visual.traverse((o) => {
      if (o.isMesh) {
        if (o.material.emissive) o.material.emissive.set(colorHex);
        else if (o.material.color && o.material.blending === THREE.AdditiveBlending) o.material.color.set(colorHex);
      }
    });
    this.halo.material.color.set(colorHex);
    this.setWeapon((this.gunSlot + 1) % 5); // force gun rebuild
    this.setWeapon((this.gunSlot + 4) % 5);
  }

  /**
   * @param {number} dt
   * @param {object} st {speed, moving, aimPitch, grounded, dead}
   */
  update(dt, st) {
    if (this.deathT >= 0) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.55);
      const ease = 1 - (1 - k) ** 3;
      this.visual.rotation.x = -ease * Math.PI * 0.5;
      this.visual.position.y = -ease * 0.15;
      return;
    }

    const moving = st.speed > 0.6 && st.grounded;
    if (moving) {
      this.walkPhase += dt * (6 + st.speed * 0.9);
      const swing = Math.sin(this.walkPhase) * 0.62;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.torso.position.y = 1.32 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.035;
    } else {
      this.legL.rotation.x *= 1 - Math.min(1, dt * 10);
      this.legR.rotation.x *= 1 - Math.min(1, dt * 10);
      this.torso.position.y = 1.32 + Math.sin(performance.now() * 0.002) * 0.015;
    }

    if (!st.grounded) {
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, -0.55, dt * 8);
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 0.35, dt * 8);
    }

    // aim pitch on weapon pivot
    const targetPitch = -st.aimPitch * 0.85;
    this.gunPivot.rotation.x = THREE.MathUtils.lerp(this.gunPivot.rotation.x, targetPitch, Math.min(1, dt * 14));
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, -st.aimPitch * 0.5, Math.min(1, dt * 12));
    this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, -st.aimPitch * 0.22, Math.min(1, dt * 10));

    // idle weapon sway
    this.gun.position.y = -0.1 + Math.sin(performance.now() * 0.0031) * 0.012;
  }

  kill() {
    this.deathT = 0;
  }

  revive() {
    this.deathT = -1;
    this.visual.rotation.set(0, 0, 0);
    this.visual.position.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.gunPivot.rotation.set(0, 0, 0);
  }
}
