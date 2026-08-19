import * as THREE from "../vendor/three.module.js";
import { CELL, cellToWorld, gridKey, makeGlowSprite } from "./three-setup.js";

export const POWERUP_TYPES = {
  gold:   { name: "Golden Apple", color: 0xf5b942, glow: 0xffd166, icon: "i-apple" },
  shield: { name: "Shield",       color: 0x38bdf8, glow: 0x7dd3fc, icon: "i-shield" },
  speed:  { name: "Speed Boost",  color: 0xfacc15, glow: 0xfde047, icon: "i-bolt" },
  slow:   { name: "Slow Time",    color: 0x818cf8, glow: 0xa5b4fc, icon: "i-clock" },
  magnet: { name: "Magnet",       color: 0xfb7185, glow: 0xfda4af, icon: "i-magnet" },
};

const APPLE = { body: 0xe6493b, stem: 0x6b4226, leaf: 0x3fae4a, glow: 0xff7b6b };

function makeAppleModel(bodyColor, leafColor, stemColor) {
  const g = new THREE.Group();

  const bodyGeo = new THREE.SphereGeometry(0.34, 24, 20);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor, roughness: 0.35, metalness: 0.05,
    emissive: new THREE.Color(bodyColor), emissiveIntensity: 0.12,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 0.94, 1);
  body.castShadow = true;
  g.add(body);

  // Top dimple.
  const dimpleGeo = new THREE.SphereGeometry(0.12, 12, 10);
  const dimple = new THREE.Mesh(dimpleGeo, new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4 }));
  dimple.position.y = 0.26;
  dimple.scale.set(1, 0.4, 1);
  g.add(dimple);

  // Stem.
  const stemGeo = new THREE.CylinderGeometry(0.024, 0.034, 0.18, 8);
  const stemMat = new THREE.MeshStandardMaterial({ color: stemColor, roughness: 0.7 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.set(0.04, 0.36, 0);
  stem.rotation.z = -0.35;
  stem.castShadow = true;
  g.add(stem);

  // Leaf (soft tapered ellipsoid).
  const leafGeo = new THREE.SphereGeometry(0.11, 12, 8);
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.5 });
  const leaf = new THREE.Mesh(leafGeo, leafMat);
  leaf.scale.set(0.55, 0.12, 1.5);
  leaf.position.set(-0.14, 0.4, 0);
  leaf.rotation.z = 0.5;
  leaf.rotation.y = -0.6;
  leaf.castShadow = true;
  g.add(leaf);

  return g;
}

function makeLightning() {
  const s = new THREE.Shape();
  s.moveTo(-0.06, 0.42);
  s.lineTo(-0.2, -0.02);
  s.lineTo(-0.02, -0.02);
  s.lineTo(-0.1, -0.42);
  s.lineTo(0.3, 0.05);
  s.lineTo(0.09, 0.05);
  s.lineTo(0.26, 0.42);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfacc15, roughness: 0.3, metalness: 0.1,
    emissive: 0xfacc15, emissiveIntensity: 0.7,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function makeHourglass() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x818cf8, roughness: 0.3, metalness: 0.1,
    emissive: 0x818cf8, emissiveIntensity: 0.6,
  });
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 18), mat);
  top.position.y = 0.14;
  const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 18), mat);
  bottom.position.y = -0.14;
  bottom.rotation.z = Math.PI;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 8, 20), new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.2, emissive: 0x93c5fd, emissiveIntensity: 0.5 }));
  g.add(top, bottom, ring);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeShield() {
  const g = new THREE.Group();
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8, roughness: 0.15, metalness: 0.05,
    transparent: true, opacity: 0.22, emissive: 0x38bdf8, emissiveIntensity: 0.35,
  });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), bubbleMat);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.2, emissive: 0x38bdf8, emissiveIntensity: 0.8 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 10, 30), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.18;
  g.add(bubble, ring);
  return g;
}

function makeMagnet() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35, metalness: 0.15, emissive: 0x7f1d1d, emissiveIntensity: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.2 });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 10, 24, Math.PI), red);
  const prongGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.24, 12);
  for (const side of [-1, 1]) {
    const prong = new THREE.Mesh(prongGeo, red);
    prong.position.set(side * 0.2, -0.12, 0);
    g.add(prong);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12), white);
    tip.position.set(side * 0.2, -0.25, 0);
    g.add(tip);
  }
  g.add(arc);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeGoldApple() {
  const g = makeAppleModel(0xf5b942, 0x34d399, 0x92400e);
  g.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive) {
      o.material.emissive.set(0xb45309);
      o.material.emissiveIntensity = 0.4;
    }
  });
  return g;
}

export class PickupManager {
  constructor(stage, glowTex, softTex) {
    this.stage = stage;
    this.glowTex = glowTex;
    this.softTex = softTex;
    this.pickups = [];
    this.cols = 1;
    this.rows = 1;
    this._isBlocked = () => false;
  }

  setBoard(cols, rows, isBlocked) {
    this.cols = cols;
    this.rows = rows;
    this._isBlocked = isBlocked;
  }

  clear() {
    this.pickups.forEach((p) => {
      this.stage.entitiesRoot.remove(p.root);
      p.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    });
    this.pickups = [];
  }

  _freeCell() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = Math.floor(Math.random() * this.cols);
      const z = Math.floor(Math.random() * this.rows);
      if (this._isBlocked({ x, z })) continue;
      if (this.pickups.some((p) => p.cell && p.cell.x === x && p.cell.z === z)) continue;
      return { x, z };
    }
    // Fallback: scan deterministically.
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        if (!this._isBlocked({ x, z }) && !this.pickups.some((p) => p.cell && p.cell.x === x && p.cell.z === z)) {
          return { x, z };
        }
      }
    }
    return null;
  }

  spawnApple() {
    const cell = this._freeCell();
    if (!cell) return null;
    const model = makeAppleModel(APPLE.body, APPLE.leaf, APPLE.stem);
    const pickup = this._wrap(model, "apple", cell, APPLE.glow, 0.85, 0.46);
    pickup.spin = 0.8;
    this.pickups.push(pickup);
    return pickup;
  }

  spawnPowerUp(type) {
    const cell = this._freeCell();
    if (!cell) return null;
    const cfg = POWERUP_TYPES[type];
    let model;
    switch (type) {
      case "gold": model = makeGoldApple(); break;
      case "shield": model = makeShield(); break;
      case "speed": model = makeLightning(); break;
      case "slow": model = makeHourglass(); break;
      case "magnet": model = makeMagnet(); break;
      default: return null;
    }
    const pickup = this._wrap(model, type, cell, cfg.glow, 1.1, 0.42);
    pickup.spin = 1.2;
    pickup.model = model;
    this.pickups.push(pickup);
    return pickup;
  }

  _wrap(model, type, cell, glowColor, glowScale, baseY) {
    const root = new THREE.Group();
    const world = cellToWorld(cell.x, cell.z, this.cols, this.rows);
    root.position.copy(world);

    const body = new THREE.Group();
    body.position.y = baseY;
    body.add(model);

    const glow = makeGlowSprite(this.glowTex, glowColor, glowScale, 0.75);
    glow.position.y = baseY * 0.5;
    body.add(glow);

    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softTex, color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
    }));
    shadow.scale.set(0.7, 0.7, 1);
    shadow.position.y = 0.02;

    root.add(body, shadow);
    this.stage.entitiesRoot.add(root);

    return { root, body, glow, shadow, type, cell, baseY, phase: Math.random() * Math.PI * 2, spin: 1, eating: null };
  }

  // Start the quick squash-and-pop animation; the pickup is removed from the
  // scene when it finishes (see update).
  consume() {
    if (this.eating) return;
    this.eating = { t: 0 };
  }

  remove(pickup) {
    const i = this.pickups.indexOf(pickup);
    if (i >= 0) this.pickups.splice(i, 1);
    this.stage.entitiesRoot.remove(pickup.root);
    pickup.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
  }

  update(dt, time, attractTo = null) {
    const dead = [];
    for (const p of this.pickups) {
      if (p.eating) {
        // Squash-and-pop: bulge up, spin, then vanish.
        p.eating.t += dt;
        const k = Math.min(1, p.eating.t / 0.16);
        const s = 1 + Math.sin(k * Math.PI) * 0.55;
        p.body.scale.set(s, s, s);
        p.body.rotation.y += dt * 10;
        p.glow.material.opacity = Math.max(0, 0.75 - k);
        if (k >= 1) dead.push(p);
        continue;
      }
      p.body.position.y = p.baseY + Math.sin(time * 2.2 + p.phase) * 0.09;
      p.body.rotation.y += dt * p.spin;
      p.glow.material.opacity = 0.55 + Math.sin(time * 4 + p.phase) * 0.2;

      if (attractTo) {
        const dx = attractTo.x - p.root.position.x;
        const dz = attractTo.z - p.root.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 4.5 && dist > 0.001) {
          const pull = dt * (7 - dist) * 1.4;
          p.root.position.x += (dx / dist) * Math.min(pull, dist);
          p.root.position.z += (dz / dist) * Math.min(pull, dist);
        }
      }
    }
    for (const p of dead) this.remove(p);
  }

  pickupNear(pos, radius) {
    for (const p of this.pickups) {
      if (p.eating) continue;
      const dx = p.root.position.x - pos.x;
      const dz = p.root.position.z - pos.z;
      if (dx * dx + dz * dz < radius * radius) return p;
    }
    return null;
  }
}
