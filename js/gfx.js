// Muckshot — rendering helpers: PS1-style materials, procedural pixel textures,
// and a tiny promise-based animation system.
import * as THREE from '../lib/three.module.min.js';
export { THREE };

// ---------- PS1 vertex snapping ----------
// Every material gets its projected vertices snapped to a coarse grid, which
// gives the wobbly low-precision look of old consoles.
export const snapUniform = { value: new THREE.Vector2(160, 120) };
function ps1(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = snapUniform;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n{ vec4 sp = gl_Position; if (sp.w > 0.0) { sp.xy = floor(sp.xy / sp.w * uSnap + 0.5) / uSnap * sp.w; gl_Position = sp; } }',
    );
  };
  return m;
}

const matCache = new Map();
// Flat-shaded Lambert. Cached when no options are passed (shared materials).
export function lam(color, opts) {
  if (!opts) {
    const k = 'l' + color;
    if (!matCache.has(k)) matCache.set(k, ps1(new THREE.MeshLambertMaterial({ color, flatShading: true })));
    return matCache.get(k);
  }
  return ps1(new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
}
export function basic(color, opts) {
  if (!opts) {
    const k = 'b' + color;
    if (!matCache.has(k)) matCache.set(k, ps1(new THREE.MeshBasicMaterial({ color })));
    return matCache.get(k);
  }
  return ps1(new THREE.MeshBasicMaterial({ color, ...opts }));
}
export const OUTLINE = ps1(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));

// Rarity glow: a soft colored "inverted hull" pushed out along the normals and
// drawn additively behind the item, so only a thin halo shows around its edges.
const glowMats = [];
export function glowMat(color) {
  const k = 'g' + color;
  if (matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = snapUniform;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * 0.0055;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 sp = gl_Position; if (sp.w > 0.0) { sp.xy = floor(sp.xy / sp.w * uSnap + 0.5) / uSnap * sp.w; gl_Position = sp; } }');
  };
  m.userData.base = 0.5;
  matCache.set(k, m);
  glowMats.push(m);
  return m;
}
// slow breathing, called once per frame
export function tickGlow(time) {
  for (const m of glowMats) m.opacity = m.userData.base * (0.75 + 0.25 * Math.sin(time * 2.4));
}

// ---------- procedural textures ----------
export function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}
function shade(hex, f) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) * f));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) * f));
  const b = Math.max(0, Math.min(255, (hex & 255) * f));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function planksTex(base, { w = 64, h = 64, planks = 4, vertical = true, seed = 1, grime = 0x1c2410, repeat = [1, 1] } = {}) {
  const R = rand(seed);
  return canvasTex(w, h, (g) => {
    const pw = (vertical ? w : h) / planks;
    for (let i = 0; i < planks; i++) {
      const f = 0.75 + R() * 0.4;
      g.fillStyle = shade(base, f);
      if (vertical) g.fillRect(i * pw, 0, pw, h); else g.fillRect(0, i * pw, w, pw);
      for (let k = 0; k < 40; k++) {
        g.fillStyle = shade(base, f * (0.7 + R() * 0.5));
        const x = vertical ? i * pw + R() * pw : R() * w;
        const y = vertical ? R() * h : i * pw + R() * pw;
        if (vertical) g.fillRect(x | 0, y | 0, 1, 2 + R() * 8); else g.fillRect(x | 0, y | 0, 2 + R() * 8, 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.6)';
      if (vertical) g.fillRect(i * pw, 0, 1, h); else g.fillRect(0, i * pw, w, 1);
      // nail heads
      g.fillStyle = 'rgba(20,20,20,0.8)';
      if (vertical) { g.fillRect(i * pw + 2, 3, 1, 1); g.fillRect(i * pw + pw - 3, h - 4, 1, 1); }
    }
    // grime / moss blotches
    for (let k = 0; k < 18; k++) {
      g.fillStyle = shade(grime, 0.6 + R() * 0.8).replace('rgb', 'rgba').replace(')', ',0.35)');
      const x = R() * w, y = R() * h, s = 2 + R() * 7;
      g.fillRect(x | 0, y | 0, s | 0, (s * (0.5 + R())) | 0);
    }
  }, repeat);
}
export function noiseTex(base, { w = 32, h = 32, amt = 0.3, seed = 3, repeat = [1, 1], spots = 0, spotColor = 0x000000 } = {}) {
  const R = rand(seed);
  return canvasTex(w, h, (g) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      g.fillStyle = shade(base, 1 - amt / 2 + R() * amt);
      g.fillRect(x, y, 1, 1);
    }
    for (let k = 0; k < spots; k++) {
      g.fillStyle = shade(spotColor, 0.8 + R() * 0.4);
      g.globalAlpha = 0.3 + R() * 0.4;
      const s = 1 + R() * 4;
      g.fillRect((R() * w) | 0, (R() * h) | 0, s | 0, s | 0);
    }
    g.globalAlpha = 1;
  }, repeat);
}
export function tableTopTex() {
  const R = rand(77);
  return canvasTex(96, 96, (g, w, h) => {
    g.fillStyle = '#3a2615';
    g.fillRect(0, 0, w, h);
    for (let r = 2; r < 48; r += 2 + R() * 2) {
      g.strokeStyle = `rgba(${20 + R() * 30},${10 + R() * 15},0,${0.35 + R() * 0.3})`;
      g.beginPath();
      g.arc(48 + R() * 2, 48 + R() * 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let k = 0; k < 260; k++) {
      g.fillStyle = `rgba(${80 + R() * 40},${50 + R() * 25},${20 + R() * 10},0.35)`;
      g.fillRect((R() * w) | 0, (R() * h) | 0, 1, 1 + ((R() * 3) | 0));
    }
    // stains & scratches
    for (let k = 0; k < 7; k++) {
      g.fillStyle = 'rgba(10,6,2,0.35)';
      g.beginPath();
      g.arc(R() * w, R() * h, 3 + R() * 7, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(150,110,70,0.35)';
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      const x = R() * w, y = R() * h;
      g.moveTo(x, y);
      g.lineTo(x + (R() - 0.5) * 20, y + (R() - 0.5) * 20);
      g.stroke();
    }
  });
}

// ---------- animation ----------
export const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
  back: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};
const anims = new Set();
let speed = 1;
export function setSpeed(s) { speed = s; }
export function getSpeed() { return speed; }

export function animate(dur, fn, e = ease.inOut) {
  return new Promise((res) => {
    if (dur <= 0) { fn(1, 1); res(); return; }
    anims.add({ t: 0, dur, fn, e, res });
  });
}
export const wait = (s) => animate(s, () => {}, ease.linear);

export function tickAnims(dt) {
  dt *= speed;
  for (const a of [...anims]) {
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    try { a.fn(a.e(k), k); } catch (err) { console.error(err); }
    if (k >= 1) { anims.delete(a); a.res(); }
  }
}
export function finishAll() { tickAnims(1e6); }

export function moveTo(obj, to, dur, { arc = 0, e = ease.inOut } = {}) {
  const from = obj.position.clone();
  return animate(dur, (k) => {
    obj.position.lerpVectors(from, to, k);
    if (arc) obj.position.y += Math.sin(k * Math.PI) * arc;
  }, e);
}
export function turnTo(obj, q, dur, e = ease.inOut) {
  const q0 = obj.quaternion.clone();
  return animate(dur, (k) => obj.quaternion.slerpQuaternions(q0, q, k), e);
}
export function scaleTo(obj, s, dur, e = ease.inOut) {
  const s0 = obj.scale.clone();
  const s1 = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s;
  return animate(dur, (k) => obj.scale.lerpVectors(s0, s1, k), e);
}
export function quatFromEuler(x, y, z) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
}
export function lookQuat(from, to) {
  const m = new THREE.Matrix4().lookAt(to, from, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
