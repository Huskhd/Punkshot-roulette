// Muckshot — every sound is synthesized with the Web Audio API. No audio files.

let ctx = null;
let master = null;
let sfxBus = null;
let ambBus = null;
let noiseBuf = null;
let muted = false;
let ambienceOn = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.connect(master);
  ambBus = ctx.createGain();
  ambBus.gain.value = 0.5;
  ambBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbience();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}
export function isMuted() { return muted; }

function now() { return ctx.currentTime; }

function noise(t, dur, { type = 'lowpass', f0 = 2000, f1 = f0, q = 0.7, gain = 0.5, attack = 0.002, out = sfxBus } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(t, dur, { type = 'sine', f0 = 440, f1 = f0, gain = 0.3, attack = 0.005, out = sfxBus } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

const S = {
  blast() {
    const t = now();
    const ws = ctx.createWaveShaper();
    ws.curve = distCurve(30);
    const g = ctx.createGain();
    g.gain.value = 0.9;
    ws.connect(g).connect(sfxBus);
    noise(t, 1.4, { f0: 9000, f1: 160, gain: 1.0, out: ws });
    noise(t, 0.25, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.6 });
    tone(t, 0.6, { f0: 120, f1: 32, gain: 1.0, type: 'sine' });
    tone(t, 0.35, { f0: 70, f1: 30, gain: 0.8, type: 'triangle' });
    // room tail
    noise(t + 0.08, 1.6, { f0: 900, f1: 120, gain: 0.18 });
  },
  click() {
    const t = now();
    noise(t, 0.04, { type: 'highpass', f0: 4000, gain: 0.5 });
    tone(t, 0.05, { type: 'square', f0: 1800, f1: 900, gain: 0.12 });
    noise(t + 0.03, 0.08, { type: 'bandpass', f0: 1200, q: 3, gain: 0.25 });
  },
  rack() {
    const t = now();
    noise(t, 0.09, { type: 'bandpass', f0: 1800, f1: 900, q: 2, gain: 0.7 });
    tone(t, 0.06, { type: 'square', f0: 300, f1: 120, gain: 0.15 });
    noise(t + 0.2, 0.1, { type: 'bandpass', f0: 2600, f1: 1400, q: 2, gain: 0.8 });
    tone(t + 0.2, 0.05, { type: 'square', f0: 420, f1: 180, gain: 0.16 });
  },
  shellIn() {
    const t = now();
    noise(t, 0.05, { type: 'bandpass', f0: 3000, q: 4, gain: 0.4 });
    tone(t, 0.12, { type: 'triangle', f0: 2400 + Math.random() * 300, f1: 2000, gain: 0.06 });
  },
  shellDrop() {
    const t = now();
    for (let i = 0; i < 3; i++) {
      const tt = t + i * (0.11 - i * 0.025);
      tone(tt, 0.12, { type: 'triangle', f0: 2100 - i * 150, f1: 1500, gain: 0.12 / (i + 1) });
      noise(tt, 0.03, { type: 'bandpass', f0: 4000, q: 5, gain: 0.15 / (i + 1) });
    }
  },
  pickup() {
    const t = now();
    noise(t, 0.18, { type: 'bandpass', f0: 700, f1: 1400, q: 1, gain: 0.25, attack: 0.04 });
    tone(t + 0.05, 0.08, { type: 'square', f0: 200, f1: 150, gain: 0.05 });
  },
  thud() {
    const t = now();
    tone(t, 0.18, { f0: 140, f1: 60, gain: 0.4 });
    noise(t, 0.06, { f0: 1200, gain: 0.2 });
  },
  item() {
    const t = now();
    noise(t, 0.12, { type: 'bandpass', f0: 1400, f1: 900, q: 2, gain: 0.3 });
    tone(t, 0.1, { type: 'triangle', f0: 600, f1: 500, gain: 0.08 });
  },
  heal() {
    const t = now();
    [523, 659, 784].forEach((f, i) => tone(t + i * 0.09, 0.4, { type: 'triangle', f0: f, gain: 0.12 }));
  },
  hurt() {
    const t = now();
    tone(t, 0.5, { type: 'sawtooth', f0: 110, f1: 45, gain: 0.25 });
    noise(t, 0.3, { f0: 600, f1: 100, gain: 0.3 });
  },
  heartbeat() {
    const t = now();
    tone(t, 0.12, { f0: 70, f1: 40, gain: 0.7 });
    tone(t + 0.22, 0.14, { f0: 60, f1: 35, gain: 0.55 });
  },
  death() {
    const t = now();
    tone(t, 1.6, { type: 'sawtooth', f0: 220, f1: 30, gain: 0.18 });
    tone(t, 1.6, { type: 'sine', f0: 110, f1: 25, gain: 0.3 });
  },
  dice() {
    const t = now();
    for (let i = 0; i < 9; i++) noise(t + i * 0.05 + Math.random() * 0.03, 0.03, { type: 'bandpass', f0: 2500 + Math.random() * 2000, q: 6, gain: 0.35 });
  },
  phone() {
    const t = now();
    for (let i = 0; i < 2; i++) {
      tone(t + i * 0.35, 0.22, { type: 'square', f0: 950, gain: 0.06 });
      tone(t + i * 0.35, 0.22, { type: 'square', f0: 1400, gain: 0.04 });
    }
    // muffled "voice"
    for (let i = 0; i < 6; i++) noise(t + 0.8 + i * 0.13, 0.11, { type: 'bandpass', f0: 600 + Math.random() * 500, q: 8, gain: 0.25 });
  },
  zap() {
    const t = now();
    tone(t, 0.35, { type: 'sawtooth', f0: 80, f1: 1200, gain: 0.12 });
    noise(t, 0.3, { type: 'highpass', f0: 3000, gain: 0.2 });
  },
  shimmer() {
    const t = now();
    [1318, 1568, 1975, 2637].forEach((f, i) => tone(t + i * 0.06, 0.6, { type: 'sine', f0: f, gain: 0.07 }));
  },
  chain() {
    const t = now();
    for (let i = 0; i < 6; i++) tone(t + i * 0.045, 0.08, { type: 'triangle', f0: 2800 + Math.random() * 1200, gain: 0.07 });
    noise(t, 0.25, { type: 'highpass', f0: 5000, gain: 0.1 });
  },
  lock() {
    const t = now();
    noise(t, 0.05, { type: 'bandpass', f0: 2000, q: 3, gain: 0.5 });
    tone(t, 0.06, { type: 'square', f0: 500, f1: 300, gain: 0.12 });
  },
  whoosh() {
    const t = now();
    noise(t, 0.35, { type: 'bandpass', f0: 400, f1: 2400, q: 1.2, gain: 0.25, attack: 0.12 });
  },
  needle() {
    const t = now();
    tone(t, 0.25, { type: 'sine', f0: 3000, f1: 2200, gain: 0.05 });
    noise(t + 0.1, 0.2, { type: 'bandpass', f0: 1200, q: 5, gain: 0.15 });
  },
  paper() {
    const t = now();
    noise(t, 0.25, { type: 'highpass', f0: 2500, gain: 0.25, attack: 0.03 });
    noise(t + 0.18, 0.1, { type: 'bandpass', f0: 800, q: 2, gain: 0.3 });
  },
  sting() {
    const t = now();
    [196, 233, 294].forEach((f) => tone(t, 2.2, { type: 'sawtooth', f0: f, f1: f * 0.98, gain: 0.05, attack: 0.3 }));
    tone(t, 2.2, { f0: 98, gain: 0.15, attack: 0.2 });
  },
  win() {
    const t = now();
    [262, 330, 392, 523].forEach((f, i) => tone(t + i * 0.14, 0.9, { type: 'triangle', f0: f, gain: 0.12 }));
  },
  ui() {
    const t = now();
    tone(t, 0.05, { type: 'square', f0: 900, f1: 700, gain: 0.04 });
  },
  coin() {
    const t = now();
    tone(t, 0.08, { type: 'square', f0: 1200, gain: 0.05 });
    tone(t + 0.07, 0.2, { type: 'square', f0: 1800, gain: 0.05 });
  },
  pop() {
    const t = now();
    tone(t, 0.12, { type: 'sine', f0: 300, f1: 900, gain: 0.15 });
  },
};

export function sfx(name) {
  if (!ctx || muted) return;
  if (ctx.state === 'suspended') ctx.resume();
  const fn = S[name];
  if (fn) { try { fn(); } catch (e) { /* ignore audio glitches */ } }
}

// Swamp night: low wind/water rumble, lamp hum, frogs and crickets.
function startAmbience() {
  if (ambienceOn) return;
  ambienceOn = true;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  const g = ctx.createGain();
  g.gain.value = 0.22;
  src.connect(lp).connect(g).connect(ambBus);
  src.start();
  const hum = ctx.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 60;
  const hf = ctx.createBiquadFilter();
  hf.type = 'lowpass';
  hf.frequency.value = 180;
  const hg = ctx.createGain();
  hg.gain.value = 0.012;
  hum.connect(hf).connect(hg).connect(ambBus);
  hum.start();
  const tick = () => {
    if (!ctx) return;
    const t = now() + 0.05;
    if (Math.random() < 0.55) {
      // frog: a few throaty pulses
      const base = 90 + Math.random() * 60;
      const pulses = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < pulses; i++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(base * 1.4, t + i * 0.09);
        o.frequency.exponentialRampToValueAtTime(base, t + i * 0.09 + 0.07);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 500;
        f.Q.value = 3;
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(0.0001, t + i * 0.09);
        gg.gain.exponentialRampToValueAtTime(0.05, t + i * 0.09 + 0.01);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.08);
        o.connect(f).connect(gg).connect(ambBus);
        o.start(t + i * 0.09);
        o.stop(t + i * 0.09 + 0.1);
      }
    } else {
      // cricket chirps
      const f0 = 4200 + Math.random() * 800;
      for (let i = 0; i < 3; i++) tone(t + i * 0.06, 0.04, { type: 'sine', f0, gain: 0.012, out: ambBus });
    }
    setTimeout(tick, 900 + Math.random() * 2600);
  };
  setTimeout(tick, 1500);
}
