// Muckshot — the Pocket Duo: a dual-screen handheld that pulls everyone into a
// minigame. This file has the console interface (menu, controls, results) and
// eight prototype minigames. Every game is a solo score attack with the same
// seed for everyone, so online players can play at the same time on their own
// devices and just compare scores. Higher score = better.
//
// Controls: WASD / arrow keys + Space (A) / Esc (B). On touch screens: the
// on-screen D-pad (slide your finger around it), A/B buttons, and dragging on
// the bottom screen.
import { MINIGAME_IDS, mulberry32 } from './engine.js';
import { getLang } from './i18n.js';
import { sfx } from './audio.js';

const TXT = {
  en: {
    mash: ['Paddle Panic', 'Mash A to paddle your canoe. Most strokes in 5 seconds wins.'],
    draw: ['Quick Draw', 'Wait for DRAW!, then press A as fast as you can. Too early and you lose the round. 3 rounds.'],
    gauge: ['Nail It', 'Stop the swinging needle in the green middle with A. 3 tries, each one faster.'],
    fireflies: ['Firefly Jar', 'Move the jar with the D-pad (or drag on the screen) and catch fireflies for 10 seconds.'],
    cups: ['Shell Game', 'Watch the cup with the shell under it. Pick it with left/right and A. 3 rounds.'],
    lilypads: ['Lily Pad Hop', 'Watch where the frog hops, then repeat it with the D-pad. It gets longer every time.'],
    count: ['Count the Live Ones', 'Shells flash by. Count the RED ones, then set the number with up/down and press A.'],
    bobber: ['Steady Bobber', 'The wind pushes the bobber around. Keep it in the green zone with left/right for 8 seconds.'],
  },
  es: {
    mash: ['Remo Loco', 'Aprieta A sin parar para remar la canoa. Gana quien dé más remadas en 5 segundos.'],
    draw: ['Desenfunda', 'Espera el ¡YA! y presiona A lo más rápido que puedas. Si te adelantas pierdes la ronda. 3 rondas.'],
    gauge: ['Clava la Aguja', 'Detén la aguja en el centro verde con A. 3 intentos, cada uno más rápido.'],
    fireflies: ['Frasco de Luciérnagas', 'Mueve el frasco con la cruceta (o arrastra en la pantalla) y atrapa luciérnagas por 10 segundos.'],
    cups: ['¿Dónde Quedó?', 'Sigue el vaso que tapa el cartucho. Elígelo con izquierda/derecha y A. 3 rondas.'],
    lilypads: ['Salto de Nenúfar', 'Mira a dónde salta la rana y repítelo con la cruceta. Cada vez es más largo.'],
    count: ['Cuenta los Reales', 'Pasan cartuchos rápido. Cuenta los ROJOS, elige el número con arriba/abajo y presiona A.'],
    bobber: ['Boya Firme', 'El viento mueve la boya. Mantenla en la zona verde con izquierda/derecha durante 8 segundos.'],
  },
};
const UI = {
  en: { pick: 'PICK A GAME', aPick: 'A: choose   B: cancel', ready: 'Press A when ready', go: 'GO!', score: 'SCORE', you: 'You', wait: 'Waiting for the others...', results: 'RESULTS', loses: 'loses 2 HP', tooSoon: 'TOO SOON!', drawGo: 'DRAW!', round: 'Round', tries: 'Try', time: 'TIME', caught: 'CAUGHT', strokes: 'STROKES', howMany: 'How many red?', watch: 'Watch...', yourTurn: 'Your turn!', miss: 'Miss!', hit: 'Got it!', pts: 'pts', plays: 'plays now', aContinue: 'A: continue' },
  es: { pick: 'ELIGE UN JUEGO', aPick: 'A: elegir   B: cancelar', ready: 'Presiona A cuando estés listo', go: '¡YA!', score: 'PUNTOS', you: 'Tú', wait: 'Esperando a los demás...', results: 'RESULTADOS', loses: 'pierde 2 de vida', tooSoon: '¡MUY PRONTO!', drawGo: '¡YA!', round: 'Ronda', tries: 'Intento', time: 'TIEMPO', caught: 'ATRAPADAS', strokes: 'REMADAS', howMany: '¿Cuántos rojos?', watch: 'Observa...', yourTurn: '¡Tu turno!', miss: '¡Fallaste!', hit: '¡Bien!', pts: 'pts', plays: 'juega ahora', aContinue: 'A: continuar' },
};
const u = (k) => UI[getLang()][k];
export function gameName(id) { return (TXT[getLang()][id] || [id])[0]; }
export function gameDesc(id) { return (TXT[getLang()][id] || ['', ''])[1]; }

// ---------- bots ----------
const SKILL = { easy: 0.3, hard: 0.55, xhard: 0.72, pro: 0.85 };
export function botScore(id, level, rng = Math.random) {
  const s = SKILL[level] ?? 0.5;
  const n = () => (rng() + rng() + rng()) / 3 - 0.5; // -0.5..0.5, bell-ish
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  switch (id) {
    case 'mash': return Math.round(18 + s * 22 + n() * 10);
    case 'draw': {
      let sum = 0;
      for (let r = 0; r < 3; r++) {
        if (rng() < 0.12 * (1 - s)) continue; // jumped the gun
        sum += Math.round(clamp(1000 - (190 + (1 - s) * 260 + n() * 120), 0, 1000));
      }
      return sum;
    }
    case 'gauge': { let sum = 0; for (let r = 0; r < 3; r++) sum += Math.round(clamp(s * 95 + n() * 40 - r * 6, 0, 100)); return sum; }
    case 'fireflies': return Math.max(0, Math.round(3 + s * 10 + n() * 4));
    case 'cups': { let sum = 0; for (let r = 0; r < 3; r++) if (rng() < 0.34 + s * 0.6) sum += 100; return sum; }
    case 'lilypads': return clamp(Math.round(2 + s * 8 + n() * 3), 1, 12);
    case 'count': return rng() < s ? 100 : rng() < 0.6 ? 65 : 30;
    case 'bobber': return Math.round(clamp(30 + s * 60 + n() * 16, 0, 100));
  }
  return Math.round(rng() * 100);
}

// ---------- pixel icons (24x24 grid, drawn big and crisp) ----------
const ICONS = {
  mash: [['#2a5a6a', 0, 14, 24, 10], ['#5aa0b0', 2, 17, 6, 1], ['#5aa0b0', 14, 21, 7, 1], ['#5a3518', 2, 11, 2, 2], ['#5a3518', 20, 11, 2, 2], ['#7a4a22', 3, 12, 18, 3], ['#7a4a22', 5, 15, 14, 1],
    ['#6e8f37', 8, 7, 7, 5], ['#e8e0a0', 8, 5, 3, 3], ['#e8e0a0', 12, 5, 3, 3], ['#000', 9, 6, 1, 1], ['#000', 13, 6, 1, 1], ['#c9a13a', 17, 3, 1, 10], ['#c9a13a', 16, 12, 3, 3], ['#ffe08a', 21, 2, 1, 4], ['#ffe08a', 21, 7, 1, 1]],
  draw: [['#d9cfa8', 7, 5, 10, 15], ['#d9cfa8', 5, 7, 14, 11], ['#20251c', 7, 7, 10, 11], ['#b0452a', 10, 2, 4, 2], ['#d9cfa8', 11, 4, 2, 1], ['#ffe08a', 11, 9, 2, 5], ['#ffe08a', 13, 12, 3, 2], ['#d8342a', 20, 4, 2, 8], ['#d8342a', 20, 14, 2, 2]],
  gauge: [['#3b3a2a', 2, 6, 20, 14], ['#b0452a', 4, 12, 3, 2], ['#c9a13a', 6, 9, 3, 2], ['#5ac04a', 10, 7, 4, 2], ['#c9a13a', 15, 9, 3, 2], ['#b0452a', 17, 12, 3, 2], ['#f4f0e6', 14, 10, 1, 2], ['#f4f0e6', 13, 12, 1, 2], ['#f4f0e6', 12, 14, 1, 3], ['#f4f0e6', 10, 16, 4, 2]],
  fireflies: [['#9ad8d0', 6, 7, 12, 15], ['#1a2a24', 7, 8, 10, 13], ['#7a5a3a', 5, 4, 14, 3], ['#ffe86a', 9, 10, 2, 2], ['#ffe86a', 13, 14, 2, 2], ['#ffe86a', 10, 18, 2, 2], ['#ffe86a', 2, 2, 1, 1], ['#ffe86a', 21, 9, 1, 1], ['#ffe86a', 20, 19, 1, 1]],
  cups: [['#b0452a', 1, 7, 6, 9], ['#b0452a', 9, 5, 6, 9], ['#b0452a', 17, 7, 6, 9], ['#7a2a18', 0, 15, 8, 2], ['#7a2a18', 16, 15, 8, 2], ['#7a2a18', 8, 13, 8, 2], ['#b3232b', 11, 16, 2, 4], ['#c9a13a', 11, 20, 2, 1], ['#ffe08a', 10, 1, 4, 1], ['#ffe08a', 13, 2, 1, 1]],
  lilypads: [['#2a5a6a', 0, 0, 24, 24], ['#5a8a2a', 9, 1, 6, 5], ['#5a8a2a', 18, 9, 6, 5], ['#5a8a2a', 9, 18, 6, 5], ['#9ad040', 0, 9, 6, 5], ['#6e8f37', 10, 9, 4, 5], ['#e8e0a0', 10, 8, 1, 2], ['#e8e0a0', 13, 8, 1, 2]],
  count: [['#b3232b', 2, 4, 3, 9], ['#1c1c1f', 7, 4, 3, 9], ['#b3232b', 12, 4, 3, 9], ['#1c1c1f', 17, 4, 3, 9], ['#c9a13a', 2, 13, 3, 2], ['#c9a13a', 7, 13, 3, 2], ['#c9a13a', 12, 13, 3, 2], ['#c9a13a', 17, 13, 3, 2],
    ['#ffe08a', 10, 16, 4, 1], ['#ffe08a', 13, 17, 1, 2], ['#ffe08a', 11, 19, 2, 1], ['#ffe08a', 11, 21, 2, 2]],
  bobber: [['#2a5a6a', 0, 14, 24, 10], ['#cccccc', 12, 0, 1, 4], ['#222222', 12, 4, 1, 2], ['#d8342a', 10, 6, 5, 5], ['#f4f0e6', 10, 11, 5, 4], ['#5aa0b0', 5, 16, 15, 1], ['#5ac04a', 6, 19, 1, 3], ['#5ac04a', 18, 19, 1, 3]],
};
function drawIcon(g, id, x, y, s) {
  g.fillStyle = '#111510';
  g.fillRect(x, y, 24 * s, 24 * s);
  for (const [c, a, b, w, h] of ICONS[id] || []) { g.fillStyle = c; g.fillRect(x + a * s, y + b * s, w * s, h * s); }
}

// ---------- drawing helpers ----------
const FONT = (px) => `${px}px VT323, ui-monospace, monospace`;
function text(g, str, x, y, { size = 28, color = '#f4f0e6', align = 'center', shadow = true } = {}) {
  g.font = FONT(size);
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (shadow) { g.fillStyle = '#000'; g.fillText(str, x + 2, y + 2); }
  g.fillStyle = color;
  g.fillText(str, x, y);
}
function wrap(g, str, x, y, maxW, { size = 24, color = '#d9cfa8', lh = 26 } = {}) {
  g.font = FONT(size);
  const words = String(str).split(' ');
  let line = '';
  const lines = [];
  for (const w of words) {
    const tryL = line ? `${line} ${w}` : w;
    if (g.measureText(tryL).width > maxW && line) { lines.push(line); line = w; } else line = tryL;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => text(g, l, x, y + i * lh, { size, color, shadow: false }));
  return lines.length;
}
function bg(g, W, H, top = '#16201a', bot = '#0b100c') {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bot);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- the minigames ----------
// Each returns { update(dt) -> score|undefined when finished, drawTop(g,W,H), drawBot(g,W,H), press(btn) }
const GAMES = {
  mash(ctx) {
    let tm = 0, count = 0;
    return {
      press(b) { if (b === 'a') { count++; sfx('tick'); } },
      update(dt) { tm += dt; return tm >= 5 ? count : undefined; },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${u('strokes')}: ${count}`, W / 2, H * 0.4, { size: 64, color: '#ffe08a' });
        g.fillStyle = '#3b3a2a'; g.fillRect(56, H * 0.72, W - 112, 18);
        g.fillStyle = '#5ac04a'; g.fillRect(56, H * 0.72, (W - 112) * clamp(1 - tm / 5, 0, 1), 18);
      },
      drawBot(g, W, H) {
        bg(g, W, H, '#2a5a6a', '#18363f');
        const x = 30 + ((count * 9) % (W - 60));
        for (let i = 0; i < 6; i++) { g.fillStyle = '#5aa0b0'; g.fillRect(((i * 97 - tm * 80) % W + W) % W, 80 + i * 45, 40, 3); }
        g.fillStyle = '#7a4a22'; g.fillRect(x - 60, 200, 120, 18); g.fillRect(x - 48, 218, 96, 8);
        g.fillStyle = '#6e8f37'; g.fillRect(x - 18, 170, 36, 30);
        g.fillStyle = '#e8e0a0'; g.fillRect(x - 18, 160, 12, 12); g.fillRect(x + 6, 160, 12, 12);
        g.fillStyle = '#c9a13a'; g.save(); g.translate(x + 30, 190); g.rotate(count % 2 ? 0.6 : -0.6); g.fillRect(-3, -50, 6, 70); g.fillRect(-10, 16, 20, 18); g.restore();
      },
    };
  },
  draw(ctx) {
    const delays = [0, 1, 2].map(() => 1.2 + ctx.rng() * 2.3);
    let r = 0, tm = 0, sum = 0, state = 'wait', msg = '', msgT = 0;
    const results = [];
    return {
      press(b) {
        if (b !== 'a') return;
        if (state === 'wait') { state = 'show'; msg = u('tooSoon'); msgT = 0; results.push(0); sfx('bad'); }
        else if (state === 'go') { const ms = (tm - delays[r]) * 1000; const sc = Math.round(clamp(1000 - ms, 0, 1000)); sum += sc; results.push(sc); state = 'show'; msg = `${Math.round(ms)} ms`; msgT = 0; sfx('good'); }
      },
      update(dt) {
        tm += dt;
        if (state === 'wait' && tm >= delays[r]) { state = 'go'; sfx('blip'); }
        if (state === 'go' && tm - delays[r] > 1.5) { state = 'show'; msg = u('miss'); msgT = 0; results.push(0); sfx('bad'); }
        if (state === 'show') { msgT += dt; if (msgT > 1.1) { r++; tm = 0; state = 'wait'; if (r >= 3) return sum; } }
        return undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${u('round')} ${Math.min(r + 1, 3)}/3`, W / 2, 50, { size: 34 });
        results.forEach((s, i) => text(g, `${i + 1}: ${s}`, W / 2, 110 + i * 40, { size: 30, color: s ? '#ffe08a' : '#d8342a' }));
      },
      drawBot(g, W, H) {
        bg(g, W, H, state === 'go' ? '#5a1a12' : '#16201a', '#0b100c');
        if (state === 'go') text(g, u('drawGo'), W / 2, H / 2, { size: 110, color: '#ffe08a' });
        else if (state === 'show') text(g, msg, W / 2, H / 2, { size: 64, color: msg === u('tooSoon') || msg === u('miss') ? '#d8342a' : '#f4f0e6' });
        else text(g, '...', W / 2, H / 2, { size: 90, color: '#5a6a50' });
      },
    };
  },
  gauge(ctx) {
    const speeds = [2.4, 3.4, 4.6];
    let r = 0, ph = ctx.rng() * 6, state = 'run', showT = 0, last = 0, sum = 0;
    const res = [];
    const pos = () => Math.sin(ph);
    return {
      press(b) {
        if (b !== 'a' || state !== 'run') return;
        last = Math.round(clamp(1 - Math.abs(pos()), 0, 1) * 100);
        sum += last; res.push(last); state = 'show'; showT = 0;
        sfx(last > 80 ? 'good' : 'blip');
      },
      update(dt) {
        if (state === 'run') ph += speeds[r] * dt;
        else { showT += dt; if (showT > 1.0) { r++; state = 'run'; ph = ctx.rng() * 6; if (r >= 3) return sum; } }
        return undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${u('tries')} ${Math.min(r + 1, 3)}/3`, W / 2, 50, { size: 34 });
        res.forEach((s, i) => text(g, `${s} ${u('pts')}`, W / 2, 110 + i * 40, { size: 30, color: '#ffe08a' }));
      },
      drawBot(g, W, H) {
        bg(g, W, H);
        const cx = W / 2, cy = H * 0.82, R = 170;
        for (let a = -80; a <= 80; a += 4) {
          const k = Math.abs(a) / 80;
          g.fillStyle = k < 0.15 ? '#5ac04a' : k < 0.5 ? '#c9a13a' : '#b0452a';
          const rad = ((a - 90) * Math.PI) / 180;
          g.fillRect(cx + Math.cos(rad) * R - 6, cy + Math.sin(rad) * R - 6, 12, 12);
        }
        const ang = ((pos() * 80 - 90) * Math.PI) / 180;
        g.strokeStyle = '#f4f0e6'; g.lineWidth = 8;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * (R - 20), cy + Math.sin(ang) * (R - 20)); g.stroke();
        g.fillStyle = '#f4f0e6'; g.fillRect(cx - 12, cy - 12, 24, 24);
        if (state === 'show') text(g, `${last}`, cx, 60, { size: 60, color: '#ffe08a' });
      },
    };
  },
  fireflies(ctx) {
    const W0 = 512, H0 = 384;
    const flies = [];
    for (let i = 0; i < 26; i++) flies.push({ t0: i * 0.37, x: 40 + ctx.rng() * (W0 - 80), y: 40 + ctx.rng() * (H0 - 80), vx: (ctx.rng() - 0.5) * 140, vy: (ctx.rng() - 0.5) * 140, got: false });
    let tm = 0, caught = 0;
    const jar = { x: W0 / 2, y: H0 / 2 };
    return {
      press() {},
      update(dt) {
        tm += dt;
        const h = ctx.held;
        const sp = 300;
        if (ctx.pointer.down) { jar.x += clamp(ctx.pointer.x - jar.x, -sp * dt * 1.6, sp * dt * 1.6); jar.y += clamp(ctx.pointer.y - jar.y, -sp * dt * 1.6, sp * dt * 1.6); }
        jar.x = clamp(jar.x + ((h.right ? 1 : 0) - (h.left ? 1 : 0)) * sp * dt, 30, W0 - 30);
        jar.y = clamp(jar.y + ((h.down ? 1 : 0) - (h.up ? 1 : 0)) * sp * dt, 30, H0 - 30);
        for (const f of flies) {
          if (f.got || tm < f.t0) continue;
          f.x += f.vx * dt; f.y += f.vy * dt;
          if (f.x < 15 || f.x > W0 - 15) f.vx *= -1;
          if (f.y < 15 || f.y > H0 - 15) f.vy *= -1;
          if (Math.hypot(f.x - jar.x, f.y - jar.y) < 38) { f.got = true; caught++; sfx('good'); }
        }
        return tm >= 10 ? caught : undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${u('caught')}: ${caught}`, W / 2, H * 0.4, { size: 60, color: '#ffe86a' });
        text(g, `${u('time')}: ${Math.max(0, 10 - tm).toFixed(1)}`, W / 2, H * 0.72, { size: 34 });
      },
      drawBot(g, W, H) {
        bg(g, W, H, '#0a120c', '#050805');
        for (const f of flies) {
          if (f.got || tm < f.t0) continue;
          const glow = 0.5 + 0.5 * Math.sin(tm * 8 + f.t0 * 5);
          g.fillStyle = `rgba(255,232,106,${0.25 * glow})`; g.fillRect(f.x - 10, f.y - 10, 20, 20);
          g.fillStyle = '#ffe86a'; g.fillRect(f.x - 4, f.y - 4, 8, 8);
        }
        g.fillStyle = '#9ad8d0'; g.fillRect(jar.x - 28, jar.y - 30, 56, 64);
        g.fillStyle = '#1a2a24'; g.fillRect(jar.x - 22, jar.y - 24, 44, 52);
        g.fillStyle = '#7a5a3a'; g.fillRect(jar.x - 32, jar.y - 40, 64, 12);
        for (let i = 0; i < Math.min(caught, 12); i++) { g.fillStyle = '#ffe86a'; g.fillRect(jar.x - 18 + (i % 4) * 11, jar.y + 16 - Math.floor(i / 4) * 12, 6, 6); }
      },
    };
  },
  cups(ctx) {
    const rounds = [0, 1, 2].map((r) => {
      const start = Math.floor(ctx.rng() * 3);
      const swaps = [];
      for (let k = 0; k < 4 + r * 3; k++) { const a = Math.floor(ctx.rng() * 3); let b = Math.floor(ctx.rng() * 2); if (b >= a) b++; swaps.push([a, b]); }
      return { start, swaps, dur: 0.42 - r * 0.09 };
    });
    let r = 0, state = 'show', tm = 0, sel = 1, score = 0, verdict = '';
    let order = [0, 1, 2]; // order[slot] = cup id
    let ball = rounds[0].start; // cup id
    let swapI = 0;
    const slotOf = (cup) => order.indexOf(cup);
    return {
      press(b) {
        if (state !== 'pick') return;
        if (b === 'left') { sel = Math.max(0, sel - 1); sfx('blip'); }
        if (b === 'right') { sel = Math.min(2, sel + 1); sfx('blip'); }
        if (b === 'a') { const ok = order[sel] === ball; if (ok) score += 100; verdict = ok ? u('hit') : u('miss'); sfx(ok ? 'good' : 'bad'); state = 'reveal'; tm = 0; }
      },
      update(dt) {
        tm += dt;
        const R = rounds[r];
        if (state === 'show' && tm > 1.2) { state = 'shuffle'; tm = 0; swapI = 0; }
        if (state === 'shuffle' && tm > R.dur) {
          const [a, b] = R.swaps[swapI];
          [order[a], order[b]] = [order[b], order[a]];
          sfx('tick');
          tm = 0; swapI++;
          if (swapI >= R.swaps.length) { state = 'pick'; sel = 1; }
        }
        if (state === 'reveal' && tm > 1.3) {
          r++;
          if (r >= 3) return score;
          order = [0, 1, 2]; ball = rounds[r].start; state = 'show'; tm = 0;
        }
        return undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${u('round')} ${Math.min(r + 1, 3)}/3`, W / 2, 50, { size: 34 });
        text(g, `${score} ${u('pts')}`, W / 2, 130, { size: 54, color: '#ffe08a' });
        if (state === 'reveal') text(g, verdict, W / 2, 210, { size: 44, color: verdict === u('hit') ? '#5ac04a' : '#d8342a' });
        else if (state === 'show' || state === 'shuffle') text(g, u('watch'), W / 2, 210, { size: 34 });
      },
      drawBot(g, W, H) {
        bg(g, W, H, '#2d3a26', '#1a2216');
        const R = rounds[r] || rounds[2];
        const xs = [W * 0.2, W * 0.5, W * 0.8];
        const lift = state === 'show' || state === 'reveal';
        const k = state === 'shuffle' ? Math.min(1, tm / R.dur) : 1;
        for (let cup = 0; cup < 3; cup++) {
          let x = xs[slotOf(cup)];
          if (state === 'shuffle' && swapI < R.swaps.length) {
            const [a, b] = R.swaps[swapI];
            const s = slotOf(cup);
            if (s === a) x = xs[a] + (xs[b] - xs[a]) * k;
            if (s === b) x = xs[b] + (xs[a] - xs[b]) * k;
          }
          if (cup === ball && lift) { g.fillStyle = '#b3232b'; g.fillRect(x - 10, 250, 20, 40); g.fillStyle = '#c9a13a'; g.fillRect(x - 11, 290, 22, 10); }
          const y = lift && (state === 'show' || cup === ball || order[sel] === cup) ? 150 : 210;
          g.fillStyle = '#b0452a'; g.fillRect(x - 46, y, 92, 100);
          g.fillStyle = '#7a2a18'; g.fillRect(x - 54, y + 92, 108, 16);
        }
        if (state === 'pick') { const x = xs[sel]; g.fillStyle = '#ffe08a'; g.fillRect(x - 12, 120, 24, 24); g.fillRect(x - 4, 144, 8, 30); }
      },
    };
  },
  lilypads(ctx) {
    const DIRS = ['up', 'right', 'down', 'left'];
    const seq = [];
    for (let i = 0; i < 12; i++) seq.push(DIRS[Math.floor(ctx.rng() * 4)]);
    let len = 1, state = 'show', tm = 0, idx = 0, best = 0, lit = null, flash = 0, fail = false;
    const stepT = () => Math.max(0.28, 0.55 - len * 0.025);
    return {
      press(b) {
        if (state !== 'input' || !DIRS.includes(b)) return;
        lit = b; flash = 0.18;
        if (seq[idx] === b) {
          sfx('blip');
          idx++;
          if (idx >= len) { best = len; sfx('good'); if (len >= 12) { state = 'done'; tm = 0; } else { len++; state = 'pause'; tm = 0; } }
        } else { fail = true; sfx('bad'); state = 'done'; tm = 0; }
      },
      update(dt) {
        tm += dt;
        if (flash > 0) { flash -= dt; if (flash <= 0) lit = null; }
        if (state === 'pause' && tm > 0.7) { state = 'show'; tm = 0; idx = 0; }
        if (state === 'show') {
          const i = Math.floor(tm / stepT());
          if (i >= len) { state = 'input'; idx = 0; lit = null; } else { const nl = seq[i]; const on = (tm % stepT()) < stepT() * 0.7; if (on && lit !== nl) sfx('tick'); lit = on ? nl : null; }
        }
        if (state === 'done' && tm > 1.2) return best;
        return undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${u('score')}: ${best}`, W / 2, 90, { size: 54, color: '#ffe08a' });
        text(g, state === 'show' ? u('watch') : state === 'input' ? u('yourTurn') : fail ? u('miss') : '', W / 2, 190, { size: 40, color: fail ? '#d8342a' : '#f4f0e6' });
      },
      drawBot(g, W, H) {
        bg(g, W, H, '#2a5a6a', '#18363f');
        const pads = { up: [W / 2, 70], right: [W - 110, H / 2], down: [W / 2, H - 70], left: [110, H / 2] };
        for (const d of DIRS) {
          const [x, y] = pads[d];
          g.fillStyle = lit === d ? '#b6ef5a' : '#4f7a26';
          g.fillRect(x - 56, y - 34, 112, 68);
          g.fillStyle = '#2a5a6a'; g.fillRect(x + 20, y - 34, 18, 22);
        }
        const [fx, fy] = lit ? pads[lit] : [W / 2, H / 2];
        g.fillStyle = '#6e8f37'; g.fillRect(fx - 22, fy - 18, 44, 32);
        g.fillStyle = '#e8e0a0'; g.fillRect(fx - 20, fy - 28, 12, 12); g.fillRect(fx + 8, fy - 28, 12, 12);
      },
    };
  },
  count(ctx) {
    const n = 10 + Math.floor(ctx.rng() * 5);
    const shells = [];
    for (let i = 0; i < n; i++) shells.push(ctx.rng() < 0.45);
    const truth = shells.filter(Boolean).length;
    let state = 'flash', tm = 0, guess = Math.round(n / 2), result = 0;
    const stepT = 0.3;
    return {
      press(b) {
        if (state !== 'guess') return;
        if (b === 'up' || b === 'right') { guess = Math.min(n, guess + 1); sfx('blip'); }
        if (b === 'down' || b === 'left') { guess = Math.max(0, guess - 1); sfx('blip'); }
        if (b === 'a') { result = Math.max(0, 100 - 35 * Math.abs(guess - truth)); state = 'reveal'; tm = 0; sfx(result === 100 ? 'good' : 'bad'); }
      },
      update(dt) {
        tm += dt;
        if (state === 'flash' && tm > n * stepT + 0.3) { state = 'guess'; tm = 0; }
        if (state === 'reveal' && tm > 1.6) return result;
        return undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        if (state === 'flash') text(g, u('watch'), W / 2, H / 2, { size: 44 });
        else if (state === 'guess') { text(g, u('howMany'), W / 2, 70, { size: 38 }); text(g, `◀ ${guess} ▶`, W / 2, 170, { size: 80, color: '#ffe08a' }); }
        else { text(g, `${truth}`, W / 2, 110, { size: 80, color: '#d8342a' }); text(g, `${result} ${u('pts')}`, W / 2, 220, { size: 44, color: '#ffe08a' }); }
      },
      drawBot(g, W, H) {
        bg(g, W, H);
        if (state === 'flash') {
          const i = Math.floor(tm / stepT);
          if (i < n && (tm % stepT) < stepT * 0.75) {
            const live = shells[i];
            const x = W / 2 + ((i * 53) % 160) - 80;
            g.fillStyle = live ? '#d8343c' : '#1c1c1f'; g.fillRect(x - 22, 90, 44, 140);
            g.fillStyle = '#c9a13a'; g.fillRect(x - 24, 230, 48, 34);
            if (!live) { g.strokeStyle = '#555'; g.lineWidth = 3; g.strokeRect(x - 22, 90, 44, 140); }
          }
        } else {
          shells.forEach((live, i) => { g.fillStyle = state === 'reveal' ? (live ? '#d8343c' : '#333') : '#222'; g.fillRect(24 + i * ((W - 48) / n), 170, (W - 48) / n - 6, 70); });
        }
      },
    };
  },
  bobber(ctx) {
    const ph = [ctx.rng() * 6, ctx.rng() * 6, ctx.rng() * 6];
    let x = 0, v = 0, tm = 0, inZone = 0;
    return {
      press() {},
      update(dt) {
        tm += dt;
        const wind = Math.sin(tm * 0.9 + ph[0]) * 0.9 + Math.sin(tm * 2.3 + ph[1]) * 0.6 + Math.sin(tm * 4.1 + ph[2]) * 0.35;
        let inp = (ctx.held.right ? 1 : 0) - (ctx.held.left ? 1 : 0);
        if (ctx.pointer.down) inp = ctx.pointer.x > 256 ? 1 : -1;
        v += (wind * 1.1 + inp * 2.4) * dt;
        v *= Math.pow(0.35, dt);
        x = clamp(x + v * dt, -1, 1);
        if (Math.abs(x) <= 0.25) inZone += dt;
        return tm >= 8 ? Math.round((inZone / 8) * 100) : undefined;
      },
      drawTop(g, W, H) {
        bg(g, W, H);
        text(g, `${Math.round((inZone / Math.max(tm, 0.01)) * 100)}%`, W / 2, H * 0.4, { size: 64, color: '#5ac04a' });
        text(g, `${u('time')}: ${Math.max(0, 8 - tm).toFixed(1)}`, W / 2, H * 0.72, { size: 34 });
      },
      drawBot(g, W, H) {
        bg(g, W, H, '#2a5a6a', '#18363f');
        g.fillStyle = 'rgba(90,192,74,0.35)'; g.fillRect(W / 2 - W * 0.4 * 0.25 - 24, 60, W * 0.4 * 0.5 + 48, 260);
        g.fillStyle = '#5ac04a'; g.fillRect(W / 2 - W * 0.4 * 0.25 - 24, 60, 6, 260); g.fillRect(W / 2 + W * 0.4 * 0.25 + 18, 60, 6, 260);
        const bx = W / 2 + x * W * 0.4;
        g.fillStyle = '#5aa0b0'; g.fillRect(bx - 50, 240, 100, 6);
        g.fillStyle = '#d8342a'; g.fillRect(bx - 24, 150, 48, 48);
        g.fillStyle = '#f4f0e6'; g.fillRect(bx - 24, 198, 48, 40);
        g.fillStyle = '#ccc'; g.fillRect(bx - 2, 40, 4, 110);
      },
    };
  },
};

// ---------- the console ----------
export class Duo {
  constructor() {
    const el = document.createElement('div');
    el.id = 'duo';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="duo-body">
        <div class="duo-lid"><canvas class="duo-screen" width="512" height="320"></canvas><div class="duo-brand">POCKET&nbsp;DUO</div></div>
        <div class="duo-hinge"></div>
        <div class="duo-base">
          <div class="duo-dpad" aria-label="D-pad"><span class="u"></span><span class="r"></span><span class="d"></span><span class="l"></span><i></i></div>
          <canvas class="duo-screen bottom" width="512" height="384"></canvas>
          <div class="duo-btns"><button class="duo-b" aria-label="B">B</button><button class="duo-a" aria-label="A">A</button></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    const [top, bot] = el.querySelectorAll('canvas');
    this.top = top.getContext('2d');
    this.bot = bot.getContext('2d');
    this.botCanvas = bot;
    this.held = { up: false, down: false, left: false, right: false };
    this.pointer = { x: 256, y: 192, down: false };
    this.mode = 'off';
    this.raf = 0;
    this.listeners();
  }

  listeners() {
    const keyMap = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'a', enter: 'a', escape: 'b', backspace: 'b' };
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      const k = keyMap[e.key.toLowerCase()];
      if (!k) return;
      e.preventDefault();
      if (this.held[k] !== undefined) { if (!this.held[k]) this.input(k); this.held[k] = true; } else if (!e.repeat) this.input(k);
    }, true);
    window.addEventListener('keyup', (e) => {
      const k = keyMap[e.key.toLowerCase()];
      if (k && this.held[k] !== undefined) this.held[k] = false;
    }, true);
    // D-pad: press and slide your finger around it
    const pad = this.el.querySelector('.duo-dpad');
    let padId = null, padDir = null;
    const padAt = (e) => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.12) return null;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    };
    const setDir = (d) => {
      if (d === padDir) return;
      if (padDir) this.held[padDir] = false;
      padDir = d;
      pad.dataset.dir = d || '';
      if (d) { this.held[d] = true; this.input(d); }
    };
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); padId = e.pointerId; pad.setPointerCapture(e.pointerId); setDir(padAt(e)); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) setDir(padAt(e)); });
    const padUp = (e) => { if (e.pointerId === padId) { padId = null; setDir(null); } };
    pad.addEventListener('pointerup', padUp);
    pad.addEventListener('pointercancel', padUp);
    for (const [sel, b] of [['.duo-a', 'a'], ['.duo-b', 'b']]) {
      const btn = this.el.querySelector(sel);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('on'); this.input(b); });
      const off = () => btn.classList.remove('on');
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
    }
    // bottom screen: drag to move the cursor / jar
    const c = this.botCanvas;
    const at = (e) => { const r = c.getBoundingClientRect(); this.pointer.x = ((e.clientX - r.left) / r.width) * 512; this.pointer.y = ((e.clientY - r.top) / r.height) * 384; };
    c.addEventListener('pointerdown', (e) => { e.preventDefault(); c.setPointerCapture(e.pointerId); this.pointer.down = true; at(e); this.touchMenu(); });
    c.addEventListener('pointermove', (e) => { if (!this.pointer.down) return; at(e); this.touchMenu(); });
    const up = () => { this.pointer.down = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  open() {
    this.el.classList.remove('hidden');
    document.body.classList.add('duo-open');
    sfx('boot');
    if (!this.raf) {
      let last = performance.now();
      const loop = (now) => {
        this.raf = requestAnimationFrame(loop);
        // real elapsed time, so a slow device doesn't get a longer game (capped only for tab switches)
        const dt = Math.min(0.5, Math.max(0, (now - last) / 1000));
        last = now;
        this.tick(dt);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }
  close() {
    this.el.classList.add('hidden');
    document.body.classList.remove('duo-open');
    this.mode = 'off';
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    Object.keys(this.held).forEach((k) => { this.held[k] = false; });
    if (this.resolve) { const r = this.resolve; this.resolve = null; r(null); }
  }
  get isOpen() { return this.mode !== 'off'; }

  // ----- menu: the activator picks a game -----
  choose() {
    this.open();
    this.mode = 'menu';
    this.sel = this.sel || 0;
    return new Promise((res) => { this.resolve = res; });
  }
  menuCell(i) { const col = i % 4, row = Math.floor(i / 4); return { x: 22 + col * 122, y: 30 + row * 176 }; }
  touchMenu() {
    if (this.mode !== 'menu') return;
    for (let i = 0; i < MINIGAME_IDS.length; i++) {
      const { x, y } = this.menuCell(i);
      if (this.pointer.x >= x && this.pointer.x < x + 112 && this.pointer.y >= y && this.pointer.y < y + 150) { if (this.sel !== i) { this.sel = i; sfx('blip'); } }
    }
  }

  // ----- play one game, resolve with the score -----
  play(id, seed, who) {
    this.open();
    this.game = id;
    this.who = who || '';
    this.mode = 'intro';
    this.introT = 0;
    this.seed = seed;
    return new Promise((res) => { this.resolve = res; });
  }
  message(textTop, textBot) { this.open(); this.mode = 'msg'; this.msg = [textTop, textBot || '']; }
  results(rows, id) {
    this.open();
    this.mode = 'results';
    this.rows = rows;
    this.game = id;
    this.resT = 0;
    return new Promise((res) => { this.resolve = res; });
  }
  finish(v) { const r = this.resolve; this.resolve = null; if (r) r(v); }

  input(b) {
    if (this.mode === 'menu') {
      const n = MINIGAME_IDS.length;
      if (b === 'left') this.sel = (this.sel + n - 1) % n;
      if (b === 'right') this.sel = (this.sel + 1) % n;
      if (b === 'up' || b === 'down') this.sel = (this.sel + 4) % n;
      if (b !== 'a' && b !== 'b') sfx('blip');
      if (b === 'a') { sfx('good'); const id = MINIGAME_IDS[this.sel]; this.mode = 'msg'; this.msg = [gameName(id), '']; this.finish(id); }
      if (b === 'b') { sfx('bad'); this.close(); }
      return;
    }
    if (this.mode === 'intro' && b === 'a') { this.startCountdown(); return; }
    if (this.mode === 'play' && this.inst) this.inst.press(b);
    if (this.mode === 'results' && b === 'a' && this.resT > 0.6) this.finish(true);
  }
  startCountdown() { this.mode = 'count'; this.countT = 3; sfx('blip'); }

  tick(dt) {
    const g1 = this.top, g2 = this.bot;
    const W1 = 512, H1 = 320, W2 = 512, H2 = 384;
    if (this.mode === 'menu') {
      bg(g1, W1, H1);
      const id = MINIGAME_IDS[this.sel];
      text(g1, gameName(id), W1 / 2, 46, { size: 44, color: '#ffe08a' });
      wrap(g1, gameDesc(id), W1 / 2, 110, W1 - 60, { size: 28, lh: 30 });
      text(g1, u('aPick'), W1 / 2, H1 - 26, { size: 24, color: '#9ad8d0', shadow: false });
      bg(g2, W2, H2, '#1d2a22', '#101712');
      MINIGAME_IDS.forEach((gid, i) => {
        const { x, y } = this.menuCell(i);
        const sel = i === this.sel;
        const bob = sel ? Math.sin(performance.now() / 160) * 3 : 0;
        if (sel) { g2.fillStyle = '#d9b04a'; g2.fillRect(x - 6, y - 6 + bob, 108, 108); }
        drawIcon(g2, gid, x, y + bob, 4);
        g2.font = FONT(20);
        g2.textAlign = 'center';
        g2.fillStyle = sel ? '#ffe08a' : '#9aa590';
        const name = gameName(gid);
        g2.fillText(name.length > 13 ? name.slice(0, 12) + '…' : name, x + 48, y + 124);
      });
      text(g2, u('pick'), W2 / 2, H2 - 14, { size: 22, color: '#5a6a50', shadow: false });
      return;
    }
    if (this.mode === 'intro' || this.mode === 'count') {
      bg(g1, W1, H1);
      text(g1, gameName(this.game), W1 / 2, 46, { size: 44, color: '#ffe08a' });
      wrap(g1, gameDesc(this.game), W1 / 2, 110, W1 - 60, { size: 28, lh: 30 });
      if (this.who) text(g1, `${this.who} — ${u('plays')}`, W1 / 2, H1 - 26, { size: 24, color: '#9ad8d0', shadow: false });
      bg(g2, W2, H2);
      drawIcon(g2, this.game, W2 / 2 - 72, 40, 6);
      if (this.mode === 'intro') {
        this.introT += dt;
        text(g2, u('ready'), W2 / 2, 250, { size: 30 });
        if (this.introT > 10) this.startCountdown(); // don't let one sleepy player hold up the table
      } else {
        this.countT -= dt;
        const n = Math.ceil(this.countT);
        if (n !== this.lastN) { this.lastN = n; sfx(n > 0 ? 'tick' : 'good'); }
        text(g2, n > 0 ? String(n) : u('go'), W2 / 2, 300, { size: 90, color: '#ffe08a' });
        if (this.countT <= -0.3) {
          this.mode = 'play';
          this.inst = GAMES[this.game]({ rng: mulberry32(this.seed >>> 0), held: this.held, pointer: this.pointer });
        }
      }
      return;
    }
    if (this.mode === 'play' && this.inst) {
      const score = this.inst.update(dt);
      this.inst.drawTop(g1, W1, H1);
      this.inst.drawBot(g2, W2, H2);
      if (score !== undefined) {
        this.inst = null;
        this.mode = 'msg';
        this.msg = [`${u('score')}: ${score}`, ''];
        sfx('good');
        this.finish(score);
      }
      return;
    }
    if (this.mode === 'msg') {
      bg(g1, W1, H1);
      text(g1, this.msg[0], W1 / 2, H1 / 2, { size: 52, color: '#ffe08a' });
      bg(g2, W2, H2);
      text(g2, this.msg[1] || u('wait'), W2 / 2, H2 / 2, { size: 32, color: '#9ad8d0' });
      return;
    }
    if (this.mode === 'results') {
      this.resT += dt;
      bg(g1, W1, H1);
      text(g1, u('results'), W1 / 2, 40, { size: 42, color: '#ffe08a' });
      text(g1, gameName(this.game), W1 / 2, 82, { size: 26, color: '#9ad8d0', shadow: false });
      this.rows.forEach((r, i) => text(g1, `${i + 1}. ${r.name}  ${r.score}`, W1 / 2, 130 + i * 40, { size: 32, color: r.lose ? '#d8342a' : '#f4f0e6' }));
      bg(g2, W2, H2);
      this.rows.filter((r) => r.lose).forEach((r, i) => text(g2, `${r.name} ${u('loses')}`, W2 / 2, 120 + i * 50, { size: 34, color: '#d8342a' }));
      text(g2, u('aContinue'), W2 / 2, H2 - 30, { size: 24, color: '#9ad8d0', shadow: false });
      if (this.resT > 6) this.finish(true);
    }
  }
}
