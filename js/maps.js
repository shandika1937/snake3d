import * as THREE from "../vendor/three.module.js";
import { CELL, cellToWorld, gridKey, makeSkyDome, makeGlowSprite } from "./three-setup.js";

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEO = {
  sphere: new THREE.SphereGeometry(1, 14, 11),
  sphereHi: new THREE.SphereGeometry(1, 20, 16),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylHi: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 12),
  box: new THREE.BoxGeometry(1, 1, 1),
  octa: new THREE.OctahedronGeometry(1, 0),
  icosa: new THREE.IcosahedronGeometry(1, 1),
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
}

// Ambient drifting/falling particles shared across maps.
function makeParticles(opts) {
  const {
    count = 80, color = 0xffffff, size = 0.14, region = { x: 30, z: 30, y: 12 },
    baseY = 6, mode = "drift", speed = 0.8, opacity = 0.7,
  } = opts;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * region.x;
    pos[i * 3 + 1] = Math.random() * region.y + baseY;
    pos[i * 3 + 2] = (Math.random() - 0.5) * region.z;
    vel[i] = (0.5 + Math.random()) * speed;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, map: null, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(dt, time) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        if (mode === "fall") {
          arr[j + 1] -= vel[i] * dt * 2;
          if (arr[j + 1] < baseY) arr[j + 1] = baseY + region.y;
          arr[j] += Math.sin(time * 0.8 + i) * dt * 0.4;
        } else if (mode === "rise") {
          arr[j + 1] += vel[i] * dt * 1.4;
          if (arr[j + 1] > baseY + region.y) arr[j + 1] = baseY;
        } else if (mode === "wander") {
          arr[j] += Math.sin(time * 0.6 + i * 1.7) * dt * vel[i] * 0.8;
          arr[j + 1] += Math.sin(time * 0.9 + i * 2.3) * dt * vel[i] * 0.5;
          arr[j + 2] += Math.cos(time * 0.7 + i * 1.1) * dt * vel[i] * 0.8;
        } else { // drift
          arr[j] += vel[i] * dt * 0.7;
          if (arr[j] > region.x / 2) arr[j] = -region.x / 2;
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Prop factories                                                      */
/* ------------------------------------------------------------------ */

function makeTree(trunkMat, leafMat, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(GEO.cyl, trunkMat);
  trunk.scale.set(0.12, 0.5, 0.12);
  trunk.position.y = 0.25;
  trunk.castShadow = true;
  g.add(trunk);
  const leaf = new THREE.Mesh(GEO.sphere, leafMat);
  leaf.scale.set(0.52, 0.48, 0.52);
  leaf.position.y = 0.72;
  leaf.castShadow = true;
  g.add(leaf);
  const leaf2 = new THREE.Mesh(GEO.sphere, leafMat);
  leaf2.scale.set(0.36, 0.34, 0.36);
  leaf2.position.set(0.12, 0.98, 0.05);
  leaf2.castShadow = true;
  g.add(leaf2);
  g.scale.setScalar(s);
  return g;
}

function makePine(trunkMat, leafMat, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(GEO.cyl, trunkMat);
  trunk.scale.set(0.14, 0.6, 0.14);
  trunk.position.y = 0.3;
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const tier = new THREE.Mesh(GEO.cone, leafMat);
    tier.scale.setScalar(0.55 - i * 0.12);
    tier.position.y = 0.55 + i * 0.3;
    tier.castShadow = true;
    g.add(tier);
  }
  g.scale.setScalar(s);
  return g;
}

function makeRock(mat, s = 1) {
  const g = new THREE.Group();
  const r = new THREE.Mesh(GEO.icosa, mat);
  r.scale.set(1, 0.6, 0.9);
  r.castShadow = true;
  g.add(r);
  const r2 = new THREE.Mesh(GEO.icosa, mat);
  r2.scale.set(0.5, 0.4, 0.5);
  r2.position.set(0.35, 0.08, 0.3);
  r2.castShadow = true;
  g.add(r2);
  g.scale.setScalar(s * 0.45);
  return g;
}

function makeBush(mat, s = 1) {
  const g = new THREE.Group();
  const a = new THREE.Mesh(GEO.sphere, mat);
  a.scale.setScalar(0.4);
  a.position.y = 0.18;
  a.castShadow = true;
  const b = new THREE.Mesh(GEO.sphere, mat);
  b.scale.setScalar(0.3);
  b.position.set(0.26, 0.1, 0.12);
  b.castShadow = true;
  g.add(a, b);
  g.scale.setScalar(s);
  return g;
}

function makeFlower(petalMat, coreMat) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(GEO.cyl, std(0x3a7d33));
  stem.scale.set(0.03, 0.3, 0.03);
  stem.position.y = 0.15;
  g.add(stem);
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(GEO.sphere, petalMat);
    petal.scale.set(0.09, 0.05, 0.09);
    const a = (i / 5) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.08, 0.3, Math.sin(a) * 0.08);
    g.add(petal);
  }
  const core = new THREE.Mesh(GEO.sphere, coreMat);
  core.scale.setScalar(0.06);
  core.position.y = 0.3;
  g.add(core);
  return g;
}

function makeCactus(mat, s = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.cylHi, mat);
  body.scale.set(0.22, 0.85, 0.22);
  body.position.y = 0.42;
  body.castShadow = true;
  g.add(body);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(GEO.cyl, mat);
    arm.scale.set(0.11, 0.42, 0.11);
    arm.position.set(side * 0.16, 0.32, 0);
    arm.rotation.z = -side * 0.9;
    arm.castShadow = true;
    g.add(arm);
  }
  g.scale.setScalar(s);
  return g;
}

function makeBoulder(mat, s = 1) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(GEO.icosa, mat);
  b.scale.set(1.1, 0.7, 0.95);
  b.castShadow = true;
  g.add(b);
  g.scale.setScalar(s * 0.5);
  return g;
}

function makeLog(mat, s = 1) {
  const g = new THREE.Group();
  const log = new THREE.Mesh(GEO.cyl, mat);
  log.rotation.z = Math.PI / 2;
  log.scale.set(0.9, 0.26, 0.26);
  log.position.y = 0.14;
  log.castShadow = true;
  g.add(log);
  g.scale.setScalar(s);
  return g;
}

function makeMushroom(capMat, stemMat, s = 1) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(GEO.cyl, stemMat);
  stem.scale.set(0.06, 0.16, 0.06);
  stem.position.y = 0.08;
  g.add(stem);
  const cap = new THREE.Mesh(GEO.sphere, capMat);
  cap.scale.set(0.18, 0.12, 0.18);
  cap.position.y = 0.18;
  g.add(cap);
  g.scale.setScalar(s);
  return g;
}

function makeIceCrystal(mat, s = 1) {
  const g = new THREE.Group();
  const a = new THREE.Mesh(GEO.octa, mat);
  a.scale.set(0.28, 1.1, 0.28);
  a.position.y = 0.55;
  a.castShadow = true;
  const b = new THREE.Mesh(GEO.octa, mat);
  b.scale.set(0.18, 0.7, 0.18);
  b.position.set(0.2, 0.32, 0.05);
  b.rotation.z = 0.4;
  b.castShadow = true;
  g.add(a, b);
  g.scale.setScalar(s);
  return g;
}

function makeMountain(mat, snowMat, s = 1) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(GEO.cone, mat);
  m.scale.set(2.6, 3.2, 2.6);
  m.castShadow = true;
  g.add(m);
  const cap = new THREE.Mesh(GEO.cone, snowMat);
  cap.scale.set(1.1, 1.1, 1.1);
  cap.position.y = 1.7;
  g.add(cap);
  g.scale.setScalar(s);
  return g;
}

function makePillar(mat, s = 1) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(GEO.box, mat);
  p.scale.set(0.5, 1.1, 0.5);
  p.position.y = 0.55;
  p.castShadow = true;
  g.add(p);
  g.scale.setScalar(s);
  return g;
}

function makeEmberTree(trunkMat, leafMat, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(GEO.cyl, trunkMat);
  trunk.scale.set(0.14, 0.5, 0.14);
  trunk.position.y = 0.25;
  trunk.castShadow = true;
  g.add(trunk);
  const leaf = new THREE.Mesh(GEO.sphere, leafMat);
  leaf.scale.set(0.5, 0.44, 0.5);
  leaf.position.y = 0.68;
  leaf.castShadow = true;
  g.add(leaf);
  const leaf2 = new THREE.Mesh(GEO.sphere, leafMat);
  leaf2.scale.set(0.3, 0.28, 0.3);
  leaf2.position.set(0.12, 0.92, 0.06);
  leaf2.castShadow = true;
  g.add(leaf2);
  g.scale.setScalar(s);
  return g;
}

function makeObsidianPillar(mat, glowMat, s = 1) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(GEO.cylHi, mat);
  p.scale.set(0.42, 1.2, 0.42);
  p.position.y = 0.6;
  p.castShadow = true;
  g.add(p);
  const tip = new THREE.Mesh(GEO.octa, glowMat);
  tip.scale.setScalar(0.34);
  tip.position.y = 1.28;
  g.add(tip);
  g.scale.setScalar(s);
  return g;
}

function makeLavaRock(mat, glowMat, s = 1) {
  const g = new THREE.Group();
  const r = new THREE.Mesh(GEO.icosa, mat);
  r.scale.set(1, 0.55, 0.9);
  r.castShadow = true;
  g.add(r);
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(GEO.octa, glowMat);
    c.scale.setScalar(0.2);
    c.position.set((i - 1) * 0.28, 0.26, (Math.random() - 0.5) * 0.4);
    g.add(c);
  }
  g.scale.setScalar(s * 0.5);
  return g;
}

function makeVolcano(mat, glowTex, s = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.cone, mat);
  body.scale.set(3.4, 3.6, 3.4);
  body.castShadow = true;
  g.add(body);
  const crater = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color: 0xff6a1f, fog: false }));
  crater.scale.set(1.4, 0.22, 1.4);
  crater.position.y = 3.7;
  g.add(crater);
  const glow = makeGlowSprite(glowTex, 0xff6a2a, 5, 0.85);
  glow.position.y = 4;
  g.add(glow);
  g.scale.setScalar(s);
  return g;
}

function makeBarrier(mat, glowTex, s = 1) {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(GEO.box, mat);
  wall.scale.set(0.92, 0.7, 0.12);
  wall.position.y = 0.35;
  g.add(wall);
  const glow = makeGlowSprite(glowTex, mat.color, 1.6, 0.5);
  glow.position.y = 0.4;
  g.add(glow);
  g.scale.setScalar(s);
  return g;
}

/* ------------------------------------------------------------------ */
/* Map definitions                                                     */
/* ------------------------------------------------------------------ */

const MAP_DEFS = [
  {
    id: "garden", name: "Classic Garden", difficulty: "Easy", cls: "easy",
    cols: 15, rows: 15, speed: 5.5, speedPerLevel: 0.3, seed: 101,
    flavour: "garden", accent: "#4ade80",
    sky: { top: "#6fc3ff", horizon: "#e8f6ff" },
    fog: { color: "#cfe8ff", near: 30, far: 90 },
    light: { color: 0xfff2d0, intensity: 2.0, pos: [14, 26, 12] },
    ambient: { sky: 0xbfe4ff, ground: 0x4c8f4a, intensity: 1.0 },
  },
  {
    id: "desert", name: "Desert Canyon", difficulty: "Normal", cls: "normal",
    cols: 17, rows: 17, speed: 6.4, speedPerLevel: 0.35, seed: 202,
    flavour: "desert", accent: "#f59e0b",
    sky: { top: "#ff9e5e", horizon: "#ffd9a0" },
    fog: { color: "#e8a05f", near: 34, far: 100 },
    light: { color: 0xffc27a, intensity: 2.4, pos: [18, 24, -10] },
    ambient: { sky: 0xffc98f, ground: 0xb0783c, intensity: 1.1 },
  },
  {
    id: "night", name: "Mystic Night Forest", difficulty: "Normal", cls: "normal",
    cols: 17, rows: 17, speed: 6.9, speedPerLevel: 0.38, seed: 303,
    flavour: "night", accent: "#8b5cf6",
    sky: { top: "#070c2c", horizon: "#24305c" },
    fog: { color: "#0d1430", near: 26, far: 80 },
    light: { color: 0x9db4ff, intensity: 1.3, pos: [6, 22, 14] },
    ambient: { sky: 0x3b4f8f, ground: 0x10231c, intensity: 0.9 },
  },
  {
    id: "cyber", name: "Neon Cyber City", difficulty: "Hard", cls: "hard",
    cols: 19, rows: 19, speed: 7.8, speedPerLevel: 0.42, seed: 404,
    flavour: "cyber", accent: "#22d3ee",
    sky: { top: "#05040f", horizon: "#1b1040" },
    fog: { color: "#0a0a20", near: 30, far: 90 },
    light: { color: 0x8fe8ff, intensity: 1.2, pos: [0, 26, 16] },
    ambient: { sky: 0x2a2a5e, ground: 0x14142e, intensity: 0.9 },
  },
  {
    id: "ice", name: "Frozen Ice Kingdom", difficulty: "Hard", cls: "hard",
    cols: 19, rows: 19, speed: 7.8, speedPerLevel: 0.42, seed: 505,
    flavour: "ice", accent: "#60a5fa",
    sky: { top: "#9fd0f5", horizon: "#eaf6ff" },
    fog: { color: "#d7e9fb", near: 32, far: 95 },
    light: { color: 0xeef6ff, intensity: 2.0, pos: [10, 26, 10] },
    ambient: { sky: 0xd6ecff, ground: 0x9fc8ec, intensity: 1.1 },
  },
  {
    id: "volcano", name: "Volcanic Inferno", difficulty: "Expert", cls: "expert",
    cols: 21, rows: 21, speed: 8.2, speedPerLevel: 0.45, seed: 606,
    flavour: "volcano", accent: "#f97316",
    sky: { top: "#17040a", horizon: "#4a1210" },
    fog: { color: "#24100b", near: 30, far: 95 },
    light: { color: 0xff9a4d, intensity: 1.9, pos: [12, 24, 8] },
    ambient: { sky: 0x8a3020, ground: 0x1c0e0a, intensity: 1.0 },
  },
];

export const MAPS = MAP_DEFS;
export function getMap(id) { return MAP_DEFS.find((m) => m.id === id); }

/* ------------------------------------------------------------------ */
/* Shared stage helpers                                                */
/* ------------------------------------------------------------------ */

function addLights(stage, def) {
  const hemi = new THREE.HemisphereLight(def.ambient.sky, def.ambient.ground, def.ambient.intensity);
  stage.mapRoot.add(hemi);

  const sun = new THREE.DirectionalLight(def.light.color, def.light.intensity);
  sun.position.set(def.light.pos[0], def.light.pos[1], def.light.pos[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  stage.mapRoot.add(sun);
  stage.mapRoot.add(sun.target);
}

function addGround(stage, def, radius = 120) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    std(def.groundColor, { roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  stage.mapRoot.add(ground);
}

function addPlatform(stage, def) {
  const w = def.cols * CELL;
  const d = def.rows * CELL;
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.5, d),
    def.platformMat
  );
  platform.position.y = -0.25;
  platform.receiveShadow = true;
  stage.mapRoot.add(platform);
}

function inSafeZone(c, cols, rows) {
  const midX = Math.floor(cols / 2);
  const midZ = Math.floor(rows / 2);
  return Math.abs(c.x - midX) <= 1 && c.z >= midZ - 2 && c.z <= midZ + 6;
}

function pickCells(cols, rows, count, seed, used) {
  const rng = mulberry32(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard < 2000) {
    guard++;
    const c = { x: Math.floor(rng() * cols), z: Math.floor(rng() * rows) };
    const k = gridKey(c.x, c.z);
    if (inSafeZone(c, cols, rows) || used.has(k)) continue;
    used.add(k);
    out.push(c);
  }
  return out;
}

function placeObstacle(stage, cell, cols, rows, mesh, obstacleCells) {
  const w = cellToWorld(cell.x, cell.z, cols, rows);
  mesh.position.set(w.x, 0, w.z);
  mesh.userData.cell = cell;
  stage.mapRoot.add(mesh);
  obstacleCells.add(gridKey(cell.x, cell.z));
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function buildGarden(stage, def) {
  const obstacleCells = new Set();
  stage.scene.background = new THREE.Color(def.sky.top);
  stage.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  stage.mapRoot.add(makeSkyDome(def.sky.top, def.sky.horizon));
  def.groundColor = 0x4c8f4a;
  def.platformMat = std(0x63b552, { roughness: 1 });
  addLights(stage, def);
  addGround(stage, def);
  addPlatform(stage, def);

  const g = stage.mapRoot;

  // White picket fence border.
  const fenceMat = std(0xf5f2e8, { roughness: 0.7 });
  const railMat = std(0xe9e2cf, { roughness: 0.7 });
  const halfW = def.cols / 2, halfD = def.rows / 2;
  for (let x = -halfW + 0.5; x <= halfW - 0.5; x += 1) {
    for (const z of [-halfD - 0.4, halfD + 0.4]) {
      const post = new THREE.Mesh(GEO.box, fenceMat);
      post.scale.set(0.1, 0.55, 0.1);
      post.position.set(x, 0.28, z);
      post.castShadow = true;
      g.add(post);
    }
  }
  for (let z = -halfD + 0.5; z <= halfD - 0.5; z += 1) {
    for (const x of [-halfW - 0.4, halfW + 0.4]) {
      const post = new THREE.Mesh(GEO.box, fenceMat);
      post.scale.set(0.1, 0.55, 0.1);
      post.position.set(x, 0.28, z);
      post.castShadow = true;
      g.add(post);
    }
  }
  for (const [len, x, z, ry] of [
    [def.cols + 1, 0, -halfD - 0.4, 0],
    [def.cols + 1, 0, halfD + 0.4, 0],
    [def.rows + 1, -halfW - 0.4, 0, Math.PI / 2],
    [def.rows + 1, halfW + 0.4, 0, Math.PI / 2],
  ]) {
    const rail = new THREE.Mesh(GEO.box, railMat);
    rail.scale.set(len, 0.06, 0.06);
    rail.position.set(x, 0.42, z);
    rail.rotation.y = ry;
    g.add(rail);
  }

  // Trees, rocks, bushes, flowers around the arena.
  const trunkMat = std(0x7a4a2b);
  const leafMat = std(0x3f9b3a);
  const rockMat = std(0x9aa3ad);
  const bushMat = std(0x4fae46);
  const rng = mulberry32(def.seed * 7);
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.max(halfW, halfD) + 2.5 + rng() * 7;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (i % 3 === 0) g.add((() => { const t = makeTree(trunkMat, leafMat, 0.9 + rng() * 0.7); t.position.set(x, 0, z); t.rotation.y = rng() * Math.PI; return t; })());
    else if (i % 3 === 1) g.add((() => { const rk = makeRock(rockMat, 0.8 + rng() * 1.2); rk.position.set(x, 0, z); return rk; })());
    else g.add((() => { const b = makeBush(bushMat, 0.8 + rng()); b.position.set(x, 0, z); return b; })());
  }
  // Flowers on the near edges.
  for (let i = 0; i < 12; i++) {
    const fl = makeFlower(std(i % 2 ? 0xff8fb0 : 0xffd166), std(0xffe08a));
    fl.position.set((rng() - 0.5) * (def.cols + 6), 0, halfD + 0.8 + rng() * 2);
    g.add(fl);
  }

  // Obstacles: trees and rocks inside the board.
  const used = new Set();
  const treeCells = pickCells(def.cols, def.rows, 8, def.seed, used);
  treeCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeTree(trunkMat, leafMat, 1.0), obstacleCells));
  const rockCells = pickCells(def.cols, def.rows, 6, def.seed + 1, used);
  rockCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeRock(rockMat, 1.1), obstacleCells));

  const pollen = makeParticles({ count: 60, color: 0xffffff, size: 0.08, region: { x: def.cols + 8, z: def.rows + 8, y: 8 }, baseY: 0.5, mode: "drift", speed: 0.5, opacity: 0.5 });
  g.add(pollen.points);
  return {
    obstacleCells,
    update: pollen.update,
    extraFactory: () => (Math.random() < 0.5 ? makeRock(rockMat, 1.1) : makeTree(trunkMat, leafMat, 1.0)),
  };
}

function buildDesert(stage, def) {
  const obstacleCells = new Set();
  stage.scene.background = new THREE.Color(def.sky.top);
  stage.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  stage.mapRoot.add(makeSkyDome(def.sky.top, def.sky.horizon));
  def.groundColor = 0xd9a45f;
  def.platformMat = std(0xe0b06a, { roughness: 1 });
  addLights(stage, def);
  addGround(stage, def);
  addPlatform(stage, def);
  const g = stage.mapRoot;

  const sandMat = std(0xc98f4e, { roughness: 0.95 });
  const cactusMat = std(0x3f9b4a);
  const boulderMat = std(0xb0713f);

  // Sandstone perimeter boulders.
  const halfW = def.cols / 2, halfD = def.rows / 2;
  for (let x = -halfW; x <= halfW; x += 1) {
    for (const z of [-halfD - 0.4, halfD + 0.4]) {
      const b = makeBoulder(boulderMat, 0.5);
      b.position.set(x, 0, z);
      b.rotation.y = Math.random() * Math.PI;
      g.add(b);
    }
  }
  for (let z = -halfD; z <= halfD; z += 1) {
    for (const x of [-halfW - 0.4, halfW + 0.4]) {
      const b = makeBoulder(boulderMat, 0.5);
      b.position.set(x, 0, z);
      b.rotation.y = Math.random() * Math.PI;
      g.add(b);
    }
  }

  // Sunset sun disc.
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false });
  const sun = new THREE.Mesh(GEO.sphereHi, sunMat);
  sun.position.set(-halfW - 8, 8, -halfD - 10);
  sun.scale.setScalar(3.2);
  g.add(sun);

  // Canyon mesas in the background.
  const mesaMat = std(0xb06a3c, { roughness: 1 });
  const mesaCap = std(0xd98e4a, { roughness: 1 });
  const rng = mulberry32(def.seed * 13);
  for (let i = 0; i < 7; i++) {
    const mesa = new THREE.Mesh(GEO.box, mesaMat);
    const w = 3 + rng() * 5, h = 2.5 + rng() * 5;
    mesa.scale.set(w, h, 2 + rng() * 3);
    mesa.position.set(-halfW - 10 + i * (def.cols + 8) / 6, h / 2, -halfD - 8 - rng() * 6);
    g.add(mesa);
    const cap = new THREE.Mesh(GEO.box, mesaCap);
    cap.scale.set(w + 0.3, 0.4, 2.4 + rng() * 3);
    cap.position.set(mesa.position.x, h + 0.2, mesa.position.z);
    g.add(cap);
  }
  // Scattered cacti around.
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.max(halfW, halfD) + 2 + rng() * 6;
    const c = makeCactus(cactusMat, 0.8 + rng() * 0.7);
    c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(c);
  }

  // Obstacles: cactus and boulders inside.
  const used = new Set();
  const cactusCells = pickCells(def.cols, def.rows, 9, def.seed, used);
  cactusCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeCactus(cactusMat, 1.05), obstacleCells));
  const boulderCells = pickCells(def.cols, def.rows, 7, def.seed + 1, used);
  boulderCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeBoulder(boulderMat, 1.0), obstacleCells));

  const dust = makeParticles({ count: 70, color: 0xd9a45f, size: 0.1, region: { x: def.cols + 10, z: def.rows + 10, y: 6 }, baseY: 0.3, mode: "drift", speed: 1.0, opacity: 0.45 });
  g.add(dust.points);
  return { obstacleCells, update: dust.update, extraFactory: () => makeCactus(cactusMat, 1.05) };
}

function buildNight(stage, def, glowTex) {
  const obstacleCells = new Set();
  stage.scene.background = new THREE.Color(def.sky.top);
  stage.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  stage.mapRoot.add(makeSkyDome(def.sky.top, def.sky.horizon));
  def.groundColor = 0x14301f;
  def.platformMat = std(0x1f4a2c, { roughness: 1 });
  addLights(stage, def);
  addGround(stage, def);
  addPlatform(stage, def);
  const g = stage.mapRoot;

  const treeMat = std(0x2c6b3f, { roughness: 0.9 });
  const trunkMat = std(0x3a2b22);
  const rockMat = std(0x3c4a52);

  // Moon.
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xf4f7ff, fog: false });
  const moon = new THREE.Mesh(GEO.sphereHi, moonMat);
  moon.position.set(def.cols * 0.6, 14, -def.rows);
  moon.scale.setScalar(2.6);
  g.add(moon);
  // Moon halo.
  g.add((() => { const halo = makeGlowSprite(glowTex, 0xdfe9ff, 9, 0.5); halo.position.copy(moon.position); return halo; })());

  // Stars.
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) {
    const a = Math.random() * Math.PI * 2;
    const elev = Math.random() * Math.PI * 0.45;
    const r = 150;
    starPos[i * 3] = Math.cos(a) * Math.cos(elev) * r;
    starPos[i * 3 + 1] = Math.sin(elev) * r + 4;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(elev) * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe9ff, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.9, fog: false }));
  stars.frustumCulled = false;
  g.add(stars);

  // Big trees around the arena.
  const rng = mulberry32(def.seed * 5);
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.max(def.cols / 2, def.rows / 2) + 2 + rng() * 7;
    const t = makeTree(trunkMat, treeMat, 1.2 + rng() * 1.4);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    t.rotation.y = rng() * Math.PI;
    g.add(t);
  }
  // Fallen logs + mossy rocks.
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.max(def.cols / 2, def.rows / 2) + 2 + rng() * 5;
    const lg = makeLog(trunkMat, 0.9 + rng() * 0.6);
    lg.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    lg.rotation.y = rng() * Math.PI;
    g.add(lg);
  }

  // Glowing mushrooms along the border.
  const shroomMat = std(0x34d399, { emissive: 0x10b981, emissiveIntensity: 1.4 });
  const shroomStem = std(0xe7e5df);
  for (let x = -def.cols / 2 + 0.5; x <= def.cols / 2 - 0.5; x += 1.5) {
    for (const z of [-def.rows / 2 - 0.4, def.rows / 2 + 0.4]) {
      const m = makeMushroom(shroomMat, shroomStem, 0.8 + Math.random() * 0.5);
      m.position.set(x, 0, z);
      g.add(m);
    }
  }

  // Obstacles: trees and logs inside.
  const used = new Set();
  const treeCells = pickCells(def.cols, def.rows, 8, def.seed, used);
  treeCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeTree(trunkMat, treeMat, 1.1), obstacleCells));
  const logCells = pickCells(def.cols, def.rows, 5, def.seed + 1, used);
  logCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeLog(trunkMat, 1.0), obstacleCells));
  const rockCells = pickCells(def.cols, def.rows, 4, def.seed + 2, used);
  rockCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeRock(rockMat, 1.0), obstacleCells));

  const fireflies = makeParticles({ count: 70, color: 0xd4ff8f, size: 0.16, region: { x: def.cols + 12, z: def.rows + 12, y: 7 }, baseY: 0.4, mode: "wander", speed: 0.8, opacity: 0.9 });
  g.add(fireflies.points);
  return { obstacleCells, update: fireflies.update, extraFactory: () => makeLog(trunkMat, 1.0) };
}

function buildCyber(stage, def, glowTex) {
  const obstacleCells = new Set();
  stage.scene.background = new THREE.Color(def.sky.top);
  stage.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  stage.mapRoot.add(makeSkyDome(def.sky.top, def.sky.horizon));
  def.groundColor = 0x0a0d20;
  def.platformMat = std(0x0e1226, { roughness: 0.6, metalness: 0.3 });
  addLights(stage, def);
  addGround(stage, def);
  addPlatform(stage, def);
  const g = stage.mapRoot;

  // Neon grid lines on the platform.
  const gridLineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 });
  const gridPoints = [];
  const halfW = def.cols / 2, halfD = def.rows / 2;
  for (let x = -halfW; x <= halfW; x += 1) {
    gridPoints.push(new THREE.Vector3(x, 0.02, -halfD), new THREE.Vector3(x, 0.02, halfD));
  }
  for (let z = -halfD; z <= halfD; z += 1) {
    gridPoints.push(new THREE.Vector3(-halfW, 0.02, z), new THREE.Vector3(halfW, 0.02, z));
  }
  const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints);
  const grid = new THREE.LineSegments(gridGeo, gridLineMat);
  g.add(grid);

  // Energy barriers around the border.
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee, emissive: 0x0ea5e9, emissiveIntensity: 1.6,
    transparent: true, opacity: 0.35, roughness: 0.2, side: THREE.DoubleSide,
  });
  for (const [len, x, z, ry] of [
    [def.cols + 0.4, 0, -halfD - 0.4, 0],
    [def.cols + 0.4, 0, halfD + 0.4, 0],
    [def.rows + 0.4, -halfW - 0.4, 0, Math.PI / 2],
    [def.rows + 0.4, halfW + 0.4, 0, Math.PI / 2],
  ]) {
    const wall = new THREE.Mesh(GEO.box, barrierMat);
    wall.scale.set(len, 0.8, 0.1);
    wall.position.set(x, 0.4, z);
    wall.rotation.y = ry;
    g.add(wall);
  }
  // Corner pillars.
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e2a52, emissive: 0x22d3ee, emissiveIntensity: 0.6, roughness: 0.3 });
  for (const [cx, cz] of [[-halfW - 0.4, -halfD - 0.4], [halfW + 0.4, -halfD - 0.4], [-halfW - 0.4, halfD + 0.4], [halfW + 0.4, halfD + 0.4]]) {
    const p = makePillar(pillarMat, 1.0);
    p.position.set(cx, 0, cz);
    g.add(p);
  }

  // Futuristic buildings in the background.
  const bldMat = std(0x141a3a, { roughness: 0.5, metalness: 0.4 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0ea5e9, emissiveIntensity: 1.2 });
  const rng = mulberry32(def.seed * 11);
  for (let i = 0; i < 10; i++) {
    const w = 2 + rng() * 3, h = 4 + rng() * 9;
    const b = new THREE.Mesh(GEO.box, bldMat);
    b.scale.set(w, h, 2 + rng() * 2);
    b.position.set(-halfW - 8 + i * (def.cols + 16) / 10, h / 2, -halfD - 8 - rng() * 4);
    g.add(b);
    // Window strips.
    for (let wy = 1; wy < h; wy += 1.4) {
      const win = new THREE.Mesh(GEO.box, winMat);
      win.scale.set(w * 0.7, 0.25, 0.12);
      win.position.set(b.position.x, wy, b.position.z + b.scale.z / 2 + 0.06);
      g.add(win);
    }
  }

  // Obstacles: barriers and neon pillars inside.
  const used = new Set();
  const barrierCells = pickCells(def.cols, def.rows, 8, def.seed, used);
  barrierCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeBarrier(barrierMat, glowTex, 1.0), obstacleCells));
  const pillarCells = pickCells(def.cols, def.rows, 6, def.seed + 1, used);
  pillarCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makePillar(pillarMat, 0.95), obstacleCells));

  // Neon rising particles.
  const neon = makeParticles({ count: 90, color: 0x22d3ee, size: 0.09, region: { x: def.cols + 10, z: def.rows + 10, y: 10 }, baseY: 0.2, mode: "rise", speed: 0.8, opacity: 0.6 });
  const neon2 = makeParticles({ count: 50, color: 0xf0abfc, size: 0.08, region: { x: def.cols + 10, z: def.rows + 10, y: 10 }, baseY: 0.2, mode: "rise", speed: 0.6, opacity: 0.5 });
  g.add(neon.points, neon2.points);
  return {
    obstacleCells,
    update(dt, time) { neon.update(dt, time); neon2.update(dt, time); },
    extraFactory: () => makeBarrier(barrierMat, glowTex, 1.0),
  };
}

function buildIce(stage, def) {
  const obstacleCells = new Set();
  stage.scene.background = new THREE.Color(def.sky.top);
  stage.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  stage.mapRoot.add(makeSkyDome(def.sky.top, def.sky.horizon));
  def.groundColor = 0xe6f1fb;
  def.platformMat = std(0xdcecfc, { roughness: 0.6, metalness: 0.05 });
  addLights(stage, def);
  addGround(stage, def);
  addPlatform(stage, def);
  const g = stage.mapRoot;

  const snowMat = std(0xffffff, { roughness: 0.9 });
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0x9fd8f5, roughness: 0.15, metalness: 0.05,
    transparent: true, opacity: 0.75, emissive: 0x7cc4ec, emissiveIntensity: 0.3,
  });
  const frozenTreeMat = std(0xcfe8f7);
  const trunkMat = std(0x8aa7bd);

  // Ice crystal border shards.
  const halfW = def.cols / 2, halfD = def.rows / 2;
  for (let x = -halfW; x <= halfW; x += 1) {
    for (const z of [-halfD - 0.4, halfD + 0.4]) {
      const c = makeIceCrystal(iceMat, 0.6);
      c.position.set(x, 0, z);
      g.add(c);
    }
  }
  for (let z = -halfD; z <= halfD; z += 1) {
    for (const x of [-halfW - 0.4, halfW + 0.4]) {
      const c = makeIceCrystal(iceMat, 0.6);
      c.position.set(x, 0, z);
      g.add(c);
    }
  }

  // Snow mountains in the distance.
  const mountainMat = std(0xb9d4e8, { roughness: 1 });
  const snowCap = std(0xffffff, { roughness: 0.9 });
  const rng = mulberry32(def.seed * 17);
  for (let i = 0; i < 8; i++) {
    const m = makeMountain(mountainMat, snowCap, 2.2 + rng() * 2.6);
    m.position.set(-halfW - 9 + i * (def.cols + 12) / 8, 0, -halfD - 9 - rng() * 5);
    g.add(m);
  }
  // Frozen trees + snow rocks around.
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.max(halfW, halfD) + 2 + rng() * 6;
    if (i % 2 === 0) {
      const t = makePine(trunkMat, frozenTreeMat, 0.9 + rng() * 0.8);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.add(t);
    } else {
      const rk = makeRock(snowMat, 0.8 + rng());
      rk.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.add(rk);
    }
  }

  // Obstacles: ice pillars and crystals inside.
  const used = new Set();
  const crystalCells = pickCells(def.cols, def.rows, 8, def.seed, used);
  crystalCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeIceCrystal(iceMat, 1.0), obstacleCells));
  const pillarCells = pickCells(def.cols, def.rows, 6, def.seed + 1, used);
  pillarCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makePillar(snowMat, 0.95), obstacleCells));

  // Falling snow.
  const snow = makeParticles({ count: 140, color: 0xffffff, size: 0.12, region: { x: def.cols + 14, z: def.rows + 14, y: 16 }, baseY: -1, mode: "fall", speed: 0.9, opacity: 0.85 });
  g.add(snow.points);
  return { obstacleCells, update: snow.update, extraFactory: () => makeIceCrystal(iceMat, 1.0) };
}

function buildVolcano(stage, def, glowTex) {
  const obstacleCells = new Set();
  stage.scene.background = new THREE.Color(def.sky.top);
  stage.scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  stage.mapRoot.add(makeSkyDome(def.sky.top, def.sky.horizon));
  def.groundColor = 0x2b1712;
  def.platformMat = std(0x3a2016, { roughness: 1 });
  addLights(stage, def);
  addGround(stage, def);
  addPlatform(stage, def);
  const g = stage.mapRoot;

  const rockMat = std(0x2b1a16, { roughness: 0.95 });
  const pillarMat = std(0x1c1416, { roughness: 0.35, metalness: 0.55 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff4a10, emissiveIntensity: 2.4, roughness: 0.3 });
  const trunkMat = std(0x24120c, { roughness: 0.9 });
  const emberMat = new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff3a10, emissiveIntensity: 1.8, roughness: 0.5 });
  const halfW = def.cols / 2, halfD = def.rows / 2;

  // Lava pools ringing the arena border.
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f });
  for (let x = -halfW; x <= halfW; x += 1) {
    for (const z of [-halfD - 0.5, halfD + 0.5]) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.72, 20), lavaMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.02, z);
      g.add(pool);
      const glow = makeGlowSprite(glowTex, 0xff7a2a, 1.7, 0.85);
      glow.position.set(x, 0.08, z);
      g.add(glow);
    }
  }
  for (let z = -halfD; z <= halfD; z += 1) {
    for (const x of [-halfW - 0.5, halfW + 0.5]) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.72, 20), lavaMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.02, z);
      g.add(pool);
      const glow = makeGlowSprite(glowTex, 0xff7a2a, 1.7, 0.85);
      glow.position.set(x, 0.08, z);
      g.add(glow);
    }
  }

  // Corner obsidian pillars.
  for (const [cx, cz] of [[-halfW - 0.5, -halfD - 0.5], [halfW + 0.5, -halfD - 0.5], [-halfW - 0.5, halfD + 0.5], [halfW + 0.5, halfD + 0.5]]) {
    const p = makeObsidianPillar(pillarMat, glowMat, 1.1);
    p.position.set(cx, 0, cz);
    g.add(p);
  }

  // Distant erupting volcanoes.
  const volcMat = std(0x3a2016, { roughness: 1 });
  const rng = mulberry32(def.seed * 23);
  for (let i = 0; i < 2; i++) {
    const v = makeVolcano(volcMat, glowTex, 1 + rng() * 0.6);
    v.position.set(-halfW - 14 + i * (def.cols + 30), 0, -halfD - 12 - rng() * 4);
    g.add(v);
  }

  // Ember trees and lava rocks scattered around the arena.
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.max(halfW, halfD) + 2 + rng() * 7;
    if (i % 2 === 0) {
      const t = makeEmberTree(trunkMat, emberMat, 0.9 + rng() * 0.7);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      t.rotation.y = rng() * Math.PI;
      g.add(t);
    } else {
      const rk = makeLavaRock(rockMat, glowMat, 1.2 + rng() * 0.8);
      rk.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.add(rk);
    }
  }

  // Obstacles: lava rocks and obsidian pillars inside the board.
  const used = new Set();
  const rockCells = pickCells(def.cols, def.rows, 9, def.seed, used);
  rockCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeLavaRock(rockMat, glowMat, 1.2), obstacleCells));
  const pillarCells = pickCells(def.cols, def.rows, 7, def.seed + 1, used);
  pillarCells.forEach((c) => placeObstacle(stage, c, def.cols, def.rows, makeObsidianPillar(pillarMat, glowMat, 1.0), obstacleCells));

  // Rising embers and sparks.
  const embers = makeParticles({ count: 90, color: 0xff7a2a, size: 0.12, region: { x: def.cols + 12, z: def.rows + 12, y: 12 }, baseY: 0.2, mode: "rise", speed: 1.0, opacity: 0.85 });
  const sparks = makeParticles({ count: 50, color: 0xffd166, size: 0.07, region: { x: def.cols + 12, z: def.rows + 12, y: 12 }, baseY: 0.2, mode: "rise", speed: 1.6, opacity: 0.8 });
  g.add(embers.points, sparks.points);
  return {
    obstacleCells,
    update(dt, time) { embers.update(dt, time); sparks.update(dt, time); },
    extraFactory: () => makeLavaRock(rockMat, glowMat, 1.2),
  };
}

const BUILDERS = {
  garden: buildGarden,
  desert: buildDesert,
  night: buildNight,
  cyber: buildCyber,
  ice: buildIce,
  volcano: buildVolcano,
};

// Build a map into the stage. Returns { obstacleCells, update }.
export function buildMap(mapId, stage, glowTex) {
  const def = getMap(mapId);
  if (!def) return null;
  const builder = BUILDERS[mapId];
  return builder(stage, def, glowTex);
}

// Obstacle cell layout for a map, using the exact same seeds/counts as the
// 3D builders. Lets the 2D fallback mirror the 3D boards without building
// any geometry.
export function obstacleLayout(mapId) {
  const def = getMap(mapId);
  if (!def) return [];
  const plans = {
    garden: [[def.seed, 8], [def.seed + 1, 6]],
    desert: [[def.seed, 9], [def.seed + 1, 7]],
    night: [[def.seed, 8], [def.seed + 1, 5], [def.seed + 2, 4]],
    cyber: [[def.seed, 8], [def.seed + 1, 6]],
    ice: [[def.seed, 8], [def.seed + 1, 6]],
    volcano: [[def.seed, 9], [def.seed + 1, 7]],
  };
  const used = new Set();
  const cells = [];
  for (const [seed, count] of plans[mapId] || []) {
    for (const c of pickCells(def.cols, def.rows, count, seed, used)) cells.push(c);
  }
  return cells;
}
