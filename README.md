# Snake 3D — Modern Arcade

A polished, cross-device 3D Snake game built with Three.js. No build step, no external
assets — everything (models, textures, SFX, music) is generated procedurally in code.

## Run

```bash
npm install     # only needed to vendor three.js (already vendored in vendor/)
npm start       # or: node server.js
```

Open http://127.0.0.1:4780 in any modern browser. Works on desktop and mobile
(keyboard / swipe / virtual D-pad / gamepad).

## Controls

| Action | Keyboard |
| ------ | -------- |
| Up / forward    | `W` or `↑` |
| Down / backward | `S` or `↓` |
| Left            | `A` or `←` |
| Right           | `D` or `→` |
| Pause           | `Esc` / `P` |

On touch devices: swipe on the arena or use the on-screen D-pad.

## Features

- Hand-built cartoon snake: rounded head, eyes, forked tongue, smooth tapered body that follows the head
- Five distinct worlds: Classic Garden, Desert Canyon, Mystic Night Forest, Neon Cyber City, Frozen Ice Kingdom
- Live 3D map previews with real thumbnails
- Power-ups: Golden Apple, Shield, Speed Boost, Slow Time, Magnet
- Combo multipliers, progressive difficulty, theme obstacles
- Procedural SFX and generative map-specific music with volume controls
- Particles, shockwaves, screen shake, floating score text
- Persistent high scores and lifetime statistics

## Structure

```
index.html        UI shell + vector icons
css/style.css     modern responsive UI
js/main.js        app wiring + render loop
js/game.js        game state, scoring, combo, power-ups, difficulty
js/snake.js       3D snake character
js/maps.js        five themed map builders
js/pickups.js     apple + power-up models
js/effects.js     particles / shockwaves / floating text
js/audio.js       procedural Web Audio SFX + music
js/input.js       unified input (keyboard/touch/d-pad/gamepad)
js/three-setup.js renderer, camera, helpers
js/store.js       localStorage persistence
vendor/three.module.js
```
