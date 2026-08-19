import * as THREE from "../vendor/three.module.js";

export const CELL = 1;

// Camera POV modes. Each mode is a set of parameters the follow camera glides
// toward. Distances are absolute (cells) so the snake reads consistently on
// every board size; `zoomPerSeg`/`maxZoom` grow the view gently with the
// snake's length, and `minD`/`maxD` enforce a minimum/maximum snake size.
const CAMERA_MODES = {
  // Philosophy: the camera sits HIGH ABOVE the snake head (elev ~60-73° from
  // the horizon) looking down — never beside or behind it — with enough
  // distance (5-6.6 cells) that the snake is clearly visible (~15-18% of the
  // screen height) while the surrounding arena stays readable. `elev` is the
  // angle above the horizon (0 = flat, ~1.57 = top-down). `lookAhead` stays
  // small so the head stays near screen centre without drifting sideways.
  follow:   { elev: 1.15, fov: 55, lookAhead: 0.6, deadZone: 0.6, speed: 12, dist: 5.8, zoomPerSeg: 0.010, maxZoom: 1.15, minD: 4.8, maxD: 7.5 },
  above:    { elev: 1.28, fov: 55, lookAhead: 0.4, deadZone: 0.5, speed: 14, dist: 5.2, zoomPerSeg: 0.008, maxZoom: 1.12, minD: 4.4, maxD: 6.8 },
  elevated: { elev: 1.05, fov: 56, lookAhead: 0.8, deadZone: 0.7, speed: 10, dist: 6.6, zoomPerSeg: 0.012, maxZoom: 1.20, minD: 5.4, maxD: 8.5 },
};

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
  constructor(container, { quality = "high" } = {}) {
    this.container = container;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.shadowMap.enabled = quality !== "low";
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

    // Dynamic quality fallback (see setQuality).
    this._qualityLevel = quality;
    this.orbitTarget = new THREE.Vector3();
    this.orbitRadius = 7;
    this.orbitHeight = 3.5;
    this.orbitSpeed = 0.22;
    this.shakeAmp = 0;

    // Gameplay follow-camera state (see setPlayCamera / _updatePlayCamera).
    // Fixed world orientation: the camera always sits on the +Z side looking
    // toward -Z, so screen-up = -Z, screen-down = +Z, left = -X, right = +X.
    // The snake HEAD is the camera anchor — never the arena centre — so the
    // snake can never leave the frame during normal play.
    const cfg0 = CAMERA_MODES.follow;
    this.follow = {
      active: false,
      target: null, // { head, dir, length, state } fed each frame
      focus: new THREE.Vector3(), // smoothed camera anchor (tracks the head)
      cameraMode: "follow",
      // Live parameters; each frame they glide toward CAMERA_MODES[cameraMode].
      elev: cfg0.elev,
      fov: cfg0.fov,
      lookAhead: cfg0.lookAhead,
      deadZone: cfg0.deadZone,
      speed: cfg0.speed,
      dist: cfg0.dist,
      zoom: 1,
      overT: 0, // eases toward 1 on game over (gentle pull-out)
      overZoom: 1.12,
      intro: 1,
      introStart: new THREE.Vector3(),
      introFromLook: new THREE.Vector3(),
    };

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    window.addEventListener("orientationchange", this._resize);
    this._resize();
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this._qualityLevel === "low") return 1;
    if (this._qualityLevel === "medium") return Math.min(dpr, 1.5);
    return Math.min(dpr, 2);
  }

  // Live quality adjustment for dynamic fallback (antialias can't change
  // after construction, but resolution + shadows are the big wins anyway).
  setQuality(quality) {
    this._qualityLevel = quality;
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.shadowMap.enabled = quality !== "low";
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
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
    const cfg = CAMERA_MODES[f.cameraMode] || CAMERA_MODES.follow;
    f.elev = cfg.elev;
    f.fov = cfg.fov;
    f.lookAhead = cfg.lookAhead;
    f.deadZone = cfg.deadZone;
    f.speed = cfg.speed;
    f.dist = cfg.dist;
    f.zoom = 1;
    f.overT = 0;
    this.camera.fov = cfg.fov;
    this.camera.updateProjectionMatrix();
    // Smooth intro from the previous camera (e.g. the orbiting preview).
    f.intro = 0;
    f.introStart.copy(this.cameraPos);
    f.introFromLook.copy(this.cameraLook);
    this.cameraPos.set(0, cfg.dist * Math.sin(cfg.elev), cfg.dist * Math.cos(cfg.elev));
    this.cameraLook.set(0, 0, 0);
  }

  // Feed the current snake state so the play camera can track it.
  setPlayFollow(target) {
    this.follow.target = target;
  }

  // Switch POV. The camera glides between modes (never snaps), and the
  // world orientation is untouched so WASD mapping stays identical.
  setCameraMode(mode) {
    this.follow.cameraMode = CAMERA_MODES[mode] ? mode : "follow";
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

  // Gameplay camera. The snake HEAD is the anchor: the camera follows it
  // every frame with a small dead zone, a bounded dynamic zoom, and an
  // aspect-aware look-ahead clamp so the head can never leave the safe centre
  // of the frame. World orientation is fixed (camera on the +Z side), so the
  // screen mapping (W/↑ = -Z, S/↓ = +Z, A/← = -X, D/→ = +X) never changes.
  _updatePlayCamera(dt) {
    const f = this.follow;
    if (!f.active) return;
    const t = f.target;

    // Freeze while paused / between screens (no drifting, no snapping).
    if (t && (t.state === "paused" || t.state === "idle")) return;

    // Glide every parameter toward the active mode (smooth mode switching).
    const cfg = CAMERA_MODES[f.cameraMode] || CAMERA_MODES.follow;
    const km = 1 - Math.exp(-dt * 3.5);
    f.elev += (cfg.elev - f.elev) * km;
    f.fov += (cfg.fov - f.fov) * km;
    f.lookAhead += (cfg.lookAhead - f.lookAhead) * km;
    f.deadZone += (cfg.deadZone - f.deadZone) * km;
    f.speed += (cfg.speed - f.speed) * km;
    f.dist += (cfg.dist - f.dist) * km;

    // Dynamic zoom by snake length — smooth, and hard-capped so a long snake
    // never shrinks to a dot. minD/maxD bound the actual distance.
    const zoomTarget = Math.min(1 + (t ? (t.length - 5) * cfg.zoomPerSeg : 0), cfg.maxZoom);
    f.zoom += (zoomTarget - f.zoom) * (1 - Math.exp(-dt * 2));
    const d = Math.max(cfg.minD, Math.min(cfg.maxD, f.dist * f.zoom));

    // Look-ahead, clamped to the current view so the head stays in frame.
    // The head sits `la` cells behind the look anchor; capping la to 55% of the
    // half-height guarantees the head never drops below the lower third.
    let la = f.lookAhead;
    if (t) {
      const tanHalf = Math.tan((f.fov * Math.PI) / 180 / 2);
      const halfH = d * tanHalf;
      la = Math.min(la, halfH * 0.55);
    }

    // Anchor on the head (plus look-ahead), never the arena centre.
    const lookX = t ? t.head.x + t.dir.x * la : f.focus.x;
    const lookZ = t ? t.head.z + t.dir.z * la : f.focus.z;

    // Small dead zone: tiny jitters don't shake the view, but the head stays
    // near centre (never drifts to the edge).
    const dx = lookX - f.focus.x;
    const dz2 = lookZ - f.focus.z;
    const dist2 = Math.hypot(dx, dz2);
    let tx = lookX;
    let tz = lookZ;
    if (dist2 > f.deadZone) {
      const over = dist2 - f.deadZone;
      tx = f.focus.x + (dx / dist2) * over;
      tz = f.focus.z + (dz2 / dist2) * over;
    }

    // Smooth follow (exponential damping: responsive, no snapping/oscillation).
    const k = 1 - Math.exp(-dt * f.speed);
    f.focus.x += (tx - f.focus.x) * k;
    f.focus.z += (tz - f.focus.z) * k;

    // Gentle pull-out on game over so the crash stays visible.
    const overT = t && t.state === "over" ? 1 : 0;
    f.overT += (overT - f.overT) * (1 - Math.exp(-dt * 2));
    const dd = d * (1 + (f.overZoom - 1) * f.overT);

    const h = dd * Math.sin(f.elev);
    const horiz = dd * Math.cos(f.elev);
    const pos = new THREE.Vector3(f.focus.x, f.focus.y + h, f.focus.z + horiz);
    const look = new THREE.Vector3(f.focus.x, f.focus.y, f.focus.z);

    if (Math.abs(this.camera.fov - f.fov) > 0.01) {
      this.camera.fov = f.fov;
      this.camera.updateProjectionMatrix();
    }

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
