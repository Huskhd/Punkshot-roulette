// Muckshot — HTML overlay: captions, HUD, action bar, pickers and screens.
// Targets (who to shoot, who to use an item on, which of their items) are picked
// by tapping them at the table; the bar at the bottom only confirms or cancels.
import { ITEMS, ITEM_IDS, itemProblem, freeSlots } from './engine.js';
import { sfx, setMusicTension } from './audio.js';
import { t, prob, itemName, itemDesc, charName, tierName } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OK_PROBS = new Set(['NEED_TARGET', 'NEED_PICK']);

export class UI {
  constructor() {
    this.thumbs = {};
    this.req = null;
    this.capTimer = 0;
    this.view = null; // TableView, set by main
    this.duo = null;  // handheld console, set by main
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
  setLastLife(on) {
    document.body.classList.toggle('lastlife', !!on);
    if (this.view) this.view.lowHp = !!on;
    setMusicTension(on);
  }

  // ---------- screens ----------
  show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id)); }
  hideScreens() { document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden')); }
  showHud(on) {
    $('hud').classList.toggle('hidden', !on);
    if (!on) { this.cancelRequest(); this.clearCaption(); this.setLastLife(false); }
  }
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
    $('plates').innerHTML = s.players.map((p, i) => {
      const hp = Array.from({ length: p.maxHp }, (_, k) => (k < p.hp ? '▲' : '<span class="off">▲</span>')).join('');
      const shield = (p.shield ? `<span class="sh">${'◆'.repeat(Math.min(p.shield, 6))}</span>` : '') + (p.immune ? '<span class="imm">∞</span>' : '');
      const st = [];
      if (p.doll) st.push(this.img('doll', itemName('doll')));
      if (p.saw) st.push(this.img('saw', itemName('saw')));
      if (p.insured) st.push(this.img('insurance', itemName('insurance')));
      if (p.double) st.push(this.img('double', itemName('double')));
      if (p.cuffed) st.push(this.img('cuffs', itemName('cuffs')));
      if (p.hacked || p.jammed) st.push(this.img('hack', itemName('hack')));
      const items = p.slots.filter(Boolean).length;
      const cls = ['plate', i === turn && !s.over ? 'turn' : '', !p.alive ? 'dead' : ''].join(' ');
      return `<div class="${cls}">
        <div class="pn">${esc(p.name)}${i === viewer ? `<span class="you">${t('you')}</span>` : ''}</div>
        <div class="hp">${p.alive ? hp + shield : '☠'}</div>
        <div class="st">${st.join('')}${items ? `<span class="cuff">${items}✋</span>` : ''}</div>
        ${s.itemMode === 'shop' ? `<div class="chips">${p.chips}¢</div>` : ''}
      </div>`;
    }).join('');
    const arrow = s.dir > 0 ? '↻' : '↺';
    const shells = s.shellsLeft != null ? ` · ${s.shellsLeft} ▮` : '';
    $('roundinfo').textContent = `R${s.round || 1}${shells} · ${arrow}`;
    const me = viewer >= 0 ? s.players[viewer] : null;
    this.setLastLife(me && me.alive && me.hp === 1 && !(me.shield > 0) && !s.over);
  }
  img(id, title) { return this.thumbs[id] ? `<img src="${this.thumbs[id]}" title="${esc(title)}" alt="">` : ''; }

  // ---------- item info ----------
  describe(id) { const tn = tierName(ITEMS[id].tier); return `${itemName(id)}${tn ? ` (${tn})` : ''}: ${itemDesc(id)}`; }
  tierTag(id) { const tier = ITEMS[id].tier; return tier !== 'common' ? ` <span class="tier t-${tier}">${esc(tierName(tier))}</span>` : ''; }
  tooltip(pick, x, y, snap) {
    const el = $('tooltip');
    let html = '';
    if (pick && (pick.kind === 'item' || pick.kind === 'tray')) {
      const id = this.idFor(pick, snap);
      if (id) html = `<b>${esc(itemName(id))}</b>${this.tierTag(id)}<br>${esc(itemDesc(id))}`;
    } else if (pick && (pick.kind === 'player' || pick.kind === 'target') && snap) {
      const p = snap.players[pick.idx];
      if (p) html = `<b>${esc(p.name)}</b> — ${esc(charName(p.char))}<br>${esc(t('hpItems', { hp: p.hp, max: p.maxHp, n: p.slots.filter(Boolean).length }))}`;
    } else if (pick && pick.kind === 'gun') html = `<b>${esc(t('gunTip'))}</b>${this.req && this.req.kind === 'turn' ? `<br>${esc(t('gunTipTurn'))}` : ''}`;
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
    if (pick.kind === 'tray') { const x = (snap.tray || []).find((y) => y.uid === pick.uid); return x && x.id; }
    for (const p of snap.players) for (const s of p.slots) if (s && s.uid === pick.uid) return s.id;
    return null;
  }

  // ---------- human decisions ----------
  // Resolves with an action object, or null if cancelled from outside.
  requestAction(snap, seat, who) {
    this.cancelRequest();
    return new Promise((resolve) => {
      this.req = { snap, seat, resolve, kind: snap.decision.kind, sel: null, who, tgt: null };
      document.body.classList.add('choosing');
      this.renderBar();
      const d = snap.decision;
      if (d.kind === 'turn') this.say(t('yourMove'), 4);
      else if (d.kind === 'draft') this.say(t('yourPickCap', { n: snap.players[seat].name }), 3);
    });
  }
  cancelRequest() {
    if (!this.req) return;
    const r = this.req;
    this.req = null;
    this.endTarget();
    this.closeBar();
    if (this.duo && this.duo.mode === 'menu') this.duo.close();
    r.resolve(null);
  }
  finish(action) {
    const r = this.req;
    if (!r) return;
    this.req = null;
    sfx('ui');
    this.endTarget();
    this.closeBar();
    r.resolve(action);
  }
  closeBar() {
    $('actionbar').classList.add('hidden');
    document.body.classList.remove('choosing', 'targeting');
    this.hideTooltip();
  }
  measureBar() { document.documentElement.style.setProperty('--abh', `${$('actionbar').offsetHeight}px`); }
  btn(label, cls, onClick, disabled) {
    const b = document.createElement('button');
    b.className = cls || '';
    b.textContent = label;
    b.disabled = !!disabled;
    b.onclick = onClick;
    return b;
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
    document.body.classList.toggle('targeting', !!r.tgt);
    if (r.tgt) { this.renderTargetBar(); this.measureBar(); return; }
    if (kind === 'turn') {
      const used = me.slots.map((s, i) => ({ s, i })).filter((x) => x.s);
      head.textContent = used.length ? `${pre}${t('yourItems')}` : pre.replace(/ — $/, '');
      for (const { s, i } of used) {
        const p = itemProblem(snap.players, snap.shellsLeft, seat, s.id);
        const b = this.itemButton(s.id, { sel: r.sel === i, bad: p && !OK_PROBS.has(p) });
        b.onclick = () => this.selectSlot(i);
        items.appendChild(b);
      }
      // Buttons sit in fixed cells: BACK is always left, USE always right.
      if (r.sel != null && me.slots[r.sel]) {
        const id = me.slots[r.sel].id;
        this.cells(btns, [this.btn(t('back'), '', () => { r.sel = null; this.renderBar(); }), this.btn(t('use', { item: itemName(id) }), 'big accent', () => this.useSelected())]);
      } else this.cells(btns, [this.btn(t('pickGun'), 'shootbtn', () => this.beginShoot())], 2);
      this.measureBar();
      return;
    }
    const free = freeSlots(me);
    if (kind === 'take') head.textContent = pre + t('takeItems', { free });
    else if (kind === 'draft') head.textContent = pre + t('yourPick', { free });
    else head.textContent = pre + t('shopHead', { chips: me.chips, free });
    for (const x of snap.tray) {
      const b = this.itemButton(x.id, { sel: r.sel === x.uid, bad: kind === 'shop' && x.price > me.chips, price: kind === 'shop' ? x.price : null });
      b.onclick = () => this.selectTray(x.uid);
      items.appendChild(b);
    }
    // the take/buy button is always there (disabled until you pick something), so nothing shifts
    const x = r.sel != null ? snap.tray.find((y) => y.uid === r.sel) : null;
    const label = !x ? t('tapItem') : kind === 'shop' ? t('buy', { item: itemName(x.id), price: x.price }) : t('take', { item: itemName(x.id) });
    const main = this.btn(label, 'big accent', () => this.confirmTray(), !x || (kind === 'shop' && x.price > me.chips));
    if (kind === 'take') this.cells(btns, [this.btn(t('leaveRest'), '', () => this.finish({ type: 'done' })), this.btn(t('takeNext'), '', () => this.finish({ type: 'take', uid: snap.tray[0].uid })), main]);
    else if (kind === 'shop') this.cells(btns, [this.btn(t('doneShop'), '', () => this.finish({ type: 'done' })), main]);
    else this.cells(btns, [main], 2);
    this.measureBar();
  }
  // Lays buttons out in equal fixed-width cells. A single button can span `span` cells.
  cells(el, list, span) {
    const cols = span || list.length;
    el.style.setProperty('--cols', cols);
    if (span) list[0].classList.add('span');
    el.append(...list);
  }
  itemButton(id, { sel, bad, price }) {
    const b = document.createElement('button');
    const tier = ITEMS[id].tier;
    b.className = `itembtn${sel ? ' sel' : ''}${bad ? ' bad' : ''}${tier !== 'common' ? ` t-${tier}` : ''}`;
    b.innerHTML = `${this.img(id, itemName(id))}<span>${esc(itemName(id))}</span>${price != null ? `<em class="price">${price}¢</em>` : ''}`;
    b.title = itemDesc(id);
    return b;
  }
  // One tap selects; using it always takes the button (no double-tap misfires).
  selectSlot(i) {
    const r = this.req;
    if (!r || r.kind !== 'turn' || r.tgt) return;
    const s = r.snap.players[r.seat].slots[i];
    if (!s || r.sel === i) return;
    sfx('ui');
    r.sel = i;
    const p = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, s.id);
    this.say(this.describe(s.id) + (p && !OK_PROBS.has(p) ? `\n(${this.probText(p, r.snap)})` : ''), 0);
    this.renderBar();
  }
  selectTray(uid) {
    const r = this.req;
    if (!r || r.kind === 'turn') return;
    const x = r.snap.tray.find((y) => y.uid === uid);
    if (!x || r.sel === uid) return;
    sfx('ui');
    r.sel = uid;
    this.say(this.describe(x.id) + (r.kind === 'shop' ? t('chipsTail', { price: x.price }) : ''), 0);
    this.renderBar();
  }
  confirmTray() {
    const r = this.req;
    if (!r || r.sel == null) return;
    const x = r.snap.tray.find((y) => y.uid === r.sel);
    if (!x) return;
    if (r.kind === 'shop') {
      if (x.price > r.snap.players[r.seat].chips) { this.say(t('noChips'), 2); return; }
      this.finish({ type: 'buy', uid: x.uid });
    } else this.finish({ type: 'take', uid: x.uid });
  }
  probText(code, snap, target) { return prob(code, { n: target != null && snap ? snap.players[target].name : '' }); }

  async useSelected() {
    const r = this.req;
    if (!r || r.sel == null) return;
    const slot = r.sel;
    const s = r.snap.players[r.seat].slots[slot];
    const id = s.id;
    if (id === 'handheld') {
      const p0 = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, id, undefined, 'mash');
      if (p0) { this.say(this.probText(p0, r.snap), 2.5); return; }
      this.closeBar();
      const game = this.duo ? await this.duo.choose() : null;
      if (this.req !== r) return;
      if (this.duo) this.duo.close();
      if (game) this.finish({ type: 'item', slot, pick: game }); else this.renderBar();
      return;
    }
    const p = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, id);
    if (p && !OK_PROBS.has(p)) { this.say(this.probText(p, r.snap), 2.5); return; }
    if (p === 'NEED_TARGET') { this.beginItemTarget(slot, id); return; }
    this.finish({ type: 'item', slot });
  }

  // ---------- picking at the table ----------
  beginShoot() {
    const r = this.req;
    if (!r || r.kind !== 'turn') return;
    sfx('pickup');
    r.tgt = { mode: 'shoot', sel: null };
    this.view.startTargeting({ kind: 'player', allowSelf: true });
    this.say(t('aimHint'), 0);
    this.renderBar();
  }
  beginItemTarget(slot, id) {
    const r = this.req;
    const kind = ITEMS[id].target === 'dead' ? 'dead' : 'player';
    r.tgt = { mode: 'item', slot, id, sel: null };
    this.view.startTargeting({
      kind,
      problem: (i) => {
        const p = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, id, i);
        return p && !OK_PROBS.has(p) ? this.probText(p, r.snap, i) : null;
      },
    });
    this.say(t(kind === 'dead' ? 'deadHint' : 'targetHint', { item: itemName(id) }), 0);
    this.renderBar();
  }
  beginItemPick(target) {
    const r = this.req;
    r.tgt = { mode: 'pickItem', slot: r.tgt.slot, id: r.tgt.id, target, sel: null };
    this.view.endTargeting(true);
    this.view.startItemPick(target);
    this.say(t('itemHint', { item: itemName(r.tgt.id), n: r.snap.players[target].name }), 0);
    this.renderBar();
  }
  endTarget(keepCamera) {
    const r = this.req;
    if (r) r.tgt = null;
    if (!this.view) return;
    this.view.endTargeting(!!keepCamera);
    this.view.endItemPick(!!keepCamera);
  }
  renderTargetBar() {
    const r = this.req;
    const T = r.tgt;
    const head = $('ab-head'), btns = $('ab-buttons');
    const snap = r.snap;
    let label = t('confirm');
    if (T.mode === 'shoot') {
      head.textContent = '';
      if (T.sel != null) label = T.sel === r.seat ? t('shootSelf') : t('shootAt', { n: snap.players[T.sel].name });
    } else if (T.mode === 'item') {
      head.textContent = itemName(T.id).toUpperCase();
      if (T.sel != null) label = t('useOn', { n: snap.players[T.sel].name });
    } else {
      head.textContent = itemName(T.id).toUpperCase();
      const it = T.sel != null ? snap.players[T.target].slots[T.sel] : null;
      if (it) label = T.id === 'trash' ? t('trashThis', { item: itemName(it.id) }) : t('stealThis', { item: itemName(it.id) });
    }
    this.cells(btns, [
      this.btn(t('cancel'), '', () => { sfx('ui'); this.endTarget(); r.tgt = null; this.clearCaption(); this.renderBar(); }),
      this.btn(label, T.mode === 'shoot' ? 'shootbtn' : 'big accent', () => this.confirmTarget(), T.sel == null),
    ]);
  }
  confirmTarget() {
    const r = this.req;
    const T = r && r.tgt;
    if (!T || T.sel == null) return;
    if (T.mode === 'shoot') { this.finish({ type: 'shoot', target: T.sel }); return; }
    if (T.mode === 'item') {
      const p = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, T.id, T.sel);
      if (p === 'NEED_PICK') { this.beginItemPick(T.sel); return; }
      this.finish({ type: 'item', slot: T.slot, target: T.sel });
      return;
    }
    this.finish({ type: 'item', slot: T.slot, target: T.target, pick: T.sel });
  }

  // 3D clicks from the table
  onPick(pick, snap) {
    const r = this.req;
    if (!pick) return;
    if (r && r.tgt) {
      const T = r.tgt;
      if (T.mode === 'pickItem') {
        if (pick.kind === 'item' && pick.owner === T.target && snap.players[T.target].slots[pick.slot]) {
          T.sel = pick.slot;
          this.view.selectItem(pick.slot);
          const id = snap.players[T.target].slots[pick.slot].id;
          this.say(this.describe(id), 0);
          this.renderBar();
        }
        return;
      }
      let idx = null;
      if (pick.kind === 'target') idx = pick.idx;
      if (pick.kind === 'player') idx = pick.idx;
      if (idx == null || !this.view.targeting) return;
      if (!this.view.targeting.valid.has(idx)) {
        const ring = this.view.targeting.rings.find((m) => m.userData.pick.idx === idx);
        if (ring && T.mode === 'item') {
          const p = itemProblem(r.snap.players, r.snap.shellsLeft, r.seat, T.id, idx);
          if (p && !OK_PROBS.has(p)) this.say(this.probText(p, r.snap, idx), 2.5);
        }
        return;
      }
      T.sel = idx;
      this.view.selectTarget(idx);
      this.renderBar();
      return;
    }
    if (r && r.kind === 'turn') {
      if (pick.kind === 'item' && pick.owner === r.seat) { this.selectSlot(pick.slot); return; }
      if (pick.kind === 'gun') { this.beginShoot(); return; }
    }
    if (r && r.kind !== 'turn' && pick.kind === 'tray') { this.selectTray(pick.uid); return; }
    if (pick.kind === 'item' || pick.kind === 'tray') {
      const id = this.idFor(pick, snap);
      if (id) this.say(this.describe(id), 3.5);
    }
  }

  // ---------- help ----------
  buildHelp() {
    $('help-items').innerHTML = ITEM_IDS.map((id) => `<div class="hitem t-${ITEMS[id].tier}">${this.img(id, itemName(id))}<div><b>${esc(itemName(id))}${this.tierTag(id)}</b>${esc(itemDesc(id))}</div></div>`).join('');
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
    $('score-table').innerHTML = `<tr><th></th><th>${t('thPlayer')}</th><th class="num">${t('thWins')}</th><th class="num">${t('thDmg')}</th><th class="num">${t('thKills')}</th><th class="num">${t('thShots')}</th><th class="num">${t('thItems')}</th></tr>${rows}`;
    $('score-title').textContent = t('winsTitle', { n: players[standings[0]].name });
    $('btn-rematch').disabled = !canRematch;
    $('score-hint').textContent = hint || '';
    this.show('screen-score');
  }
}
