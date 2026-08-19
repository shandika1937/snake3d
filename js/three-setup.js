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

    // Gameplay follow-camera state (see setPlayCamera / _updatePlayCamera).
    // Fixed world orientation: the camera always sits on the +Z side looking
    // toward -Z, so screen-up = -Z, screen-down = +Z, left = -X, right = +X.
    this.follow = {
      active: false,
      target: null, // { head, dir, length, state } fed each frame
      focus: new THREE.Vector3(),
      dist: 10, // smoothed camera distance
      distTarget: 10,
      elev: 0.98, // ~56° above the horizon, same as frameBoard
      lookAhead: 1.8, // cells of space shown ahead of the head
      deadZone: 2.2, // cells the head may roam before the camera chases
      followSpeed: 8,
      zoom: 1,
      zoomPerSeg: 0.014,
      maxZoom: 1.45,
      zoomSpeed: 2,
      overZoom: 1.12,
      bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
      intro: 1,
      introStart: new THREE.Vector3(),
      introFromLook: new THREE.Vector3(),
    };

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
    if (this.mode === "play" && this.follow.active && this._playCols) {
      this.follow.distTarget = this._frameRadius(this._playCols, this._playRows);
    }
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

  // Distance from the playfield centre at which the whole board fits the
  // current aspect ratio (shared by the framing and the follow camera).
  _frameRadius(cols, rows, margin = 0.86) {
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
    return R;
  }

  // Frame the whole playfield with the current aspect ratio.
  frameBoard(cols, rows, margin = 0.86) {
    const R = this._frameRadius(cols, rows, margin);
    const elev = 0.98;
    this.cameraPos.set(0, R * Math.sin(elev), R * Math.cos(elev));
    this.cameraLook.set(0, 0, 0);
  }

  setPlayCamera(cols, rows) {
    this.mode = "play";
    this._playCols = cols;
    this._playRows = rows;
    const f = this.follow;
    f.active = true;
    f.target = null;
    f.focus.set(0, 0, 0);
    f.dist = this._frameRadius(cols, rows);
    f.distTarget = f.dist;
    f.zoom = 1;
    // Keep the follow focus inside the arena so a boundary never leaves view.
    const m = Math.max(2.5, Math.min(cols, rows) * 0.12);
    f.bounds = {
      minX: -(cols / 2) + m,
      maxX: (cols / 2) - m,
      minZ: -(rows / 2) + m,
      maxZ: (rows / 2) - m,
    };
    // Smooth intro from the previous camera (e.g. the orbiting preview).
    f.intro = 0;
    f.introStart.copy(this.cameraPos);
    f.introFromLook.copy(this.cameraLook);
    this.cameraPos.set(0, f.dist * Math.sin(f.elev), f.dist * Math.cos(f.elev));
    this.cameraLook.set(0, 0, 0);
  }

  // Feed the current snake state so the play camera can track it.
  setPlayFollow(target) {
    this.follow.target = target;
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
    } else if (this.mode === "play") {
      this._updatePlayCamera(dt);
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

  // Third-person elevated follow camera for gameplay: fixed world orientation,
  // smooth follow with a dead zone, slight look-ahead, dynamic zoom.
  _updatePlayCamera(dt) {
    const f = this.follow;
    if (!f.active) return;
    const t = f.target;

    // Freeze while paused / between screens (no drifting, no snapping).
    if (t && (t.state === "paused" || t.state === "idle")) return;

    // Where the camera should centre: the head plus a small look-ahead.
    const lookX = t ? t.head.x + t.dir.x * f.lookAhead : f.focus.x;
    const lookZ = t ? t.head.z + t.dir.z * f.lookAhead : f.focus.z;

    // Dead zone: only chase once the head leaves the safe area around the
    // current focus, so small movements don't drag the camera around.
    const dx = lookX - f.focus.x;
    const dz = lookZ - f.focus.z;
    const dist = Math.hypot(dx, dz);
    let tx = lookX;
    let tz = lookZ;
    if (dist > f.deadZone) {
      const over = dist - f.deadZone;
      tx = f.focus.x + (dx / dist) * over;
      tz = f.focus.z + (dz / dist) * over;
    }
    // Keep the boundary visible: the focus never leaves the arena.
    tx = Math.max(f.bounds.minX, Math.min(f.bounds.maxX, tx));
    tz = Math.max(f.bounds.minZ, Math.min(f.bounds.maxZ, tz));

    // Smooth follow (exponential damping: no snapping, no oscillation).
    const k = 1 - Math.exp(-dt * f.followSpeed);
    f.focus.x += (tx - f.focus.x) * k;
    f.focus.z += (tz - f.focus.z) * k;

    // Smooth distance (recomputed on resize for portrait/landscape).
    f.dist += (f.distTarget - f.dist) * (1 - Math.exp(-dt * 3));

    // Dynamic zoom: a longer snake needs more of the arena on screen;
    // game over pulls out gently so the snake stays visible.
    let zoomT = Math.min(1 + (t ? (t.length - 5) * f.zoomPerSeg : 0), f.maxZoom);
    if (t && t.state === "over") zoomT *= f.overZoom;
    f.zoom += (zoomT - f.zoom) * (1 - Math.exp(-dt * f.zoomSpeed));

    const d = f.dist * f.zoom;
    const h = d * Math.sin(f.elev);
    const horiz = d * Math.cos(f.elev);
    const pos = new THREE.Vector3(f.focus.x, f.focus.y + h, f.focus.z + horiz);
    const look = new THREE.Vector3(f.focus.x, f.focus.y, f.focus.z);

    // Short intro transition from the previous camera position.
    if (f.intro < 1) {
      f.intro = Math.min(1, f.intro + dt / 0.7);
      const e = 1 - Math.pow(1 - f.intro, 3);
      this.cameraPos.lerpVectors(f.introStart, pos, e);
      this.cameraLook.lerpVectors(f.introFromLook, look, e);
    } else {
      this.cameraPos.copy(pos);
      this.cameraLook.copy(look);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
