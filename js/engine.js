// Muckshot — game rules.
// Pure logic: no DOM, no rendering, no text. The same code runs in pass-and-play,
// on the online host (the single source of truth), and in the node tests.
//
// Flow: game.start() and game.act(player, action) return a list of events that
// describe what happened (for animation + captions). game.decision says who must
// act next and what kind of choice it is. Problems are returned as short codes
// (see i18n.js) so every client can show them in its own language.

export const MAX_SLOTS = 6;
export const MAX_SHELLS = 10;

// Rarity tiers set how often an item shows up and what it costs in the shop.
export const TIERS = ['common', 'rare', 'epic', 'legendary'];
const TIER = { rare: { weight: 3, price: 4 }, epic: { weight: 2, price: 5 }, legendary: { weight: 1, price: 6 } };
const tiered = (tier, extra) => ({ ...TIER[tier], tier, ...extra });

// weight = how often it shows up; price = shop chips.
export const ITEMS = {
  stethoscope: { weight: 9, price: 2 },
  prybar:      { weight: 8, price: 2 },
  saw:         { weight: 7, price: 3 },
  bandage:     { weight: 8, price: 2 },
  doll:        tiered('epic'),
  mirror:      tiered('rare', { target: 'player' }),
  dice:        { weight: 5, price: 2 },
  glove:       { weight: 5, price: 3, target: 'player' },
  goldglove:   { weight: 3, price: 4, target: 'item' },
  fake:        { weight: 5, price: 2 },
  insurance:   tiered('legendary'),
  double:      { weight: 4, price: 3 },
  switch:      { weight: 4, price: 3 },
  syringe:     { weight: 5, price: 2 },
  cuffs:       { weight: 5, price: 3, target: 'player' },
  rotator:     { weight: 3, price: 2 },
  phone:       { weight: 6, price: 2 },
  medkit:      tiered('epic'),
  hack:        tiered('rare', { target: 'player' }),
  trash:       { weight: 5, price: 3, target: 'item' },
  stinktrash:  tiered('rare'),
  shield:      { weight: 5, price: 3 },
  wings:       tiered('legendary', { target: 'dead' }),
  handheld:    tiered('epic'),
};
for (const def of Object.values(ITEMS)) def.tier = def.tier || 'common';
export const ITEM_IDS = Object.keys(ITEMS);

// Minigames the handheld can launch (see minigames.js for the games themselves).
export const MINIGAME_IDS = ['mash', 'draw', 'gauge', 'fireflies', 'cups', 'lilypads', 'count', 'bobber'];

export const ITEM_MODES = ['progressive', 'draft', 'shop', 'none'];

// Healing items: they stop working on your last life (1 HP).
export const HEALS = ['bandage', 'medkit', 'syringe'];
export const MINIGAME_DMG = 2; // what the bottom half loses to the Pocket Duo

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function freeSlots(pl) { return pl.slots.filter((s) => !s).length; }
export function firstFree(pl) { return pl.slots.findIndex((s) => !s); }

// Why an item can't be used right now (a code), or null if it can.
// Works on the real game and on the snapshot clients receive.
// 'NEED_TARGET' / 'NEED_PICK' mean "fine so far, the UI must ask for more".
export function itemProblem(players, shellsLeft, p, id, target, pick) {
  const me = players[p];
  const others = players.filter((q, i) => i !== p && q.alive);
  if (me.jammed) return 'jammed';
  if (HEALS.includes(id) && me.hp <= 1) return 'lastLife';
  switch (id) {
    case 'stethoscope': case 'prybar': case 'switch': case 'phone':
      if (shellsLeft < 1) return 'gunEmpty';
      break;
    case 'dice': if (shellsLeft < 2) return 'needTwo'; break;
    case 'saw': if (me.saw) return 'sawOn'; break;
    case 'bandage': case 'medkit': if (me.hp >= me.maxHp) return 'fullHp'; break;
    case 'doll': if (me.doll) return 'dollOn'; break;
    case 'fake': if (shellsLeft >= MAX_SHELLS) return 'gunFull'; break;
    case 'insurance': if (me.insured) return 'insured'; break;
    case 'double':
      if (me.double) return 'doubleOn';
      if (shellsLeft < 2) return 'needTwo';
      break;
    case 'rotator': if (others.length < 2) return 'twoLeft'; break;
    case 'glove': case 'goldglove': case 'trash':
      if (!others.some((q) => q.slots.some(Boolean))) return 'nothingToTake';
      break;
    case 'stinktrash': {
      const total = players.reduce((s, q) => s + (q.alive ? q.slots.filter(Boolean).length : 0), 0);
      if (total <= 1) return 'nothingToTake'; // only the trash can itself
      break;
    }
    case 'cuffs': if (!others.some((q) => !q.cuffed)) return 'allCuffed'; break;
    case 'hack': if (!others.some((q) => !q.hacked)) return 'allHacked'; break;
    case 'wings': if (!players.some((q) => !q.alive)) return 'noDead'; break;
    case 'handheld': if (pick == null || !MINIGAME_IDS.includes(pick)) return 'NEED_PICK'; break;
  }
  const def = ITEMS[id];
  if (def && def.target === 'dead') {
    if (target == null) return 'NEED_TARGET';
    const t = players[target];
    if (!t || t.alive) return 'badTarget';
  } else if (def && def.target) {
    if (target == null) return 'NEED_TARGET';
    const t = players[target];
    if (!t || !t.alive || target === p) return 'badTarget';
    if (id === 'cuffs' && t.cuffed) return 'alreadyCuffed';
    if (id === 'hack' && t.hacked) return 'alreadyHacked';
    if ((id === 'glove' || id === 'goldglove' || id === 'trash') && !t.slots.some(Boolean)) return 'targetEmpty';
    if (id === 'goldglove' || id === 'trash') {
      if (pick == null) return 'NEED_PICK';
      if (!t.slots[pick]) return 'pickItem';
    }
  }
  return null;
}

export function itemsForRound(round) { return round < 2 ? 0 : Math.min(round, 6); }

export class Game {
  // opts: { players: [{name, char}], hp, itemMode, seed }
  constructor(opts) {
    this.rng = mulberry32((opts.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0);
    this.cfg = { hp: opts.hp || 4, itemMode: opts.itemMode || 'progressive' };
    const hp = this.cfg.hp;
    this.players = opts.players.map((p, i) => this.newPlayer(i, p));
    this.round = 0;
    this.shells = []; // index 0 fires next. {id, live}
    this.shellSeq = 1;
    this.uidSeq = 1;
    this.turn = Math.floor(this.rng() * this.players.length);
    this.dir = 1;
    this.phase = 'init';
    this.decision = null;
    this.tray = [];
    this.ip = null;
    this.knowledge = this.players.map(() => new Map()); // shell id -> live, per player
    this.over = false;
    this.winner = -1;
    this.ev = [];
  }

  newPlayer(i, p) {
    const hp = this.cfg.hp;
    return {
      idx: i, name: p.name, char: p.char ?? i,
      hp, maxHp: hp, alive: true, shield: 0,
      slots: Array(MAX_SLOTS).fill(null),
      cuffed: false, doll: false, saw: false, insured: false, double: false, hacked: false, jammed: false, immune: false,
      chips: 0, place: 0, roundDmg: 0,
      stats: { shots: 0, selfShots: 0, hits: 0, dmgDealt: 0, dmgTaken: 0, itemsUsed: 0, kills: 0, healed: 0 },
    };
  }

  // ---------- helpers ----------
  emit(e) { this.ev.push(e); }
  flush() { const e = this.ev; this.ev = []; return e; }
  rint(a, b) { return a + Math.floor(this.rng() * (b - a + 1)); }
  alive() { return this.players.filter((p) => p.alive); }
  nextAlive(i, dir = this.dir) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (((i + dir * k) % n) + n) % n;
      if (this.players[j].alive) return j;
    }
    return i;
  }
  orderFrom(start) {
    const out = [];
    let i = start;
    if (!this.players[i].alive) i = this.nextAlive(i);
    for (let k = 0; k < this.players.length; k++) {
      if (this.players[i].alive && !out.includes(i)) out.push(i);
      i = this.nextAlive(i);
    }
    return out;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  rollItem() {
    const twoLeft = this.alive().length <= 2;
    const pool = ITEM_IDS.filter((id) => !(twoLeft && id === 'rotator'));
    const total = pool.reduce((s, id) => s + ITEMS[id].weight, 0);
    let r = this.rng() * total;
    for (const id of pool) { r -= ITEMS[id].weight; if (r <= 0) return id; }
    return pool[pool.length - 1];
  }
  newItem(id) { return { uid: this.uidSeq++, id }; }
  liveLeft() { return this.shells.filter((s) => s.live).length; }
  clearKnowledge() { this.knowledge.forEach((k) => k.clear()); }

  snapshot() {
    return {
      round: this.round, dir: this.dir, turn: this.turn, phase: this.phase,
      shellsLeft: this.shells.length, itemMode: this.cfg.itemMode,
      decision: this.decision ? { ...this.decision } : null,
      tray: this.tray.map((t) => ({ ...t })),
      players: this.players.map((p) => ({
        idx: p.idx, name: p.name, char: p.char, hp: p.hp, maxHp: p.maxHp, alive: p.alive, shield: p.shield,
        slots: p.slots.map((s) => (s ? { ...s } : null)),
        cuffed: p.cuffed, doll: p.doll, saw: p.saw, insured: p.insured, double: p.double, hacked: p.hacked, jammed: p.jammed, immune: p.immune,
        chips: p.chips, place: p.place, stats: { ...p.stats },
      })),
      over: this.over, winner: this.winner,
    };
  }

  // ---------- flow ----------
  start() {
    this.ev = [];
    this.emit({ t: 'gameStart', first: this.turn });
    this.startRound();
    return this.flush();
  }

  startRound() {
    this.round++;
    let lo, hi;
    if (this.round === 1) { lo = 2; hi = 4; } else if (this.round === 2) { lo = 3; hi = 6; } else { lo = 4; hi = 8; }
    const total = this.rint(lo, hi);
    const ratio = 0.35 + this.rng() * 0.3;
    const live = Math.max(1, Math.min(total - 1, Math.round(total * ratio)));
    this.shells = [];
    for (let i = 0; i < total; i++) this.shells.push({ id: this.shellSeq++, live: i < live });
    this.shuffle(this.shells);
    this.clearKnowledge();
    this.players.forEach((p) => { p.roundDmg = 0; });
    this.phase = 'load';
    this.emit({ t: 'roundStart', round: this.round, live, blank: total - live, total });
    this.emit({ t: 'load', total });
    this.startItemPhase();
  }

  // Whoever is due to shoot next picks first (so a self-shot blank on the last
  // shell buys you first pick).
  startItemPhase() {
    const n = itemsForRound(this.round);
    const mode = this.cfg.itemMode;
    if (n === 0 || mode === 'none') { this.beginTurns(); return; }
    const order = this.orderFrom(this.turn);
    this.phase = 'items';
    if (mode === 'progressive') {
      this.ip = { mode, order, i: 0, n };
      this.nextProgressive();
    } else if (mode === 'draft') {
      // shared pool with a few spare items, so even the last picker has a choice
      this.tray = [];
      for (let k = 0; k < n * order.length + order.length; k++) this.tray.push(this.newItem(this.rollItem()));
      const picks = {};
      order.forEach((p) => { picks[p] = n; });
      this.ip = { mode, order, cursor: 0, picks, n };
      this.emit({ t: 'tray', mode, player: -1, items: this.tray.map((x) => ({ ...x })), picks: n, order });
      this.nextDraft();
    } else if (mode === 'shop') {
      this.ip = { mode, order, i: 0 };
      this.nextShop();
    } else this.beginTurns();
  }

  endTray(reason) {
    const lost = this.tray.map((t) => t.uid);
    this.emit({ t: 'trayEnd', lost, reason: reason || '' });
    this.tray = [];
  }

  nextProgressive() {
    const ip = this.ip;
    while (ip.i < ip.order.length) {
      const p = ip.order[ip.i];
      const pl = this.players[p];
      this.tray = [];
      for (let k = 0; k < ip.n; k++) this.tray.push(this.newItem(this.rollItem()));
      this.emit({ t: 'tray', mode: 'progressive', player: p, items: this.tray.map((x) => ({ ...x })), order: ip.i === 0 ? ip.order : undefined });
      if (!pl.alive || freeSlots(pl) === 0) { this.endTray('full'); ip.i++; continue; }
      this.decision = { kind: 'take', player: p };
      return;
    }
    this.ip = null;
    this.beginTurns();
  }
  progTake(p, uid) {
    const pl = this.players[p];
    const k = this.tray.findIndex((t) => t.uid === uid);
    const it = this.tray.splice(k, 1)[0];
    const slot = firstFree(pl);
    pl.slots[slot] = it;
    this.emit({ t: 'take', player: p, uid: it.uid, id: it.id, slot });
    if (this.tray.length === 0 || freeSlots(pl) === 0) {
      this.endTray(this.tray.length ? 'full' : '');
      this.ip.i++;
      this.nextProgressive();
    }
  }
  progDone() { this.endTray('left'); this.ip.i++; this.nextProgressive(); }

  nextDraft() {
    const ip = this.ip;
    const order = ip.order;
    if (this.tray.length) {
      for (let k = 0; k < order.length; k++) {
        const p = order[(ip.cursor + k) % order.length];
        const pl = this.players[p];
        if (ip.picks[p] > 0 && pl.alive && freeSlots(pl) === 0) ip.picks[p] = 0;
        if (ip.picks[p] > 0 && pl.alive) {
          ip.cursor = (ip.cursor + k) % order.length;
          this.decision = { kind: 'draft', player: p, picksLeft: ip.picks[p] };
          return;
        }
      }
    }
    this.endTray(this.tray.length ? 'leftover' : '');
    this.ip = null;
    this.beginTurns();
  }
  draftTake(p, uid) {
    const pl = this.players[p];
    const k = this.tray.findIndex((t) => t.uid === uid);
    const it = this.tray.splice(k, 1)[0];
    const slot = firstFree(pl);
    pl.slots[slot] = it;
    this.ip.picks[p]--;
    this.emit({ t: 'take', player: p, uid: it.uid, id: it.id, slot });
    this.ip.cursor = (this.ip.order.indexOf(p) + 1) % this.ip.order.length;
    this.nextDraft();
  }

  nextShop() {
    const ip = this.ip;
    while (ip.i < ip.order.length) {
      const p = ip.order[ip.i];
      const pl = this.players[p];
      this.tray = [];
      for (let k = 0; k < 6; k++) {
        const it = this.newItem(this.rollItem());
        it.price = ITEMS[it.id].price;
        this.tray.push(it);
      }
      this.emit({ t: 'tray', mode: 'shop', player: p, items: this.tray.map((x) => ({ ...x })), chips: pl.chips, order: ip.i === 0 ? ip.order : undefined });
      if (!pl.alive || freeSlots(pl) === 0 || !this.tray.some((t) => t.price <= pl.chips)) {
        this.endTray(freeSlots(pl) === 0 ? 'full' : 'broke');
        ip.i++;
        continue;
      }
      this.decision = { kind: 'shop', player: p };
      return;
    }
    this.ip = null;
    this.beginTurns();
  }
  shopBuy(p, uid) {
    const pl = this.players[p];
    const k = this.tray.findIndex((t) => t.uid === uid);
    const it = this.tray.splice(k, 1)[0];
    pl.chips -= it.price;
    const slot = firstFree(pl);
    pl.slots[slot] = { uid: it.uid, id: it.id };
    this.emit({ t: 'buy', player: p, uid: it.uid, id: it.id, slot, price: it.price, chips: pl.chips });
    if (!this.tray.length || freeSlots(pl) === 0 || !this.tray.some((t) => t.price <= pl.chips)) {
      this.endTray('');
      this.ip.i++;
      this.nextShop();
    }
  }
  shopDone() { this.endTray(''); this.ip.i++; this.nextShop(); }

  beginTurns() { this.phase = 'turn'; this.beginTurn(); }

  beginTurn() {
    for (let guard = 0; guard < this.players.length * 2 + 2; guard++) {
      const pl = this.players[this.turn];
      if (!pl.alive) { this.turn = this.nextAlive(this.turn); continue; }
      if (pl.cuffed) {
        pl.cuffed = false;
        this.emit({ t: 'cuffSkip', player: this.turn });
        this.turn = this.nextAlive(this.turn);
        continue;
      }
      break;
    }
    const pl = this.players[this.turn];
    this.emit({ t: 'turn', player: this.turn, shellsLeft: this.shells.length });
    if (pl.hacked) {
      pl.hacked = false;
      pl.jammed = true;
      this.emit({ t: 'jammed', player: this.turn });
    }
    this.decision = { kind: 'turn', player: this.turn };
  }

  // after a shot or item: 'stay' keeps the turn, 'pass' moves it on.
  afterAction(mode) {
    if (this.over) return;
    const cur = this.players[this.turn];
    if (!cur.alive) mode = 'pass';
    if (mode === 'pass') { cur.jammed = false; this.turn = this.nextAlive(this.turn); }
    this.phase = 'turn';
    if (this.shells.length === 0) { this.endRound(); this.startRound(); return; }
    if (mode === 'pass') this.beginTurn();
    else this.decision = { kind: 'turn', player: this.turn };
  }

  endRound() {
    const gains = [];
    this.players.forEach((p) => {
      if (p.alive && this.cfg.itemMode === 'shop') {
        const g = 3 + p.roundDmg;
        p.chips += g;
        gains.push({ player: p.idx, gain: g, chips: p.chips });
      }
    });
    this.emit({ t: 'roundEnd', round: this.round, gains });
    this.decision = null;
  }

  damage(i, amount, by) {
    const pl = this.players[i];
    if (pl.immune) { // admin test mode
      this.emit({ t: 'damage', player: i, amount: 0, blocked: 0, immune: amount, shield: pl.shield, hp: pl.hp, by });
      return;
    }
    let blocked = 0;
    if (pl.shield > 0) { blocked = Math.min(pl.shield, amount); pl.shield -= blocked; amount -= blocked; }
    if (amount > 0) {
      pl.hp -= amount;
      pl.stats.dmgTaken += amount;
      if (by != null && by !== i) {
        const sh = this.players[by];
        sh.stats.dmgDealt += amount;
        sh.roundDmg += amount;
      }
    }
    this.emit({ t: 'damage', player: i, amount, blocked, shield: pl.shield, hp: Math.max(0, pl.hp), by });
    if (pl.hp > 0) return;
    if (pl.insured) {
      pl.insured = false;
      pl.hp = 1;
      this.emit({ t: 'revive', player: i, hp: 1, via: 'insurance' });
      return;
    }
    const w = pl.slots.findIndex((s) => s && s.id === 'wings');
    if (w >= 0) {
      const it = pl.slots[w];
      pl.slots[w] = null;
      pl.hp = Math.ceil(pl.maxHp / 2);
      this.emit({ t: 'revive', player: i, hp: pl.hp, via: 'wings', slot: w, uid: it.uid });
      return;
    }
    pl.hp = 0;
    pl.alive = false;
    pl.cuffed = pl.doll = pl.hacked = pl.jammed = false;
    const aliveCount = this.alive().length;
    pl.place = aliveCount + 1;
    if (by != null && by !== i) this.players[by].stats.kills++;
    this.emit({ t: 'death', player: i, place: pl.place, by });
    if (aliveCount <= 1) {
      const win = this.alive()[0];
      this.over = true;
      this.phase = 'over';
      this.decision = null;
      if (win) { win.place = 1; this.winner = win.idx; }
      const standings = this.players.slice().sort((a, b) => a.place - b.place).map((p) => p.idx);
      this.emit({ t: 'gameOver', winner: this.winner, standings });
    }
  }

  // ---------- actions ----------
  check(p, a) {
    if (this.over) return 'gameOver';
    const d = this.decision;
    if (!d || d.player !== p) return 'notYourMove';
    if (!a || typeof a !== 'object') return 'badAction';
    const pl = this.players[p];
    if (d.kind === 'turn') {
      if (a.type === 'shoot') {
        const t = this.players[a.target];
        return !t || !t.alive ? 'badTarget' : null;
      }
      if (a.type === 'item') {
        const it = pl.slots[a.slot];
        if (!it) return 'noItem';
        return itemProblem(this.players, this.shells.length, p, it.id, a.target, a.pick);
      }
      return 'badAction';
    }
    if (d.kind === 'take' || d.kind === 'draft') {
      if (a.type === 'done' && d.kind === 'take') return null;
      if (a.type !== 'take') return 'badAction';
      if (!this.tray.some((t) => t.uid === a.uid)) return 'gone';
      if (freeSlots(pl) === 0) return 'noRoom';
      return null;
    }
    if (d.kind === 'shop') {
      if (a.type === 'done') return null;
      if (a.type !== 'buy') return 'badAction';
      const it = this.tray.find((t) => t.uid === a.uid);
      if (!it) return 'gone';
      if (it.price > pl.chips) return 'noChips';
      if (freeSlots(pl) === 0) return 'noRoom';
      return null;
    }
    if (d.kind === 'minigame') return a.type === 'scores' && Array.isArray(a.scores) ? null : 'badAction';
    return 'badAction';
  }

  act(p, a) {
    this.ev = [];
    const err = this.check(p, a);
    if (err) return { error: err, events: [] };
    const kind = this.decision.kind;
    if (kind === 'turn') {
      if (a.type === 'shoot') this.doShoot(p, a.target);
      else this.doItem(p, a.slot, a.target, a.pick);
    } else if (kind === 'take') {
      if (a.type === 'take') this.progTake(p, a.uid); else this.progDone(p);
    } else if (kind === 'draft') this.draftTake(p, a.uid);
    else if (kind === 'shop') {
      if (a.type === 'buy') this.shopBuy(p, a.uid); else this.shopDone(p);
    } else if (kind === 'minigame') this.doScores(a.scores);
    return { events: this.flush() };
  }

  doShoot(p, target) {
    const sh = this.players[p];
    const count = sh.double ? Math.min(2, this.shells.length) : 1;
    const usedDouble = sh.double;
    sh.double = false;
    const fired = this.shells.splice(0, count);
    let actual = target;
    let bounced = false, parried = false;
    const tp = this.players[target];
    if (target !== p && tp.doll) {
      tp.doll = false;
      if (sh.doll) { sh.doll = false; parried = true; } // the shooter's own doll cancels the bounce
      else { actual = p; bounced = true; }
    }
    const liveCount = fired.filter((s) => s.live).length;
    const usedSaw = sh.saw;
    sh.saw = false; // the saw only lasts one shot, live or blank
    const dmg = liveCount * (usedSaw ? 2 : 1);
    sh.stats.shots++;
    if (target === p) sh.stats.selfShots++;
    if (dmg > 0 && actual !== p) sh.stats.hits++;
    this.emit({
      t: 'shot', player: p, target, actual, bounced, parried,
      shells: fired.map((s) => s.live), dmg, saw: usedSaw, double: usedDouble, shellsLeft: this.shells.length,
    });
    if (dmg > 0) this.damage(actual, dmg, p);
    if (this.over) return;
    this.afterAction(target === p && liveCount === 0 ? 'stay' : 'pass');
  }

  doItem(p, slot, target, pick) {
    const pl = this.players[p];
    const it = pl.slots[slot];
    pl.slots[slot] = null;
    pl.stats.itemsUsed++;
    const e = { t: 'item', player: p, id: it.id, uid: it.uid, slot };
    const K = this.knowledge[p];
    // no healing on your last life (itemProblem blocks it; this is the safety net)
    const heal = (n) => { const b = pl.hp; if (b <= 1) n = 0; pl.hp = Math.min(pl.maxHp, pl.hp + n); pl.stats.healed += pl.hp - b; e.amount = pl.hp - b; e.hp = pl.hp; };
    switch (it.id) {
      case 'stethoscope': {
        const s = this.shells[0];
        K.set(s.id, s.live);
        e.secret = { for: p, live: s.live };
        break;
      }
      case 'prybar': { const s = this.shells.shift(); e.shell = s.live; e.shellsLeft = this.shells.length; break; }
      case 'saw': pl.saw = true; break;
      case 'doll': pl.doll = true; break;
      case 'insurance': pl.insured = true; break;
      case 'double': pl.double = true; break;
      case 'shield': pl.shield++; e.shield = pl.shield; break;
      case 'bandage': heal(1); break;
      case 'medkit': heal(pl.maxHp); break;
      case 'mirror': {
        const t = this.players[target];
        const mine = pl.slots;
        pl.slots = t.slots;
        t.slots = mine;
        e.target = target;
        e.slotsP = pl.slots.map((s) => (s ? { ...s } : null));
        e.slotsT = t.slots.map((s) => (s ? { ...s } : null));
        break;
      }
      case 'dice': this.shuffle(this.shells); this.clearKnowledge(); break;
      case 'glove': case 'goldglove': {
        const t = this.players[target];
        let from = pick;
        if (it.id === 'glove') {
          const opts = t.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
          from = opts[Math.floor(this.rng() * opts.length)];
        }
        const stolen = t.slots[from];
        t.slots[from] = null;
        const to = firstFree(pl);
        pl.slots[to] = stolen;
        Object.assign(e, { target, stolen: { ...stolen }, from, to });
        break;
      }
      case 'trash': {
        const t = this.players[target];
        const removed = t.slots[pick];
        t.slots[pick] = null;
        Object.assign(e, { target, from: pick, removed: { ...removed } });
        break;
      }
      case 'stinktrash': {
        const pool = [];
        this.players.forEach((q) => {
          if (!q.alive) return;
          q.slots.forEach((s, k) => { if (s) pool.push({ player: q.idx, slot: k, w: q.idx === p ? 0.75 : 1 }); });
        });
        let count = pool.length ? Math.max(1, Math.round(pool.length * 0.25)) : 0;
        const removed = [];
        while (count-- > 0 && pool.length) {
          const total = pool.reduce((s, x) => s + x.w, 0);
          let r = this.rng() * total;
          let k = 0;
          for (; k < pool.length - 1; k++) { r -= pool[k].w; if (r <= 0) break; }
          const x = pool.splice(k, 1)[0];
          const s = this.players[x.player].slots[x.slot];
          this.players[x.player].slots[x.slot] = null;
          removed.push({ player: x.player, slot: x.slot, uid: s.uid, id: s.id });
        }
        e.removed = removed;
        break;
      }
      case 'fake': {
        const pos = Math.floor(this.rng() * (this.shells.length + 1));
        this.shells.splice(pos, 0, { id: this.shellSeq++, live: false });
        this.clearKnowledge();
        e.shellsLeft = this.shells.length;
        break;
      }
      case 'switch': {
        this.shells.forEach((s) => { s.live = !s.live; });
        this.knowledge.forEach((k) => { for (const [id, v] of k) k.set(id, !v); });
        break;
      }
      case 'syringe': {
        e.good = this.rng() < 0.5;
        if (e.good) heal(3);
        break;
      }
      case 'cuffs': this.players[target].cuffed = true; e.target = target; break;
      case 'hack': this.players[target].hacked = true; e.target = target; break;
      case 'rotator': this.dir = -this.dir; e.dir = this.dir; break;
      case 'phone': {
        const i = Math.floor(this.rng() * this.shells.length);
        const s = this.shells[i];
        K.set(s.id, s.live);
        e.secret = { for: p, pos: i + 1, live: s.live, total: this.shells.length };
        break;
      }
      case 'wings': {
        const t = this.players[target];
        t.alive = true;
        t.hp = Math.ceil(t.maxHp / 2);
        t.place = 0;
        Object.assign(e, { target, hp: t.hp });
        break;
      }
      case 'handheld': {
        e.game = pick;
        this.emit(e);
        this.phase = 'minigame';
        this.decision = { kind: 'minigame', player: p, game: pick, seed: this.rint(1, 2 ** 30) };
        return;
      }
    }
    this.emit(e);
    if (it.id === 'syringe' && !e.good) this.damage(p, 1, null);
    if (this.over) return;
    if (!pl.alive) { this.afterAction('pass'); return; }
    if (this.shells.length === 0) { this.afterAction('stay'); return; }
    this.decision = { kind: 'turn', player: p };
  }

  // Handheld minigame results: the bottom half (at least one) loses MINIGAME_DMG HP.
  doScores(scores) {
    const d = this.decision;
    const alive = this.alive().map((q) => q.idx);
    const sc = alive.map((i) => ({ i, s: Number(scores[i]) || 0, r: this.rng() }));
    sc.sort((x, y) => (x.s - y.s) || (x.r - y.r));
    const losers = sc.slice(0, Math.max(1, Math.floor(alive.length / 2))).map((x) => x.i);
    this.emit({ t: 'mgResult', game: d.game, player: d.player, scores: sc.map((x) => ({ player: x.i, score: x.s })).reverse(), losers, dmg: MINIGAME_DMG });
    this.phase = 'turn';
    for (const l of losers) { if (!this.over) this.damage(l, MINIGAME_DMG, null); }
    if (this.over) return;
    if (!this.players[this.turn].alive) { this.afterAction('pass'); return; }
    this.decision = { kind: 'turn', player: this.turn };
  }
}

// ---------- admin / test tools (local games only, see admin.js) ----------
// Each returns the events it caused (possibly none); the caller re-syncs the view.
Object.assign(Game.prototype, {
  adminGive(i, id) {
    const pl = this.players[i];
    const k = firstFree(pl);
    if (!pl || !pl.alive || k < 0 || !ITEMS[id]) return false;
    pl.slots[k] = this.newItem(id);
    return true;
  },
  adminClear(i) { this.players[i].slots.fill(null); },
  adminHeal(i) { const pl = this.players[i]; if (pl.alive && pl.hp < pl.maxHp) pl.hp++; },
  adminShield(i) { const pl = this.players[i]; if (pl.alive) pl.shield++; },
  adminImmune(i, on) { this.players[i].immune = !!on; },
  adminHurt(i) {
    this.ev = [];
    const pl = this.players[i];
    if (this.over || !pl.alive) return [];
    const was = pl.immune;
    pl.immune = false;
    this.damage(i, 1, null);
    pl.immune = was;
    if (!this.over) this.adminUnstick();
    return this.flush();
  },
  // if the player we're waiting on just died, move the game along
  adminUnstick() {
    const d = this.decision;
    if (!d || this.players[d.player].alive) return;
    if (d.kind === 'turn') this.afterAction('pass');
    else if (d.kind === 'take') this.progDone();
    else if (d.kind === 'shop') this.shopDone();
    else if (d.kind === 'draft') { this.ip.picks[d.player] = 0; this.nextDraft(); }
  },
  adminSkip() {
    this.ev = [];
    if (this.over || !this.decision || this.decision.kind !== 'turn') return [];
    this.afterAction('pass');
    return this.flush();
  },
  adminNextShell(live) {
    const s = this.shells[0];
    if (!s) return false;
    s.live = !!live;
    this.knowledge.forEach((k) => k.delete(s.id));
    return true;
  },
  adminReload() {
    this.ev = [];
    if (this.over || !this.decision || this.decision.kind !== 'turn') return [];
    this.shells = [];
    this.tray = [];
    this.ip = null;
    this.endRound();
    this.startRound();
    return this.flush();
  },
  adminAddPlayer(name) {
    const i = this.players.length;
    if (i >= 4) return -1;
    this.players.push(this.newPlayer(i, { name, char: i }));
    this.knowledge.push(new Map());
    return i;
  },
});

// Strip private info (stethoscope / phone results) from events for a viewer.
export function redactEvents(events, viewer) {
  return events.map((e) => {
    if (!e.secret || e.secret.for === viewer) return e;
    const c = { ...e };
    delete c.secret;
    return c;
  });
}
