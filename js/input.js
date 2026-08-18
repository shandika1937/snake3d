// Single source of truth for directional input.
// Everything (keyboard, touch swipe, virtual D-pad, gamepad) funnels into one
// `onDir(name)` callback where name is "up" | "down" | "left" | "right".
//
// Screen-space is mapped to the world once, here:
//   up    -> -Z (away from camera, top of the screen)
//   down  -> +Z
//   left  -> -X
//   right -> +X
export const DIR_VECTORS = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

const KEY_MAP = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

export class InputSystem {
  constructor() {
    this.onDir = null;
    this.onPause = null;
    this._bound = [];
    this._touch = null;
    this._swipeThreshold = 26;
    this._dpads = new Set();
  }

  attach({ onDir, onPause }) {
    this.onDir = onDir;
    this.onPause = onPause;

    this._bind(window, "keydown", (e) => {
      const dir = KEY_MAP[e.code];
      if (dir) {
        e.preventDefault();
        this.onDir?.(dir);
      } else if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        this.onPause?.();
      }
    });

    // Swipe on the stage.
    const stage = document.getElementById("stage");
    this._bind(stage, "pointerdown", (e) => this._swipeStart(e));
    this._bind(stage, "pointermove", (e) => this._swipeMove(e));
    this._bind(stage, "pointerup", () => (this._touch = null));
    this._bind(stage, "pointercancel", () => (this._touch = null));

    // Virtual D-pad.
    document.querySelectorAll(".dpad-btn").forEach((btn) => {
      const dir = btn.dataset.dir;
      const press = (e) => {
        e.preventDefault();
        btn.classList.add("pressed");
        this.onDir?.(dir);
      };
      const release = () => btn.classList.remove("pressed");
      this._bind(btn, "pointerdown", press);
      this._bind(btn, "pointerup", release);
      this._bind(btn, "pointerleave", release);
      this._bind(btn, "pointercancel", release);
    });
  }

  _bind(target, evt, fn) {
    target.addEventListener(evt, fn, { passive: false });
    this._bound.push([target, evt, fn]);
  }

  _swipeStart(e) {
    this._touch = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  _swipeMove(e) {
    if (!this._touch || e.pointerId !== this._touch.id) return;
    const dx = e.clientX - this._touch.x;
    const dy = e.clientY - this._touch.y;
    if (Math.hypot(dx, dy) < this._swipeThreshold) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up");
    this.onDir?.(dir);
    // Re-arm for continuous swipes without lifting the finger.
    this._touch = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  // Polled each frame (cheap; also handles gamepads).
  pollGamepad() {
    const gp = navigator.getGamepads?.()?.[0];
    if (!gp) return;
    const axis = 0.5;
    const x = gp.axes[0] || 0;
    const y = gp.axes[1] || 0;
    const btn = (i) => gp.buttons[i]?.pressed;
    const dir =
      Math.abs(x) > axis && Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left")
      : Math.abs(y) > axis ? (y > 0 ? "down" : "up")
      : btn(12) ? "up" : btn(13) ? "down" : btn(14) ? "left" : btn(15) ? "right"
      : null;
    if (dir && !this._gpDir) this.onDir?.(dir);
    this._gpDir = dir;
  }
}
