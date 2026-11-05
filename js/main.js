// Muckshot — app flow: title, setup, sessions (local, online host, online client).
import { TableView } from './table.js';
import { UI } from './ui.js';
import { Game, ITEM_IDS, redactEvents } from './engine.js';
import { botAction, DIFFICULTIES } from './bot.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';
import { setSpeed, getSpeed, wait } from './gfx.js';
import { HostNet, ClientNet, cleanCode } from './net.js';
import { CHARACTERS } from './models.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('muckshot.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('muckshot.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

const ui = new UI();
const canvas = $('gl');
const view = new TableView(canvas, ui);
ui.thumbs = view.makeThumbs(ITEM_IDS);
ui.buildHelp();
view.setupDemo();

const app = { session: null, wins: {}, online: null, localSetup: null };
window.__muckshot = { app, view, ui, setSpeed, startLocal: (s) => startLocal(s) }; // handy for debugging in the console

// ---------- settings ----------
function myName() {
  const n = ($('in-name').value || '').trim().slice(0, 14);
  return n || 'Stranger';
}
$('in-name').value = store.get('name', '');
$('in-name-online').value = $('in-name').value;
for (const [a, b] of [['in-name', 'in-name-online'], ['in-name-online', 'in-name']]) {
  $(a).addEventListener('input', () => { $(b).value = $(a).value; });
  $(a).addEventListener('change', () => store.set('name', $(a).value.trim()));
}
setMuted(store.get('muted', false));
setSpeed(store.get('speed', 1));
view.setRetro(store.get('retro', true));
function refreshToggles() {
  const s = isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
  $('btn-sound-t').textContent = s;
  $('btn-sound-m').textContent = s;
  const p = view.retro ? 'PIXELS: RETRO' : 'PIXELS: SHARP';
  $('btn-pixels-t').textContent = p;
  $('btn-pixels-m').textContent = p;
  $('btn-speed').textContent = `SPEED: ${getSpeed()}x`;
}
refreshToggles();
const toggleSound = () => { setMuted(!isMuted()); store.set('muted', isMuted()); refreshToggles(); sfx('ui'); };
const togglePixels = () => { view.setRetro(!view.retro); store.set('retro', view.retro); refreshToggles(); };
$('btn-sound-t').onclick = toggleSound;
$('btn-sound-m').onclick = toggleSound;
$('btn-pixels-t').onclick = togglePixels;
$('btn-pixels-m').onclick = togglePixels;
$('btn-speed').onclick = () => {
  const order = [1, 1.5, 2];
  const s = order[(order.indexOf(getSpeed()) + 1) % order.length];
  setSpeed(s);
  store.set('speed', s);
  refreshToggles();
};

// Audio can only start after a user gesture.
document.addEventListener('pointerdown', () => initAudio(), { capture: true });
document.addEventListener('keydown', () => initAudio(), { capture: true });
document.addEventListener('click', (e) => { if (e.target.closest('button')) sfx('ui'); }, { capture: true });

// ---------- 3D picking ----------
let downAt = null;
let hoverT = 0;
const curSnap = () => (ui.req ? ui.req.snap : view.vs);
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12) return;
  downAt = null;
  if (!app.session) return;
  ui.onPick(view.pickAt(e.clientX, e.clientY), curSnap());
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !app.session) return;
  const now = performance.now();
  if (now - hoverT < 60) return;
  hoverT = now;
  const pick = view.pickAt(e.clientX, e.clientY);
  ui.tooltip(pick, e.clientX, e.clientY, curSnap());
  canvas.style.cursor = pick && (pick.kind !== 'player' || ui.req) ? 'pointer' : 'default';
});
canvas.addEventListener('pointerleave', () => ui.hideTooltip());

// ---------- sessions ----------
function uniqueNames(list) {
  const seen = {};
  return list.map((n) => {
    let name = (n || 'Player').trim().slice(0, 14) || 'Player';
    const base = name;
    let k = 2;
    while (seen[name.toLowerCase()]) name = `${base.slice(0, 12)}${k++}`;
    seen[name.toLowerCase()] = true;
    return name;
  });
}

class LocalSession {
  // setup: { players: [{name, ctrl:'human'|'bot', level}], hp, itemMode }
  constructor(setup) { this.setup = setup; this.stopped = false; }
  stop() { this.stopped = true; ui.cancelRequest(); }
  present(events) { return view.play(redactEvents(events, this.viewer), this.game.snapshot()); }
  async run() {
    const S = this.setup;
    const players = S.players.map((p, i) => ({ name: p.name, char: i }));
    const game = new Game({ players, hp: S.hp, itemMode: S.itemMode });
    this.game = game;
    const humans = S.players.map((p, i) => (p.ctrl === 'human' ? i : -1)).filter((i) => i >= 0);
    this.viewer = humans.length ? humans[0] : 0;
    view.setup(players, this.viewer, game.snapshot());
    ui.hideScreens();
    ui.showHud(true);
    await this.present(game.start());
    let lastTurnHuman = this.viewer;
    let streak = 0;
    while (!game.over && !this.stopped) {
      const d = game.decision;
      const sp = S.players[d.player];
      let action = null;
      if (sp.ctrl === 'bot') {
        await wait(d.kind === 'turn' ? 0.8 : 0.35);
        if (this.stopped) return;
        action = botAction(game, d.player, sp.level);
        if (d.kind === 'turn' && action && action.type === 'item') { if (++streak > 10) action = { type: 'shoot', target: d.player }; } else streak = 0;
      } else {
        if (d.kind === 'turn' && humans.length > 1 && d.player !== lastTurnHuman) {
          await ui.passScreen(sp.name);
          lastTurnHuman = d.player;
        }
        if (this.stopped) return;
        if (d.kind === 'turn' && this.viewer !== d.player) {
          this.viewer = d.player;
          await view.setViewer(d.player);
          view.sync(game.snapshot());
        }
        action = await ui.requestAction(game.snapshot(), d.player, humans.length > 1 ? sp.name : null);
        if (!action) { if (this.stopped) return; continue; }
      }
      const r = game.act(d.player, action);
      if (r.error) {
        if (sp.ctrl === 'human') { ui.say(r.error, 2.5); continue; }
        const fb = game.act(d.player, d.kind === 'turn' ? { type: 'shoot', target: d.player } : { type: 'done' });
        if (!fb.error) await this.present(fb.events);
        continue;
      }
      await this.present(r.events);
    }
    if (this.stopped) return;
    finishGame(game.snapshot(), true, '');
  }
}

function finishGame(snap, canRematch, hint) {
  const standings = snap.players.slice().sort((a, b) => a.place - b.place).map((p) => p.idx);
  const w = snap.players[standings[0]];
  app.wins[w.name] = (app.wins[w.name] || 0) + 1;
  ui.showHud(false);
  ui.scoreboard({ players: snap.players, standings, wins: app.wins, canRematch, hint });
}

async function startLocal(setup) {
  stopSession();
  app.localSetup = setup;
  app.session = new LocalSession(setup);
  try { await app.session.run(); } catch (err) { console.error(err); ui.toast('Something broke. Back to the title.'); toTitle(); }
}

function stopSession() {
  if (app.session) { app.session.stop(); app.session = null; }
  ui.cancelRequest();
}

function toTitle() {
  stopSession();
  if (app.online) { app.online.net.close(); app.online = null; }
  ui.showHud(false);
  ui.black(false);
  view.setupDemo();
  ui.show('screen-title');
}

// ---------- local setup screen ----------
const LEVEL_OPTS = Object.entries(DIFFICULTIES).map(([k, v]) => `<option value="${k}">Bot: ${v}</option>`).join('');
let localMode = 'vs';
let seatCount = 2;
function renderSeats(keep) {
  const prev = keep ? [...document.querySelectorAll('.seat')].map((r) => ({ name: r.querySelector('input').value, type: r.querySelector('select').value })) : [];
  const list = $('seat-list');
  list.innerHTML = '';
  for (let i = 0; i < seatCount; i++) {
    const row = document.createElement('div');
    row.className = 'seat';
    const p = prev[i];
    let name, type;
    if (p) { name = p.name; type = p.type; } else if (i === 0) { name = myName(); type = 'human'; } else if (localMode === 'vs') { name = CHARACTERS[i].name; type = 'hard'; } else { name = `Player ${i + 1}`; type = 'human'; }
    row.innerHTML = `<span class="who">${CHARACTERS[i].name}</span><input maxlength="14" value=""><select><option value="human">Human</option>${LEVEL_OPTS}</select>`;
    row.querySelector('input').value = name;
    row.querySelector('select').value = type;
    row.querySelector('select').onchange = (e) => {
      const inp = row.querySelector('input');
      const isBotName = CHARACTERS.some((c) => c.name === inp.value) || /^Player \d$/.test(inp.value);
      if (isBotName) inp.value = e.target.value === 'human' ? `Player ${i + 1}` : CHARACTERS[i].name;
    };
    list.appendChild(row);
  }
  document.querySelectorAll('#seg-count button').forEach((b) => b.classList.toggle('on', +b.dataset.n === seatCount));
}
const ITEM_HINTS = {
  progressive: 'Round 1: no items. Round 2: 2 each, round 3: 3 each, and so on. You hold up to 8 — extras are lost.',
  draft: 'Same amounts as Progressive, but everyone takes turns picking from one shared tray.',
  shop: 'Survive a round to earn chips (3 + damage you dealt). Spend them in the shop each round.',
  none: 'No items. Just nerve and a bit of counting.',
};
function itemHint() { $('items-hint').textContent = ITEM_HINTS[$('opt-items').value]; }
$('opt-items').onchange = itemHint;
function openLocal(mode) {
  localMode = mode;
  seatCount = mode === 'vs' ? 2 : 2;
  $('local-title').textContent = mode === 'vs' ? 'VS COMPUTER' : 'PASS & PLAY';
  const last = store.get('local', null);
  if (last) { $('opt-hp').value = String(last.hp); $('opt-items').value = last.itemMode; }
  renderSeats(false);
  itemHint();
  ui.show('screen-local');
}
document.querySelectorAll('#seg-count button').forEach((b) => { b.onclick = () => { seatCount = +b.dataset.n; renderSeats(true); }; });
$('btn-vs').onclick = () => openLocal('vs');
$('btn-pass').onclick = () => openLocal('pass');
$('btn-local-back').onclick = () => ui.show('screen-title');
$('btn-local-start').onclick = () => {
  const rows = [...document.querySelectorAll('.seat')];
  const names = uniqueNames(rows.map((r) => r.querySelector('input').value));
  const players = rows.map((r, i) => {
    const t = r.querySelector('select').value;
    return t === 'human' ? { name: names[i], ctrl: 'human' } : { name: names[i], ctrl: 'bot', level: t };
  });
  if (!players.some((p) => p.ctrl === 'human')) { ui.toast('Someone has to be human.'); return; }
  const setup = { players, hp: +$('opt-hp').value, itemMode: $('opt-items').value };
  store.set('local', { hp: setup.hp, itemMode: setup.itemMode });
  app.wins = {};
  startLocal(setup);
};

// ---------- title / help / menu ----------
$('btn-help').onclick = () => { app.helpBack = 'screen-title'; ui.show('screen-help'); };
$('btn-help-m').onclick = () => { app.helpBack = 'screen-menu'; ui.show('screen-help'); };
$('btn-help-close').onclick = () => { if (app.helpBack === 'screen-menu') ui.show('screen-menu'); else ui.show('screen-title'); };
$('btn-menu').onclick = () => ui.show('screen-menu');
$('btn-resume').onclick = () => ui.hideScreens();
$('btn-quit').onclick = () => toTitle();
$('btn-score-menu').onclick = () => {
  if (app.online && app.online.role === 'host') { hostToLobby(); return; }
  toTitle();
};
$('btn-rematch').onclick = () => {
  if (app.online && app.online.role === 'host') { hostStartGame(); return; }
  if (app.localSetup) startLocal(app.localSetup);
};

// ---------- online ----------
$('btn-online').onclick = () => { $('online-status').textContent = ''; ui.show('screen-online'); };
$('btn-online-back').onclick = () => ui.show('screen-title');
$('in-code').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

$('btn-create').onclick = async () => {
  store.set('name', $('in-name').value.trim());
  $('online-status').textContent = 'Opening a room…';
  $('btn-create').disabled = true;
  const net = new HostNet();
  try {
    const code = await net.open();
    app.online = {
      role: 'host', net, code,
      lobby: { players: [{ name: myName(), kind: 'host' }], hp: 4, itemMode: 'progressive' },
    };
    app.wins = {};
    wireHost();
    renderLobby();
    ui.show('screen-lobby');
  } catch (err) {
    $('online-status').textContent = err.message;
  } finally {
    $('btn-create').disabled = false;
  }
};

function lobbyMsg() {
  const L = app.online.lobby;
  return { t: 'lobby', code: app.online.code, players: L.players.map((p) => ({ name: p.name, kind: p.kind, level: p.level, via: p.conn ? p.conn.via : '' })), hp: L.hp, itemMode: L.itemMode };
}
function broadcastLobby() {
  const msg = lobbyMsg();
  app.online.lobby.players.forEach((p) => { if (p.kind === 'remote' && p.conn) app.online.net.send(p.conn, msg); });
  renderLobby();
}
function wireHost() {
  const O = app.online;
  const net = O.net;
  net.onJoin = (conn, name) => {
    const L = O.lobby;
    if (O.session) { net.kick(conn, 'That game already started.'); return; }
    if (L.players.length >= 4) { net.kick(conn, 'The room is full (4 players).'); return; }
    const taken = L.players.map((p) => p.name);
    const unique = uniqueNames([...taken, name]).pop();
    L.players.push({ name: unique, kind: 'remote', conn });
    net.send(conn, { t: 'welcome', name: unique });
    ui.toast(`${unique} joined.`);
    sfx('pop');
    broadcastLobby();
  };
  net.onLeave = (conn) => {
    const L = O.lobby;
    const i = L.players.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const p = L.players[i];
    if (O.session && !O.session.stopped) {
      O.session.onRemoteLeave(i);
    } else {
      L.players.splice(i, 1);
      ui.toast(`${p.name} left.`);
      broadcastLobby();
    }
  };
  net.onMsg = (conn, msg) => {
    if (msg.t === 'act' && O.session) O.session.onRemoteAction(conn, msg);
    else if (msg.t === 'resync') {
      if (O.session && O.session.game && !O.session.stopped) O.session.resync(conn, !!msg.inGame);
      else if (!O.session) net.send(conn, lobbyMsg());
    }
  };
  net.onError = (text) => ui.toast(text);
}

function renderLobby() {
  const O = app.online;
  if (!O) return;
  const host = O.role === 'host';
  const L = host ? lobbyMsg() : O.lobby;
  if (!L) return;
  $('lobby-code').textContent = O.code;
  const list = $('lobby-list');
  list.innerHTML = '';
  L.players.forEach((p, i) => {
    const li = document.createElement('li');
    const tag = p.kind === 'host' ? 'host' : p.kind === 'bot' ? `bot · ${DIFFICULTIES[p.level]}` : `player${p.via ? ` · ${p.via}` : ''}`;
    const youMark = (host && i === 0) || (!host && p.name === O.myName && p.kind === 'remote') ? ' (you)' : '';
    li.innerHTML = `<span>${CHARACTERS[i].name} — <b></b>${youMark}</span><span class="tag">${tag}</span>`;
    li.querySelector('b').textContent = p.name;
    if (host && i > 0) {
      const x = document.createElement('button');
      x.textContent = p.kind === 'bot' ? 'REMOVE' : 'KICK';
      x.onclick = () => {
        const real = O.lobby.players[i];
        if (real.kind === 'remote') O.net.kick(real.conn, 'The host removed you.');
        O.lobby.players.splice(i, 1);
        broadcastLobby();
      };
      li.appendChild(x);
    }
    list.appendChild(li);
  });
  $('lobby-host-ctrls').classList.toggle('hidden', !host);
  $('btn-lobby-start').classList.toggle('hidden', !host);
  $('lobby-hp').value = String(L.hp);
  $('lobby-items').value = L.itemMode;
  const modeName = { progressive: 'Progressive', draft: 'Draft', shop: 'Shop', none: 'No items' }[L.itemMode];
  $('lobby-info').textContent = host
    ? (L.players.length < 2 ? 'Waiting for players… share the code or add a bot.' : `${L.players.length} players ready. HP ${L.hp} · Items: ${modeName}.`)
    : `HP ${L.hp} · Items: ${modeName}. Waiting for the host to start…`;
  $('btn-lobby-start').disabled = L.players.length < 2;
  $('btn-add-bot').disabled = L.players.length >= 4;
}
$('btn-add-bot').onclick = () => {
  const O = app.online;
  if (!O || O.role !== 'host' || O.lobby.players.length >= 4) return;
  const level = $('lobby-bot-level').value;
  const i = O.lobby.players.length;
  const name = uniqueNames([...O.lobby.players.map((p) => p.name), CHARACTERS[i].name]).pop();
  O.lobby.players.push({ name, kind: 'bot', level });
  broadcastLobby();
};
$('lobby-hp').onchange = () => { if (app.online && app.online.role === 'host') { app.online.lobby.hp = +$('lobby-hp').value; broadcastLobby(); } };
$('lobby-items').onchange = () => { if (app.online && app.online.role === 'host') { app.online.lobby.itemMode = $('lobby-items').value; broadcastLobby(); } };
$('btn-lobby-leave').onclick = () => toTitle();
$('btn-lobby-start').onclick = () => hostStartGame();
const inviteLink = () => {
  const q = new URLSearchParams();
  q.set('room', app.online ? app.online.code : '');
  const cur = new URLSearchParams(location.search);
  for (const k of ['peer', 'relay', 'p2p']) if (cur.get(k)) q.set(k, cur.get(k));
  return `${location.origin}${location.pathname}?${q}`;
};
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); ui.toast(okMsg); } catch (e) { ui.toast(text, 4000); }
}
$('btn-copy-code').onclick = () => copy(app.online.code, 'Code copied.');
$('btn-copy-link').onclick = () => copy(inviteLink(), 'Invite link copied.');

function hostToLobby() {
  const O = app.online;
  if (!O) return;
  if (O.session) { O.session.stop(); O.session = null; }
  app.session = null;
  ui.showHud(false);
  view.setupDemo();
  O.lobby.players.forEach((p) => { if (p.kind === 'remote' && p.conn) O.net.send(p.conn, { t: 'toLobby' }); });
  broadcastLobby();
  ui.show('screen-lobby');
}

class HostSession {
  constructor(O) { this.O = O; this.stopped = false; this.waiting = null; this.seq = 0; this.lastAid = {}; this.pending = {}; }
  stop() { this.stopped = true; ui.cancelRequest(); if (this.waiting) { const w = this.waiting; this.waiting = null; w.res(null); } }
  seats() { return this.O.lobby.players; }
  present(events) {
    const snap = this.game.snapshot();
    const seq = ++this.seq;
    this.seats().forEach((p, i) => { if (p.kind === 'remote' && p.conn) this.O.net.send(p.conn, { t: 'ev', ev: redactEvents(events, i), snap, seq }); });
    return view.play(redactEvents(events, 0), snap);
  }
  // A friend's move can arrive before we're ready for it (their animations may
  // finish first), so it's queued. Resent copies carry the same aid and are ignored.
  onRemoteAction(conn, msg) {
    const i = this.seats().findIndex((p) => p.kind === 'remote' && p.conn === conn);
    if (i < 0 || !msg.action) return;
    if (msg.aid != null && msg.aid <= (this.lastAid[i] || 0)) return;
    const w = this.waiting;
    if (w && w.seat === i) {
      this.waiting = null;
      if (msg.aid != null) this.lastAid[i] = msg.aid;
      w.res(msg.action);
    } else this.pending[i] = msg;
  }
  waitRemote(i) {
    const p = this.pending[i];
    delete this.pending[i];
    if (p && !(p.aid != null && p.aid <= (this.lastAid[i] || 0))) {
      if (p.aid != null) this.lastAid[i] = p.aid;
      return Promise.resolve(p.action);
    }
    return new Promise((res) => { this.waiting = { seat: i, res }; });
  }
  // A friend missed a message (or the game start): send them the current state.
  resync(conn, inGame) {
    const seats = this.seats();
    const i = seats.findIndex((p) => p.kind === 'remote' && p.conn === conn);
    if (i < 0 || !this.game) return;
    const snap = this.game.snapshot();
    if (!inGame) this.O.net.send(conn, { t: 'start', players: this.players, you: i, pre: snap });
    this.O.net.send(conn, { t: 'state', snap, seq: this.seq });
  }
  onRemoteLeave(i) {
    const p = this.seats()[i];
    p.kind = 'bot';
    p.level = 'hard';
    p.conn = null;
    const text = `${p.name} disconnected — a bot takes their seat.`;
    ui.toast(text, 3000);
    this.seats().forEach((q) => { if (q.kind === 'remote' && q.conn) this.O.net.send(q.conn, { t: 'note', text }); });
    if (this.waiting && this.waiting.seat === i) { const w = this.waiting; this.waiting = null; w.res(null); }
  }
  async run() {
    const seats = this.seats();
    const players = seats.map((p, i) => ({ name: p.name, char: i }));
    this.players = players;
    const game = new Game({ players, hp: this.O.lobby.hp, itemMode: this.O.lobby.itemMode });
    this.game = game;
    const pre = game.snapshot();
    seats.forEach((p, i) => { if (p.kind === 'remote' && p.conn) this.O.net.send(p.conn, { t: 'start', players, you: i, pre }); });
    view.setup(players, 0, pre);
    ui.hideScreens();
    ui.showHud(true);
    await this.present(game.start());
    let streak = 0;
    while (!game.over && !this.stopped) {
      const d = game.decision;
      const seat = seats[d.player];
      let action = null;
      if (seat.kind === 'remote') {
        action = await this.waitRemote(d.player);
        if (this.stopped) return;
        if (!action) continue; // they left — the seat is a bot now
      } else if (seat.kind === 'host') {
        action = await ui.requestAction(game.snapshot(), d.player);
        if (!action) { if (this.stopped) return; continue; }
      } else {
        await wait(d.kind === 'turn' ? 0.8 : 0.35);
        if (this.stopped) return;
        action = botAction(game, d.player, seat.level);
        if (d.kind === 'turn' && action && action.type === 'item') { if (++streak > 10) action = { type: 'shoot', target: d.player }; } else streak = 0;
      }
      const r = game.act(d.player, action);
      if (r.error) {
        if (seat.kind === 'remote') { this.O.net.send(seat.conn, { t: 'err', msg: r.error }); continue; }
        if (seat.kind === 'host') { ui.say(r.error, 2.5); continue; }
        const fb = game.act(d.player, d.kind === 'turn' ? { type: 'shoot', target: d.player } : { type: 'done' });
        if (!fb.error) await this.present(fb.events);
        continue;
      }
      await this.present(r.events);
    }
    if (this.stopped) return;
    finishGame(game.snapshot(), true, 'Rematch starts a new game for everyone. Lobby lets you change settings.');
    $('btn-score-menu').textContent = 'LOBBY';
  }
}

async function hostStartGame() {
  const O = app.online;
  if (!O || O.lobby.players.length < 2) return;
  if (O.session) O.session.stop();
  O.session = new HostSession(O);
  app.session = O.session;
  try { await O.session.run(); } catch (err) { console.error(err); ui.toast('Something broke.'); hostToLobby(); }
}

// ----- client -----
$('btn-join').onclick = async () => {
  const code = cleanCode($('in-code').value);
  if (code.length !== 4) { $('online-status').textContent = 'Room codes are 4 characters.'; return; }
  store.set('name', $('in-name').value.trim());
  $('online-status').textContent = `Knocking on room ${code}…`;
  $('btn-join').disabled = true;
  const net = new ClientNet();
  try {
    const welcome = await net.join(code, myName());
    app.online = { role: 'client', net, code, lobby: null, myName: welcome.name || myName(), session: null };
    app.wins = {};
    net.onMsg = (msg) => clientMsg(msg);
    net.onClose = () => { if (app.online && app.online.net === net) { ui.toast('Lost connection to the host.', 3500); toTitle(); } };
    startClientSyncLoop(app.online);
    $('lobby-info').textContent = 'Joined. Waiting for the host…';
    ui.show('screen-lobby');
    renderLobby();
  } catch (err) {
    $('online-status').textContent = err.message;
  } finally {
    $('btn-join').disabled = false;
  }
};

function clientMsg(msg) {
  const O = app.online;
  if (!O) return;
  switch (msg.t) {
    case 'lobby':
      O.lobby = msg;
      O.code = msg.code || O.code;
      if (!O.session) { renderLobby(); }
      break;
    case 'start':
      stopSession();
      O.session = new ClientSession(O, msg);
      app.session = O.session;
      O.session.start();
      break;
    case 'ev': if (O.session) O.session.onEvents(msg); break;
    case 'state': if (O.session) O.session.onState(msg); break;
    case 'err': if (O.session) O.session.onError(msg.msg); break;
    case 'note': ui.toast(msg.text, 3000); break;
    case 'toLobby':
      stopSession();
      O.session = null;
      ui.showHud(false);
      view.setupDemo();
      renderLobby();
      ui.show('screen-lobby');
      break;
    case 'reject': ui.toast(msg.reason || 'Removed from the room.', 3500); toTitle(); break;
    case 'closed': ui.toast('The host closed the room.', 3500); toTitle(); break;
  }
}

class ClientSession {
  constructor(O, startMsg) {
    this.O = O;
    this.you = startMsg.you;
    this.players = startMsg.players;
    this.pre = startMsg.pre;
    this.queue = [];
    this.busy = false;
    this.stopped = false;
    this.lastSnap = startMsg.pre;
    this.nextSeq = 1;
    this.aid = 0;
    this.pendingAct = null;
  }
  stop() { this.stopped = true; ui.cancelRequest(); this.clearPending(); }
  clearPending() { this.pendingAct = null; clearInterval(this.resendT); }
  idle() { return !this.busy && !ui.req && !this.pendingAct && !(this.lastSnap && this.lastSnap.over); }
  start() {
    view.setup(this.players, this.you, this.pre);
    ui.hideScreens();
    ui.showHud(true);
  }
  onEvents(msg) {
    this.clearPending();
    if (msg.seq != null) {
      if (msg.seq < this.nextSeq) return; // duplicate
      if (msg.seq > this.nextSeq) { this.O.net.send({ t: 'resync', inGame: true }); return; } // missed one
      this.nextSeq = msg.seq + 1;
    }
    this.queue.push(msg);
    this.pump();
  }
  onState(msg) {
    if (msg.seq < this.nextSeq) return; // nothing new
    this.clearPending();
    this.nextSeq = msg.seq + 1;
    this.queue = [{ ev: [], snap: msg.snap }];
    this.pump();
  }
  onError(text) { this.clearPending(); ui.say(text, 2.5); if (!this.busy) this.ask(this.lastSnap); }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    ui.cancelRequest();
    while (this.queue.length && !this.stopped) {
      const m = this.queue.shift();
      await view.play(m.ev, m.snap);
      this.lastSnap = m.snap;
    }
    this.busy = false;
    if (this.stopped) return;
    const s = this.lastSnap;
    if (s.over) {
      finishGame(s, false, 'Waiting for the host to start a rematch…');
      $('btn-score-menu').textContent = 'LEAVE ROOM';
    } else if (s.decision && s.decision.player === this.you) this.ask(s);
  }
  async ask(s) {
    if (!s || !s.decision || s.decision.player !== this.you || s.over) return;
    const a = await ui.requestAction(s, this.you);
    if (!a || this.stopped) return;
    const msg = { t: 'act', action: a, aid: ++this.aid };
    this.pendingAct = msg;
    this.O.net.send(msg);
    let tries = 0;
    clearInterval(this.resendT);
    this.resendT = setInterval(() => {
      if (this.pendingAct !== msg || ++tries > 6) { clearInterval(this.resendT); return; }
      this.O.net.send(msg); // the host ignores copies it already has
    }, 4000);
  }
}

// Safety net for lossy connections: every few seconds, while nothing is
// happening, ask the host whether we missed anything (game start or events).
function startClientSyncLoop(O) {
  const t = setInterval(() => {
    if (app.online !== O) { clearInterval(t); return; }
    const s = O.session;
    if (!s) O.net.send({ t: 'resync', inGame: false });
    else if (s.idle()) O.net.send({ t: 'resync', inGame: true });
  }, 6000);
}

// ---------- boot ----------
const params = new URLSearchParams(location.search);
const roomParam = cleanCode(params.get('room'));
if (roomParam.length === 4) {
  $('in-code').value = roomParam;
  ui.show('screen-online');
  $('online-status').textContent = 'Type your name on the title screen if you like, then press JOIN.';
} else {
  ui.show('screen-title');
}
$('btn-score-menu').textContent = 'MAIN MENU';
// restore score-menu label whenever we leave the scoreboard
const _show = ui.show.bind(ui);
ui.show = (id) => { if (id !== 'screen-score') $('btn-score-menu').textContent = 'MAIN MENU'; _show(id); };
