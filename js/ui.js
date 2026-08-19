import { MAPS } from "./maps.js";

function $(id) { return document.getElementById(id); }
function icon(id) { return `<svg class="icon"><use href="#${id}"/></svg>`; }
function fmt(n) { return Math.floor(n).toLocaleString("en-US"); }
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class UI {
  constructor(app, audio, store) {
    this.app = app;
    this.audio = audio;
    this.store = store;
    this.selectedMap = "garden";
    this._bannerTimer = null;

    this._cache();
    this._buildMapCards();
    this._bind();
    this._loadSettings();
  }

  _cache() {
    this.el = {
      hud: $("hud"),
      hudScore: $("hud-score"),
      hudCombo: $("hud-combo"),
      hudApples: $("hud-apples-n"),
      hudPowerups: $("hud-powerups"),
      hudLevel: $("hud-level"),
      hudBanner: $("hud-banner"),
      dpad: $("dpad"),
      mapCards: $("map-cards"),
      selectStatus: $("select-status"),
      btnSelectPlay: $("btn-select-play"),
      settingHighscore: $("setting-highscore"),
      statsPanel: $("stats-panel"),
      muteIcon: $("mute-icon"),
      muteState: $("mute-state"),
      volMaster: $("vol-master"),
      volMusic: $("vol-music"),
      volSfx: $("vol-sfx"),
      goNew: $("go-new"),
      goScore: $("go-score"),
      goStats: $("go-stats"),
      overlay: $("transition-overlay"),
      perfInfo: $("perf-info"),
    };
  }

  _screens() {
    return ["screen-menu", "screen-select", "screen-howto", "screen-settings", "screen-stats", "screen-pause", "screen-gameover"];
  }

  showScreen(name) {
    this._screens().forEach((s) => $(s).classList.toggle("hidden", s !== name));
    if (name === "screen-menu") this.el.dpad.classList.add("hidden");
  }

  hideScreens() {
    this._screens().forEach((s) => $(s).classList.add("hidden"));
  }

  showHud() { this.el.hud.classList.remove("hidden"); }
  hideHud() { this.el.hud.classList.add("hidden"); }
  showDpad(show) { this.el.dpad.classList.toggle("hidden", !show); }

  /* ---------------- Screen transitions ---------------- */
  // Fade the full-screen overlay in, run the navigation, then fade out.
  startTransition(onDone) {
    const o = this.el.overlay;
    o.classList.remove("hidden");
    void o.offsetWidth; // force reflow so the opacity transition plays
    requestAnimationFrame(() => o.classList.add("shown"));
    window.setTimeout(onDone, 240); // fade-in duration
  }

  endTransition(onDone) {
    const o = this.el.overlay;
    o.classList.remove("shown");
    window.setTimeout(() => {
      o.classList.add("hidden");
      onDone?.();
    }, 260); // fade-out duration
  }

  setBusy(busy) {
    document.body.classList.toggle("is-busy", !!busy);
  }

  /* ---------------- HUD ---------------- */
  setScore(n) {
    this.el.hudScore.textContent = fmt(n);
    this.el.hudScore.classList.remove("bump");
    void this.el.hudScore.offsetWidth;
    this.el.hudScore.classList.add("bump");
  }
  setApples(n) { this.el.hudApples.textContent = fmt(n); }
  setLevel(l) { this.el.hudLevel.textContent = "Level " + l; }
  setCombo(n) {
    if (n >= 2) {
      this.el.hudCombo.textContent = "COMBO x" + n;
      this.el.hudCombo.classList.remove("pop");
      void this.el.hudCombo.offsetWidth;
      this.el.hudCombo.classList.add("pop");
    } else {
      this.el.hudCombo.textContent = "";
    }
  }

  setPowerups(list) {
    this.el.hudPowerups.innerHTML = "";
    for (const p of list) {
      const chip = document.createElement("div");
      chip.className = "pu-chip";
      const name = p.type === "shield" ? "Shield" : p.type === "speed" ? "Speed" : p.type === "slow" ? "Slow" : "Magnet";
      chip.innerHTML = icon(p.icon) + `<span>${name}</span>` +
        (p.remaining >= 0
          ? `<span class="pu-bar"><span style="width:${(p.remaining / p.total) * 100}%"></span></span>`
          : "");
      this.el.hudPowerups.appendChild(chip);
    }
  }

  showBanner(text, cls = "", duration = 900) {
    if (this._bannerTimer) window.clearTimeout(this._bannerTimer);
    this.el.hudBanner.innerHTML = `<span class="banner-line ${cls}">${text}</span>`;
    this._bannerTimer = window.setTimeout(() => { this.el.hudBanner.innerHTML = ""; }, duration);
  }

  /* ---------------- Map cards ---------------- */
  _buildMapCards() {
    this.el.mapCards.innerHTML = "";
    MAPS.forEach((m, i) => {
      const card = document.createElement("button");
      card.className = "map-card";
      card.style.animationDelay = (i * 60) + "ms";
      card.dataset.id = m.id;
      card.innerHTML = `
        <div class="thumb"></div>
        <div class="overlay">
          <div class="m-diff ${m.cls}">${m.difficulty}</div>
          <div class="m-name">${m.name}</div>
        </div>
        <div class="m-badge">${icon("i-play")}</div>
      `;
      card.addEventListener("click", () => this.app.selectMap(m.id));
      card.addEventListener("dblclick", () => this.app.playSelectedMap());
      this.el.mapCards.appendChild(card);
    });
  }

  setMapThumbs(urls) {
    const cards = this.el.mapCards.querySelectorAll(".map-card");
    cards.forEach((card) => {
      const url = urls[card.dataset.id];
      if (url) card.querySelector(".thumb").style.backgroundImage = `url(${url})`;
    });
  }

  setSelectedMap(id) {
    this.selectedMap = id;
    const map = MAPS.find((m) => m.id === id);
    this.el.mapCards.querySelectorAll(".map-card").forEach((c) => c.classList.toggle("selected", c.dataset.id === id));
    this.el.selectStatus.textContent = map ? `${map.name} · ${map.difficulty} · ready` : "Choose a world";
    this.el.btnSelectPlay.disabled = !map;
  }

  /* ---------------- Game over ---------------- */
  showGameOver(s) {
    this.el.goNew.classList.toggle("hidden", !s.isNew);
    this.el.goScore.textContent = fmt(s.score);
    const rows = [
      ["Length", s.length],
      ["Apples", s.apples],
      ["Best Combo", "x" + s.combo],
      ["Time", fmtTime(s.time)],
      ["Level", s.level],
      ["High Score", fmt(this.store.highScore(s.mapId))],
    ];
    this.el.goStats.innerHTML = "";
    rows.forEach(([label, val], i) => {
      const d = document.createElement("div");
      d.className = "go-stat";
      d.style.animationDelay = (i * 60) + "ms";
      d.innerHTML = `<span class="gs-num">${val}</span><span class="gs-label">${label}</span>`;
      this.el.goStats.appendChild(d);
    });
    this.showScreen("screen-gameover");
    this.hideHud();
  }

  /* ---------------- Settings ---------------- */
  _loadSettings() {
    const s = this.store.settings;
    this.el.volMaster.value = Math.round(s.master * 100);
    this.el.volMusic.value = Math.round(s.music * 100);
    this.el.volSfx.value = Math.round(s.sfx * 100);
    this._fillRange(this.el.volMaster);
    this._fillRange(this.el.volMusic);
    this._fillRange(this.el.volSfx);
    this.el.settingHighscore.textContent = fmt(this.store.stats.highScore);
    this._renderMute(s.muted);
    this._refreshSegs();
  }

  // Sync the segmented controls (Camera Mode / Graphics Mode) with saved settings.
  _refreshSegs() {
    const s = this.store.settings;
    document.querySelectorAll(".seg").forEach((seg) => {
      const key = seg.dataset.key;
      const val = s[key];
      seg.querySelectorAll(".seg-btn").forEach((btn) => {
        const on = btn.dataset.val === val;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-checked", String(on));
      });
    });
  }

  setPerfLabel(text) {
    this.el.perfInfo.textContent = text;
  }

  _fillRange(input) {
    input.style.setProperty("--fill", ((input.value - input.min) / (input.max - input.min)) * 100 + "%");
  }

  _renderMute(muted) {
    this.el.muteIcon.setAttribute("href", muted ? "#i-sound-off" : "#i-sound-on");
    this.el.muteState.textContent = muted ? "Off" : "On";
  }

  _applyVolumes() {
    const s = {
      master: this.el.volMaster.value / 100,
      music: this.el.volMusic.value / 100,
      sfx: this.el.volSfx.value / 100,
      muted: this.store.settings.muted,
    };
    this.audio.setSettings(s);
    this.store.setSettings(s);
  }

  refreshStats() {
    const st = this.store.stats;
    const hs = this.store.stats.highScore;
    const items = [
      ["Games", fmt(st.games), ""],
      ["High Score", fmt(hs), "highlight"],
      ["Apples Eaten", fmt(st.apples), ""],
      ["Best Combo", "x" + st.bestCombo, ""],
      ["Time Played", fmtTime(st.totalTime), ""],
    ];
    this.el.statsPanel.innerHTML = "";
    for (const [label, num, cls] of items) {
      const d = document.createElement("div");
      d.className = "stat-box " + cls;
      d.innerHTML = `<span class="stat-num">${num}</span><span class="stat-label">${label}</span>`;
      this.el.statsPanel.appendChild(d);
    }
    // Per-map bests.
    const mapBest = document.createElement("div");
    mapBest.className = "stat-box";
    const rows = MAPS.map((m) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span style="color:var(--text-dim)">${m.name}</span><span style="font-weight:700">${fmt(this.store.highScore(m.id))}</span></div>`).join("");
    mapBest.innerHTML = `<span class="stat-num" style="font-size:15px;text-align:left">World Bests</span>${rows}`;
    this.el.statsPanel.appendChild(mapBest);
  }

  _bind() {
    $("btn-play").addEventListener("click", () => this.app.openSelect());
    $("btn-select").addEventListener("click", () => this.app.openSelect());
    $("btn-howto").addEventListener("click", () => this.app.openHowTo());
    $("btn-settings").addEventListener("click", () => this.app.openSettings());

    $("btn-select-back").addEventListener("click", () => this.app.openMenu());
    $("btn-howto-back").addEventListener("click", () => this.app.openMenu());
    $("btn-settings-back").addEventListener("click", () => this.app.backFromSettings());
    $("btn-stats-back").addEventListener("click", () => this.app.openSettings());
    $("btn-select-play").addEventListener("click", () => this.app.playSelectedMap());

    $("btn-resume").addEventListener("click", () => this.app.resumeGame());
    $("btn-restart").addEventListener("click", () => this.app.restartGame());
    $("btn-pause-settings").addEventListener("click", () => this.app.openSettings());
    $("btn-quit").addEventListener("click", () => this.app.quitToMenu());
    $("btn-again").addEventListener("click", () => this.app.restartGame());
    $("btn-go-menu").addEventListener("click", () => this.app.openMenu());
    $("btn-pause").addEventListener("click", () => this.app.pauseGame());

    $("btn-mute").addEventListener("click", () => {
      const s = this.store.settings;
      const muted = !s.muted;
      this.store.setSettings({ muted });
      this.audio.setSettings({ ...s, muted });
      this._renderMute(muted);
    });

    for (const [el, key] of [[this.el.volMaster, "master"], [this.el.volMusic, "music"], [this.el.volSfx, "sfx"]]) {
      el.addEventListener("input", () => { this._fillRange(el); this._applyVolumes(); });
    }

    $("btn-stats").addEventListener("click", () => this.app.openStats());
    $("btn-reset").addEventListener("click", () => {
      if (window.confirm("Reset all progress and high scores?")) {
        this.store.reset();
        this._loadSettings();
        this.app.applySettings();
      }
    });

    // Segmented settings (Camera Mode / Graphics Mode).
    document.querySelectorAll(".seg").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest(".seg-btn");
        if (!btn) return;
        const key = seg.dataset.key;
        const val = btn.dataset.val;
        this.store.setSettings({ [key]: val });
        this._refreshSegs();
        this.audio.click();
        if (key === "cameraMode") this.app.applyCameraMode();
        if (key === "graphicsMode") this.app.applyGraphicsMode();
      });
    });

    // Hover SFX on buttons.
    document.querySelectorAll(".btn, .icon-btn, .map-card").forEach((b) => {
      b.addEventListener("pointerenter", () => this.audio.hover());
      b.addEventListener("click", () => this.audio.click());
    });
  }
}
