// Procedural audio: all SFX and music are synthesized with the Web Audio API,
// so no external audio assets are required.
const SEMITONE = Math.pow(2, 1 / 12);

function midiToFreq(m) {
  return 440 * Math.pow(SEMITONE, m - 69);
}

// Map flavours drive the generative music (scale, tempo, timbre).
export const MUSIC_FLAVOURS = {
  garden: { scale: [0, 2, 4, 7, 9, 12, 14, 16], base: 55, tempo: 108, wave: "triangle", bright: 0.7 },
  desert: { scale: [0, 3, 5, 7, 10, 12, 15], base: 49, tempo: 96, wave: "sawtooth", bright: 0.35 },
  night:  { scale: [0, 2, 3, 5, 7, 8, 12], base: 44, tempo: 82, wave: "sine", bright: 0.25 },
  cyber:  { scale: [0, 1, 3, 5, 7, 8, 10, 12], base: 37, tempo: 128, wave: "square", bright: 0.9 },
  ice:    { scale: [0, 2, 4, 7, 9, 11, 12, 16], base: 52, tempo: 100, wave: "sine", bright: 0.6 },
  menu:   { scale: [0, 2, 4, 7, 9, 12, 14, 16], base: 55, tempo: 96, wave: "triangle", bright: 0.5 },
};

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.step = 0;
    this.chord = 0;
    this.playing = false;
    this.flavour = MUSIC_FLAVOURS.menu;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this._applyVolumes();
      this._initialized = true;
    } catch {
      /* audio unavailable */
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  setSettings({ master = 0.8, music = 0.7, sfx = 0.85, muted = false } = {}) {
    this.master = master;
    this.music = music;
    this.sfx = sfx;
    this.muted = muted;
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.master, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.muted ? 0 : this.music, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.muted ? 0 : this.sfx, t, 0.05);
  }

  /* ---------- low level helpers ---------- */
  _tone({ freq = 440, end = null, type = "sine", dur = 0.2, gain = 0.2, attack = 0.005, dest = null, detune = 0, glide = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (end && glide > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + glide);
    if (detune) osc.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise({ dur = 0.2, gain = 0.2, freq = 1000, q = 1, type = "bandpass" }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.setValueAtTime(q, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  /* ---------- SFX ---------- */
  click() { this._tone({ freq: 520, type: "triangle", dur: 0.08, gain: 0.18 }); this._tone({ freq: 780, type: "sine", dur: 0.06, gain: 0.1 }); }
  hover() { this._tone({ freq: 660, type: "sine", dur: 0.05, gain: 0.06 }); }
  back() { this._tone({ freq: 440, end: 300, glide: 0.09, type: "triangle", dur: 0.12, gain: 0.14 }); }

  pickup(combo = 1) {
    const root = 660 * Math.pow(SEMITONE, Math.min(combo, 8) * 2);
    this._tone({ freq: root, type: "sine", dur: 0.12, gain: 0.22 });
    this._tone({ freq: root * 1.5, type: "triangle", dur: 0.16, gain: 0.16, attack: 0.02 });
    this._tone({ freq: root * 2, type: "sine", dur: 0.2, gain: 0.1, attack: 0.04 });
    this._noise({ dur: 0.08, gain: 0.05, freq: 6000, type: "highpass" });
  }

  combo(level = 2) {
    const f = 520 * Math.pow(SEMITONE, level * 2);
    this._tone({ freq: f, type: "square", dur: 0.1, gain: 0.1 });
    this._tone({ freq: f * 1.25, type: "square", dur: 0.12, gain: 0.1, attack: 0.03 });
  }

  powerup() {
    [660, 880, 1100, 1320].forEach((f, i) => {
      this._tone({ freq: f, type: "triangle", dur: 0.14, gain: 0.14, attack: 0.02 * i });
    });
  }

  shieldBreak() {
    this._noise({ dur: 0.25, gain: 0.25, freq: 2200, type: "highpass" });
    this._tone({ freq: 300, end: 120, glide: 0.2, type: "sawtooth", dur: 0.28, gain: 0.15 });
  }

  collision() {
    this._noise({ dur: 0.3, gain: 0.3, freq: 500, type: "lowpass" });
    this._tone({ freq: 180, end: 60, glide: 0.25, type: "sawtooth", dur: 0.35, gain: 0.2 });
  }

  gameOver() {
    [392, 311, 233, 155].forEach((f, i) => {
      window.setTimeout(() => this._tone({ freq: f, type: "triangle", dur: 0.3, gain: 0.18, attack: 0.02 }), i * 130);
    });
    this._noise({ dur: 0.5, gain: 0.12, freq: 300, type: "lowpass" });
  }

  highScore() {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318];
    notes.forEach((f, i) => {
      window.setTimeout(() => this._tone({ freq: f, type: "triangle", dur: 0.3, gain: 0.16 }), i * 90);
    });
  }

  pause() { this._tone({ freq: 440, type: "sine", dur: 0.1, gain: 0.12 }); this._tone({ freq: 330, type: "sine", dur: 0.1, gain: 0.1, attack: 0.04 }); }
  resume() { this._tone({ freq: 330, type: "sine", dur: 0.1, gain: 0.12 }); this._tone({ freq: 494, type: "sine", dur: 0.12, gain: 0.1, attack: 0.04 }); }

  countdown() { this._tone({ freq: 660, type: "sine", dur: 0.12, gain: 0.16 }); }

  /* ---------- generative music ---------- */
  startMusic(flavourName = "menu") {
    if (!this.ctx) return;
    this.stopMusic();
    this.flavour = MUSIC_FLAVOURS[flavourName] || MUSIC_FLAVOURS.menu;
    this.step = 0;
    this.chord = 0;
    this.playing = true;
    const stepMs = 60000 / this.flavour.tempo / 2; // eighth notes
    this._stepNow();
    this.musicTimer = window.setInterval(() => this._stepNow(), stepMs);
  }

  stopMusic() {
    if (this.musicTimer) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.playing = false;
  }

  _stepNow() {
    if (!this.playing || !this.ctx) return;
    const f = this.flavour;
    const beat = this.step % 8;
    // Change chord every 2 bars.
    if (this.step % 16 === 0) this.chord = Math.floor(Math.random() * 4);

    // Soft pad chord.
    if (this.step % 8 === 0) {
      const roots = [0, -4, -2, -5];
      const root = f.base * Math.pow(SEMITONE, roots[this.chord]);
      [0, 3, 7].forEach((iv) => {
        this._tone({
          freq: root * Math.pow(SEMITONE, iv),
          type: "sine",
          dur: 3.2,
          gain: 0.028,
          attack: 0.8,
          dest: this.musicGain,
        });
      });
    }

    // Bass pulse.
    if (beat % 2 === 0) {
      const roots = [0, -4, -2, -5];
      this._tone({
        freq: f.base * Math.pow(SEMITONE, roots[this.chord] - 12),
        type: "triangle",
        dur: 0.5,
        gain: 0.05,
        attack: 0.01,
        dest: this.musicGain,
      });
    }

    // Melody plucks, sparse.
    if (Math.random() < 0.55) {
      const scale = f.scale;
      const note = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      this._tone({
        freq: f.base * Math.pow(SEMITONE, note + 12),
        type: f.wave,
        dur: 0.35,
        gain: 0.045 * f.bright + 0.02,
        attack: 0.008,
        dest: this.musicGain,
        detune: (Math.random() - 0.5) * 8,
      });
    }

    this.step++;
  }
}

export const audio = new AudioSystem();
