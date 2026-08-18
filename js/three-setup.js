import * as THREE from "../vendor/three.module.js";

export const CELL = 1;

export function cellToWorld(gx, gz, cols, rows) {
  return new THREE.Vector3(
    (gx - (cols - 1) / 2) * CELL,
    0,
    (gz - (rows - 1) / 2) * CELL
  );
}

export function gridKey(gx, gz) {
  return gx + "," + gz;
}

// Soft radial glow texture (billboard sprites, halos).
export function makeGlowTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.65)");
  g.addColorStop(0.55, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Soft round blob texture (particles, fake blob shadows).
export function makeSoftTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function makeGlowSprite(texture, color, scale = 1, opacity = 0.8) {
  const mat = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(scale);
  return sprite;
}

// Gradient sky dome (horizon colour -> zenith colour).
export function makeSkyDome(topColor, horizonColor, radius = 170) {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c1 = new THREE.Color(horizonColor);
  const c2 = new THREE.Color(topColor);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    const t = Math.max(0, Math.min(1, (y + 1) / 2));
    tmp.copy(c1).lerp(c2, Math.pow(t, 1.35));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -20;
  return mesh;
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

export class Stage {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

    this.mapRoot = new THREE.Group();
    this.entitiesRoot = new THREE.Group();
    this.scene.add(this.mapRoot);
    this.scene.add(this.entitiesRoot);

    this.mode = "orbit"; // 'play' | 'orbit'
    this.cameraPos = new THREE.Vector3(0, 6, 8);
    this.cameraLook = new THREE.Vector3(0, 0.3, 0);
    this.orbitTarget = new THREE.Vector3();
    this.orbitRadius = 7;
    this.orbitHeight = 3.5;
    this.orbitSpeed = 0.22;
    this.shakeAmp = 0;

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    window.addEventListener("orientationchange", this._resize);
    this._resize();
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearMap() {
    this.scene.remove(this.mapRoot);
    disposeObject(this.mapRoot);
    this.mapRoot = new THREE.Group();
    this.scene.add(this.mapRoot);
  }

  clearEntities() {
    this.scene.remove(this.entitiesRoot);
    disposeObject(this.entitiesRoot);
    this.entitiesRoot = new THREE.Group();
    this.scene.add(this.entitiesRoot);
  }

  // Frame the whole playfield with the current aspect ratio.
  frameBoard(cols, rows, margin = 0.86) {
    const halfW = (cols * CELL) / 2;
    const halfD = (rows * CELL) / 2;
    const corners = [
      new THREE.Vector3(-halfW, 0, -halfD),
      new THREE.Vector3(halfW, 0, -halfD),
      new THREE.Vector3(halfW, 0, halfD),
      new THREE.Vector3(-halfW, 0, halfD),
    ];
    const elev = 0.98; // ~56° above the horizon
    const target = new THREE.Vector3(0, 0, 0);
    let R = Math.max(halfW, halfD) * 1.25;
    const v = new THREE.Vector3();
    for (let iter = 0; iter < 50; iter++) {
      this.camera.position.set(0, R * Math.sin(elev), R * Math.cos(elev));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      let fits = true;
      for (const c of corners) {
        v.copy(c).project(this.camera);
        if (Math.abs(v.x) > margin || Math.abs(v.y) > margin) { fits = false; break; }
      }
      if (fits) break;
      R *= 1.07;
    }
    this.cameraPos.copy(this.camera.position);
    this.cameraLook.copy(target);
  }

  setPlayCamera(cols, rows) {
    this.mode = "play";
    this.frameBoard(cols, rows);
  }

  setOrbit(target, radius, height, speed = 0.22) {
    this.mode = "orbit";
    this.orbitTarget.copy(target);
    this.orbitRadius = radius;
    this.orbitHeight = height;
    this.orbitSpeed = speed;
  }

  shake(intensity = 0.5) {
    this.shakeAmp = Math.max(this.shakeAmp, intensity);
  }

  update(dt, time) {
    if (this.mode === "orbit") {
      const a = time * this.orbitSpeed;
      this.cameraPos.set(
        this.orbitTarget.x + Math.sin(a) * this.orbitRadius,
        this.orbitTarget.y + this.orbitHeight + Math.sin(time * 0.6) * 0.25,
        this.orbitTarget.z + Math.cos(a) * this.orbitRadius
      );
      this.cameraLook.set(this.orbitTarget.x, this.orbitTarget.y + 0.5, this.orbitTarget.z);
    }

    this.camera.position.copy(this.cameraPos);
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp * 0.5;
      this.shakeAmp *= Math.pow(0.0001, dt); // fast decay
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.cameraLook);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
