import * as THREE from "../vendor/three.module.js";
import { Stage, makeGlowTexture, makeSoftTexture } from "./three-setup.js";
import { Effects } from "./effects.js";
import { audio } from "./audio.js";
import { InputSystem } from "./input.js";
import { Game } from "./game.js";
import { UI } from "./ui.js";
import { store } from "./store.js";
import { MAPS, getMap, buildMap } from "./maps.js";

class App {
  constructor() {
    this.stage = new Stage(document.getElementById("stage"));
    this.glowTex = makeGlowTexture();
    this.softTex = makeSoftTexture();
    this.effects = new Effects(this.stage, this.softTex);
    this.ui = new UI(this, audio, store);
    this.input = new InputSystem();
    this.game = new Game({
      stage: this.stage,
      effects: this.effects,
      audio,
      ui: this.ui,
      store,
      glowTex: this.glowTex,
      softTex: this.softTex,
    });

    this.screen = "menu";
    this._isTouch = window.matchMedia("(pointer: coarse)").matches;
    this.thumbs = {};
    this._thumbsDone = false;
    this._transitioning = false;

    this._bindInput();
    this._initAudioUnlock();
    this._openMenuScene();

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
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
    const def = getMap(this.game.mapId);
    this.stage.setPlayCamera(def.cols, def.rows);
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
    this.stage.setOrbit(new THREE.Vector3(0, 0.4, 0), 8.5, 4.4, 0.16);
  }

  _previewMap(id) {
    this.game.load(id);
    const def = getMap(id);
    this.stage.setOrbit(
      new THREE.Vector3(0, 0.4, 0),
      Math.max(def.cols, def.rows) * 0.62,
      Math.max(def.cols, def.rows) * 0.36,
      0.2
    );
  }

  _generateThumbs() {
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

  _loop(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const t = now / 1000;

    this.input.pollGamepad();
    this.game.update(dt, t);
    if (this.screen === "play" && this.game.mapDef && this.game.snake) {
      this.stage.setPlayFollow({
        head: this.game.snake.headSmooth(),
        dir: this.game.snake.dir,
        length: this.game.snake.segments.length,
        state: this.game.state,
      });
    }
    this.stage.update(dt, t);
    this.stage.render();
    requestAnimationFrame(this._loop);
  }
}

window.__app = new App();
