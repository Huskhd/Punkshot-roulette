// Muckshot — admin / test panel. Unlocked with a password from the title screen,
// and only usable in local games (vs computer, pass & play), so it can't be used
// to cheat in online rooms. Lets you hand out items, skip turns, set the next
// shell, go immune, add bots mid-game and play every seat yourself — handy for
// checking animations and item interactions.
//
// Note: this is a browser game, so the password only keeps casual players out.
import { ITEM_IDS } from './engine.js';
import { DIFFICULTIES } from './bot.js';
import { t, itemName, levelName, charName } from './i18n.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'muckshot.admin';
const HASH = 0x121dec15; // fnv1a('muckshot-admin:' + password)

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export class Admin {
  constructor({ ui, getSession }) {
    this.ui = ui;
    this.getSession = getSession; // -> the running LocalSession, or null
    this.on = false;
    try { this.on = localStorage.getItem(KEY) === '1'; } catch (e) { /* private mode */ }
    this.sel = 0;
    this.level = 'hard';
    this.open = false;
    this.sig = '';
    this.wire();
    this.refresh();
    setInterval(() => { if (this.open) this.render(); }, 400);
  }

  wire() {
    $('btn-admin').onclick = () => this.openLogin();
    $('btn-admin-pw-back').onclick = () => this.ui.show('screen-title');
    $('btn-admin-pw-go').onclick = () => this.tryLogin();
    $('in-admin-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.tryLogin(); });
    $('btn-admin-off').onclick = () => { this.setOn(false); this.ui.toast(t('adm_off')); this.ui.show('screen-title'); };
    $('btn-admin-hud').onclick = () => { this.open = !this.open; this.render(true); };
  }
  openLogin() {
    $('in-admin-pw').value = '';
    $('admin-pw-status').textContent = '';
    $('btn-admin-off').classList.toggle('hidden', !this.on);
    this.ui.show('screen-admin-pw');
    setTimeout(() => $('in-admin-pw').focus(), 50);
  }
  tryLogin() {
    const pw = $('in-admin-pw').value.trim();
    if (fnv1a('muckshot-admin:' + pw) !== HASH) {
      sfx('bad');
      $('admin-pw-status').textContent = t('adm_wrong');
      $('in-admin-pw').value = '';
      return;
    }
    this.setOn(true);
    sfx('good');
    this.ui.toast(t('adm_on'), 3200);
    this.ui.show('screen-title');
  }
  setOn(on) {
    this.on = on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!on) this.open = false;
    this.refresh();
  }
  // show / hide the HUD button + panel for the current session
  refresh() {
    const s = this.getSession();
    const usable = this.on && !!s && !!s.game && !s.game.over;
    $('btn-admin').classList.toggle('on', this.on);
    $('btn-admin-hud').classList.toggle('hidden', !usable);
    if (!usable) this.open = false;
    this.render(true);
  }

  render(force) {
    const panel = $('admin-panel');
    const s = this.getSession();
    if (!this.open || !s || !s.game || s.game.over) { panel.classList.add('hidden'); return; }
    const g = s.game;
    if (this.sel >= g.players.length) this.sel = 0;
    const sig = JSON.stringify([g.players.map((p) => [p.name, p.hp, p.alive, p.immune, p.slots.filter(Boolean).length]), g.shells.map((x) => x.live), this.sel, s.solo, g.decision && g.decision.kind, this.level, g.over]);
    if (!force && sig === this.sig) return;
    this.sig = sig;
    panel.classList.remove('hidden');
    const me = g.players[this.sel];
    const thumbs = this.ui.thumbs;
    const shells = g.shells.map((x) => `<i class="${x.live ? 'live' : 'blank'}"></i>`).join('') || '—';
    panel.innerHTML = `
      <div class="adm-head"><b>${t('adm_title')}</b><button data-a="close">×</button></div>
      <div class="adm-sec">${t('adm_player')}</div>
      <div class="adm-row">${g.players.map((p, i) => `<button class="chip${i === this.sel ? ' on' : ''}${p.alive ? '' : ' dead'}" data-a="sel" data-i="${i}">${esc(p.name)}</button>`).join('')}</div>
      <div class="adm-grid">
        <button data-a="skip">${t('adm_skip')}</button>
        <button data-a="immune" class="${me.immune ? 'on' : ''}">${t('adm_immune', { on: me.immune })}</button>
        <button data-a="heal">${t('adm_heal')}</button>
        <button data-a="hurt">${t('adm_hurt')}</button>
        <button data-a="shield">${t('adm_shield')}</button>
        <button data-a="clear">${t('adm_clear')}</button>
      </div>
      <div class="adm-sec">${t('adm_give')} → ${esc(me.name)}</div>
      <div class="adm-items">${ITEM_IDS.map((id) => `<button data-a="give" data-id="${id}" title="${esc(itemName(id))}">${thumbs[id] ? `<img src="${thumbs[id]}" alt="">` : ''}<span>${esc(itemName(id))}</span></button>`).join('')}</div>
      <div class="adm-sec">${t('adm_gun')}</div>
      <div class="adm-shells" title="${esc(t('adm_shells'))}">${shells}</div>
      <div class="adm-grid">
        <button data-a="live">${t('adm_nextLive')}</button>
        <button data-a="blank">${t('adm_nextBlank')}</button>
        <button data-a="reload" class="wide">${t('adm_reload')}</button>
      </div>
      <div class="adm-sec">${t('adm_table')}</div>
      <div class="adm-grid">
        <select data-a="level">${DIFFICULTIES.map((k) => `<option value="${k}"${k === this.level ? ' selected' : ''}>${esc(t('bot', { l: levelName(k) }))}</option>`).join('')}</select>
        <button data-a="bot"${g.players.length >= 4 ? ' disabled' : ''}>${t('adm_addBot')}</button>
        <button data-a="solo" class="wide${s.solo ? ' on' : ''}">${t('adm_solo', { on: !!s.solo })}</button>
      </div>
      <p class="adm-hint">${t('adm_soloHint')}</p>`;
    panel.querySelectorAll('[data-a]').forEach((el) => {
      if (el.tagName === 'SELECT') el.onchange = () => { this.level = el.value; };
      else el.onclick = () => this.act(el.dataset.a, el.dataset);
    });
  }

  act(a, data) {
    const s = this.getSession();
    if (!s || !s.game) return;
    const i = this.sel;
    const turnOnly = (fn) => (g) => {
      if (!g.decision || g.decision.kind !== 'turn') { this.ui.toast(t('adm_onlyTurn')); return null; }
      return fn(g);
    };
    switch (a) {
      case 'close': this.open = false; this.render(true); return;
      case 'sel': this.sel = +data.i; this.render(true); return;
      case 'give':
        s.admin((g) => {
          if (!g.adminGive(i, data.id)) { this.ui.toast(t('adm_full')); return null; }
          this.ui.toast(t('adm_gave', { item: itemName(data.id), n: g.players[i].name }), 1200);
          return [];
        });
        break;
      case 'skip': s.admin(turnOnly((g) => g.adminSkip())); break;
      case 'immune': s.admin((g) => { g.adminImmune(i, !g.players[i].immune); return []; }); break;
      case 'heal': s.admin((g) => { g.adminHeal(i); return []; }); break;
      case 'hurt': s.admin((g) => g.adminHurt(i)); break;
      case 'shield': s.admin((g) => { g.adminShield(i); return []; }); break;
      case 'clear': s.admin((g) => { g.adminClear(i); return []; }); break;
      case 'live': case 'blank': s.admin((g) => (g.adminNextShell(a === 'live') ? [] : null)); break;
      case 'reload': s.admin(turnOnly((g) => g.adminReload())); break;
      case 'bot':
        if (s.game.players.length >= 4) { this.ui.toast(t('adm_max')); return; }
        s.adminAddBot(this.level, (k) => charName(k));
        break;
      case 'solo': s.solo = !s.solo; s.admin(() => []); break;
    }
    sfx('ui');
    setTimeout(() => this.render(true), 60);
  }
}
