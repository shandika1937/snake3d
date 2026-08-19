import * as THREE from "../vendor/three.module.js";
import { Stage, makeGlowTexture, makeSoftTexture } from "./three-setup.js";
import { Effects } from "./effects.js";
import { audio } from "./audio.js";
import { InputSystem } from "./input.js";
import { Game } from "./game.js";
import { Game2D } from "./game2d.js";
import { UI } from "./ui.js";
import { store } from "./store.js";
import { MAPS, getMap, buildMap } from "./maps.js";
import { detectPerformance, resolveGraphics, FpsMonitor } from "./perf.js";

// Lightweight performance detection runs before the renderer is built, so a
// weak device is never dragged through a full 3D boot before switching to 2D.
const perf = detectPerformance();
const graphics = resolveGraphics(perf, store.settings.graphicsMode);
window.__perf = {
  tier: perf.tier,
  reason: perf.reason,
  quality: perf.quality,
  graphics: graphics.mode,
  info: perf.info,
};

class App {
  constructor({ perf, graphics }) {
    this.perf = perf;
    this.graphics = graphics.mode; // '3d' | '2d'
    this.quality = graphics.quality; // 'high' | 'medium' | 'low'

    this.ui = new UI(this, audio, store);
    this._initRenderer();
    this.input = new InputSystem();

    this.screen = "menu";
    this._isTouch = window.matchMedia("(pointer: coarse)").matches;
    this.thumbs = {};
    this._thumbsDone = false;
    this._transitioning = false;

    this._bindInput();
    this._initAudioUnlock();
    this._openMenuScene();
    this.ui.setPerfLabel(this.perfLabel());

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // Build the renderer for the effective graphics mode. Called at boot and
  // again when the user changes Graphics Mode from Settings.
  _initRenderer() {
    const container = document.getElementById("stage");
    container.innerHTML = "";
    if (this.graphics === "2d") {
      this.stage = null;
      this.glowTex = null;
      this.softTex = null;
      this.canvas2d = document.createElement("canvas");
      container.appendChild(this.canvas2d);
      this.game = new Game2D({ canvas: this.canvas2d, ui: this.ui, audio, store });
    } else {
      this.stage = new Stage(container, { quality: this.quality });
      this.glowTex = makeGlowTexture();
      this.softTex = makeSoftTexture();
      this.effects = new Effects(this.stage, this.softTex, this.quality);
      this.game = new Game({
        stage: this.stage,
        effects: this.effects,
        audio,
        ui: this.ui,
        store,
        glowTex: this.glowTex,
        softTex: this.softTex,
      });
      this.stage.setCameraMode(store.settings.cameraMode);
    }
    this._thumbsDone = false;
  }

  perfLabel() {
    const tier = this.perf.tier;
    return `${tier} · ${this.graphics === "2d" ? "2D" : "3D " + (this.quality ? "(" + this.quality + ")" : "")}`;
  }

  /* ---------- audio ---------- */
  _initAudioUnlock() {
    const unlock = () => {
      audio.init();
      audio.resume();
      if (this.screen === "menu" || this.screen === "select") audio.startMusic("menu");
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) audio.ctx?.suspend();
      else audio.resume();
    });
  }

  _bindInput() {
    this.input.attach({
      onDir: (dir) => {
        if (this.game.state === "playing" || this.game.state === "ready") {
          this.game.snake.queueDir(dir);
        }
      },
      onPause: () => {
        if (this.game.state === "playing") this.pauseGame();
        else if (this.game.state === "paused") this.resumeGame();
      },
    });
  }

  /* ---------- settings ---------- */
  applyCameraMode() {
    if (this.stage) {
      this.stage.setCameraMode(store.settings.cameraMode);
    }
  }

  // Graphics Mode change: applies immediately from menus; mid-game it lands
  // on the next round so we never tear the scene out from under a player.
  applyGraphicsMode() {
    const want = resolveGraphics(this.perf, store.settings.graphicsMode);
    if (want.mode === this.graphics) {
      this.ui.setPerfLabel(this.perfLabel());
      return;
    }
    const playing = this.screen === "play" && (this.game.state === "playing" || this.game.state === "ready");
    if (playing) {
      this.ui.showBanner("WILL APPLY NEXT ROUND", "banner-ready", 1600);
      this.ui.setPerfLabel(this.perfLabel());
      return;
    }
    this.graphics = want.mode;
    this.quality = want.quality;
    this._initRenderer();
    this.ui.setPerfLabel(this.perfLabel());
    this.openMenu();
  }

  /* ---------- navigation ---------- */
  openMenu() {
    this.screen = "menu";
    this.game.quit();
    this.ui.hideHud();
    this.ui.showDpad(false);
    this.ui.showScreen("screen-menu");
    this._openMenuScene();
    audio.startMusic("menu");
  }

  // Guard against double-presses and repeated navigation while a
  // transition is running (prevents duplicate games / map loads).
  _guardTransition() {
    if (this._transitioning) return true;
    this._transitioning = true;
    this.ui.setBusy(true);
    return false;
  }

  _finishTransition(cb) {
    this.ui.endTransition(() => {
      this._transitioning = false;
      this.ui.setBusy(false);
      cb?.();
    });
  }

  // Shared start-of-game flow: load the map, settle the camera, show the
  // snake spawn animation, then READY -> GO! before movement starts.
  _beginPlay(id) {
    this.game.load(id);
    this._enterPlayback();
    this.ui.showBanner("READY", "banner-ready", 700);
    window.setTimeout(() => {
      if (this.game.state === "ready") this.game.start();
    }, 700);
  }

  openSelect() {
    if (this._guardTransition()) return;
    this.ui.startTransition(() => {
      this.screen = "select";
      this.game.quit();
      this.ui.hideHud();
      this.ui.showDpad(false);
      if (!this._thumbsDone) {
        this._generateThumbs();
        this._thumbsDone = true;
      }
      this.ui.showScreen("screen-select");
      this.ui.setSelectedMap(this.ui.selectedMap);
      this._previewMap(this.ui.selectedMap);
      audio.startMusic("menu");
      this._finishTransition();
    });
  }

  selectMap(id) {
    this.ui.setSelectedMap(id);
    this._previewMap(id);
  }

  playSelectedMap() {
    if (this._guardTransition()) return;
    const id = this.ui.selectedMap;
    if (!getMap(id)) {
      this.ui.showBanner("MAP NOT FOUND", "banner-error", 1800);
      this._finishTransition();
      return;
    }
    this.ui.startTransition(() => {
      try {
        this._beginPlay(id);
      } catch (err) {
        console.error("Failed to load map:", err);
        this.ui.showBanner("LOAD FAILED", "banner-error", 2000);
        this.screen = "select";
        this.ui.showScreen("screen-select");
      }
      this._finishTransition();
    });
  }

  openHowTo() {
    this.screen = "howto";
    this.ui.showScreen("screen-howto");
  }

  openSettings() {
    this.screen = "settings";
    this.ui._loadSettings();
    this.ui.showScreen("screen-settings");
  }

  openStats() {
    this.ui.refreshStats();
    this.ui.showScreen("screen-stats");
  }

  backFromSettings() {
    if (this.game.state === "paused") this.ui.showScreen("screen-pause");
    else this.openMenu();
  }

  applySettings() {
    audio.setSettings(store.settings);
    this.ui._loadSettings();
  }

  /* ---------- gameplay ---------- */
  _enterPlayback() {
    this.screen = "play";
    if (this.stage) {
      const def = getMap(this.game.mapId);
      this.stage.setPlayCamera(def.cols, def.rows);
    }
    this.ui.hideScreens();
    this.ui.showHud();
    this.ui.showDpad(this._isTouch);
  }

  pauseGame() {
    if (this.game.state !== "playing") return;
    this.game.pause();
    this.ui.showDpad(false);
    this.ui.showScreen("screen-pause");
  }

  resumeGame() {
    if (this.game.state !== "paused") return;
    this.game.resume();
    this.ui.hideScreens();
    this.ui.showHud();
    this.ui.showDpad(this._isTouch);
  }

  restartGame() {
    if (this._guardTransition()) return;
    const id = this.game.mapId || this.ui.selectedMap;
    this.ui.startTransition(() => {
      try {
        this._beginPlay(id);
      } catch (err) {
        console.error("Failed to restart:", err);
        this.ui.showBanner("RESTART FAILED", "banner-error", 2000);
        this.openMenu();
      }
      this._finishTransition();
    });
  }

  quitToMenu() {
    this.openMenu();
  }

  /* ---------- scenes ---------- */
  _openMenuScene() {
    this.game.load("garden");
    if (this.stage) this.stage.setOrbit(new THREE.Vector3(0, 0.4, 0), 8.5, 4.4, 0.16);
  }

  _previewMap(id) {
    this.game.load(id);
    if (!this.stage) return; // 2D mode: the board itself is the preview
    const def = getMap(id);
    this.stage.setOrbit(
      new THREE.Vector3(0, 0.4, 0),
      Math.max(def.cols, def.rows) * 0.62,
      Math.max(def.cols, def.rows) * 0.36,
      0.2
    );
  }

  _generateThumbs() {
    if (this.graphics === "2d" || !this.stage) return; // gradient thumbs in 2D
    const w = 240, h = 300;
    const rt = new THREE.WebGLRenderTarget(w, h);
    this.stage.entitiesRoot.visible = false;
    for (const m of MAPS) {
      this.stage.clearMap();
      buildMap(m.id, this.stage, this.glowTex);
      this.stage.frameBoard(m.cols, m.rows, 0.88);
      this.stage.camera.updateMatrixWorld();
      const renderer = this.stage.renderer;
      renderer.setRenderTarget(rt);
      renderer.render(this.stage.scene, this.stage.camera);
      const px = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
      renderer.setRenderTarget(null);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const src = ((h - 1 - y) * w + x) * 4;
          const dst = (y * w + x) * 4;
          img.data[dst] = px[src];
          img.data[dst + 1] = px[src + 1];
          img.data[dst + 2] = px[src + 2];
          img.data[dst + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      this.thumbs[m.id] = canvas.toDataURL("image/jpeg", 0.72);
    }
    rt.dispose();
    this.stage.entitiesRoot.visible = true;
    this.ui.setMapThumbs(this.thumbs);
  }

  /* ---------- dynamic quality fallback ---------- */
  _monitorFps(dt) {
    if (!this._fps) this._fps = new FpsMonitor();
    const state = this._fps.sample(dt);
    if (!state || state.avgMs <= 33) return;
    this._degradeQuality();
  }

  _degradeQuality() {
    const now = performance.now();
    if (now - (this._lastDegrade || 0) < 8000) return; // cooldown: no thrashing
    this._lastDegrade = now;
    if (this.quality === "high") {
      this.quality = "medium";
      this._applyQuality();
      this.ui.showBanner("PERFORMANCE — LOWERING QUALITY", "banner-ready", 1500);
    } else if (this.quality === "medium") {
      this.quality = "low";
      this._applyQuality();
      this.ui.showBanner("PERFORMANCE — LOW MODE", "banner-ready", 1500);
    } else if (this.screen !== "play") {
      // Already at minimum 3D quality: offer the 2D fallback from menus.
      this.graphics = "2d";
      this.quality = "low";
      this._initRenderer();
      this.ui.setPerfLabel(this.perfLabel());
      this.openMenu();
      this.ui.showBanner("SWITCHED TO 2D MODE", "banner-ready", 2000);
    } else {
      this.ui.showBanner("TRY 2D MODE IN SETTINGS", "banner-ready", 1800);
    }
  }

  _applyQuality() {
    if (!this.stage) return;
    this.stage.setQuality(this.quality);
    this.effects.setQuality(this.quality);
  }

  /* ---------- main loop ---------- */
  _loop(now) {
    // Clamp against negative/zero (clock jumps back) and huge gaps.
    const dt = Math.max(0, Math.min(0.05, (now - this._last) / 1000));
    this._last = now;
    const t = now / 1000;

    this.input.pollGamepad();
    this.game.update(dt, t);
    if (this.graphics === "3d" && this.screen === "play" && this.game.mapDef && this.game.snake) {
      this.stage.setPlayFollow({
        head: this.game.snake.headSmooth(),
        dir: this.game.snake.dir,
        length: this.game.snake.segments.length,
        state: this.game.state,
      });
    }
    if (this.stage) {
      this.stage.update(dt, t);
      this.stage.render();
      this._monitorFps(dt);
    } else {
      this.game.render(t);
    }
    requestAnimationFrame(this._loop);
  }
}

window.__app = new App({ perf, graphics });
