/**
 * "Future Desert" arena — rolling neon dunes, glowing crossroads,
 * holo-billboards, neon cacti, rock cover and a perimeter fence.
 *
 * terrainHeight(x, z) is the single source of truth for ground height,
 * so players, bots and props all agree with the rendered mesh.
 */
import * as THREE from 'three';
import { makeGlowSprite } from './effects.js';

export const ARENA_HALF = 140;

export function terrainHeight(x, z) {
  let h = 0;
  h += Math.sin(x * 0.022) * Math.cos(z * 0.019) * 6.2;
  h += Math.sin(x * 0.061 + 1.7) * Math.cos(z * 0.043 + 0.4) * 2.1;
  h += Math.sin((x + z) * 0.031) * 1.1;
  // flatten the central crossroads plaza
  const d = Math.hypot(x, z);
  const flat = Math.max(0, 1 - d / 46);
  return h * (1 - flat * 0.92);
}

function glowLineTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // {x, z, r} cylinders players collide against
    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildCrossroads();
    this._buildProps();
    this._buildFence();
  }

  // ------------------------------------------------------------------ sky --
  _buildSky() {
    const geo = new THREE.SphereGeometry(520, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#2a0a52') },
        mid: { value: new THREE.Color('#b3417a') },
        bottom: { value: new THREE.Color('#ff7a3c') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        void main() {
          float h = normalize(vPos).y * 0.5 + 0.5;
          vec3 col = h > 0.5 ? mix(mid, top, (h - 0.5) * 2.0) : mix(bottom, mid, h * 2.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, mat));

    // twin moons
    const moonA = makeGlowSprite('#8affff', 64, 0.95);
    moonA.position.set(-180, 150, -320);
    this.scene.add(moonA);
    const moonB = makeGlowSprite('#ff9ad5', 34, 0.8);
    moonB.position.set(240, 110, -260);
    this.scene.add(moonB);

    // horizon sun glow
    const sun = makeGlowSprite('#ffb223', 160, 0.75);
    sun.position.set(0, 22, -430);
    this.scene.add(sun);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 420; i++) {
      const r = 430;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      pts.push(
        r * Math.cos(theta) * Math.cos(phi),
        r * Math.sin(phi) + 30,
        r * Math.sin(theta) * Math.cos(phi)
      );
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xcfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8 })
    );
    this.scene.add(stars);

    this.scene.fog = new THREE.FogExp2(new THREE.Color('#c2527d').lerp(new THREE.Color('#2a0a52'), 0.35), 0.0042);
    this.scene.background = new THREE.Color('#3b1262');
  }

  // ---------------------------------------------------------------- lights --
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x7a4bd6, 0xff8a4a, 1.15));
    const key = new THREE.DirectionalLight(0xffd9a0, 1.35);
    key.position.set(60, 90, -80);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x28e6ff, 0.55);
    rim.position.set(-70, 40, 60);
    this.scene.add(rim);
  }

  // --------------------------------------------------------------- terrain --
  _buildTerrain() {
    const SIZE = 420;
    const SEG = 110;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const cLow = new THREE.Color('#7a3d8f');
    const cHigh = new THREE.Color('#d96a4f');
    const cGlow = new THREE.Color('#ff8a5c');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const t = THREE.MathUtils.clamp((y + 8) / 18, 0, 1);
      const c = cLow.clone().lerp(cHigh, t).lerp(cGlow, Math.max(0, 0.22 - t) * 0.6);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.08,
      flatShading: true,
    });
    const ground = new THREE.Mesh(geo, mat);
    this.scene.add(ground);
  }

  // ------------------------------------------------------------ crossroads --
  _buildCrossroads() {
    const group = new THREE.Group();
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x14142c,
      emissive: new THREE.Color('#1b2f6e'),
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.7,
    });

    // two neon strips crossing at origin — the "Crossroads"
    const stripA = new THREE.Mesh(new THREE.BoxGeometry(240, 0.3, 16), roadMat);
    stripA.position.y = terrainHeight(0, 0) + 0.12;
    const stripB = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 240), roadMat);
    stripB.position.y = terrainHeight(0, 0) + 0.14;
    group.add(stripA, stripB);

    // glowing lane lines
    const lineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#23e6ff'),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const magentaMat = lineMat.clone();
    magentaMat.color.set('#ff2ea6');

    for (const [w, d, x, z, mat] of [
      [240, 0.6, 0, -7.2, lineMat], [240, 0.6, 0, 7.2, lineMat],
      [0.6, 240, -7.2, 0, magentaMat], [0.6, 240, 7.2, 0, magentaMat],
    ]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat);
      line.position.set(x, terrainHeight(x, z) + 0.34, z);
      group.add(line);
    }

    // center beacon — landmark tower
    const tower = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2.2, 26, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1a1030,
        emissive: new THREE.Color('#23e6ff'),
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.8,
      })
    );
    pillar.position.y = 13;
    tower.add(pillar);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.2 - i * 0.35, 0.16, 8, 32),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(i % 2 ? '#ff2ea6' : '#23e6ff'),
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      ring.position.y = 6 + i * 5.2;
      ring.rotation.x = Math.PI / 2;
      ring.userData.spin = (i % 2 ? -1 : 1) * (0.3 + i * 0.12);
      tower.add(ring);
      (this.spinners ||= []).push(ring);
    }
    const beacon = makeGlowSprite('#23e6ff', 12, 0.9);
    beacon.position.y = 27;
    tower.add(beacon);
    tower.position.y = terrainHeight(0, 0);
    group.add(tower);
    this.colliders.push({ x: 0, z: 0, r: 3.2 });

    this.scene.add(group);
  }

  // ----------------------------------------------------------------- props --
  _buildProps() {
    const rng = mulberry32(20261013);

    // --- rock clusters ---------------------------------------------------
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3d2456,
      emissive: new THREE.Color('#2a1250'),
      emissiveIntensity: 0.35,
      roughness: 0.95,
      metalness: 0.12,
      flatShading: true,
    });
    for (let i = 0; i < 42; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = 24 + rng() * 110;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (Math.abs(x) < 14 || Math.abs(z) < 14) continue; // keep lanes open
      const s = 1.2 + rng() * 3.4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(x, terrainHeight(x, z) + s * 0.45, z);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.scale.y = 0.65 + rng() * 0.5;
      this.scene.add(rock);
      this.colliders.push({ x, z, r: s * 1.05 });

      if (rng() > 0.55) {
        const glow = makeGlowSprite(rng() > 0.5 ? '#23e6ff' : '#ff2ea6', s * 2.2, 0.16);
        glow.position.copy(rock.position).y += s * 0.5;
        this.scene.add(glow);
      }
    }

    // --- neon cacti ------------------------------------------------------
    const cactusMat = new THREE.MeshStandardMaterial({
      color: 0x0d2b24,
      emissive: new THREE.Color('#26ffd0'),
      emissiveIntensity: 0.75,
      roughness: 0.5,
      metalness: 0.3,
    });
    const cactusGlow = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#26ffd0'),
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    for (let i = 0; i < 26; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = 30 + rng() * 105;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (Math.abs(x) < 12 || Math.abs(z) < 12) continue;
      const h = 3.2 + rng() * 3.4;
      const cactus = new THREE.Group();

      const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, h, 4, 8), cactusMat);
      trunk.position.y = h / 2;
      const trunkGlow = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, h, 4, 8), cactusGlow);
      trunkGlow.position.y = h / 2;
      trunkGlow.scale.setScalar(1.18);
      cactus.add(trunkGlow, trunk);

      const armCount = rng() > 0.4 ? 2 : 1;
      for (let a = 0; a < armCount; a++) {
        const side = a === 0 ? 1 : -1;
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, h * 0.32, 4, 8), cactusMat);
        arm.position.set(side * 0.85, h * 0.55, 0);
        arm.rotation.z = side * -0.7;
        const armGlow = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, h * 0.32, 4, 8), cactusGlow);
        armGlow.position.copy(arm.position);
        armGlow.rotation.copy(arm.rotation);
        armGlow.scale.setScalar(1.2);
        cactus.add(armGlow, arm);
      }
      cactus.position.set(x, terrainHeight(x, z), z);
      this.scene.add(cactus);
      this.colliders.push({ x, z, r: 0.85 });
    }

    // --- holo billboards ---------------------------------------------------
    const holoColors = ['#23e6ff', '#ff2ea6', '#ffb223', '#9d4dff'];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + rng() * 0.4;
      const dist = 55 + rng() * 70;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const h = 8 + rng() * 5;
      const color = holoColors[i % holoColors.length];

      const board = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.3, h, 6),
        new THREE.MeshStandardMaterial({ color: 0x1c1430, emissive: new THREE.Color(color), emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.4 })
      );
      pole.position.y = h / 2;
      board.add(pole);

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(7.5, 3.6, 0.18),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      panel.position.y = h + 1.6;
      board.add(panel);

      // flickering scanline bar
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(7.5, 0.16, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      bar.position.y = h + 1.6;
      board.add(bar);
      (this.holoBars ||= []).push({ bar, baseY: h + 1.6, speed: 0.7 + rng() * 1.4, phase: rng() * 6 });

      const glow = makeGlowSprite(color, 11, 0.3);
      glow.position.y = h + 1.6;
      board.add(glow);

      board.position.set(x, terrainHeight(x, z), z);
      board.lookAt(0, board.position.y, 0);
      this.scene.add(board);
      this.colliders.push({ x, z, r: 0.7 });
    }

    // --- neon pylons along the lanes ---------------------------------------
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      for (const [x, z] of [[i * 21, -11], [i * 21, 11], [-11, i * 21], [11, i * 21]]) {
        const col = (Math.abs(i) + (x === 0 ? 1 : 0)) % 2 ? '#23e6ff' : '#ff2ea6';
        const pylon = new THREE.Group();
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 7.5, 0.7),
          new THREE.MeshStandardMaterial({
            color: 0x16122c,
            emissive: new THREE.Color(col),
            emissiveIntensity: 0.8,
            roughness: 0.4,
            metalness: 0.6,
          })
        );
        post.position.y = 3.75;
        pylon.add(post);
        const tip = makeGlowSprite(col, 3.2, 0.75);
        tip.position.y = 7.8;
        pylon.add(tip);
        pylon.position.set(x, terrainHeight(x, z), z);
        this.scene.add(pylon);
        this.colliders.push({ x, z, r: 0.75 });
      }
    }
  }

  // ----------------------------------------------------------------- fence --
  _buildFence() {
    const fenceMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff2ea6'),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const H = 10;
    for (const [w, d, x, z] of [
      [ARENA_HALF * 2, 0.2, 0, -ARENA_HALF], [ARENA_HALF * 2, 0.2, 0, ARENA_HALF],
      [0.2, ARENA_HALF * 2, -ARENA_HALF, 0], [0.2, ARENA_HALF * 2, ARENA_HALF, 0],
    ]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, H), fenceMat);
      wall.position.set(x, terrainHeight(x, z) + H / 2, z);
      if (d > 1) wall.rotation.y = Math.PI / 2;
      this.scene.add(wall);
    }

    // corner + mid posts with glow
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x221038,
      emissive: new THREE.Color('#9d4dff'),
      emissiveIntensity: 0.85,
      metalness: 0.6,
      roughness: 0.4,
    });
    const step = 35;
    for (let i = -ARENA_HALF; i <= ARENA_HALF; i += step) {
      for (const [x, z] of [[i, -ARENA_HALF], [i, ARENA_HALF], [-ARENA_HALF, i], [ARENA_HALF, i]]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.8), postMat);
        post.position.set(x, terrainHeight(x, z) + 6, z);
        this.scene.add(post);
        const tip = makeGlowSprite('#9d4dff', 3, 0.6);
        tip.position.set(x, terrainHeight(x, z) + 12, z);
        this.scene.add(tip);
      }
    }
  }

  update(dt, elapsed) {
    if (this.spinners) {
      for (const s of this.spinners) s.rotation.z += dt * s.userData.spin;
    }
    if (this.holoBars) {
      for (const h of this.holoBars) {
        h.bar.position.y = h.baseY + Math.sin(elapsed * h.speed + h.phase) * 1.55;
      }
    }
  }

  /** resolve a cylindrical collider push-out for position (x, z) */
  collide(x, z, radius = 0.55) {
    let px = x;
    let pz = z;
    for (const c of this.colliders) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        px = c.x + (dx / d) * rr;
        pz = c.z + (dz / d) * rr;
      }
    }
    // hard arena bounds
    const lim = ARENA_HALF - 1.2;
    px = Math.max(-lim, Math.min(lim, px));
    pz = Math.max(-lim, Math.min(lim, pz));
    return { x: px, z: pz };
  }
}

// deterministic rng for stable map layout
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
