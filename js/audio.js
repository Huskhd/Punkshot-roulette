// Muckshot — every sound is synthesized with the Web Audio API. No audio files.

let ctx = null;
let master = null;
let sfxBus = null;
let ambBus = null;
let noiseBuf = null;
let muted = false;
let ambienceOn = false;
let musicBus = null;
let musicOn = true;
let tense = false;
const MUSIC_VOL = 0.5;

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
  startMusic();
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
    // about half as loud as before: still a punch, no longer a jump scare
    const t = now();
    const ws = ctx.createWaveShaper();
    ws.curve = distCurve(18);
    const g = ctx.createGain();
    g.gain.value = 0.42;
    ws.connect(g).connect(sfxBus);
    noise(t, 1.2, { f0: 7000, f1: 160, gain: 0.8, out: ws });
    noise(t, 0.22, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.25 });
    tone(t, 0.55, { f0: 120, f1: 32, gain: 0.5, type: 'sine' });
    tone(t, 0.3, { f0: 70, f1: 30, gain: 0.35, type: 'triangle' });
    noise(t + 0.08, 1.4, { f0: 900, f1: 120, gain: 0.09 });
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
  powerup() {
    const t = now();
    [392, 494, 587, 784, 988, 1175].forEach((f, i) => tone(t + i * 0.07, 0.12, { type: 'square', f0: f, gain: 0.06 }));
    tone(t + 0.45, 0.4, { type: 'triangle', f0: 1568, f1: 1760, gain: 0.07 });
  },
  saw() {
    const t = now();
    noise(t, 0.09, { type: 'bandpass', f0: 2600 + Math.random() * 600, f1: 1800, q: 4, gain: 0.35, attack: 0.02 });
  },
  clang() {
    const t = now();
    [523, 1310, 2093].forEach((f) => tone(t, 0.5, { type: 'triangle', f0: f, f1: f * 0.98, gain: 0.07 }));
    noise(t, 0.05, { type: 'highpass', f0: 3000, gain: 0.25 });
  },
  hack() {
    const t = now();
    for (let i = 0; i < 8; i++) tone(t + i * 0.05, 0.04, { type: 'square', f0: 400 + Math.random() * 1600, gain: 0.04 });
  },
  trash() {
    const t = now();
    noise(t, 0.25, { type: 'bandpass', f0: 600, f1: 200, q: 1.5, gain: 0.45 });
    tone(t, 0.15, { type: 'square', f0: 180, f1: 90, gain: 0.08 });
  },
  stink() {
    const t = now();
    tone(t, 0.7, { type: 'sawtooth', f0: 90, f1: 60, gain: 0.08 });
    noise(t, 0.8, { f0: 400, f1: 150, gain: 0.25, attack: 0.15 });
  },
  boot() {
    const t = now();
    tone(t, 0.12, { type: 'square', f0: 660, gain: 0.05 });
    tone(t + 0.13, 0.3, { type: 'square', f0: 990, gain: 0.05 });
  },
  blip() { tone(now(), 0.04, { type: 'square', f0: 880, gain: 0.035 }); },
  good() { const t = now(); tone(t, 0.08, { type: 'square', f0: 784, gain: 0.05 }); tone(t + 0.08, 0.12, { type: 'square', f0: 1175, gain: 0.05 }); },
  bad() { const t = now(); tone(t, 0.18, { type: 'square', f0: 220, f1: 150, gain: 0.06 }); },
  tick() { tone(now(), 0.02, { type: 'square', f0: 1400, gain: 0.03 }); },
  pop() {
    const t = now();
    tone(t, 0.12, { type: 'sine', f0: 300, f1: 900, gain: 0.15 });
  },
  squish() { // rubbery squeeze, like a toy being wrung
    const t = now();
    tone(t, 0.32, { type: 'sawtooth', f0: 520, f1: 1300, gain: 0.05, attack: 0.04 });
    tone(t, 0.32, { type: 'sine', f0: 260, f1: 640, gain: 0.12, attack: 0.04 });
    noise(t, 0.22, { type: 'bandpass', f0: 900, f1: 1800, q: 6, gain: 0.18, attack: 0.05 });
  },
  crack() { // metal snapping off
    const t = now();
    noise(t, 0.06, { type: 'highpass', f0: 2500, gain: 0.6 });
    tone(t, 0.09, { type: 'square', f0: 900, f1: 220, gain: 0.14 });
    [1760, 2637].forEach((f) => tone(t + 0.02, 0.35, { type: 'triangle', f0: f, f1: f * 0.97, gain: 0.05 }));
  },
  cloth() { // fabric pulled tight
    const t = now();
    noise(t, 0.16, { type: 'bandpass', f0: 3200, f1: 1800, q: 1.4, gain: 0.22, attack: 0.03 });
  },
  buzz() { // flies around something rotten
    const t = now();
    for (let i = 0; i < 3; i++) tone(t + i * 0.09, 0.5, { type: 'sawtooth', f0: 180 + Math.random() * 60, f1: 210 + Math.random() * 60, gain: 0.025, attack: 0.08 });
  },
  glitch() {
    const t = now();
    for (let i = 0; i < 5; i++) tone(t + i * 0.03, 0.03, { type: 'square', f0: 120 + Math.random() * 3000, gain: 0.03 });
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

// ---------------------------------------------------------------------------
// Background music: a slow, smoky noir-jazz loop for a back-room bar — walking
// upright bass, brushes and ride cymbal, Rhodes chords, and a vibraphone that
// wanders in now and then. Everything is generated and scheduled on the fly,
// with a little randomness so the loop never repeats exactly.
// On your last life a low heartbeat joins the band.

export function setMusic(on) {
  musicOn = !!on;
  if (musicBus) musicBus.gain.setTargetAtTime(musicOn ? MUSIC_VOL : 0, ctx.currentTime, 0.4);
}
export function isMusicOn() { return musicOn; }
export function setMusicTension(on) { tense = !!on; }

const BPM = 74;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// D minor, eight bars: Dm9 · Dm9/C · Bm7b5 · Bb7 · Gm9 · Gm9 · Em7b5 · A7b9
const PROG = [
  { root: 38, tones: [0, 3, 7, 10], voicing: [53, 57, 60, 64] },
  { root: 36, tones: [0, 2, 5, 9], voicing: [53, 57, 60, 64] },
  { root: 35, tones: [0, 3, 6, 10], voicing: [53, 57, 59, 62] },
  { root: 34, tones: [0, 4, 7, 10], voicing: [50, 56, 60, 65] },
  { root: 43, tones: [0, 3, 7, 10], voicing: [53, 57, 58, 62] },
  { root: 43, tones: [0, 3, 7, 10], voicing: [53, 58, 62, 65] },
  { root: 40, tones: [0, 3, 6, 10], voicing: [50, 55, 58, 62] },
  { root: 45, tones: [0, 4, 7, 10], voicing: [55, 58, 61, 64] },
];
const BLUES = [62, 65, 67, 68, 69, 72, 74, 77]; // D minor blues, for the vibes
const M = { next: 0, step: 0, bar: 0, timer: 0, comp: null, vibes: null, beatLen: 60 / BPM };

function startMusic() {
  if (musicBus) return;
  musicBus = ctx.createGain();
  musicBus.gain.value = musicOn ? MUSIC_VOL : 0;
  // small dark room reverb
  const len = Math.floor(ctx.sampleRate * 2.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.35; data[i] = lp * Math.pow(1 - i / len, 3.2); }
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  musicBus.connect(master);
  musicBus.connect(verb).connect(wet).connect(master);
  M.next = ctx.currentTime + 0.3;
  M.timer = setInterval(schedule, 90);
}

function schedule() {
  if (!ctx || !musicBus) return;
  const t0 = ctx.currentTime;
  if (!musicOn || muted || ctx.state !== 'running' || M.next < t0 - 0.2) {
    // paused, or the tab slept: pick up again from "now" instead of bursting
    M.next = t0 + 0.1;
    return;
  }
  const beat = M.beatLen;
  while (M.next < t0 + 0.35) {
    playStep(M.bar, M.step, M.next, beat);
    M.next += (M.step % 2 === 0 ? 0.63 : 0.37) * beat; // swung eighths
    if (++M.step === 8) { M.step = 0; M.bar = (M.bar + 1) % 16; }
  }
}

// one swung eighth note of the band
function playStep(bar, step, t, beat) {
  const ch = PROG[bar % 8];
  const next = PROG[(bar + 1) % 8];
  const second = bar >= 8; // second time around: sparser bass, more vibes
  const onBeat = step % 2 === 0;
  const b = step >> 1;

  // --- bass ---
  if (onBeat && (!second || bar >= 12 || b % 2 === 0)) {
    let m;
    if (b === 0) m = ch.root;
    else if (b === 3 && !(second && bar < 12)) m = next.root + (Math.random() < 0.5 ? 1 : -1);
    else m = ch.root + ch.tones[1 + Math.floor(Math.random() * 3)];
    while (m > 50) m -= 12;
    while (m < 31) m += 12;
    bass(t, mtof(m), second && bar < 12 ? beat * 1.9 : beat * 0.92);
  }

  // --- drums ---
  if ([0, 2, 3, 4, 6, 7].includes(step)) ride(t, onBeat ? 0.022 : 0.013);
  if (step === 2 || step === 6) chick(t);
  if (onBeat) brush(t, beat);
  if ((step === 0 || step === 4) && Math.random() < 0.8) feather(t);
  if (tense && (step === 0 || step === 4)) heart(t);

  // --- Rhodes comping (Charleston: beat 1 and the "and" of 2, or one long chord) ---
  if (step === 0) M.comp = Math.random() < 0.35 ? 'long' : 'charleston';
  if (step === 0) rhodes(t, ch.voicing, M.comp === 'long' ? beat * 3.5 : beat * 0.55);
  if (step === 3 && M.comp === 'charleston' && Math.random() < 0.85) rhodes(t, ch.voicing, beat * 1.1);

  // --- vibes: a short phrase now and then ---
  if (step === 0) {
    M.vibes = null;
    if (Math.random() < (second ? 0.55 : 0.22)) {
      const n = 2 + Math.floor(Math.random() * 3);
      let k = 2 + Math.floor(Math.random() * 4);
      const notes = [];
      for (let i = 0; i < n; i++) { notes.push(BLUES[k]); k = Math.max(0, Math.min(BLUES.length - 1, k + (Math.random() < 0.6 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)))); }
      M.vibes = { start: 1 + Math.floor(Math.random() * 3), notes };
    }
  }
  if (M.vibes) {
    const i = step - M.vibes.start;
    if (i >= 0 && i < M.vibes.notes.length) vibes(t, mtof(M.vibes.notes[i]), i === M.vibes.notes.length - 1 ? beat * 2 : beat * 0.6);
  }
}

function env(g, t, peak, attack, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function bass(t, f, dur) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f * 1.012, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const sub = ctx.createOscillator();
  sub.frequency.value = f;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(260, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.13, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
  const sg = ctx.createGain();
  sg.gain.value = 0.6;
  o.connect(lp);
  sub.connect(sg).connect(lp);
  lp.connect(g).connect(musicBus);
  o.start(t); sub.start(t);
  o.stop(t + dur + 0.2); sub.stop(t + dur + 0.2);
}
function ride(t, gain) {
  noise(t, 0.5, { type: 'bandpass', f0: 7600, f1: 6400, q: 1.6, gain, attack: 0.002, out: musicBus });
  tone(t, 0.35, { type: 'square', f0: 3170, gain: gain * 0.12, attack: 0.002, out: musicBus });
}
function chick(t) { noise(t, 0.05, { type: 'highpass', f0: 6000, gain: 0.02, attack: 0.002, out: musicBus }); }
function brush(t, beat) { noise(t, beat * 0.7, { type: 'bandpass', f0: 2400, f1: 3800, q: 0.8, gain: 0.012, attack: beat * 0.3, out: musicBus }); }
function feather(t) { tone(t, 0.18, { f0: 62, f1: 42, gain: 0.08, out: musicBus }); }
function heart(t) {
  tone(t, 0.14, { f0: 58, f1: 36, gain: 0.3, out: musicBus });
  tone(t + 0.2, 0.16, { f0: 52, f1: 32, gain: 0.22, out: musicBus });
}
function rhodes(t, notes, dur) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  lp.connect(musicBus);
  notes.forEach((m, i) => {
    const tt = t + i * 0.008; // a hint of a rolled chord
    const f = mtof(m);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.4, tt);
    mg.gain.exponentialRampToValueAtTime(f * 0.15, tt + 0.35);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    env(g, tt, 0.028, 0.006, dur + 0.7);
    car.connect(g).connect(lp);
    car.start(tt); mod.start(tt);
    car.stop(tt + dur + 0.8); mod.stop(tt + dur + 0.8);
  });
}
function vibes(t, f, dur) {
  const o = ctx.createOscillator();
  o.frequency.value = f;
  const o2 = ctx.createOscillator();
  o2.frequency.value = f * 4;
  const g2 = ctx.createGain();
  env(g2, t, 0.006, 0.002, 0.25);
  const g = ctx.createGain();
  env(g, t, 0.05, 0.003, dur + 1.2);
  const trem = ctx.createOscillator();
  trem.frequency.value = 5.2;
  const tg = ctx.createGain();
  tg.gain.value = 0.35;
  const amp = ctx.createGain();
  amp.gain.value = 0.65;
  trem.connect(tg).connect(amp.gain);
  o.connect(g).connect(amp).connect(musicBus);
  o2.connect(g2).connect(musicBus);
  [o, o2, trem].forEach((x) => { x.start(t); x.stop(t + dur + 1.3); });
}
