// Lightweight performance detection.
//
// The goal is to pick a quality tier (or the 2D fallback) from a combination
// of cheap hardware hints and a short synchronous render test — never from a
// single indicator, and never with a heavy benchmark. Weak devices should not
// be forced through a full 3D boot before being redirected to 2D.

import * as THREE from "../vendor/three.module.js";

const QUALITY_SCALES = { high: 1, medium: 0.72, low: 0.5 };

export function qualityScale(quality) {
  return QUALITY_SCALES[quality] ?? 1;
}

// Runs synchronously (~a few dozen ms). Safe to call at module top level.
export function detectPerformance() {
  const info = { webgl: null, gpu: null, mem: null, cores: null, ms: null };

  // --- WebGL support + short render test ---
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (gl) {
      info.webgl = gl.getParameter(gl.VERSION) || "webgl";
      try {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        info.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
      } catch { /* extension read failed — ignore */ }

      // Minimal scene: a few lit meshes, rendered 24 times back to back.
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setSize(64, 64, false);
      renderer.setPixelRatio(1);
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
      cam.position.set(3, 3, 3);
      cam.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.2));
      const dl = new THREE.DirectionalLight(0xffffff, 1.2);
      dl.position.set(4, 6, 2);
      scene.add(dl);
      const mat = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.6 });
      for (let i = 0; i < 14; i++) {
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat);
        mesh.position.set((i % 4 - 1.5) * 1.3, Math.floor(i / 4) * 1.3, (i % 3) * 1.1);
        scene.add(mesh);
      }
      const t0 = performance.now();
      for (let i = 0; i < 24; i++) {
        cam.position.x = 3 + Math.sin(i * 0.3) * 0.4;
        cam.position.z = 3 + Math.cos(i * 0.3) * 0.4;
        cam.lookAt(0, 0, 0);
        renderer.render(scene, cam);
      }
      const elapsed = performance.now() - t0;
      info.ms = elapsed / 24;
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      canvas.remove();
    }
  } catch {
    info.webgl = null;
  }

  // --- Hardware hints (optional APIs; missing values are neutral) ---
  info.mem = navigator.deviceMemory ?? null;         // Chrome/Edge only (GB)
  info.cores = navigator.hardwareConcurrency ?? null;

  // --- Scoring ---
  let score = 0;
  if (info.cores != null) score += info.cores >= 8 ? 3 : info.cores >= 4 ? 2 : info.cores >= 2 ? 1 : 0;
  if (info.mem != null) score += info.mem >= 8 ? 3 : info.mem >= 4 ? 2 : info.mem >= 2 ? 1 : 0;
  if (info.ms != null) score += info.ms < 4 ? 3 : info.ms < 7 ? 2 : info.ms < 12 ? 1 : 0;

  let tier, reason, quality;
  if (!info.webgl) {
    tier = "VERY_LOW";
    quality = "low";
    reason = "WebGL unavailable";
  } else if (info.ms >= 20 && score <= 3) {
    tier = "VERY_LOW";
    quality = "low";
    reason = "Rendering too slow for stable 3D";
  } else if (info.ms < 6 && score >= 7) {
    tier = "HIGH";
    quality = "high";
    reason = "Fast GPU and capable hardware";
  } else if (info.ms < 11) {
    tier = "MEDIUM";
    quality = "medium";
    reason = "Adequate, optimized 3D";
  } else {
    tier = "LOW";
    quality = "low";
    reason = "Limited rendering performance";
  }

  return { tier, quality, reason, info };
}

// Decide the effective graphics mode from the user preference + detection.
//   settings.graphicsMode: "auto" | "3d" | "2d"
export function resolveGraphics(perf, userChoice = "auto") {
  if (userChoice === "2d") return { mode: "2d", quality: "low" };
  if (userChoice === "3d") return { mode: "3d", quality: perf.quality };
  // auto
  if (perf.tier === "VERY_LOW") return { mode: "2d", quality: "low" };
  return { mode: "3d", quality: perf.quality };
}

// Rolling frame-time monitor used for dynamic quality fallback.
// `sample(dt)` returns { avgMs } every `every` frames, otherwise null.
export class FpsMonitor {
  constructor({ window = 300, every = 300 } = {}) {
    this.window = window;
    this.every = every;
    this.frames = [];
    this.count = 0;
  }

  sample(dt) {
    this.frames.push(dt * 1000);
    if (this.frames.length > this.window) this.frames.shift();
    this.count++;
    if (this.count < this.every) return null;
    this.count = 0;
    const sum = this.frames.reduce((a, b) => a + b, 0);
    return { avgMs: sum / this.frames.length };
  }
}
