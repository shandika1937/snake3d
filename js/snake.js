import * as THREE from "../vendor/three.module.js";
import { CELL, cellToWorld } from "./three-setup.js";
import { DIR_VECTORS } from "./input.js";

const HEAD_R = 0.42;      // body radius at the neck
const SAMPLES = 64;       // longitudinal tube samples
const RADIAL = 12;        // cross-section segments

const SKIN = new THREE.Color("#2ec56e");
const BELLY = new THREE.Color("#f3e7c8");
const EYE_WHITE = new THREE.Color("#ffffff");
const PUPIL = new THREE.Color("#101c33");
const TONGUE = new THREE.Color("#ef4444");

function radiusAt(u) {
  // Full-ish body that tapers to a fine tail tip.
  const body = HEAD_R * (1 - 0.28 * Math.min(u / 0.72, 1));
  if (u < 0.72) return body;
  const t = (u - 0.72) / 0.28;
  return body * (1 - t * t) + 0.012;
}

export class Snake {
  constructor() {
    this.cols = 1;
    this.rows = 1;
    this.segments = [];
    this.dir = { x: 0, z: -1 };
    this.dirQueue = [];
    this.growPending = 0;
    this.fromCell = { x: 0, z: 0 };
    this.toCell = { x: 0, z: 0 };
    this.moveT = 0;
    this.tickDuration = 0.16;
    this._yaw = Math.PI;
    this._tongueTime = 0;

    this.group = new THREE.Group();
    this._buildTube();
    this._buildHead();
    this.group.add(this.tubeMesh, this.headGroup);
  }

  reset(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const midX = Math.floor(cols / 2);
    const midZ = Math.floor(rows / 2);
    this.dir = { x: 0, z: -1 };
    this.dirQueue = [];
    this.growPending = 0;
    this.segments = [];
    // Head at centre, body trailing toward the camera (+Z).
    for (let i = 0; i < 5; i++) {
      this.segments.push({ x: midX, z: midZ + i });
    }
    this.fromCell = { x: midX, z: midZ };
    this.toCell = { x: midX, z: midZ };
    this.moveT = 0;
    this._yaw = Math.atan2(this.dir.x, this.dir.z);
    this.headGroup.rotation.y = this._yaw;
  }

  setSpeed(cellsPerSec) {
    this.tickDuration = 1 / Math.max(0.001, cellsPerSec);
  }

  get headCell() { return this.segments[0]; }

  queueDir(name) {
    const v = DIR_VECTORS[name];
    if (!v) return;
    const last = this.dirQueue[this.dirQueue.length - 1];
    if (last && last.x === v.x && last.z === v.z) return;
    // Ignore an immediate 180° reversal of the current heading.
    if (v.x === -this.dir.x && v.z === -this.dir.z) return;
    if (this.dirQueue.length >= 3) this.dirQueue.shift();
    this.dirQueue.push({ x: v.x, z: v.z });
  }

  grow(n = 1) { this.growPending += n; }

  // Direction that would be applied on the next step (peek without consuming).
  pendingDir() {
    for (const cand of this.dirQueue) {
      if (cand.x === -this.dir.x && cand.z === -this.dir.z) continue;
      return cand;
    }
    return this.dir;
  }

  peekHeadCell() {
    const d = this.pendingDir();
    return { x: this.segments[0].x + d.x, z: this.segments[0].z + d.z };
  }

  step() {
    // Apply the first valid queued direction.
    while (this.dirQueue.length) {
      const cand = this.dirQueue.shift();
      if (cand.x === -this.dir.x && cand.z === -this.dir.z) continue;
      this.dir = cand;
      break;
    }
    const head = this.segments[0];
    this.fromCell = { x: head.x, z: head.z };
    const newHead = { x: head.x + this.dir.x, z: head.z + this.dir.z };
    this.segments.unshift(newHead);
    if (this.growPending > 0) this.growPending--;
    else this.segments.pop();
    this.toCell = newHead;
    this.moveT = 0;
  }

  // Advance the smooth clock; returns how many grid steps have elapsed.
  advance(dt) {
    this.moveT += dt / this.tickDuration;
    let steps = 0;
    while (this.moveT >= 1) {
      this.moveT -= 1;
      steps++;
    }
    return steps;
  }

  collidesWith(cell) {
    const limit = this.growPending > 0 ? this.segments.length : this.segments.length - 1;
    for (let i = 1; i < limit; i++) {
      if (this.segments[i].x === cell.x && this.segments[i].z === cell.z) return true;
    }
    return false;
  }

  occupies(cell) {
    return this.segments.some((s) => s.x === cell.x && s.z === cell.z);
  }

  // ---------- smooth spine ----------
  headSmooth() {
    const a = cellToWorld(this.fromCell.x, this.fromCell.z, this.cols, this.rows);
    const b = cellToWorld(this.toCell.x, this.toCell.z, this.cols, this.rows);
    if (this.fromCell.x === this.toCell.x && this.fromCell.z === this.toCell.z) return a;
    return a.lerp(b, this.moveT);
  }

  _sampleSpine(d, out) {
    out = out || new THREE.Vector3();
    const hs = this.headSmooth();
    const firstLen = this.moveT * CELL;
    if (d <= firstLen || this.segments.length < 2) {
      const p1 = cellToWorld(this.segments[1].x, this.segments[1].z, this.cols, this.rows);
      const t = firstLen > 0.0001 ? d / firstLen : 0;
      return out.copy(hs).lerp(p1, t);
    }
    let rem = d - firstLen;
    let i = 1;
    while (rem > CELL && i + 1 < this.segments.length) {
      rem -= CELL;
      i++;
    }
    const a = cellToWorld(this.segments[i].x, this.segments[i].z, this.cols, this.rows);
    const b = i + 1 < this.segments.length
      ? cellToWorld(this.segments[i + 1].x, this.segments[i + 1].z, this.cols, this.rows)
      : a;
    return out.copy(a).lerp(b, Math.max(0, Math.min(1, rem / CELL)));
  }

  _buildTube() {
    this._radii = new Float32Array(SAMPLES + 1);
    for (let i = 0; i <= SAMPLES; i++) this._radii[i] = radiusAt(i / SAMPLES);

    const vertCount = (SAMPLES + 1) * RADIAL;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    this._cos = new Float32Array(RADIAL);
    this._sin = new Float32Array(RADIAL);
    this._bellyMix = new Float32Array(RADIAL);

    for (let j = 0; j < RADIAL; j++) {
      const theta = (j / RADIAL) * Math.PI * 2;
      this._cos[j] = Math.cos(theta);
      this._sin[j] = Math.sin(theta);
      const s = this._sin[j];
      // Soft two-tone split around the equator.
      this._bellyMix[j] = s < -0.18 ? 1 : s < 0.18 ? (0.18 - s) / 0.36 : 0;
    }

    const tmp = new THREE.Color();
    for (let j = 0; j < RADIAL; j++) {
      tmp.copy(BELLY).lerp(SKIN, this._bellyMix[j]);
      for (let i = 0; i <= SAMPLES; i++) {
        const idx = (i * RADIAL + j) * 3;
        colors[idx] = tmp.r;
        colors[idx + 1] = tmp.g;
        colors[idx + 2] = tmp.b;
      }
    }

    const indices = [];
    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const j2 = (j + 1) % RADIAL;
        const a = i * RADIAL + j;
        const b = i * RADIAL + j2;
        const c = (i + 1) * RADIAL + j;
        const d = (i + 1) * RADIAL + j2;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    this.tubeGeo = geo;
    this._positions = positions;
    this._normals = normals;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.02,
      emissive: new THREE.Color("#0a2a16"),
      emissiveIntensity: 0.25,
    });
    this.tubeMesh = new THREE.Mesh(geo, mat);
    this.tubeMesh.castShadow = true;
    this.tubeMesh.receiveShadow = true;
  }

  _buildHead() {
    const headGroup = new THREE.Group();
    this.headGroup = headGroup;

    // Main head: rounded, slightly flattened and elongated forward.
    const headGeo = new THREE.SphereGeometry(HEAD_R * 1.2, 28, 22);
    const pos = headGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / (HEAD_R * 1.2);
      const m = y < -0.15 ? 1 : y < 0.15 ? (0.15 - y) / 0.3 : 0;
      tmp.copy(BELLY).lerp(SKIN, m);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    headGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const headMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.02,
      emissive: new THREE.Color("#0a2a16"),
      emissiveIntensity: 0.25,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.scale.set(0.98, 0.82, 1.32);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Brow ridge for character.
    const browGeo = new THREE.SphereGeometry(HEAD_R * 1.05, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const browMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.45 });
    const brow = new THREE.Mesh(browGeo, browMat);
    brow.scale.set(1.02, 0.5, 0.9);
    brow.position.set(0, HEAD_R * 0.42, HEAD_R * 0.35);
    brow.castShadow = true;
    headGroup.add(brow);

    // Eyes.
    const eyeWhiteGeo = new THREE.SphereGeometry(0.15, 18, 14);
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: EYE_WHITE, roughness: 0.25 });
    const pupilGeo = new THREE.SphereGeometry(0.075, 14, 12);
    const pupilMat = new THREE.MeshStandardMaterial({ color: PUPIL, roughness: 0.15, emissive: new THREE.Color("#0a0f1c"), emissiveIntensity: 0.3 });
    const glintGeo = new THREE.SphereGeometry(0.028, 8, 8);
    const glintMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const white = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
      white.scale.set(1, 1.2, 0.85);
      eye.add(white);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(0, 0.02, 0.095);
      pupil.scale.set(1, 1.4, 0.8);
      eye.add(pupil);
      const glint = new THREE.Mesh(glintGeo, glintMat);
      glint.position.set(0.05, 0.06, 0.11);
      eye.add(glint);
      eye.position.set(side * HEAD_R * 0.62, HEAD_R * 0.62, HEAD_R * 0.78);
      eye.scale.setScalar(1.05);
      headGroup.add(eye);
    }

    // Nostrils.
    const nostrilGeo = new THREE.SphereGeometry(0.032, 10, 8);
    const nostrilMat = new THREE.MeshStandardMaterial({ color: "#0c1a10", roughness: 0.6 });
    for (const side of [-1, 1]) {
      const n = new THREE.Mesh(nostrilGeo, nostrilMat);
      n.position.set(side * HEAD_R * 0.24, HEAD_R * 0.06, HEAD_R * 1.28);
      headGroup.add(n);
    }

    // Forked tongue (animated).
    const tongue = new THREE.Group();
    const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.34, 8);
    stemGeo.translate(0, 0, 0.17);
    const stemMat = new THREE.MeshStandardMaterial({ color: TONGUE, roughness: 0.5 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    tongue.add(stem);
    for (const side of [-1, 1]) {
      const forkGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.16, 6);
      forkGeo.translate(0, 0, 0.08);
      const fork = new THREE.Mesh(forkGeo, stemMat);
      fork.position.set(side * 0.045, 0.01, 0.3);
      fork.rotation.z = -side * 0.5;
      tongue.add(fork);
    }
    tongue.position.set(0, -HEAD_R * 0.28, HEAD_R * 0.98);
    tongue.scale.z = 0.2;
    this.tongue = tongue;
    headGroup.add(tongue);
  }

  update(dt, time) {
    const hs = this.headSmooth();
    const targetYaw = Math.atan2(this.dir.x, this.dir.z);
    let dy = targetYaw - this._yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this._yaw += dy * Math.min(1, dt * 16);
    this.headGroup.position.copy(hs);
    this.headGroup.position.y += HEAD_R * 0.92;
    this.headGroup.rotation.y = this._yaw;

    // Tongue flicks.
    this._tongueTime += dt;
    const ext = Math.max(0, Math.sin(this._tongueTime * 1.4) - 0.965) * 11;
    this.tongue.scale.z = 0.2 + Math.min(1.1, ext);

    this._updateTube(dt, time);
  }

  _updateTube(dt, time) {
    const totalLen = (this.segments.length - 1) * CELL;
    const n = SAMPLES + 1;
    const px = this._positions;
    const nm = this._normals;

    if (!this._spine) {
      this._spine = [];
      for (let i = 0; i < n; i++) this._spine.push(new THREE.Vector3());
    }

    for (let i = 0; i < n; i++) {
      const u = i / SAMPLES;
      const d = u * totalLen;
      this._sampleSpine(d, this._spine[i]);
    }

    for (let i = 0; i < n; i++) {
      const u = i / SAMPLES;
      const p = this._spine[i];
      const pp = this._spine[Math.max(0, i - 1)];
      const pn = this._spine[Math.min(n - 1, i + 1)];
      let tx = pn.x - pp.x, ty = pn.y - pp.y, tz = pn.z - pp.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      // cross(up, tangent) → horizontal frame normal.
      let nx = tz, nz = -tx;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      // binormal = cross(tangent, normal) → ~up.
      const bx = ty * nz - tz * 0;
      const by = tz * nx - tx * nz;
      const bz = tx * 0 - ty * nx;

      // Gentle slithering undulation.
      const r = this._radii[i];
      const wave = Math.sin(time * 5.4 - u * 7.2) * 0.055 * Math.min(1, u * 3);
      const lat = Math.sin(time * 4.1 - u * 6.0 + 1.2) * 0.03 * u;
      const cx = p.x + nx * lat;
      const cy = r * 0.9 + wave;
      const cz = p.z + nz * lat;

      for (let j = 0; j < RADIAL; j++) {
        const c = this._cos[j];
        const s = this._sin[j];
        const idx = (i * RADIAL + j) * 3;
        px[idx] = cx + (nx * c + bx * s) * r;
        px[idx + 1] = cy + (by * s) * r;
        px[idx + 2] = cz + (nz * c + bz * s) * r;
        nm[idx] = nx * c + bx * s;
        nm[idx + 1] = by * s;
        nm[idx + 2] = nz * c + bz * s;
      }
    }
    this.tubeGeo.attributes.position.needsUpdate = true;
    this.tubeGeo.attributes.normal.needsUpdate = true;
  }
}
