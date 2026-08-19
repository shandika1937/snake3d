import * as THREE from "../vendor/three.module.js";
import { Snake } from "./snake.js";
import { PickupManager, POWERUP_TYPES } from "./pickups.js";
import { buildMap, getMap } from "./maps.js";
import { gridKey, cellToWorld } from "./three-setup.js";

const COMBO_WINDOW = 5.5;   // seconds to keep the combo alive
const PU_SPAWN_MIN = 6;     // seconds between power-up spawns
const PU_LIFETIME = 9;      // seconds before a power-up despawns

export class Game {
  constructor({ stage, effects, audio, ui, store, glowTex, softTex }) {
    this.stage = stage;
    this.effects = effects;
    this.audio = audio;
    this.ui = ui;
    this.store = store;
    this.glowTex = glowTex;
    this.snake = new Snake();
    this.pickups = new PickupManager(stage, glowTex, softTex);

    this.mapDef = null;
    this.mapCtx = null;
    this.mapId = null;
    this.state = "idle"; // idle | ready | playing | paused | over
    this.time = 0;
    this.score = 0;
    this.apples = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.level = 1;
    this.comboTimer = 0;
    this.puTimer = 5;
    this._puUiTimer = 0;
    this.deathTimer = 0;
    this._deathShown = false;
    this.fx = { shield: 0, speed: 0, slow: 0, magnet: 0 };
    this.spawnT = 1; // snake spawn-in animation clock (0..1)
    this._buildShieldBubble();
  }

  _buildShieldBubble() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, roughness: 0.1, metalness: 0,
      transparent: true, opacity: 0.28, emissive: 0x0ea5e9, emissiveIntensity: 0.6,
    });
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 18), mat);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.05, 10, 30),
      new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x0ea5e9, emissiveIntensity: 1.4, roughness: 0.2 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.5;
    this.shieldBubble = new THREE.Group();
    this.shieldBubble.add(bubble, ring);
    this.shieldBubble.visible = false;
    this.snake.headGroup.add(this.shieldBubble);
  }

  load(mapId) {
    this.stage.clearMap();
    this.pickups.clear();
    this.effects.clear();
    this.mapId = mapId;
    this.mapDef = getMap(mapId);
    this.mapCtx = buildMap(mapId, this.stage, this.glowTex);

    this.snake.reset(this.mapDef.cols, this.mapDef.rows);
    this.stage.entitiesRoot.add(this.snake.group);
    // Spawn-in animation: the snake scales up instead of popping in.
    this.spawnT = 0;
    this.snake.group.scale.setScalar(0.0001);

    this.pickups.setBoard(this.mapDef.cols, this.mapDef.rows, (c) => this._blocked(c));
    this.pickups.spawnApple();

    this.time = 0;
    this.score = 0;
    this.apples = 0;
    this.combo = 0;
    this.highestCombo = 0;
    this.level = 1;
    this.comboTimer = 0;
    this.puTimer = PU_SPAWN_MIN * 0.6;
    this.fx = { shield: 0, speed: 0, slow: 0, magnet: 0 };
    this.shieldBubble.visible = false;
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

  restart() {
    this.load(this.mapId);
    this.start();
  }

  quit() {
    this.state = "idle";
    this.audio.stopMusic();
  }

  _blocked(cell) {
    if (cell.x < 0 || cell.z < 0 || cell.x >= this.mapDef.cols || cell.z >= this.mapDef.rows) return true;
    if (this.mapCtx.obstacleCells.has(gridKey(cell.x, cell.z))) return true;
    if (this.snake.occupies(cell)) return true;
    return false;
  }

  _recomputeSpeed() {
    const ramp = (this.level - 1) * this.mapDef.speedPerLevel;
    let speed = this.mapDef.speed + ramp;
    if (this.fx.speed > 0) speed *= 1.45;
    if (this.fx.slow > 0) speed *= 0.62;
    this.snake.setSpeed(Math.min(speed, 14));
  }

  _lethal(cell) {
    if (cell.x < 0 || cell.z < 0 || cell.x >= this.mapDef.cols || cell.z >= this.mapDef.rows) return "wall";
    if (this.mapCtx.obstacleCells.has(gridKey(cell.x, cell.z))) return "obstacle";
    if (this.snake.collidesWith(cell)) return "self";
    return null;
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
      // Power-up effect timers.
      for (const k of ["speed", "slow", "magnet"]) {
        if (this.fx[k] > 0) {
          this.fx[k] -= dt;
          if (this.fx[k] <= 0) {
            this.fx[k] = 0;
            this._recomputeSpeed();
          }
        }
      }
      // Refresh power-up countdown bars at a throttled cadence.
      this._puUiTimer -= dt;
      if (this._puUiTimer <= 0) {
        this._puUiTimer = 0.15;
        this.ui.setPowerups(this._activePowerups());
      }
      this._tick(dt, time);
    }

    this.snake.active = this.state === "playing";
    this.snake.update(dt, time);
    // Snake spawn-in animation (scale with a soft overshoot).
    if (this.spawnT < 1) {
      this.spawnT = Math.min(1, this.spawnT + dt / 0.45);
      const t = this.spawnT;
      const e = 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
      this.snake.group.scale.setScalar(Math.max(0.0001, e));
    }
    this.pickups.update(dt, time, playing && this.fx.magnet > 0 ? this.snake.headSmooth() : null);
    this.effects.update(dt);
    if (this.mapCtx && this.mapCtx.update) this.mapCtx.update(dt, time);

    // Shield bubble follow + pulse.
    if (this.fx.shield > 0) {
      this.shieldBubble.visible = true;
      const s = 0.9 + Math.sin(time * 5) * 0.08;
      this.shieldBubble.scale.setScalar(s);
      this.shieldBubble.children[0].material.opacity = 0.22 + Math.sin(time * 5) * 0.08;
    } else {
      this.shieldBubble.visible = false;
    }

    // Pickup eating (distance based, feels like a bite as the head reaches it).
    if (playing) {
      const p = this.pickups.pickupNear(this.snake.headSmooth(), 0.52);
      if (p) this._eat(p);
    }

    // Power-up spawn cadence.
    if (playing) {
      this.puTimer -= dt;
      if (this.puTimer <= 0) {
        const hasPU = this.pickups.pickups.some((pk) => pk.type !== "apple");
        if (!hasPU) {
          const types = Object.keys(POWERUP_TYPES);
          const type = types[Math.floor(Math.random() * types.length)];
          const pk = this.pickups.spawnPowerUp(type);
          if (pk) pk.expiresAt = this.time + PU_LIFETIME;
        }
        this.puTimer = PU_SPAWN_MIN + Math.random() * 3;
      }
      // Expire stale power-ups.
      for (const pk of [...this.pickups.pickups]) {
        if (pk.type !== "apple" && pk.expiresAt && this.time > pk.expiresAt) {
          this.pickups.remove(pk);
        }
      }
    }

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
          // Shield absorbs the hit: stall one tick, keep going.
          this.fx.shield = 0;
          this.combo = 0;
          this.ui.setCombo(0);
          this.audio.shieldBreak();
          this.effects.shockwave(this.snake.headSmooth(), { color: 0x38bdf8, radius: 0.9, life: 0.5 });
          this.effects.burst(this.snake.headSmooth(), { count: 22, color: 0x7dd3fc, color2: 0xffffff, speed: 4, size: 0.22, gravity: -2 });
          this.stage.shake(0.25);
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
    const pos = pickup.root.position.clone();
    if (pickup.type === "apple") {
      this.combo = this.combo + 1;
      this.highestCombo = Math.max(this.highestCombo, this.combo);
      this.comboTimer = COMBO_WINDOW;
      const pts = 10 * this.combo;
      this.score += pts;
      this.apples += 1;
      this.snake.grow(1);
      this.audio.pickup(this.combo);
      this.effects.burst(pos, { count: 14, color: 0xff6b5e, color2: 0xffd166, speed: 3.6, size: 0.2, gravity: -4 });
      this.effects.shockwave(pos, { color: 0xff7b6b, radius: 0.5, life: 0.4 });
      this.effects.floatText(pos, "+" + pts);
      if (this.combo >= 2) {
        this.audio.combo(this.combo);
        this.ui.showBanner("COMBO x" + this.combo, "banner-combo", 800);
      }
      this._afterApple();
    } else if (pickup.type === "gold") {
      this.combo = this.combo + 1;
      this.highestCombo = Math.max(this.highestCombo, this.combo);
      this.comboTimer = COMBO_WINDOW;
      const pts = 50 * this.level;
      this.score += pts;
      this.apples += 1;
      this.snake.grow(2);
      this.audio.powerup();
      this.effects.burst(pos, { count: 26, color: 0xffd166, color2: 0xffffff, speed: 5, size: 0.24, gravity: -3 });
      this.effects.shockwave(pos, { color: 0xffd166, radius: 0.8, life: 0.5 });
      this.effects.floatText(pos, "+" + pts);
      this._afterApple();
    } else {
      this._applyPowerUp(pickup.type, pos);
    }
    // Squash-and-pop instead of vanishing instantly.
    pickup.consume();
    if (pickup.type === "apple" || pickup.type === "gold") {
      this.pickups.spawnApple();
    }
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
    if (this.level < 3 || this.level % 2 === 0 || !this.mapCtx.extraFactory) return;
    const { cols, rows } = this.mapDef;
    for (let attempt = 0; attempt < 200; attempt++) {
      const c = { x: Math.floor(Math.random() * cols), z: Math.floor(Math.random() * rows) };
      if (this._blocked(c)) continue;
      const mesh = this.mapCtx.extraFactory();
      const w = cellToWorld(c.x, c.z, cols, rows);
      mesh.position.set(w.x, 0, w.z);
      this.stage.mapRoot.add(mesh);
      this.mapCtx.obstacleCells.add(gridKey(c.x, c.z));
      this.effects.shockwave(w, { color: 0xffffff, radius: 0.7, life: 0.5 });
      break;
    }
  }

  _applyPowerUp(type, pos) {
    const cfg = POWERUP_TYPES[type];
    switch (type) {
      case "shield": this.fx.shield = 1; break;
      case "speed": this.fx.speed = 6; break;
      case "slow": this.fx.slow = 6; break;
      case "magnet": this.fx.magnet = 6; break;
    }
    this._recomputeSpeed();
    this.audio.powerup();
    this.effects.burst(pos, { count: 22, color: cfg.glow, color2: 0xffffff, speed: 4.4, size: 0.24, gravity: -2 });
    this.effects.shockwave(pos, { color: cfg.glow, radius: 0.8, life: 0.5 });
    this.ui.showBanner(cfg.name.toUpperCase(), "banner-" + type, 1000);
    this._pushHud();
  }

  _die(hit) {
    this.state = "over";
    this.deathTimer = 0.9;
    this._deathShown = false;
    this.audio.stopMusic();
    this.audio.collision();
    this.audio.gameOver();
    const hp = this.snake.headSmooth();
    this.effects.burst(hp, { count: 30, color: 0xff5b5b, color2: 0xffd166, speed: 5.5, size: 0.3, gravity: -5, up: 2.5 });
    this.effects.shockwave(hp, { color: 0xff5b5b, radius: 1.1, life: 0.6 });
    this.stage.shake(0.9);
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
      const hp = this.snake.headSmooth();
      this.effects.burst(hp, { count: 42, color: 0xffd166, color2: 0xffffff, speed: 6, size: 0.3, gravity: -2, up: 3 });
      this.effects.shockwave(hp, { color: 0xffd166, radius: 1.6, life: 0.8 });
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
        const cfg = POWERUP_TYPES[type];
        list.push({
          type,
          icon: cfg.icon,
          remaining: type === "shield" ? -1 : this.fx[type],
          total: 6,
        });
      }
    }
    return list;
  }
}
