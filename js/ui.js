// Muckshot — HTML overlay: captions, HUD, action bar, pickers and screens.
import { ITEMS, ITEM_IDS, itemProblem, freeSlots } from './engine.js';
import { CHARACTERS } from './models.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor() {
    this.thumbs = {};
    this.req = null;
    this.capTimer = 0;
    this.onPickHook = null;
    this.lastHud = null;
  }

  // ---------- captions & effects ----------
  say(text, dur = 3) {
    const el = $('caption');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this.capTimer);
    if (dur > 0) this.capTimer = setTimeout(() => el.classList.remove('on'), dur * 1000);
  }
  clearCaption() { $('caption').classList.remove('on'); }
  flash() {
    const el = $('fx-flash');
    el.style.transition = 'none';
    el.style.opacity = '0.85';
    requestAnimationFrame(() => { el.style.transition = 'opacity 0.12s'; el.style.opacity = '0'; });
  }
  black(on, fade = 0) {
    const el = $('fx-black');
    el.style.transition = fade ? `opacity ${fade}s` : 'none';
    el.style.opacity = on ? '1' : '0';
  }
  hurt() {
    const el = $('fx-hurt');
    el.style.transition = 'none';
    el.style.opacity = '1';
    requestAnimationFrame(() => { el.style.transition = 'opacity 1.2s'; el.style.opacity = '0'; });
  }
  toast(text, ms = 2200) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- screens ----------
  show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  }
  hideScreens() { document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden')); }
  overlay(id, on) { $(id).classList.toggle('hidden', !on); }
  showHud(on) { $('hud').classList.toggle('hidden', !on); if (!on) { this.cancelRequest(); this.clearCaption(); } }

  passScreen(name) {
    return new Promise((res) => {
      $('pass-name').textContent = name;
      $('screen-pass').classList.remove('hidden');
      $('btn-pass-ready').onclick = () => { sfx('ui'); $('screen-pass').classList.add('hidden'); res(); };
    });
  }

  // ---------- HUD ----------
  hud(s, viewer) {
    if (!s || !s.players) return;
    this.lastHud = { s, viewer };
    const turn = s.decision ? s.decision.player : s.turn;
    const html = s.players.map((p, i) => {
      const hp = Array.from({ length: p.maxHp }, (_, k) => (k < p.hp ? '▲' : '<span class="off">▲</span>')).join('');
      const st = [];
      if (p.doll) st.push(this.img('doll', 'Boodoo Doll'));
      if (p.hollow) st.push(this.img('hollow', 'Hollow point loaded'));
      if (p.insured) st.push(this.img('insurance', 'Insured'));
      if (p.double) st.push(this.img('double', 'Double barrel'));
      if (p.cuffed) st.push(this.img('cuffs', 'Cuffed'));
      const items = p.slots.filter(Boolean).length;
      const cls = ['plate', i === turn && !s.over ? 'turn' : '', !p.alive ? 'dead' : ''].join(' ');
      return `<div class="${cls}">
        <div class="pn">${esc(p.name)}${i === viewer ? '<span class="you">YOU</span>' : ''}</div>
        <div class="hp">${p.alive ? hp : '☠'}</div>
        <div class="st">${st.join('')}${items ? `<span class="cuff">${items}✋</span>` : ''}</div>
        ${s.itemMode === 'shop' ? `<div class="chips">${p.chips}¢</div>` : ''}
      </div>`;
    }).join('');
    $('plates').innerHTML = html;
    const arrow = s.dir > 0 ? '↻' : '↺';
    const shells = s.shellsLeft != null ? ` · ${s.shellsLeft} shell${s.shellsLeft === 1 ? '' : 's'}` : '';
    $('roundinfo').textContent = `R${s.round || 1}${shells} · ${arrow}`;
  }
  img(id, title) { return this.thumbs[id] ? `<img src="${this.thumbs[id]}" title="${esc(title)}" alt="">` : ''; }

  // ---------- item info ----------
  describe(id) { const d = ITEMS[id]; return d ? `${d.name}: ${d.desc}` : ''; }
  tooltip(pick, x, y, snap) {
    const el = $('tooltip');
    let html = '';
    if (pick && (pick.kind === 'item' || pick.kind === 'tray')) {
      const id = this.idFor(pick, snap);
      if (id) html = `<b>${esc(ITEMS[id].name)}</b><br>${esc(ITEMS[id].desc)}`;
    } else if (pick && pick.kind === 'player' && snap) {
      const p = snap.players[pick.idx];
      if (p) html = `<b>${esc(p.name)}</b> — ${CHARACTERS[p.char % 4].name}<br>${p.hp}/${p.maxHp} HP · ${p.slots.filter(Boolean).length} items`;
    } else if (pick && pick.kind === 'gun') html = this.req && this.req.kind === 'turn' ? '<b>The gun</b><br>Click to pick it up.' : '<b>The gun</b>';
    if (!html) { el.classList.add('hidden'); return; }
    el.innerHTML = html;
    el.classList.remove('hidden');
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.min(window.innerWidth - w - 8, x + 16) + 'px';
    el.style.top = Math.max(8, y - h - 12) + 'px';
  }
  hideTooltip() { $('tooltip').classList.add('hidden'); }
  idFor(pick, snap) {
    if (!snap) return null;
    if (pick.kind === 'tray') { const t = (snap.tray || []).find((x) => x.uid === pick.uid); return t && t.id; }
    for (const p of snap.players) for (const s of p.slots) if (s && s.uid === pick.uid) return s.id;
    return null;
  }

  // ---------- human decisions ----------
  // Resolves with an action object, or null if cancelled from outside.
  requestAction(snap, seat, who) {
    this.cancelRequest();
    return new Promise((resolve) => {
      this.req = { snap, seat, resolve, kind: snap.decision.kind, sel: null, who };
      document.body.classList.add('choosing');
      this.renderBar();
      const d = snap.decision;
      if (d.kind === 'turn') this.say('Your move. Use items, or pick up the gun.', 4);
      else if (d.kind === 'draft') this.say(`${snap.players[seat].name}, your pick.`, 3);
    });
  }
  cancelRequest() {
    if (!this.req) return;
    const r = this.req;
    this.req = null;
    this.closeBar();
    r.resolve(null);
  }
  finish(action) {
    const r = this.req;
    if (!r) return;
    this.req = null;
    sfx('ui');
    this.closeBar();
    r.resolve(action);
  }
  closeBar() {
    $('actionbar').classList.add('hidden');
    this.closeModal();
    document.body.classList.remove('choosing');
    this.hideTooltip();
  }

  renderBar() {
    const r = this.req;
    if (!r) return;
    const { snap, seat, kind } = r;
    const me = snap.players[seat];
    const head = $('ab-head'), items = $('ab-items'), btns = $('ab-buttons');
    items.innerHTML = '';
    btns.innerHTML = '';
    $('actionbar').classList.remove('hidden');
    const pre = r.who ? `${r.who.toUpperCase()} — ` : '';
    if (kind === 'turn') {
      const used = me.slots.map((s, i) => ({ s, i })).filter((x) => x.s);
      head.textContent = used.length ? `${pre}YOUR ITEMS` : pre.replace(/ — $/, '');
      for (const { s, i } of used) {
        const prob = itemProblem(snap.players, snap.shellsLeft, seat, s.id);
        const bad = prob && prob !== 'NEED_TARGET' && prob !== 'NEED_PICK';
        const b = this.itemButton(s.id, { sel: r.sel === i, bad });
        b.onclick = () => this.selectSlot(i);
        items.appendChild(b);
      }
      if (r.sel != null && me.slots[r.sel]) {
        const id = me.slots[r.sel].id;
        const use = document.createElement('button');
        use.className = 'big accent';
        use.textContent = `USE ${ITEMS[id].name.toUpperCase()}`;
        use.onclick = () => this.useSelected();
        const cancel = document.createElement('button');
        cancel.textContent = 'BACK';
        cancel.onclick = () => { r.sel = null; this.renderBar(); };
        btns.append(cancel, use);
      } else {
        const sh = document.createElement('button');
        sh.className = 'shootbtn';
        sh.textContent = 'PICK UP THE GUN';
        sh.onclick = () => this.shootModal();
        btns.append(sh);
      }
      this.measureBar();
      return;
    }
    // tray decisions
    const free = freeSlots(me);
    if (kind === 'take') head.textContent = `${pre}TAKE YOUR ITEMS — ${free} FREE SLOT${free === 1 ? '' : 'S'}`;
    else if (kind === 'draft') head.textContent = `${pre}YOUR PICK — ${free} FREE SLOT${free === 1 ? '' : 'S'}`;
    else head.textContent = `${pre}SHOP — ${me.chips} CHIPS · ${free} FREE SLOT${free === 1 ? '' : 'S'}`;
    for (const t of snap.tray) {
      const bad = kind === 'shop' && t.price > me.chips;
      const b = this.itemButton(t.id, { sel: r.sel === t.uid, bad, price: kind === 'shop' ? t.price : null });
      b.onclick = () => this.selectTray(t.uid);
      items.appendChild(b);
    }
    if (r.sel != null) {
      const t = snap.tray.find((x) => x.uid === r.sel);
      if (t) {
        const ok = document.createElement('button');
        ok.className = 'big accent';
        ok.textContent = kind === 'shop' ? `BUY ${ITEMS[t.id].name.toUpperCase()} (${t.price}¢)` : `TAKE ${ITEMS[t.id].name.toUpperCase()}`;
        ok.disabled = kind === 'shop' && t.price > me.chips;
        ok.onclick = () => this.confirmTray();
        btns.append(ok);
      }
    }
    if (kind === 'take' || kind === 'shop') {
      const done = document.createElement('button');
      done.textContent = kind === 'take' ? 'LEAVE THE REST' : 'DONE SHOPPING';
      done.onclick = () => this.finish({ type: 'done' });
      btns.append(done);
    }
    if (kind === 'take') {
      const all = document.createElement('button');
      all.textContent = 'TAKE NEXT';
      all.onclick = () => this.finish({ type: 'take', uid: snap.tray[0].uid });
      btns.append(all);
    }
    this.measureBar();
  }
  measureBar() {
    const h = $('actionbar').offsetHeight;
    document.documentElement.style.setProperty('--abh', `${h}px`);
  }
  itemButton(id, { sel, bad, price }) {
    const b = document.createElement('button');
    b.className = `itembtn${sel ? ' sel' : ''}${bad ? ' bad' : ''}${ITEMS[id].rare ? ' rare' : ''}`;
    b.innerHTML = `${this.img(id, ITEMS[id].name)}<span>${esc(ITEMS[id].name)}</span>${price != null ? `<em class="price">${price}¢</em>` : ''}`;
    b.title = ITEMS[id].desc;
    return b;
  }
  selectSlot(i) {
    const r = this.req;
    if (!r || r.kind !== 'turn') return;
    const s = r.snap.players[r.seat].slots[i];
    if (!s) return;
    sfx('ui');
    if (r.sel === i) { this.useSelected(); return; }
    r.sel = i;
    const prob = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, s.id);
    const bad = prob && prob !== 'NEED_TARGET' && prob !== 'NEED_PICK';
    this.say(this.describe(s.id) + (bad ? `\n(${prob})` : ''), 0);
    this.renderBar();
  }
  selectTray(uid) {
    const r = this.req;
    if (!r || r.kind === 'turn') return;
    const t = r.snap.tray.find((x) => x.uid === uid);
    if (!t) return;
    sfx('ui');
    if (r.sel === uid) { this.confirmTray(); return; }
    r.sel = uid;
    this.say(this.describe(t.id) + (r.kind === 'shop' ? ` (${t.price} chips)` : ''), 0);
    this.renderBar();
  }
  confirmTray() {
    const r = this.req;
    if (!r || r.sel == null) return;
    const t = r.snap.tray.find((x) => x.uid === r.sel);
    if (!t) return;
    if (r.kind === 'shop') {
      if (t.price > r.snap.players[r.seat].chips) { this.say('Not enough chips.', 2); return; }
      this.finish({ type: 'buy', uid: t.uid });
    } else this.finish({ type: 'take', uid: t.uid });
  }
  useSelected() {
    const r = this.req;
    if (!r || r.sel == null) return;
    const slot = r.sel;
    const s = r.snap.players[r.seat].slots[slot];
    const prob = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, s.id);
    if (prob === 'NEED_TARGET' || prob === 'NEED_PICK') { this.targetModal(slot, s.id); return; }
    if (prob) { this.say(prob, 2.5); return; }
    this.finish({ type: 'item', slot });
  }

  // ---------- modals ----------
  modal(title, build) {
    const p = $('modal-panel');
    p.innerHTML = `<h2>${esc(title)}</h2>`;
    build(p);
    const c = document.createElement('button');
    c.textContent = 'CANCEL';
    c.style.marginTop = '8px';
    c.onclick = () => { sfx('ui'); this.closeModal(); };
    p.appendChild(c);
    $('modal').classList.remove('hidden');
  }
  closeModal() { $('modal').classList.add('hidden'); }
  choice(label, sub, onClick, disabled, extraCls = '') {
    const b = document.createElement('button');
    b.className = `choice ${extraCls}`;
    b.innerHTML = `<span>${esc(label)}</span><small>${esc(sub || '')}</small>`;
    b.disabled = !!disabled;
    b.onclick = onClick;
    return b;
  }
  shootModal() {
    const r = this.req;
    if (!r || r.kind !== 'turn') return;
    sfx('pickup');
    const { snap, seat } = r;
    const me = snap.players[seat];
    this.modal('POINT THE GUN AT…', (p) => {
      const selfSub = me.double ? 'two shells! both blank = go again' : 'blank = you go again';
      p.appendChild(this.choice('Yourself', selfSub, () => this.finish({ type: 'shoot', target: seat }), false, 'self'));
      snap.players.forEach((q, i) => {
        if (i === seat || !q.alive) return;
        const sub = `${q.hp}/${q.maxHp} HP${q.doll ? ' · has a Boodoo Doll!' : ''}`;
        p.appendChild(this.choice(q.name, sub, () => this.finish({ type: 'shoot', target: i })));
      });
    });
  }
  targetModal(slot, id) {
    const r = this.req;
    const { snap, seat } = r;
    this.modal(`USE ${ITEMS[id].name.toUpperCase()} ON…`, (p) => {
      snap.players.forEach((q, i) => {
        if (i === seat || !q.alive) return;
        const prob = itemProblem(snap.players, snap.shellsLeft, seat, id, i);
        const bad = prob && prob !== 'NEED_PICK';
        const n = q.slots.filter(Boolean).length;
        const sub = bad ? prob : `${q.hp}/${q.maxHp} HP · ${n} item${n === 1 ? '' : 's'}`;
        p.appendChild(this.choice(q.name, sub, () => {
          if (id === 'goldglove') this.pickItemModal(slot, i);
          else this.finish({ type: 'item', slot, target: i });
        }, bad));
      });
    });
  }
  pickItemModal(slot, target) {
    const r = this.req;
    const q = r.snap.players[target];
    this.modal(`STEAL FROM ${q.name.toUpperCase()}`, (p) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center';
      q.slots.forEach((s, k) => {
        if (!s) return;
        const b = this.itemButton(s.id, {});
        b.onclick = () => this.finish({ type: 'item', slot, target, pick: k });
        wrap.appendChild(b);
      });
      p.appendChild(wrap);
    });
  }

  // 3D clicks from the table
  onPick(pick, snap) {
    const r = this.req;
    if (!pick) return;
    if (r && r.kind === 'turn') {
      if (pick.kind === 'item' && pick.owner === r.seat) { this.selectSlot(pick.slot); return; }
      if (pick.kind === 'gun' || (pick.kind === 'player' && pick.idx !== r.seat)) { this.shootModal(); return; }
    }
    if (r && r.kind !== 'turn' && pick.kind === 'tray') { this.selectTray(pick.uid); return; }
    if (pick.kind === 'item' || pick.kind === 'tray') {
      const id = this.idFor(pick, snap);
      if (id) this.say(this.describe(id), 3.5);
    }
  }

  // ---------- help ----------
  buildHelp() {
    $('help-items').innerHTML = ITEM_IDS.map((id) => `<div class="hitem">${this.img(id, ITEMS[id].name)}<div><b>${esc(ITEMS[id].name)}</b>${esc(ITEMS[id].desc)}</div></div>`).join('');
  }

  // ---------- scoreboard ----------
  scoreboard({ players, standings, wins, canRematch, hint }) {
    const rows = standings.map((i, k) => {
      const p = players[i];
      const s = p.stats;
      return `<tr class="${k === 0 ? 'win' : ''}"><td>${k + 1}.</td><td>${esc(p.name)}</td>
        <td class="num">${wins[p.name] || 0}</td><td class="num">${s.dmgDealt}</td><td class="num">${s.kills}</td>
        <td class="num">${s.shots}</td><td class="num">${s.itemsUsed}</td></tr>`;
    }).join('');
    $('score-table').innerHTML = `<tr><th></th><th>Player</th><th class="num">Wins</th><th class="num">Dmg</th><th class="num">Kills</th><th class="num">Shots</th><th class="num">Items</th></tr>${rows}`;
    const w = players[standings[0]];
    $('score-title').textContent = `${w.name.toUpperCase()} WINS`;
    $('btn-rematch').disabled = !canRematch;
    $('score-hint').textContent = hint || '';
    this.show('screen-score');
  }
}
