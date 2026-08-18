import * as THREE from "../vendor/three.module.js";

const MAX_PARTICLES = 140;

export class Effects {
  constructor(stage, softTex) {
    this.stage = stage;
    this.softTex = softTex;
    this.particles = [];
    this.shockwaves = [];
    this._pool = [];
  }

  _acquire() {
    for (const p of this.particles) if (!p.active) return p;
    if (this.particles.length >= MAX_PARTICLES) return null;
    const mat = new THREE.SpriteMaterial({
      map: this.softTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffffff, opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    this.stage.entitiesRoot.add(sprite);
    const p = {
      active: false, sprite, mat, vel: new THREE.Vector3(), life: 0, maxLife: 1,
      gravity: 0, size: 0.2, sizeEnd: 0.1, spin: 0,
    };
    this.particles.push(p);
    return p;
  }

  burst(pos, { count = 12, color = 0xffffff, color2 = null, speed = 3.2, spread = 1, gravity = -4, size = 0.24, life = 0.55, up = 1.5 } = {}) {
    const c1 = new THREE.Color(color);
    const c2 = color2 != null ? new THREE.Color(color2) : c1;
    for (let i = 0; i < count; i++) {
      const p = this._acquire();
      if (!p) break;
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.7) * speed;
      p.vel.set(Math.cos(a) * r * spread, (Math.random() - 0.2) * speed * 0.6 + up, Math.sin(a) * r * spread);
      p.gravity = gravity;
      p.life = 0;
      p.maxLife = life * (0.7 + Math.random() * 0.6);
      p.size = size * (0.7 + Math.random() * 0.7);
      p.sizeEnd = p.size * 0.15;
      p.active = true;
      p.sprite.position.copy(pos);
      p.sprite.visible = true;
      p.sprite.material.color.copy(c1).lerp(c2, Math.random());
      p.sprite.material.opacity = 1;
      p.sprite.scale.setScalar(p.size);
    }
  }

  shockwave(pos, { color = 0xffffff, radius = 0.55, life = 0.45, width = 0.09 } = {}) {
    let sw = this.shockwaves.find((s) => !s.active);
    if (!sw) {
      const geo = new THREE.RingGeometry(0.5, 1, 36);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      this.stage.entitiesRoot.add(mesh);
      sw = { active: false, mesh, mat, life: 0, maxLife: life, radius };
      this.shockwaves.push(sw);
    }
    sw.active = true;
    sw.life = 0;
    sw.maxLife = life;
    sw.radius = radius;
    sw.mat.color.set(color);
    sw.mesh.position.set(pos.x, 0.05, pos.z);
  }

  update(dt) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      p.sprite.material.opacity = 1 - t;
      p.sprite.scale.setScalar(p.size + (p.sizeEnd - p.size) * t);
      p.sprite.material.rotation += dt * 3;
    }
    for (const s of this.shockwaves) {
      if (!s.active) continue;
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1) { s.active = false; s.mat.opacity = 0; continue; }
      s.mat.opacity = (1 - t) * 0.9;
      const scale = s.radius * (0.25 + t * 1.6) * 2;
      s.mesh.scale.setScalar(scale);
    }
  }

  clear() {
    for (const p of this.particles) { p.active = false; p.sprite.visible = false; }
    for (const s of this.shockwaves) { s.active = false; s.mat.opacity = 0; }
  }

  // Screen-space floating text (score popups, combo).
  floatText(worldPos, text, className = "") {
    const v = worldPos.clone().project(this.stage.camera);
    const w = this.stage.renderer.domElement.clientWidth;
    const h = this.stage.renderer.domElement.clientHeight;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    const el = document.createElement("div");
    el.className = "float-text " + className;
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    const app = document.getElementById("app");
    app.appendChild(el);
    window.setTimeout(() => el.remove(), 950);
  }
}
