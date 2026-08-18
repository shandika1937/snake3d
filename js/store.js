// Local persistence for settings, high scores and lifetime stats.
const KEY = "snake3d.v1";

const DEFAULTS = {
  settings: { master: 0.8, music: 0.7, sfx: 0.85, muted: false },
  highScores: {},        // mapId -> best score
  bestCombo: 0,
  stats: {
    games: 0,
    apples: 0,
    bestCombo: 0,
    totalTime: 0,        // seconds survived, accumulated
    highScore: 0,        // global best
  },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const data = JSON.parse(raw);
    return {
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
      highScores: { ...DEFAULTS.highScores, ...(data.highScores || {}) },
      bestCombo: data.bestCombo ?? DEFAULTS.bestCombo,
      stats: { ...DEFAULTS.stats, ...(data.stats || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — ignore */
  }
}

export const store = {
  get settings() { return state.settings; },
  setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    save();
  },

  highScore(mapId) {
    return state.highScores[mapId] ?? 0;
  },
  submitScore(mapId, score) {
    const prev = state.highScores[mapId] ?? 0;
    const isNew = score > prev;
    if (isNew) {
      state.highScores[mapId] = score;
      if (score > state.stats.highScore) state.stats.highScore = score;
      save();
    }
    return isNew;
  },

  get stats() { return state.stats; },
  recordRun({ apples = 0, combo = 0, time = 0 } = {}) {
    state.stats.games += 1;
    state.stats.apples += apples;
    state.stats.totalTime += time;
    state.stats.bestCombo = Math.max(state.stats.bestCombo, combo);
    state.bestCombo = Math.max(state.bestCombo, combo);
    save();
  },

  reset() {
    state = structuredClone(DEFAULTS);
    save();
  },
};
