// Muckshot — computer opponents.
// Bots only read public information (shell counts, items on the table, HP) plus
// what they personally learned (stethoscope / phone). They never peek at the
// shell order.
//
//  easy  — sloppy: forgets what it knows, sometimes blunders.
//  hard  — never blunders, but plays simple rules and ignores tricky items.
//  xhard — makes the best move for *this* turn (info first, heal, max damage),
//          but doesn't plan combos across turns.
//  pro   — best move plus strategy: cuffs before risky shots, switch tricks,
//          denying others' info with dice, item theft, smart target choice.

import { ITEMS, MAX_SHELLS, MINIGAME_IDS, itemProblem, freeSlots } from './engine.js';

export const DIFFICULTIES = ['easy', 'hard', 'xhard', 'pro'];

const BASE_VALUE = {
  stethoscope: 6, saw: 4, cuffs: 5, insurance: 8, goldglove: 5, double: 4, bandage: 4,
  doll: 5, mirror: 3, glove: 3, prybar: 4, phone: 4, switch: 4, syringe: 2, dice: 2, fake: 2, rotator: 1,
  medkit: 6, hack: 4, trash: 4, stinktrash: 2, shield: 5, wings: 7, handheld: 4, adrenaline: 5, joker: 4,
};

export function itemValue(game, p, id) {
  const me = game.players[p];
  let v = BASE_VALUE[id] ?? 2;
  if ((id === 'bandage' || id === 'medkit') && me.hp < me.maxHp) v += 2;
  if (id === 'insurance' && me.hp <= 2) v += 3;
  if (id === 'rotator' && game.alive().length <= 2) v = 0;
  if (id === 'syringe' && me.hp <= 2) v -= 1;
  if (id === 'adrenaline' && me.hp <= 2) v += 2;
  if (id === 'joker') {
    const top = Math.max(...game.alive().map((q) => q.hp));
    v += Math.max(0, top - me.hp) * 1.5;
  }
  return v;
}

function analyze(game, p, forget) {
  const n = game.shells.length;
  const live = game.liveLeft();
  const known = new Map();
  if (!forget) {
    const K = game.knowledge[p];
    game.shells.forEach((s, i) => { if (K.has(s.id)) known.set(i, K.get(s.id)); });
  }
  let kl = 0;
  for (const v of known.values()) if (v) kl++;
  const unkN = n - known.size;
  const unkL = live - kl;
  const pAt = (i) => (known.has(i) ? (known.get(i) ? 1 : 0) : unkN > 0 ? unkL / unkN : 0);
  const p0 = pAt(0);
  return { n, live, blank: n - live, known, pAt, p: p0, certain: p0 === 0 || p0 === 1 };
}

function pickRandom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

export function botAction(game, p, level, rng = Math.random) {
  const d = game.decision;
  if (!d || d.player !== p) return null;
  if (d.kind === 'take' || d.kind === 'draft') return trayPick(game, p, level, rng);
  if (d.kind === 'shop') return shopPick(game, p, level, rng);
  return turnAction(game, p, level, rng);
}

function trayPick(game, p, level, rng) {
  const tray = game.tray;
  if (!tray.length) return { type: 'done' };
  if (level === 'easy') return { type: 'take', uid: pickRandom(tray, rng).uid };
  let best = tray[0], bv = -1e9;
  for (const t of tray) {
    const v = itemValue(game, p, t.id) + (level === 'hard' ? rng() * 3 : rng() * 0.5);
    if (v > bv) { bv = v; best = t; }
  }
  return { type: 'take', uid: best.uid };
}

function shopPick(game, p, level, rng) {
  const me = game.players[p];
  const afford = game.tray.filter((t) => t.price <= me.chips);
  if (!afford.length || freeSlots(me) === 0) return { type: 'done' };
  if (level === 'easy') return rng() < 0.15 ? { type: 'done' } : { type: 'buy', uid: pickRandom(afford, rng).uid };
  let best = null, bv = -1e9;
  for (const t of afford) {
    const v = itemValue(game, p, t.id) / Math.sqrt(t.price) + (level === 'hard' ? rng() : rng() * 0.2);
    if (v > bv) { bv = v; best = t; }
  }
  return { type: 'buy', uid: best.uid };
}

function turnAction(game, p, level, rng) {
  const me = game.players[p];
  const players = game.players;
  const opps = players.filter((q) => q.alive && q.idx !== p);
  const n = game.shells.length;
  const can = (id, target, pick) => {
    const s = me.slots.findIndex((x) => x && x.id === id);
    if (s < 0) return -1;
    return itemProblem(players, n, p, id, target, pick) === null ? s : -1;
  };
  const has = (id) => me.slots.some((x) => x && x.id === id);
  const use = (id, target, pick) => {
    const s = can(id, target, pick);
    return s >= 0 ? { type: 'item', slot: s, target, pick } : null;
  };
  const shoot = (t) => ({ type: 'shoot', target: t });
  // with our own doll up, a target's doll can't bounce the shot (it gets parried)
  const noDoll = me.doll ? opps : opps.filter((q) => !q.doll);
  const dmgNow = (me.saw ? 2 : 1);
  const randomGame = () => pickRandom(MINIGAME_IDS, rng);
  const minOppHp = Math.min(...opps.map((q) => q.hp));
  const maxOppHp = Math.max(...opps.map((q) => q.hp));

  const weakest = (list) => {
    const arr = list.slice().sort((a, b) => {
      const ka = a.hp <= dmgNow ? 0 : 1, kb = b.hp <= dmgNow ? 0 : 1;
      if (ka !== kb) return ka - kb;
      if (a.hp !== b.hp) return a.hp - b.hp;
      return countItems(b) - countItems(a);
    });
    return arr[0];
  };
  const threat = (q) => q.hp * 1.0 + countItems(q) * 0.6 + (knowsSomething(game, q.idx) ? 1.5 : 0);
  const proTarget = (list) => {
    const kill = list.filter((q) => q.hp <= dmgNow);
    if (kill.length) return kill.sort((a, b) => threat(b) - threat(a))[0];
    return list.slice().sort((a, b) => (a.hp - b.hp) || (threat(b) - threat(a)))[0];
  };

  // ---------- EASY ----------
  if (level === 'easy') {
    if (rng() < 0.22) {
      const acts = randomItemActions(game, p, rng);
      if (acts.length && rng() < 0.5) return pickRandom(acts, rng);
      const alive = players.filter((q) => q.alive);
      return shoot(pickRandom(alive, rng).idx);
    }
    const A = analyze(game, p, rng() < 0.4);
    if (me.hp < me.maxHp && rng() < 0.6) { const a = use('bandage'); if (a) return a; }
    if (!A.certain && rng() < 0.4) { const a = use('stethoscope'); if (a) return a; }
    if (rng() < 0.25) {
      const acts = randomItemActions(game, p, rng);
      if (acts.length) return pickRandom(acts, rng);
    }
    const tgt = pickRandom(opps, rng).idx;
    if (A.p > 0.5) return shoot(tgt);
    if (A.p < 0.5) return shoot(p);
    return rng() < 0.5 ? shoot(tgt) : shoot(p);
  }

  const A = analyze(game, p, false);
  const targetsOr = (fn) => (noDoll.length ? fn(noDoll) : null);

  // ---------- HARD ----------
  if (level === 'hard') {
    if (me.hp <= me.maxHp - 2) { const a = use('medkit'); if (a) return a; }
    if (me.hp < me.maxHp) { const a = use('bandage'); if (a) return a; }
    if (me.hp <= 2) { const a = use('insurance'); if (a) return a; }
    if (me.hp <= 2) { const a = use('adrenaline'); if (a) return a; }
    if (rng() < 0.5) { const a = use('shield'); if (a) return a; }
    if (me.hp >= 3 && me.hp < me.maxHp && rng() < 0.5) { const a = use('syringe'); if (a) return a; }
    if (rng() < 0.2 && me.hp > minOppHp) { const a = use('handheld', undefined, randomGame()); if (a) return a; }
    if (rng() < 0.25) {
      const t = pickRandom(opps.filter((q) => !q.hacked && !q.jammed && !q.hackSafe && countItems(q) > 0), rng);
      if (t) { const a = use('hack', t.idx); if (a) return a; }
    }
    if (!A.certain && rng() < 0.6) { const a = use('stethoscope'); if (a) return a; }
    if (!A.certain && rng() < 0.3) { const a = use('phone'); if (a) return a; }
    if (rng() < 0.4) { const a = use('doll'); if (a) return a; }
    if (rng() < 0.25) {
      const t = pickRandom(opps.filter((q) => !q.cuffed && !q.cuffSafe), rng);
      if (t) { const a = use('cuffs', t.idx); if (a) return a; }
    }
    if (rng() < 0.35) {
      const withItems = opps.filter((q) => countItems(q) > 0);
      if (withItems.length) {
        const t = pickRandom(withItems, rng);
        const a = use('glove', t.idx); if (a) return a;
        const picks = t.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        const pk = pickRandom(picks, rng);
        const g = use('goldglove', t.idx, pk); if (g) return g;
        const tr = use('trash', t.idx, pk); if (tr) return tr;
      }
    }
    const randT = () => (noDoll.length ? pickRandom(noDoll, rng) : pickRandom(opps, rng)).idx;
    if (A.p === 1) {
      if (rng() < 0.5) { const a = use('saw'); if (a) return a; }
      if (!noDoll.length) { const a = use('prybar'); if (a) return a; }
      return shoot(randT());
    }
    if (A.p === 0) return shoot(p);
    if (A.p >= 0.5) return shoot(randT());
    return shoot(p);
  }

  // ---------- XTRA HARD & PRO (shared core) ----------
  const pro = level === 'pro';

  // Joker: when well behind on HP, or when the others are much better armed.
  {
    const topHp = Math.max(...players.filter((q) => q.alive).map((q) => q.hp));
    const theirs = opps.reduce((s2, q) => s2 + countItems(q), 0);
    const mine = countItems(me) - 1;
    if (topHp - me.hp >= (pro ? 2 : 3) || (pro && theirs >= mine + 4 && topHp > me.hp)) { const a = use('joker'); if (a) return a; }
  }

  // Item theft / swaps first: more tools for the rest of the turn.
  {
    const steal = bestSteal(game, p, A);
    if (steal) {
      const a = use('goldglove', steal.target, steal.slot);
      if (a && steal.value >= 4) return a;
    }
    const rich = opps.filter((q) => countItems(q) > 0).sort((a, b) => avgValue(game, p, b) - avgValue(game, p, a))[0];
    if (rich && (pro || countItems(rich) >= 2)) { const a = use('glove', rich.idx); if (a) return a; }
    const mineVal = me.slots.reduce((s, x) => s + (x && x.id !== 'mirror' ? itemValue(game, p, x.id) : 0), 0);
    const mirrorT = opps.map((q) => ({ q, v: q.slots.reduce((s, x) => s + (x ? itemValue(game, p, x.id) : 0), 0) }))
      .sort((a, b) => b.v - a.v)[0];
    if (mirrorT && mirrorT.v > mineVal + (pro ? 3 : 5)) { const a = use('mirror', mirrorT.q.idx); if (a) return a; }
    if (steal && steal.value >= 5) { const a = use('trash', steal.target, steal.slot); if (a) return a; }
    const oppItems = opps.reduce((s2, q) => s2 + countItems(q), 0);
    if (oppItems >= 3 && oppItems >= 2 * (countItems(me) - 1)) { const a = use('stinktrash'); if (a) return a; }
    const busy = opps.filter((q) => !q.hacked && !q.jammed && !q.hackSafe && countItems(q) >= 2).sort((a, b) => countItems(b) - countItems(a));
    const hackT = pro ? (busy.find((q) => q.idx === game.nextAlive(p)) || null) : busy[0];
    if (hackT) { const a = use('hack', hackT.idx); if (a) return a; }
  }

  // Survival.
  if (me.hp <= me.maxHp - 2 || me.hp === 1) { const a = use('medkit'); if (a) return a; }
  if (me.hp < me.maxHp) { const a = use('bandage'); if (a) return a; }
  { const a = use('shield'); if (a) return a; }
  // The handheld hurts the bottom half: worth it when we're sturdier than the field.
  if (opps.length && ((pro && minOppHp === 1 && me.hp >= 2) || me.hp > maxOppHp)) { const a = use('handheld', undefined, randomGame()); if (a) return a; }
  if (me.hp <= 2) { const a = use('insurance'); if (a) return a; }
  if (me.hp <= 2 || (pro && A.p >= 0.5 && me.hp <= 3)) { const a = use('adrenaline'); if (a) return a; }
  if ((me.hp >= 3 || (pro && me.insured)) && me.maxHp - me.hp >= (pro ? 3 : 2)) { const a = use('syringe'); if (a) return a; }

  // Pro: wipe out what opponents know before they can use it.
  if (pro && n >= 2 && opps.some((q) => knowsSomething(game, q.idx)) && !A.known.size) {
    const a = use('dice'); if (a) return a;
  }

  // Information.
  if (!A.certain) {
    const a = use('stethoscope'); if (a) return a;
    if (n >= 2 || !pro) { const b = use('phone'); if (b) return b; }
    if (pro && A.p >= 0.4 && A.p <= 0.6) { const c = use('prybar'); if (c) return c; }
  }

  const A2 = A; // knowledge unchanged within this decision
  const pick = pro ? proTarget : weakest;
  const nextP = game.nextAlive(p);

  if (A2.p === 1) {
    if (!noDoll.length) {
      { const d = use('doll'); if (d) return d; } // parry their doll
      if (pro) { const s = use('switch'); if (s) return s; }
      const pr = use('prybar'); if (pr) return pr;
      return shoot(pick(opps).idx);
    }
    { const a = use('saw'); if (a) return a; }
    if (n >= 2 && A2.pAt(1) >= 0.5) { const a = use('double'); if (a) return a; }
    if (pro && n > 1 + (me.double ? 1 : 0) && !players[nextP].cuffed) { const a = use('cuffs', nextP); if (a) return a; }
    return shoot(pick(noDoll).idx);
  }

  if (A2.p === 0) {
    if (pro && n === 1 && noDoll.length) { const s = use('switch'); if (s) return s; }
    return shoot(p);
  }

  // Uncertain shell.
  if (A2.p < 0.5) {
    if (noDoll.length && A2.p <= (pro ? 0.34 : 0.3)) { const s = use('switch'); if (s) return s; }
    if (pro && A2.p > 0.2 && n < MAX_SHELLS && !A2.known.size) { const f = use('fake'); if (f) return f; }
    return shoot(p);
  }

  // p >= 0.5: shoot someone else.
  { const a = use('doll'); if (a) return a; }
  if (!noDoll.length) return shoot(p);
  if (pro && n > 1 && !players[nextP].cuffed) { const a = use('cuffs', nextP); if (a) return a; }
  if (A2.p >= (pro ? 0.66 : 0.6) || (pro && A2.p >= 0.5 && proTarget(noDoll).hp === 2)) { const a = use('saw'); if (a) return a; }
  if (n >= 2 && A2.p >= 0.6 && A2.pAt(1) >= 0.6) { const a = use('double'); if (a) return a; }
  if (pro && opps.length >= 2) {
    const prevP = game.nextAlive(p, -game.dir);
    if (prevP !== nextP && threat(players[nextP]) > threat(players[prevP]) + 1) {
      const a = use('rotator'); if (a) return a;
    }
  }
  return shoot(pick(noDoll).idx);
}

function countItems(q) { return q.slots.filter(Boolean).length; }
function avgValue(game, p, q) {
  const its = q.slots.filter(Boolean);
  if (!its.length) return 0;
  return its.reduce((s, x) => s + itemValue(game, p, x.id), 0) / its.length;
}
function knowsSomething(game, q) {
  const K = game.knowledge[q];
  return game.shells.some((s) => K.has(s.id));
}

function bestSteal(game, p, A) {
  let best = null;
  game.players.forEach((q) => {
    if (!q.alive || q.idx === p) return;
    q.slots.forEach((s, i) => {
      if (!s) return;
      let v = itemValue(game, p, s.id);
      if (s.id === 'stethoscope' && !A.certain) v += 2;
      if (s.id === 'saw' && A.p >= 0.5) v += 1;
      if (!best || v > best.value) best = { target: q.idx, slot: i, value: v };
    });
  });
  return best;
}

// Every item action that is valid right now, with random targets (easy bot).
function randomItemActions(game, p, rng) {
  const me = game.players[p];
  const n = game.shells.length;
  const out = [];
  const opps = game.players.filter((q) => q.alive && q.idx !== p);
  me.slots.forEach((s, slot) => {
    if (!s) return;
    const def = ITEMS[s.id];
    if (!def.target) {
      const pick = s.id === 'handheld' ? pickRandom(MINIGAME_IDS, rng) : undefined;
      if (!itemProblem(game.players, n, p, s.id, undefined, pick)) out.push({ type: 'item', slot, pick });
      return;
    }
    const t = pickRandom(def.target === 'dead' ? game.players.filter((q) => !q.alive) : opps, rng);
    if (!t) return;
    let pick;
    if (def.target === 'item') {
      const picks = t.slots.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      pick = picks.length ? pickRandom(picks, rng) : undefined;
    }
    if (!itemProblem(game.players, n, p, s.id, t.idx, pick)) out.push({ type: 'item', slot, target: t.idx, pick });
  });
  return out;
}
