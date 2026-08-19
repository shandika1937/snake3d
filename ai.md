# ai.md — AI Handoff / Context for This Project

> **Purpose**: This file exists so that a *different AI session* (or a new engineer) can
> pick up this project and understand it without any conversation history. Read this
> first before editing code. It is written for AI agents, not end users.
>
> **Bahasa Indonesia (ringkas untuk manusia)**: File ini adalah "memori proyek" agar AI
> lain yang melanjutkan sesi baru langsung paham arsitektur, sistem kamera, deploy, dan
> konvensi proyek ini tanpa perlu baca seluruh riwayat chat.

---

## 1. What this project is

A **pure-static, dependency-free 3D Snake game** built with **Three.js** (ES modules,
no bundler, no build step). All models, textures, SFX and music are **generated
procedurally in code** — there are no external assets. It runs on desktop and mobile.

- Repo: `https://github.com/shandika1937/snake3d` (default branch `master`)
- Live (Vercel): `https://snake3d-taupe.vercel.app` — auto-redeploys on every push to `master`
- Local server: `node server.js` → `http://127.0.0.1:4780`

**Latest commit context (df13481)**: camera POV overhaul + performance detection + 2D
fallback + animation polish. The live site serves this commit.

---

## 2. How to run & verify

```bash
node server.js        # static file server, binds 127.0.0.1:4780
```

- No install needed for the game itself (`vendor/three.module.js` is checked in).
- Open `http://127.0.0.1:4780` in a browser. Keyboard: W/S/A/D + arrows, Esc/P pause.
- **Preview workflow used in this project's history**: a headless preview is driven via
  `window.__app` (see §9). `preview_*` tools interact with the running page.

---

## 3. Architecture map (file → responsibility)

| File | Responsibility |
| --- | --- |
| `index.html` | UI shell, all screens, inline SVG icon symbols |
| `css/style.css` | Responsive UI, buttons, segmented controls, overlays, banners |
| `js/main.js` | **App wiring + render loop + boot decision** (3D vs 2D from detection) |
| `js/three-setup.js` | **Renderer, Stage, ALL gameplay camera logic**, helpers (`CELL`, `cellToWorld`) |
| `js/game.js` | 3D game state: scoring, combo, power-ups, difficulty, death, eating |
| `js/game2d.js` | 2D fallback mode — same rules, Canvas 2D rendering, polished |
| `js/snake.js` | 3D snake character (head, eyes, tongue, smooth tube body) |
| `js/maps.js` | 6 themed map builders + `obstacleLayout()` shared with 2D |
| `js/pickups.js` | Apple + power-up models and consume/spawn animations |
| `js/effects.js` | Particles / shockwaves / floating text (quality-aware) |
| `js/audio.js` | Procedural Web Audio SFX + generative per-map music |
| `js/input.js` | **Single source of truth for directional input** (see §5) |
| `js/perf.js` | Lightweight performance detection → tier + quality |
| `js/store.js` | localStorage persistence (settings, high scores, stats) |
| `vendor/three.module.js` | Three.js (vendored) |

---

## 4. Boot sequence (main.js)

1. `detectPerformance()` runs **synchronously before the renderer is built** (weak devices
   are never dragged through a 3D boot).
2. `resolveGraphics(perf, store.settings.graphicsMode)` decides `3d` or `2d`.
3. `App` constructor builds the right renderer, then starts the rAF loop.
4. Every frame: `input.pollGamepad()` → `game.update(dt, t)` → (3D) feed snake state to
   camera via `stage.setPlayFollow(...)` → `stage.update(dt, t)` → `stage.render()` →
   FPS monitor. In 2D mode it calls `game.render(t)` instead.
5. `dt` is **clamped to `[0, 0.05]`** — clock jumps backwards must not explode the camera.

---

## 5. Input → world mapping (NEVER change these two together casually)

`js/input.js` maps **screen directions to world axes** once, in `DIR_VECTORS`:

```
up    -> {x:0, z:-1}   (away from camera = top of screen)
down  -> {x:0, z:+1}
left  -> {x:-1, z:0}
right -> {x:+1, z:0}
```

The camera is always on the **+Z side** of the look point (`up=(0,1,0)`), so this mapping
holds in **every camera mode**. If you ever change camera orientation, you must re-verify
this mapping (§9 Test A). W/↑, S/↓, A/←, D/→, swipe, D-pad, and gamepad all funnel into
one `onDir(name)` callback.

---

## 6. Camera system (the most worked-on / most contested area)

All gameplay camera code lives in **`js/three-setup.js`** — `Stage` class,
`CAMERA_MODES` config, `setPlayCamera`, `setPlayFollow`, `setCameraMode`,
`_updatePlayCamera`. **There is only ONE camera controller; nothing else overrides the
camera during play** (menu/preview uses `setOrbit`).

### Modes (`CAMERA_MODES`)

| Mode | elev (rad) | dist (cells) | lookAhead | deadZone | speed | Feel |
| --- | --- | --- | --- | --- | --- | --- |
| `follow` (default) | 0.92 (~53°) | 3.8 | 0.7 | 0.4 | 11 | above + slightly behind head |
| `above` | 1.16 (~66°) | 3.4 | 0.45 | 0.35 | 13 | strong overhead, closest |
| `elevated` | 1.00 (~57°) | 4.4 | 0.85 | 0.5 | 10 | a bit farther, more surroundings |

### Rules that MUST hold (user requirements, repeatedly demanded)

1. **The snake head is the camera anchor — never the arena centre.** There is **no clamp
   to board bounds** on the focus; the camera freely follows the head to any corner.
2. **The snake must never leave the frame.** Look-ahead `la` is clamped to
   `la = min(la, halfH * 0.55)` where `halfH = d * tan(fov/2)` — the head stays inside the
   lower ~55% of the half-height.
3. **Distance is absolute (cells), not scaled to board size** — a 15x15 and a 21x21 map
   show the snake at the same size. `minD`/`maxD` bound the dynamic zoom so a long snake
   never shrinks to a dot.
4. **Smooth everything** (exponential damping `k = 1 - exp(-dt * speed)`), no snaps, no
   jitter, no oscillation. Parameter glides use `km = 1 - exp(-dt * 3.5)`.
5. **World orientation is fixed** — the camera never yaws with the snake. W is always up
   on screen. This is the single most important non-negotiable.
6. Dead zone is **small** (0.35–0.5 cells) so the head stays in the middle ~40–60% of the
   screen.

### Dynamic zoom & game over

- `zoomTarget = min(1 + (length - 5) * zoomPerSeg, maxZoom)`; distance `d` is clamped
  `minD ≤ d ≤ maxD`.
- On `state === "over"` a gentle pull-out (`overZoom`) keeps the crash visible; on
  `paused`/`idle` the camera **freezes** (no drift, no snap).

### Known gotchas

- `f.dist` must be glided (`f.dist += (cfg.dist - f.dist) * km`) **and** used via
  `f.dist * f.zoom` for `d` — previously the distance snapped on mode switch while
  elev/fov glided (fixed in df13481).
- When verifying camera math from an AI/headless context: **call
  `camera.updateMatrixWorld(true)` before projecting** — `matrixWorldInverse` is only
  refreshed at render time, and reading a stale matrix gives wrong (rotated-looking)
  results.

---

## 7. Performance detection & graphics mode

`js/perf.js`:
- Sync checks: WebGL support, render test (~24 frames), device hints (deviceMemory,
  hardwareConcurrency, GPU name via WEBGL_debug_renderer_info), screen, mobile.
- Outputs a tier: `HIGH / MEDIUM / LOW / VERY_LOW` plus a quality
  (`high / medium / low`) and a reason string.

`resolveGraphics(perf, userSetting)` in `perf.js`:
- `AUTO` → tier decides 3D quality (or 2D if VERY_LOW / unsupported).
- `3d` / `2d` → forced.

Quality → renderer: HIGH = AA + pixelRatio ≤2 + shadows; MEDIUM = pixelRatio ≤1.5;
LOW = AA off, pixelRatio 1, shadows off, particles 0.5×. `Stage.setQuality()` and
`Effects.setQuality()` apply live.

Dynamic fallback (`main.js._monitorFps` / `_degradeQuality`): rolling FPS monitor; on
sustained low FPS (avgMs > 33) degrade one step, **8s cooldown**, banner feedback; at
minimum 3D quality offer/switch to 2D from menus. Graphics-mode change **mid-game is
deferred to next round** ("WILL APPLY NEXT ROUND" banner).

2D fallback (`js/game2d.js`): full Canvas-2D game with the same rules, 6 map themes,
obstacle layouts shared via `maps.js` `obstacleLayout()`, VFX (burst/ring/float text),
READY→GO, Game Over + Play Again.

---

## 8. Settings & persistence (`js/store.js`)

localStorage key `snake3d.v1`:
- `settings`: `master/music/sfx` volumes, `muted`, **`cameraMode`** (`follow`|`above`|`elevated`), **`graphicsMode`** (`auto`|`3d`|`2d`).
- `highScores` (per mapId), `stats` (games, apples, totalTime, bestCombo, highScore).

Defaults: `cameraMode: "follow"`, `graphicsMode: "auto"`. Save on every change.

---

## 9. Verification playbook (how this project's changes get proven)

These were the acceptance tests used in this thread's history. Re-run them for camera
changes:

- **Test A — WASD mapping**: start a game (state `ready`, snake stationary), force
  `camera.updateMatrixWorld(true)`, then project `head` and `head + dir` for W/S/A/D;
  W must give `+dy`, S `-dy`, A `-dx`, D `+dx` (NDC).
- **Test B — head in frame**: drive `stage.setPlayFollow({head, dir, length, state})`
  with synthetic head positions at every corner/edge, run ~90 frames of
  `stage.update(1/60, t)`, project the head; NDC must stay within ±0.8 (safe zone).
- **Test C — head size on screen**: project `head` and `head + (0, 0.5, 0)`; the 0.5-cell
  span should be roughly 13–17% of screen height (≈26–34% for the whole head) at
  `dist ≈ 3.8`, FOV 55.
- **Test D — smoothness**: after teleporting the head, the camera must settle without
  overshoot/oscillation; mode switches must glide all params (including `dist`).
- 2D mode: switch `graphicsMode` to `2d`, verify canvas renders, eat-apple logic
  (+10 score, combo), game over screen, Play Again restart.

---

## 10. Deployment (Vercel — CRITICAL)

- Repo is connected to Vercel; **every push to `master` auto-redeploys** `snake3d-taupe.vercel.app`.
- `vercel.json` = `{ "framework": null }` (preset "Other" = static). This is **required**:
  without it Vercel misdetects the project as a Node server (package.json has a `start`
  script) and serves only traced files → broken CSS/JS. Also do **NOT** add
  `cleanUrls: true` for a single-page site.
- `.vercel/` is gitignored (CLI build artifacts). Do not commit it.
- If changes "don't show up" on the live site, first check the deployed JS serves the new
  code (`curl https://snake3d-taupe.vercel.app/js/<file>.js`), then hard-refresh the
  browser (Ctrl+F5) — stale cache has repeatedly caused "nothing changed" reports.
- Temporary anonymous deploys: `npx -y vercel deploy --temporary` (no auth) — expires in
  ~60 min; only for one-off links, not for the production URL.

---

## 11. Git / GitHub quirks in this environment

- **Git identity is NOT set globally.** Every commit needs per-command overrides:
  `git -c user.name="Codebuff" -c user.email="noreply@codebuff.com" commit ...`
- Credential manager is interactive/empty; use the gh credential helper for network ops:
  `git -c credential.helper='!gh auth git-credential' push ...`
- `gh` CLI is authenticated as `shandika1937` (scope `repo`). No CI workflows exist
  (no `.github/`), so PRs have no checks to wait on.
- Commit footer convention used in this repo:
  ```
  🤖 Generated with Codebuff
  Co-Authored-By: Codebuff <noreply@codebuff.com>
  ```
- Branch `master` is the default. Local checkout may contain stale local branches
  (`feat/polish-play-transition`, `feat/volcanic-inferno-world`) — both were merged and
  deleted on the remote; safe to ignore/delete locally.

---

## 12. Recent work (what the last commits did)

- `fb84bc9` (PR #1): Volcanic Inferno world + first camera overhaul (whole-board framing).
- `3141a27` (PR #2): Play button polish, transition overlay, READY→GO flow, spawn animation.
- `6af9044`: `vercel.json` static fix (fixed the broken Node-server misdetection deploy).
- `df13481` (master HEAD, live): **camera POV overhaul** — head-anchored follow, close
  distances (3.4–4.4), 3 modes (follow/above/elevated), aspect-aware look-ahead clamp,
  bounded dynamic zoom, smooth mode gliding incl. distance; **performance detection +
  quality tiers + polished 2D fallback**; snake head/pickup animation polish.

---

## 13. Conventions & gotchas

- **ES modules everywhere** (`import`/`export`); no bundler, no npm scripts beyond
  `node server.js`. `node --check js/<file>.js` is the syntax check.
- `CELL = 1` (one world unit per grid cell). `cellToWorld(gx, gz, cols, rows)` maps grid
  → world with the board centred on the origin.
- Snake head radius ≈ 0.42 cells; head mesh ~1 cell long — use this to reason about
  on-screen size.
- `snake.headSmooth()` returns the interpolated head world position (a fresh THREE.Vector3).
- UI screens are `<div class="screen">` toggled by `ui.showScreen/hideScreens`; the
  game-over screen id is `screen-gameover` (it persists until hidden — a game that is
  left uncontrolled will die and show it; that is expected behaviour, not a bug).
- When the game starts without input, the snake moves straight forward and dies into a
  wall within ~1–2 s — factor this into any screenshot/demo timing.
- Do not add dependencies; everything is procedural. New SFX/VFX should go through
  `audio.js` / `effects.js` (quality-aware).
