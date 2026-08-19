// 2D fallback mode.
//
// Used automatically when the device can't run the 3D experience smoothly
// (or when the player picks Graphics Mode: 2D). Same rules as the 3D game —
// grid movement, apples, combo, power-ups, levels, high scores — rendered
// with Canvas 2D so even the weakest device stays playable. The 2D build is
// deliberately light: no 3D geometry is ever constructed.

import { DIR_VECTORS } from "./input.js";
import { getMap, obstacleLayout } from "./maps.js";

const COMBO_WINDOW = 5.5;
const PU_SPAWN_MIN = 6;
const PU_LIFETIME = 9;
const PU_TYPES = ["shield", "speed", "slow", "magnet", "gold"];

const THEMES = {
  garden: { bg: ["#cfe8b8", "#4f9a45"], grid: "rgba(255,255,255,.14)", border: "#f5f2e8", borderGlow: "#d7eec9", obs: "#8a6a3f", obsGlow: "#a97b45", apple: "#e6493b", accent: "#4ade80" },
  desert: { bg: ["#f2c98c", "#c98f4e"], grid: "rgba(120,70,20,.18)", border: "#b0713f", borderGlow: "#d9a45f", obs: "#a0643a", obsGlow: "#c9803f", apple: "#e6493b", accent: "#f59e0b" },
  night: { bg: ["#0d1430", "#1c2a4e"], grid: "rgba(139,92,246,.2)", border: "#34d399", borderGlow: "rgba(52,211,153,.8)", obs: "#3c4a52", obsGlow: "#5b6b78", apple: "#ff6b5e", accent: "#8b5cf6" },
  cyber: { bg: ["#05040f", "#141a3a"], grid: "rgba(34,211,238,.22)", border: "#22d3ee", borderGlow: "rgba(34,211,238,.9)", obs: "#22d3ee", obsGlow: "rgba(34,211,238,.5)", apple: "#ff6b5e", accent: "#22d3ee" },
  ice: { bg: ["#d7e9fb", "#8fc0ec"], grid: "rgba(255,255,255,.3)", border: "#ffffff", borderGlow: "rgba(255,255,255,.9)", obs: "#9fd8f5", obsGlow: "#ffffff", apple: "#e6493b", accent: "#60a5fa" },
  volcano: { bg: ["#24100b", "#57150d"], grid: "rgba(255,138,42,.16)", border: "#ff8a2a", borderGlow: "rgba(255,138,42,.8)", obs: "#ff8a2a", obsGlow: "rgba(255,74,16,.6)", apple: "#ff6b5e", accent: "#f97316" },
};

const PU_STYLE = {
  shield: { color: "#38bdf8", glow: "#7dd3fc" },
  speed: { color: "#facc15", glow: "#fde047" },
  slow: { color: "#818cf8", glow: "#a5b4fc" },
  magnet: { color: "#fb7185", glow: "#fda4af" },
  gold: { color: "#f5b942", glow: "#ffd166" },
};

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

class Snake2D {
  constructor() {
    this.cols = 1; this.rows = 1;
    this.segments = [];
    this.dir = { x: 0, z: -1 };
    this.dirQueue = [];
    this.growPending = 0;
    this.fromCell = { x: 0, z: 0 };
    this.toCell = { x: 0, z: 0 };
    this.moveT = 0;
    this.tickDuration = 0.16;
    this.eyeBlink = 0;
  }

  reset(cols, rows) {
    this.cols = cols; this.rows = rows;
    const midX = Math.floor(cols / 2);
    const midZ = Math.floor(rows / 2);
    this.dir = { x: 0, z: -1 };
    this.dirQueue = [];
    this.growPending = 0;
    this.segments = [];
    for (let i = 0; i < 5; i++) this.segments.push({ x: midX, z: midZ + i });
    this.fromCell = { x: midX, z: midZ };
    this.toCell = { x: midX, z: midZ };
    this.moveT = 0;
  }

  get headCell() { return this.segments[0]; }

  setSpeed(cellsPerSec) {
    this.tickDuration = 1 / Math.max(0.001, cellsPerSec);
  }

  queueDir(name) {
    const v = DIR_VECTORS[name];
    if (!v) return;
    const last = this.dirQueue[this.dirQueue.length - 1];
    if (last && last.x === v.x && last.z === v.z) return;
    if (v.x === -this.dir.x && v.z === -this.dir.z) return;
    if (this.dirQueue.length >= 3) this.dirQueue.shift();
    this.dirQueue.push({ x: v.x, z: v.z });
  }

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

  advance(dt) {
    this.moveT += dt / this.tickDuration;
    let steps = 0;
    while (this.moveT >= 1) { this.moveT -= 1; steps++; }
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

  grow(n = 1) { this.growPending += n; }

  _cellCenter(c) {
    return { x: (c.x - (this.cols - 1) / 2), z: (c.z - (this.rows - 1) / 2) };
  }

  headSmooth() {
    const a = this._cellCenter(this.fromCell);
    const b = this._cellCenter(this.toCell);
    if (a.x === b.x && a.z === b.z) return a;
    return { x: lerp(a.x, b.x, this.moveT), z: lerp(a.z, b.z, this.moveT) };
  }

  // Sample the spine at distance d (in cells) from the head, tail-ward.
  sampleSpine(d) {
    const hs = this.headSmooth();
    const firstLen = this.moveT;
    if (d <= firstLen || this.segments.length < 2) {
      const p1 = this._cellCenter(this.segments[1]);
      const t = firstLen > 0.0001 ? d / firstLen : 0;
      return { x: lerp(hs.x, p1.x, t), z: lerp(hs.z, p1.z, t) };
    }
    let rem = d - firstLen;
    let i = 1;
    while (rem > 1 && i + 1 < this.segments.length) { rem -= 1; i++; }
    const a = this._cellCenter(this.segments[i]);
    const b = i + 1 < this.segments.length ? this._cellCenter(this.segments[i + 1]) : a;
    const t = clamp(rem, 0, 1);
    return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
  }
}

export class Game2D {
  constructor({ canvas, ui, audio, store }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;
    this.audio = audio;
    this.store = store;

    this.mapId = null;
    this.mapDef = null;
    this.state = "idle"; // idle | ready | playing | paused | over
    this.time = 0;
    this.score = 0;
    this.apples = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.level = 1;
    this.comboTimer = 0;
    this.puTimer = 5;
    this.fx = { shield: 0, speed: 0, slow: 0, magnet: 0 };
    this.deathTimer = 0;
    this._deathShown = false;
    this.spawnT = 1;

    this.snake = new Snake2D();
    this.pickups = []; // { type, cell, phase }
    this.obstacles = [];
    this.particles = [];
    this.rings = [];
    this.floats = [];

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    this._resize();
  }

  _resize() {
    const w = this.canvas.parentElement?.clientWidth || window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this._dpr = dpr;
  }

  load(mapId) {
    this.mapId = mapId;
    this.mapDef = getMap(mapId);
    const def = this.mapDef;
    this.theme = THEMES[mapId] || THEMES.garden;
    this.obstacles = obstacleLayout(mapId).map((c) => ({ x: c.x, z: c.z }));
    this._obsSet = new Set(this.obstacles.map((o) => o.x + "," + o.z));

    this.snake.reset(def.cols, def.rows);
    this.spawnT = 0;
    this.pickups = [];
    this.particles = [];
    this.rings = [];
    this.floats = [];
    this._spawnApple();

    this.time = 0;
    this.score = 0;
    this.apples = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.level = 1;
    this.comboTimer = 0;
    this.puTimer = PU_SPAWN_MIN * 0.6;
    this.fx = { shield: 0, speed: 0, slow: 0, magnet: 0 };
    this._deathShown = false;
    this._recomputeSpeed();
    this.state = "ready";
    this._pushHud();
  }

  start() {
    if (this.state !== "ready" && this.state !== "paused") return;
    this.state = "playing";
    this.audio.startMusic(this.mapDef.flavour);
    this.ui.showHud();
    this.ui.showBanner("GO!", "", 900);
    this.audio.countdown();
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.audio.pause();
    this.audio.stopMusic();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.audio.resume();
    this.audio.startMusic(this.mapDef.flavour);
  }

  restart() { this.load(this.mapId); this.start(); }

  quit() {
    this.state = "idle";
    this.audio.stopMusic();
  }

  /* ---------------- rules (mirrors the 3D game) ---------------- */
  _blocked(cell) {
    if (cell.x < 0 || cell.z < 0 || cell.x >= this.mapDef.cols || cell.z >= this.mapDef.rows) return true;
    if (this._obsSet.has(cell.x + "," + cell.z)) return true;
    if (this.snake.occupies(cell)) return true;
    return false;
  }

  _lethal(cell) {
    if (cell.x < 0 || cell.z < 0 || cell.x >= this.mapDef.cols || cell.z >= this.mapDef.rows) return "wall";
    if (this._obsSet.has(cell.x + "," + cell.z)) return "obstacle";
    if (this.snake.collidesWith(cell)) return "self";
    return null;
  }

  _recomputeSpeed() {
    const ramp = (this.level - 1) * this.mapDef.speedPerLevel;
    let speed = this.mapDef.speed + ramp;
    if (this.fx.speed > 0) speed *= 1.45;
    if (this.fx.slow > 0) speed *= 0.62;
    this.snake.setSpeed(Math.min(speed, 14));
  }

  _freeCell() {
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = Math.floor(Math.random() * this.mapDef.cols);
      const z = Math.floor(Math.random() * this.mapDef.rows);
      if (this._blocked({ x, z })) continue;
      if (this.pickups.some((p) => p.cell.x === x && p.cell.z === z)) continue;
      return { x, z };
    }
    for (let z = 0; z < this.mapDef.rows; z++) {
      for (let x = 0; x < this.mapDef.cols; x++) {
        if (!this._blocked({ x, z }) && !this.pickups.some((p) => p.cell.x === x && p.cell.z === z)) {
          return { x, z };
        }
      }
    }
    return null;
  }

  _spawnApple() {
    const cell = this._freeCell();
    if (cell) this.pickups.push({ type: "apple", cell, pos: this._cellCenter(cell), phase: Math.random() * Math.PI * 2 });
  }

  update(dt, time) {
    const playing = this.state === "playing";

    if (playing) {
      this.time += dt;
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0 && this.combo > 0) {
          this.combo = 0;
          this.ui.setCombo(0);
        }
      }
      for (const k of ["speed", "slow", "magnet"]) {
        if (this.fx[k] > 0) {
          this.fx[k] -= dt;
          if (this.fx[k] <= 0) { this.fx[k] = 0; this._recomputeSpeed(); }
        }
      }
      this._tick(dt, time);
    }

    // Spawn-in scale (soft overshoot).
    if (this.spawnT < 1) {
      this.spawnT = Math.min(1, this.spawnT + dt / 0.45);
      const t = this.spawnT;
      const e = 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
      this._spawnScale = Math.max(0.0001, e);
    }

    // Magnet: pull apples toward the head (pickup.pos is world-space).
    if (playing && this.fx.magnet > 0) {
      const h = this.snake.headSmooth();
      for (const p of this.pickups) {
        if (p.type !== "apple") continue;
        const dx = h.x - p.pos.x, dz = h.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 4.5 && dist > 0.001) {
          const pull = dt * (7 - dist) * 1.2;
          p.pos.x += (dx / dist) * Math.min(pull, dist);
          p.pos.z += (dz / dist) * Math.min(pull, dist);
        }
      }
    }

    // Eat (distance-based, feels like a bite as the head reaches it).
    if (playing) {
      const h = this.snake.headSmooth();
      for (const p of [...this.pickups]) {
        const dx = h.x - p.pos.x, dz = h.z - p.pos.z;
        if (dx * dx + dz * dz < 0.42 * 0.42) {
          this._eat(p);
          break;
        }
      }
    }

    // Power-up spawn cadence.
    if (playing) {
      this.puTimer -= dt;
      if (this.puTimer <= 0) {
        if (!this.pickups.some((p) => p.type !== "apple")) {
          const type = PU_TYPES[Math.floor(Math.random() * PU_TYPES.length)];
          const cell = this._freeCell();
          if (cell) {
            const pk = { type, cell, pos: this._cellCenter(cell), phase: Math.random() * Math.PI * 2, expiresAt: this.time + PU_LIFETIME };
            this.pickups.push(pk);
          }
        }
        this.puTimer = PU_SPAWN_MIN + Math.random() * 3;
      }
      this.pickups = this.pickups.filter((p) => p.type === "apple" || !p.expiresAt || this.time < p.expiresAt);
    }

    // Particles / rings / floats.
    this.particles = this.particles.filter((p) => (p.t += dt) < p.life);
    for (const p of this.particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.rings = this.rings.filter((r) => (r.t += dt) < r.life);
    this.floats = this.floats.filter((f) => (f.t += dt) < f.life);

    if (this.state === "over" && !this._deathShown) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this._deathShown = true;
        this._showGameOver();
      }
    }
  }

  _tick(dt, time) {
    const steps = this.snake.advance(dt);
    for (let i = 0; i < steps; i++) {
      const next = this.snake.peekHeadCell();
      const hit = this._lethal(next);
      if (hit) {
        if (this.fx.shield > 0) {
          this.fx.shield = 0;
          this.combo = 0;
          this.ui.setCombo(0);
          this.audio.shieldBreak();
          this._burst(this._cellCenter(this.snake.headCell), 16, "#7dd3fc", "#ffffff");
          this._ring(this._cellCenter(this.snake.headCell), "#38bdf8", 0.5);
          this._pushHud();
          break;
        }
        this._die(hit);
        return;
      }
      this.snake.step();
    }
  }

  _eat(pickup) {
    const pos = { x: pickup.pos.x, z: pickup.pos.z };
    if (pickup.type === "apple") {
      this.combo += 1;
      this.highestCombo = Math.max(this.highestCombo, this.combo);
      this.comboTimer = COMBO_WINDOW;
      const pts = 10 * this.combo;
      this.score += pts;
      this.apples += 1;
      this.snake.grow(1);
      this.audio.pickup(this.combo);
      this._burst(pos, 14, "#ff6b5e", "#ffd166");
      this._ring(pos, "#ff7b6b", 0.4);
      this._float(pos, "+" + pts);
      if (this.combo >= 2) {
        this.audio.combo(this.combo);
        this.ui.showBanner("COMBO x" + this.combo, "banner-combo", 800);
      }
      this._afterApple();
    } else if (pickup.type === "gold") {
      this.combo += 1;
      this.highestCombo = Math.max(this.highestCombo, this.combo);
      this.comboTimer = COMBO_WINDOW;
      const pts = 50 * this.level;
      this.score += pts;
      this.apples += 1;
      this.snake.grow(2);
      this.audio.powerup();
      this._burst(pos, 22, "#ffd166", "#ffffff");
      this._ring(pos, "#ffd166", 0.5);
      this._float(pos, "+" + pts);
      this._afterApple();
    } else {
      this._applyPowerUp(pickup.type, pos);
    }
    this.pickups = this.pickups.filter((p) => p !== pickup);
    if (pickup.type === "apple" || pickup.type === "gold") this._spawnApple();
  }

  _afterApple() {
    const newLevel = Math.floor(this.apples / 5) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this._recomputeSpeed();
      this.ui.showBanner("LEVEL " + this.level, "", 1100);
      this.audio.countdown();
      this._maybeAddObstacle();
    }
    this._pushHud();
  }

  _maybeAddObstacle() {
    if (this.level < 3 || this.level % 2 === 0) return;
    const { cols, rows } = this.mapDef;
    for (let attempt = 0; attempt < 200; attempt++) {
      const c = { x: Math.floor(Math.random() * cols), z: Math.floor(Math.random() * rows) };
      if (this._blocked(c)) continue;
      this.obstacles.push({ x: c.x, z: c.z });
      this._obsSet.add(c.x + "," + c.z);
      this._ring(this._cellCenter(c), "#ffffff", 0.5);
      break;
    }
  }

  _applyPowerUp(type, pos) {
    const cfg = PU_STYLE[type];
    switch (type) {
      case "shield": this.fx.shield = 1; break;
      case "speed": this.fx.speed = 6; break;
      case "slow": this.fx.slow = 6; break;
      case "magnet": this.fx.magnet = 6; break;
    }
    this._recomputeSpeed();
    this.audio.powerup();
    this._burst(pos, 18, cfg.glow, "#ffffff");
    this._ring(pos, cfg.color, 0.5);
    this.ui.showBanner(type.toUpperCase(), "banner-" + (type === "shield" ? "shield" : type), 1000);
    this._pushHud();
  }

  _die(hit) {
    this.state = "over";
    this.deathTimer = 0.9;
    this._deathShown = false;
    this.audio.stopMusic();
    this.audio.collision();
    this.audio.gameOver();
    const hp = this._cellCenter(this.snake.headCell);
    this._burst(hp, 26, "#ff5b5b", "#ffd166");
    this._ring(hp, "#ff5b5b", 0.6);
    this._pushHud();

    const stats = {
      score: this.score,
      apples: this.apples,
      length: this.snake.segments.length,
      combo: this.highestCombo,
      time: this.time,
      level: this.level,
      mapId: this.mapId,
      mapName: this.mapDef.name,
    };
    const isNew = this.store.submitScore(this.mapId, this.score);
    this.store.recordRun({ apples: this.apples, combo: this.highestCombo, time: this.time });
    this._finalStats = { ...stats, isNew };
    if (isNew) window.setTimeout(() => this.audio.highScore(), 900);
  }

  _showGameOver() {
    if (this._finalStats.isNew) {
      const hp = this._cellCenter(this.snake.headCell);
      this._burst(hp, 30, "#ffd166", "#ffffff");
      this._ring(hp, "#ffd166", 0.8);
    }
    this.ui.showGameOver(this._finalStats);
  }

  _pushHud() {
    this.ui.setScore(this.score);
    this.ui.setApples(this.apples);
    this.ui.setLevel(this.level);
    this.ui.setCombo(this.combo >= 2 ? this.combo : 0);
    this.ui.setPowerups(this._activePowerups());
  }

  _activePowerups() {
    const list = [];
    for (const type of ["shield", "speed", "slow", "magnet"]) {
      if (this.fx[type] > 0) {
        const icon = type === "shield" ? "i-shield" : type === "speed" ? "i-bolt" : type === "slow" ? "i-clock" : "i-magnet";
        list.push({ type, icon, remaining: type === "shield" ? -1 : this.fx[type], total: 6 });
      }
    }
    return list;
  }

  /* ---------------- VFX helpers ---------------- */
  _cellCenter(c) {
    return { x: (c.x - (this.mapDef.cols - 1) / 2), z: (c.z - (this.mapDef.rows - 1) / 2) };
  }

  _burst(pos, count, color, color2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.6;
      this.particles.push({
        x: pos.x, y: pos.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
        t: 0, life: 0.4 + Math.random() * 0.3, r: 0.1 + Math.random() * 0.12,
        color: Math.random() < 0.5 ? color : (color2 || color),
        gravity: -3.5,
      });
    }
  }

  _ring(pos, color, life) {
    this.rings.push({ x: pos.x, y: pos.z, t: 0, life, color });
  }

  _float(pos, text) {
    this.floats.push({ x: pos.x, y: pos.z, text, t: 0, life: 0.9 });
  }

  /* ---------------- rendering ---------------- */
  render(time) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this._dpr || 1;
    const def = this.mapDef;
    const theme = this.theme;

    // Background.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.bg[0]);
    bg.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (!def) return;

    // Board transform (letterboxed).
    const pad = 28 * dpr;
    const cell = Math.max(8, Math.min((W - pad * 2) / def.cols, (H - pad * 2) / def.rows));
    const ox = (W - def.cols * cell) / 2;
    const oy = (H - def.rows * cell) / 2;
    const px = (gx) => ox + (gx + 0.5) * cell;
    const py = (gz) => oy + (gz + 0.5) * cell;

    // Grid.
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (let x = 0; x <= def.cols; x++) {
      ctx.moveTo(ox + x * cell, oy);
      ctx.lineTo(ox + x * cell, oy + def.rows * cell);
    }
    for (let z = 0; z <= def.rows; z++) {
      ctx.moveTo(ox, oy + z * cell);
      ctx.lineTo(ox + def.cols * cell, oy + z * cell);
    }
    ctx.stroke();

    // Border (rounded glow).
    ctx.save();
    ctx.shadowColor = theme.borderGlow;
    ctx.shadowBlur = 14 * dpr;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = Math.max(2, 3 * dpr);
    ctx.strokeRect(ox, oy, def.cols * cell, def.rows * cell);
    ctx.restore();

    // Obstacles.
    for (const o of this.obstacles) {
      const x = px(o.x), y = py(o.z);
      const r = cell * 0.34;
      ctx.save();
      ctx.shadowColor = theme.obsGlow;
      ctx.shadowBlur = 8 * dpr;
      ctx.fillStyle = theme.obs;
      roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.32);
      ctx.fill();
      ctx.restore();
    }

    // Pickups.
    for (const p of this.pickups) {
      const x = this.pxLocal(p.pos.x), y = this.pyLocal(p.pos.z);
      const bob = Math.sin(time * 2.4 + p.phase) * cell * 0.05;
      const pulse = 1 + Math.sin(time * 4 + p.phase) * 0.1;
      if (p.type === "apple") this._drawApple(ctx, x, y + bob, cell * 0.4 * pulse, dpr);
      else this._drawPowerUp(ctx, p.type, x, y + bob, cell * 0.4 * pulse, dpr, time + p.phase);
    }

    // Snake.
    this._drawSnake(ctx, cell, dpr, time);

    // Rings.
    for (const r of this.rings) {
      const t = r.t / r.life;
      const radius = cell * (0.3 + t * 1.6);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.lineWidth = Math.max(1.5, 3 * dpr * (1 - t));
      ctx.beginPath();
      ctx.arc(ox + (r.x + 0.5) * cell, oy + (r.y + 0.5) * cell, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Particles.
    for (const p of this.particles) {
      const t = p.t / p.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(ox + (p.x + 0.5) * cell, oy + (p.y + 0.5) * cell, p.r * cell * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating score text.
    for (const f of this.floats) {
      const t = f.t / f.life;
      ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.15) / 0.85);
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 ${16 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 6 * dpr;
      ctx.fillText(f.text, ox + (f.x + 0.5) * cell, oy + (f.y + 0.3) * cell - t * 40 * dpr);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  _drawApple(ctx, x, y, r, dpr) {
    ctx.save();
    ctx.shadowColor = "rgba(255,123,107,.7)";
    ctx.shadowBlur = 10 * dpr;
    ctx.fillStyle = "#e6493b";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // highlight
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // stem + leaf
    ctx.strokeStyle = "#6b4226";
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(x + r * 0.1, y - r * 0.75);
    ctx.lineTo(x + r * 0.2, y - r * 1.15);
    ctx.stroke();
    ctx.fillStyle = "#3fae4a";
    ctx.beginPath();
    ctx.ellipse(x + r * 0.55, y - r * 0.95, r * 0.4, r * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawPowerUp(ctx, type, x, y, r, dpr, time) {
    const cfg = PU_STYLE[type] || PU_STYLE.shield;
    const rot = Math.sin(time) * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.shadowColor = cfg.glow;
    ctx.shadowBlur = 12 * dpr;
    ctx.strokeStyle = cfg.color;
    ctx.fillStyle = cfg.color;
    ctx.lineWidth = Math.max(2, r * 0.18);
    if (type === "shield") {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px2 = Math.cos(a) * r, py2 = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (type === "speed") {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.8, r * 0.3);
      ctx.lineTo(r * 0.15, r * 0.3);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.15, r * 0.3);
      ctx.lineTo(-r * 0.8, r * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (type === "slow") {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.6);
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.55, 0);
      ctx.stroke();
    } else if (type === "magnet") {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, Math.PI, 0);
      ctx.lineTo(r * 0.7, r * 0.9);
      ctx.lineTo(r * 0.25, r * 0.9);
      ctx.lineTo(r * 0.25, r * 0.25);
      ctx.lineTo(-r * 0.25, r * 0.25);
      ctx.lineTo(-r * 0.25, r * 0.9);
      ctx.lineTo(-r * 0.7, r * 0.9);
      ctx.closePath();
      ctx.stroke();
    } else { // gold — star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.5;
        const px2 = Math.cos(a) * rad, py2 = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSnake(ctx, cell, dpr, time) {
    const snake = this.snake;
    const totalLen = (snake.segments.length - 1);
    const n = 26;
    const hs = snake.headSmooth();
    const head = { x: this.pxLocal(hs.x), y: this.pyLocal(hs.z) };
    const dir = snake.dir;

    // Spine from tail to head.
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const d = u * totalLen;
      const p = snake.sampleSpine(d);
      // gentle slither wave
      const wave = Math.sin(time * 5.4 - u * 7.2) * 0.08 * Math.min(1, u * 3);
      pts.push({ x: this.pxLocal(p.x) + wave * cell, y: this.pyLocal(p.z) });
    }

    // Spawn-in: scale the whole snake around the head with a soft overshoot.
    ctx.save();
    if (this.spawnT < 1) {
      const s = this._spawnScale;
      ctx.translate(head.x, head.y);
      ctx.scale(s, s);
      ctx.translate(-head.x, -head.y);
    }

    // Body circles tail → head (overlap makes a smooth tube).
    for (let i = n - 1; i >= 0; i--) {
      const u = i / (n - 1);
      const r = Math.max(1.2, cell * (0.42 - 0.3 * Math.min(u / 0.82, 1)) * (i < n - 1 ? 1 : 0.94));
      ctx.fillStyle = i === n - 1 ? "#7ce5a3" : "#2ec56e";
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyes (perpendicular to direction).
    const headR = cell * 0.44;
    const ex = -dir.z, ez = dir.x; // perpendicular in screen space
    const blink = Math.max(0, Math.sin(time * 0.8) - 0.92) * 5;
    for (const side of [-1, 1]) {
      const ex2 = head.x + ex * side * headR * 0.55 + dir.x * headR * 0.3;
      const ey2 = head.y + ez * side * headR * 0.55 + dir.z * headR * 0.3;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(ex2, ey2, headR * 0.3, Math.max(0.8, headR * 0.3 - blink * 0.06 * dpr), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#101c33";
      ctx.beginPath();
      ctx.arc(ex2 + dir.x * headR * 0.16, ey2 + dir.z * headR * 0.16, headR * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
    // Tongue flick.
    const ext = Math.max(0, Math.sin(time * 1.4) - 0.965) * 11;
    if (ext > 0) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = Math.max(1.5, headR * 0.14);
      ctx.beginPath();
      ctx.moveTo(head.x + dir.x * headR * 0.8, head.y + dir.z * headR * 0.8);
      ctx.lineTo(head.x + dir.x * (headR * 0.8 + headR * 0.7 * Math.min(1, ext)), head.y + dir.z * (headR * 0.8 + headR * 0.7 * Math.min(1, ext)));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cell (world) → pixel on canvas.
  pxLocal(wx) {
    const def = this.mapDef;
    const W = this.canvas.width, H = this.canvas.height;
    const pad = 28 * (this._dpr || 1);
    const cell = Math.max(8, Math.min((W - pad * 2) / def.cols, (H - pad * 2) / def.rows));
    const ox = (W - def.cols * cell) / 2;
    return ox + (wx + 0.5) * cell;
  }

  pyLocal(wz) {
    const def = this.mapDef;
    const W = this.canvas.width, H = this.canvas.height;
    const pad = 28 * (this._dpr || 1);
    const cell = Math.max(8, Math.min((W - pad * 2) / def.cols, (H - pad * 2) / def.rows));
    const oy = (H - def.rows * cell) / 2;
    return oy + (wz + 0.5) * cell;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
