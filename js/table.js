// Muckshot — the 3D table: scene, camera, and the animation for every game event.
// The view never decides anything; it replays events from the rules engine and
// then snaps to the authoritative snapshot (sync) so it can't drift.
import {
  THREE, snapUniform, tickGlow, animate, wait, ease, moveTo, turnTo, scaleTo, tickAnims, finishAll, lookQuat, quatFromEuler, basic,
} from './gfx.js';
import * as M from './models.js';
import { sfx } from './audio.js';
import { t, itemName, charName } from './i18n.js';
import { gameName } from './minigames.js';

const TY = M.TABLE_Y;
const ITEM_SCALE = 1.75;
const SLOT_ROWS = [1.3, 1.02];
const SLOT_COLS = [-0.36, 0, 0.36];
const SLOT_N = SLOT_COLS.length;
const STATUS_ORDER = ['doll', 'saw', 'insured', 'double', 'hacked'];
const STATUS_ITEM = { doll: 'doll', saw: 'saw', insured: 'insurance', double: 'double', hacked: 'hack' };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);

export class TableView {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    this.retro = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060806);
    scene.fog = new THREE.FogExp2(0x060806, 0.13);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.03, 40);
    scene.add(this.camera);
    this.camPos = V3(0, 2.6, 3);
    this.camLook = V3(0, TY, 0);
    this.camMode = 'orbit';
    this.shakeAmt = 0;
    this.tremble = null; // {chars:[idx], cam, gun} while someone is being aimed at
    this.lowHp = false;  // viewer on their last life: the room won't sit still

    scene.add(M.makeRoom());
    this.tableGroup = M.makeTable();
    scene.add(this.tableGroup);
    this.lamp = M.makeLamp();
    this.lamp.position.set(0, 4.4, 0);
    scene.add(this.lamp);
    const spot = new THREE.SpotLight(0xffd7a0, 24, 14, 0.78, 0.55, 1.5);
    spot.position.set(0, this.lamp.userData.bulbY + 0.02, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.4;
    spot.shadow.camera.far = 9;
    spot.shadow.bias = -0.0006;
    spot.shadow.normalBias = 0.02;
    this.lamp.add(spot);
    spot.target.position.set(0, TY, 0);
    scene.add(spot.target);
    this.spot = spot;
    this.spotBase = 24;
    const glow = new THREE.PointLight(0xffc98a, 7, 7, 1.4); // bare bulb spill onto the patrons
    glow.position.set(0, this.lamp.userData.bulbY - 0.05, 0);
    this.lamp.add(glow);
    this.glow = glow;
    this.showLight = new THREE.PointLight(0xfff0d0, 0, 3, 1.5);
    this.showLight.position.set(0.1, 0.15, 0.1);
    this.camera.add(this.showLight);
    scene.add(new THREE.HemisphereLight(0x5a6e52, 0x1a1008, 1.5));
    const fill = new THREE.PointLight(0x3c5a4a, 6, 9, 1.5); // cold moonlight from the window
    fill.position.set(-2.2, 2.3, -4.6);
    scene.add(fill);

    this.gun = M.makeGun();
    this.gun.scale.setScalar(1.1);
    scene.add(this.gun);
    this.gunHomeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2, 'YXZ'));
    this.gunHomeP = V3(-0.05, TY + 0.045, 0);
    this.gun.position.copy(this.gunHomeP);
    this.gun.quaternion.copy(this.gunHomeQ);
    this.gun.userData.pick = { kind: 'gun' };

    this.tray = M.makeTray();
    this.tray.visible = false;
    scene.add(this.tray);
    this.trayItems = new Map();

    this.P = [];
    this.itemMeshes = new Map();
    this.spent = [];
    this.viewer = 0;
    this.n = 0;
    this.names = [];
    this.vs = null;
    this.targeting = null;
    this.tagLayer = document.getElementById('tags');
    this.domTags = [];
    this.clock = new THREE.Clock();
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.chainMat = M.makeCuffRing().material;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    requestAnimationFrame(loop);
    // keep animations (and therefore the online host) moving while the tab is hidden
    setInterval(() => { if (document.hidden) tickAnims(0.5); }, 200);
  }

  // ---------------- render loop ----------------
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    let px = Math.max(2, Math.min(6, Math.round(Math.min(w, h) / 270)));
    if (!this.retro) px = Math.max(1, Math.round(px / 2));
    const rw = Math.ceil(w / px), rh = Math.ceil(h / px);
    this.renderer.setSize(rw, rh, false);
    snapUniform.value.set(rw * 0.35, rh * 0.35);
    this.camera.aspect = w / h;
    this.camera.fov = w / h >= 1 ? 58 : 72;
    this.camera.updateProjectionMatrix();
    if (this.camMode === 'seat' && !this.camBusy && !this.targeting) { const h0 = this.camHome(); this.camPos.copy(h0.pos); this.camLook.copy(h0.look); }
  }
  setRetro(on) { this.retro = on; this.resize(); }

  frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    const t0 = this.time;
    tickGlow(t0);
    tickAnims(dt);
    this.lamp.rotation.z = Math.sin(t0 * 0.5) * 0.035;
    this.lamp.rotation.x = Math.cos(t0 * 0.37) * 0.025;
    const flick = Math.random() < 0.01 ? 0.55 : 1;
    this.spot.intensity = this.spotBase * flick * (0.97 + Math.sin(t0 * 9) * 0.03);
    this.glow.intensity = 7 * flick;
    const tr = this.tremble;
    for (const p of this.P) {
      if (p.alive) {
        p.char.userData.body.scale.y = 1 + Math.sin(t0 * 1.6 + p.phase) * 0.012;
        p.char.userData.head.rotation.y = Math.sin(t0 * 0.4 + p.phase) * 0.12 + p.lookY;
        p.char.userData.head.rotation.z = Math.sin(t0 * 0.3 + p.phase * 2) * 0.04;
      }
      if (tr && tr.chars.includes(p.idx)) {
        const b = p.char.userData.body;
        b.position.x = (Math.random() - 0.5) * 0.035;
        b.position.z = (Math.random() - 0.5) * 0.02;
      }
      for (const c of p.candles) {
        if (c.userData.lit) c.userData.flame.scale.set(1, 1 + Math.sin(t0 * 13 + c.userData.phase) * 0.18 + Math.random() * 0.1, 1);
      }
      if (p.cuffs) this.updateChain(p);
    }
    if (tr && tr.gun) {
      const b = this.gun.userData.body;
      b.position.set((Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.008);
    }
    if (this.targeting) {
      const pulse = 1 + Math.sin(t0 * 6) * 0.08;
      for (const m of this.targeting.rings) {
        const sel = this.targeting.selected === m.userData.pick.idx;
        m.scale.setScalar((sel ? 1.35 : 1) * pulse);
      }
    }
    if (this.itemPick) {
      for (const [uid, m] of this.itemMeshes) {
        if (m.userData.owner !== this.itemPick.target || !m.userData.base) continue;
        const sel = this.itemPick.selected === m.userData.slot;
        m.position.y = m.userData.base.y + (sel ? 0.09 : 0.025 + Math.sin(t0 * 5 + m.userData.slot) * 0.02);
      }
    }
    if (this.camMode === 'orbit') {
      const a = t0 * 0.08;
      this.camPos.set(Math.sin(a) * 3.6, 2.5, Math.cos(a) * 3.6);
      this.camLook.set(0, TY + 0.2, 0);
    }
    this.camera.position.copy(this.camPos);
    if (this.shakeAmt > 0.0005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    if (tr && tr.cam) {
      this.camera.position.x += (Math.random() - 0.5) * 0.03;
      this.camera.position.y += (Math.random() - 0.5) * 0.03;
    }
    if (this.lowHp && this.camMode === 'seat') {
      this.camera.position.x += Math.sin(t0 * 2.3) * 0.012 + (Math.random() - 0.5) * 0.008;
      this.camera.position.y += Math.sin(t0 * 3.1) * 0.008 + (Math.random() - 0.5) * 0.008;
    }
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
    this.placeTags();
  }

  // ---------------- crisp HTML labels pinned to 3D spots ----------------
  addTag(html, anchor, { offset = V3(), cls = '', group = 'misc', onClick } = {}) {
    const el = document.createElement('div');
    el.className = `tag3d ${cls}`;
    el.innerHTML = html;
    if (onClick) { el.classList.add('click'); el.addEventListener('pointerup', (e) => { e.stopPropagation(); onClick(); }); }
    this.tagLayer.appendChild(el);
    const tag = { el, anchor, offset, group };
    this.domTags.push(tag);
    return tag;
  }
  removeTags(group) {
    this.domTags = this.domTags.filter((tg) => {
      if (group && tg.group !== group) return true;
      tg.el.remove();
      return false;
    });
  }
  placeTags() {
    if (!this.domTags.length) return;
    const r = this.canvas.getBoundingClientRect();
    const v = V3();
    for (const tg of this.domTags) {
      if (tg.anchor.isObject3D) {
        if (!tg.anchor.parent || !tg.anchor.visible) { tg.el.style.display = 'none'; continue; }
        tg.anchor.getWorldPosition(v);
      } else v.copy(tg.anchor);
      v.add(tg.offset).project(this.camera);
      if (v.z > 1) { tg.el.style.display = 'none'; continue; }
      tg.el.style.display = '';
      // keep labels on screen (far seats sit at the edges on narrow phones)
      const half = (tg.el.offsetWidth || 80) / 2 + 4;
      const x = Math.max(r.left + half, Math.min(r.right - half, r.left + ((v.x + 1) / 2) * r.width));
      const y = Math.max(r.top + 70, Math.min(r.bottom - 60, r.top + ((1 - v.y) / 2) * r.height));
      tg.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  stopTremble() {
    const tr = this.tremble;
    this.tremble = null;
    if (!tr) return;
    for (const i of tr.chars) if (this.P[i]) this.P[i].char.userData.body.position.set(0, this.P[i].alive ? 0 : -0.25, 0);
    this.gun.userData.body.position.set(0, 0, 0);
  }

  // ---------------- seats & camera ----------------
  seat(i) {
    const a = (Math.PI * 2 * i) / this.n;
    const d = V3(Math.sin(a), 0, Math.cos(a));
    const r = V3(Math.cos(a), 0, -Math.sin(a));
    return {
      a, d, r, faceIn: a + Math.PI,
      at: (rad, lat = 0, y = TY) => V3(d.x * rad + r.x * lat, y, d.z * rad + r.z * lat),
    };
  }
  camHome(v = this.viewer, wide = 1) {
    const s = this.seat(v);
    const aspect = this.camera.aspect;
    let dist, elev;
    if (aspect >= 1.2) { dist = 3.25; elev = 0.56; } else if (aspect >= 0.8) { dist = 3.9; elev = 0.66; } else { dist = 4.9; elev = 0.6; }
    dist *= wide;
    if (wide > 1) elev += 0.12;
    const look = s.at(-0.15, 0, TY + 0.1);
    const pos = look.clone().addScaledVector(s.d, dist * Math.cos(elev));
    pos.y = Math.min(3.95, pos.y + dist * Math.sin(elev)); // never above the beams
    return { pos, look };
  }
  async camTo(pos, look, dur = 0.6, e = ease.inOut) {
    const p0 = this.camPos.clone(), l0 = this.camLook.clone();
    this.camBusy = true;
    await animate(dur, (k) => { this.camPos.lerpVectors(p0, pos, k); this.camLook.lerpVectors(l0, look, k); }, e);
    this.camBusy = false;
  }
  camHomeNow() { const h = this.camHome(); this.camPos.copy(h.pos); this.camLook.copy(h.look); }
  async goHome(dur = 0.6) { const h = this.camHome(); await this.camTo(h.pos, h.look, dur); }

  async setViewer(v, instant) {
    if (this.viewer === v && this.camMode === 'seat') return;
    const old = this.viewer;
    this.viewer = v;
    this.camMode = 'seat';
    this.P.forEach((p, i) => { p.char.visible = i !== v; });
    if (instant) { this.camHomeNow(); return; }
    const h = this.camHome();
    const mid = V3(0, 3.4, 0);
    if (old !== v) {
      const p0 = this.camPos.clone(), l0 = this.camLook.clone();
      this.camBusy = true;
      await animate(1.1, (k) => {
        const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
        this.camPos.set(p0.x * a + mid.x * b + h.pos.x * c, p0.y * a + mid.y * b + h.pos.y * c, p0.z * a + mid.z * b + h.pos.z * c);
        this.camLook.lerpVectors(l0, h.look, k);
      });
      this.camBusy = false;
    } else await this.camTo(h.pos, h.look, 0.6);
  }

  // ---------------- setup ----------------
  clearGame() {
    finishAll();
    this.endTargeting(true);
    this.endItemPick(true);
    this.stopTremble();
    this.removeTags();
    for (const p of this.P) {
      this.scene.remove(p.char);
      p.hands.forEach((h) => { h.parent && h.parent.remove(h); });
      p.candles.forEach((c) => this.scene.remove(c));
      p.shields.forEach((c) => this.scene.remove(c));
      Object.values(p.status).forEach((s) => s && this.scene.remove(s));
      if (p.cuffs) this.scene.remove(p.cuffs.chain);
    }
    this.P = [];
    for (const m of this.itemMeshes.values()) m.parent && m.parent.remove(m);
    this.itemMeshes.clear();
    this.clearSpent(true);
    this.hideTray(true);
    this.gun.position.copy(this.gunHomeP);
    this.gun.quaternion.copy(this.gunHomeQ);
    this.gun.scale.setScalar(1.1);
    this.gun.userData.body.position.set(0, 0, 0);
    this.gun.userData.body.rotation.set(0, 0, 0);
    M.setGunState(this.gun, { saw: false, double: false });
    this.lowHp = false;
  }

  // players: [{name, char}]
  setup(players, viewer, snap) {
    this.clearGame();
    this.n = players.length;
    this.names = players.map((p) => p.name);
    this.viewer = viewer;
    players.forEach((pl, i) => {
      const s = this.seat(i);
      const ch = M.makeCharacter(pl.char % 4);
      ch.position.copy(s.at(M.SEAT_R, 0, 0));
      ch.rotation.y = s.faceIn;
      ch.userData.pick = { kind: 'player', idx: i };
      this.scene.add(ch);
      const hands = [M.makeHand(-1), M.makeHand(1)];
      const rest = [s.at(1.58, -0.36, TY + 0.005), s.at(1.58, 0.36, TY + 0.005)];
      const restQ = quatFromEuler(0, s.faceIn, 0);
      hands.forEach((h, k) => { h.position.copy(rest[k]); h.quaternion.copy(restQ); this.scene.add(h); });
      this.P.push({ idx: i, seat: s, char: ch, hands, rest, restQ, candles: [], shields: [], status: {}, cuffs: null, alive: true, phase: Math.random() * 6, lookY: 0 });
    });
    this.camMode = 'seat';
    this.P.forEach((p, i) => { p.char.visible = i !== viewer; });
    this.camHomeNow();
    if (snap) this.sync(snap, true);
  }

  // Title screen: four patrons and the gun, slow orbiting camera.
  setupDemo() {
    this.setup([0, 1, 2, 3].map((k) => ({ name: charName(k), char: k })), -1);
    this.P.forEach((p) => { p.char.visible = true; this.setCandles(p, 4, 4); });
    this.camMode = 'orbit';
  }

  setCandles(P, hp, maxHp) {
    while (P.candles.length < maxHp) {
      const c = M.makeCandle();
      c.scale.setScalar(1.4);
      const k = P.candles.length;
      c.position.copy(P.seat.at(0.8, -0.14 - k * 0.075, TY));
      this.scene.add(c);
      P.candles.push(c);
    }
    P.candles.forEach((c, k) => this.lightCandle(c, k < hp, true));
  }
  setShields(P, n, animated) {
    while (P.shields.length < n) {
      const s = M.makeShieldToken();
      s.scale.setScalar(1.5);
      s.position.copy(P.seat.at(0.64, -0.14 - P.shields.length * 0.07, TY));
      this.scene.add(s);
      P.shields.push(s);
      if (animated) { s.scale.setScalar(0.01); scaleTo(s, 1.5, 0.35, ease.back); }
    }
    while (P.shields.length > n) {
      const s = P.shields.pop();
      if (animated) { this.puff(s.position.clone().add(V3(0, 0.05, 0)), 0x5a8ad0); scaleTo(s, 0.01, 0.25).then(() => this.scene.remove(s)); } else this.scene.remove(s);
    }
  }
  lightCandle(c, on, instant) {
    if (!c || c.userData.lit === on) return;
    c.userData.lit = on;
    c.userData.flame.visible = on;
    if (!on && !instant) this.puff(c.position.clone().add(V3(0, 0.15, 0)));
  }
  puff(pos, color = 0x6a6a60, size = 1) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.03 * size, 5, 4), basic(color, { transparent: true, opacity: 0.6, depthWrite: false }));
    m.position.copy(pos);
    this.scene.add(m);
    const p0 = pos.clone();
    animate(1.0, (k) => {
      m.position.set(p0.x, p0.y + k * 0.25, p0.z);
      m.scale.setScalar(1 + k * 3);
      m.material.opacity = 0.6 * (1 - k);
    }, ease.out).then(() => { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  slotPos(i, slot) { return this.P[i].seat.at(SLOT_ROWS[Math.floor(slot / SLOT_N)], SLOT_COLS[slot % SLOT_N], TY); }
  slotQuat(i, slot) { return quatFromEuler(0, this.P[i].seat.a + (((slot * 37) % 7) - 3) * 0.05, 0); }
  makeItemMesh(id, uid) {
    const m = M.makeItem(id);
    m.userData.uid = uid;
    m.userData.pick = { kind: 'item', uid };
    m.add(this.hitBox());
    return m;
  }
  // invisible box around an item so taps don't have to land on its thin parts
  hitBox() {
    if (!this._hitGeo) { this._hitGeo = new THREE.BoxGeometry(0.15, 0.1, 0.15); this._hitMat = new THREE.MeshBasicMaterial({ visible: false }); }
    const b = new THREE.Mesh(this._hitGeo, this._hitMat);
    b.position.y = 0.05;
    b.userData.hitbox = true;
    return b;
  }
  placeItem(m, i, slot) {
    m.position.copy(this.slotPos(i, slot));
    m.quaternion.copy(this.slotQuat(i, slot));
    m.scale.setScalar(ITEM_SCALE);
    m.userData.base = m.position.clone();
    if (m.parent !== this.scene) this.scene.attach(m);
  }
  gunState(vs) {
    const ps = (vs || this.vs).players;
    M.setGunState(this.gun, { saw: ps.some((p) => p.alive && p.saw), double: ps.some((p) => p.alive && p.double) });
  }

  // ---------------- authoritative sync ----------------
  sync(snap, instant) {
    if (!snap || !this.P.length) return;
    this.vs = JSON.parse(JSON.stringify(snap));
    this.stopTremble();
    snap.players.forEach((pl, i) => {
      const P = this.P[i];
      if (!P) return;
      this.setCandles(P, pl.hp, pl.maxHp);
      this.setShields(P, pl.alive ? pl.shield || 0 : 0, false);
      if (pl.alive !== P.alive) this.setAlivePose(P, pl.alive);
      for (const key of STATUS_ORDER) this.setStatus(i, key, key === 'hacked' ? !!(pl.hacked || pl.jammed) : !!pl[key], true);
      this.setCuffs(i, pl.cuffed, true);
      const want = new Set();
      pl.slots.forEach((s, slot) => {
        if (!s) return;
        want.add(s.uid);
        let m = this.itemMeshes.get(s.uid);
        if (!m) { m = this.makeItemMesh(s.id, s.uid); this.itemMeshes.set(s.uid, m); this.scene.add(m); }
        m.userData.owner = i;
        m.userData.slot = slot;
        m.userData.pick = { kind: 'item', uid: s.uid };
        this.placeItem(m, i, slot);
        m.visible = pl.alive;
      });
      for (const [uid, m] of this.itemMeshes) {
        if (m.userData.owner === i && !want.has(uid)) { m.parent && m.parent.remove(m); this.itemMeshes.delete(uid); }
      }
    });
    const held = new Set();
    snap.players.forEach((pl) => pl.slots.forEach((s) => s && held.add(s.uid)));
    for (const [uid, m] of this.itemMeshes) if (!held.has(uid)) { m.parent && m.parent.remove(m); this.itemMeshes.delete(uid); }
    const d = snap.decision;
    const trayPhase = d && (d.kind === 'take' || d.kind === 'draft' || d.kind === 'shop') && snap.tray.length;
    if (trayPhase) this.ensureTray(snap.tray, d.kind === 'shop');
    else if (this.tray.visible) this.hideTray(instant);
    if (this.gun.parent !== this.scene) this.scene.attach(this.gun);
    this.gun.position.copy(this.gunHomeP);
    this.gun.quaternion.copy(this.gunHomeQ);
    this.gun.scale.setScalar(1.1);
    this.gunState(snap);
    this.P.forEach((P) => P.hands.forEach((h, k) => {
      if (h.parent !== this.scene) this.scene.attach(h);
      h.position.copy(P.rest[k]);
      h.quaternion.copy(P.restQ);
      h.scale.setScalar(1.25);
      M.setCurl(h, 0);
      h.visible = P.alive;
    }));
    if (!trayPhase && this.camMode === 'seat' && !this.targeting && !this.itemPick) this.camHomeNow();
    if (this.ui && this.ui.hud) this.ui.hud(snap, this.viewer);
  }

  setAlivePose(P, alive) {
    P.alive = alive;
    const b = P.char.userData.body;
    if (alive) { b.rotation.x = 0; b.position.y = 0; } else { b.rotation.x = -0.9; b.position.y = -0.25; }
    P.char.userData.eyes.forEach((e) => { e.visible = alive; });
    P.hands.forEach((h) => { h.visible = alive; });
  }

  setStatus(i, key, on, instant) {
    const P = this.P[i];
    const cur = P.status[key];
    if (on && !cur) {
      const m = M.makeItem(STATUS_ITEM[key], { glow: false });
      const k = STATUS_ORDER.indexOf(key);
      m.position.copy(P.seat.at(0.8, 0.16 + k * 0.1, TY));
      m.rotation.y = P.seat.a;
      m.scale.setScalar(instant ? 1.05 : 0.01);
      this.scene.add(m);
      P.status[key] = m;
      if (!instant) scaleTo(m, 1.05, 0.35, ease.back);
    } else if (!on && cur) {
      P.status[key] = null;
      if (instant) this.scene.remove(cur);
      else scaleTo(cur, 0.01, 0.3).then(() => this.scene.remove(cur));
    }
  }

  // Handcuffs: one ring snapped around each wrist, a chain between them.
  setCuffs(i, on, instant) {
    const P = this.P[i];
    if (on && !P.cuffs) {
      const rings = P.hands.map((h) => {
        const ring = M.makeCuffRing();
        ring.position.set(0, 0.03, -0.085);
        h.add(ring);
        return ring;
      });
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 4), this.chainMat);
      this.scene.add(chain);
      P.cuffs = { rings, chain };
      this.updateChain(P);
      if (!instant) rings.forEach((r) => { r.scale.setScalar(2.4); scaleTo(r, 1, 0.3, ease.back); });
    } else if (!on && P.cuffs) {
      const { rings, chain } = P.cuffs;
      P.cuffs = null;
      this.scene.remove(chain);
      if (instant) rings.forEach((r) => r.parent && r.parent.remove(r));
      else rings.forEach((r) => scaleTo(r, 2.2, 0.25, ease.out).then(() => r.parent && r.parent.remove(r)));
    }
  }
  updateChain(P) {
    const a = P.cuffs.rings[0].getWorldPosition(V3());
    const b = P.cuffs.rings[1].getWorldPosition(V3());
    const c = P.cuffs.chain;
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.position.y -= 0.01;
    const dir = b.clone().sub(a);
    const len = dir.length();
    c.scale.set(1, Math.max(0.01, len), 1);
    if (len > 1e-4) c.quaternion.setFromUnitVectors(UP, dir.normalize());
    c.visible = P.cuffs.rings[0].parent.visible !== false && P.alive;
  }

  // ---------------- tray ----------------
  trayPose() {
    const s = this.seat(this.viewer < 0 ? 0 : this.viewer);
    const pos = s.at(0.12, 0, TY + 0.4);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, s.a, 0, 'YXZ'));
    return { pos, q, s };
  }
  layoutTray(n) {
    const { W, D } = this.tray.userData;
    const scale = n <= 6 ? 2.1 : n <= 10 ? 1.7 : n <= 16 ? 1.3 : 1.05;
    const minD = 0.13 * scale;
    const pts = [];
    for (let tries = 0; pts.length < n && tries < 4000; tries++) {
      const p = { x: (Math.random() - 0.5) * (W - 0.18), z: (Math.random() - 0.5) * (D - 0.16) };
      if (pts.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 > minD * minD)) pts.push(p);
    }
    if (pts.length < n) { // fall back to a jittered grid
      pts.length = 0;
      const cols = Math.ceil(Math.sqrt((n * W) / D));
      const rows = Math.ceil(n / cols);
      for (let k = 0; k < n; k++) {
        const c = k % cols, r = Math.floor(k / cols);
        pts.push({ x: (-W / 2 + 0.09) + ((c + 0.5) * (W - 0.18)) / cols, z: (-D / 2 + 0.08) + ((r + 0.5) * (D - 0.16)) / rows });
      }
    }
    return { pts, scale };
  }
  ensureTray(items, shop) {
    const have = new Set(items.map((x) => x.uid));
    for (const [uid, m] of this.trayItems) if (!have.has(uid)) { m.parent && m.parent.remove(m); this.trayItems.delete(uid); if (m.userData.label) { m.userData.label.el.remove(); this.domTags = this.domTags.filter((tg) => tg !== m.userData.label); } }
    const missing = items.filter((x) => !this.trayItems.has(x.uid));
    if (missing.length || !this.tray.visible) {
      if (!this.tray.visible) this.showTrayInstant();
      const { pts, scale } = this.layoutTray(items.length);
      let k = 0;
      for (const x of items) {
        if (this.trayItems.has(x.uid)) { k++; continue; }
        this.tray.add(this.makeTrayItem(x, shop, pts[k++], scale));
      }
    }
  }
  makeTrayItem(x, shop, p, scale) {
    const m = M.makeItem(x.id);
    m.userData.uid = x.uid;
    m.userData.pick = { kind: 'tray', uid: x.uid };
    m.add(this.hitBox());
    m.position.set(p.x, this.tray.userData.top, p.z);
    m.rotation.y = (Math.random() - 0.5) * 1.2;
    m.scale.setScalar(scale);
    if (shop) {
      const tier = M.itemTier(x.id);
      m.userData.label = this.addTag(`<span class="chip"></span>${x.price}`, m, { offset: V3(0, 0.13, 0), cls: `price${tier !== 'common' ? ` t-${tier}` : ''}`, group: 'price' });
    }
    this.trayItems.set(x.uid, m);
    return m;
  }
  showTrayInstant() {
    const { pos, q } = this.trayPose();
    this.tray.visible = true;
    this.tray.position.copy(pos);
    this.tray.quaternion.copy(q);
    this.tray.scale.setScalar(1);
    this.showLight.intensity = 1.2;
    this.trayCam(true);
  }
  trayCam(instant) {
    const { pos, s } = this.trayPose();
    const aspect = this.camera.aspect;
    const k = aspect >= 1.2 ? 1 : aspect >= 0.8 ? 1.3 : 1.85;
    const cp = pos.clone().addScaledVector(s.d, 0.95 * k);
    cp.y = Math.min(3.95, cp.y + 0.75 * k);
    const look = pos.clone();
    if (instant) { this.camPos.copy(cp); this.camLook.copy(look); return Promise.resolve(); }
    return this.camTo(cp, look, 0.7);
  }
  async showTray(items, shop) {
    this.removeTags('price');
    for (const m of this.trayItems.values()) m.parent && m.parent.remove(m);
    this.trayItems.clear();
    const { pos, q } = this.trayPose();
    const { pts, scale } = this.layoutTray(items.length);
    items.forEach((x, k) => this.tray.add(this.makeTrayItem(x, shop, pts[k], scale)));
    this.tray.visible = true;
    this.tray.position.set(0, TY + 0.05, 0);
    this.tray.quaternion.copy(q);
    this.tray.scale.setScalar(0.01);
    sfx('whoosh');
    this.showLight.intensity = 1.2;
    await Promise.all([
      moveTo(this.tray, pos, 0.6, { e: ease.out }),
      scaleTo(this.tray, 1, 0.6, ease.back),
      this.trayCam(false),
    ]);
  }
  async hideTray(instant) {
    this.removeTags('price');
    if (instant) {
      this.tray.visible = false;
      this.showLight.intensity = 0;
      for (const m of this.trayItems.values()) m.parent && m.parent.remove(m);
      this.trayItems.clear();
      return;
    }
    if (!this.tray.visible) return;
    await Promise.all([
      moveTo(this.tray, V3(0, TY + 0.05, 0), 0.45, { e: ease.in }),
      scaleTo(this.tray, 0.01, 0.45, ease.in),
      this.goHome(0.6),
    ]);
    this.tray.visible = false;
    this.showLight.intensity = 0;
    for (const m of this.trayItems.values()) m.parent && m.parent.remove(m);
    this.trayItems.clear();
  }

  // ---------------- picking targets at the table ----------------
  // kind: 'player' (alive others, maybe yourself) or 'dead'. problem(i) -> text|null
  startTargeting({ kind = 'player', allowSelf = false, problem = () => null }) {
    this.endTargeting(true);
    const T = { rings: [], tags: [], selected: null, valid: new Set() };
    const vs = this.vs;
    vs.players.forEach((p, i) => {
      const self = i === this.viewer;
      if (kind === 'dead' ? p.alive : !p.alive) return;
      if (self && !allowSelf) return;
      const reason = problem(i);
      const P = this.P[i];
      const ring = M.makeTargetRing(reason ? 0x6a6a6a : self ? 0x88ccff : 0xffcc55);
      ring.position.copy(self ? P.seat.at(1.35, 0, TY + 0.012) : P.seat.at(1.2, 0, TY + 0.012));
      if (self) ring.scale.setScalar(1.4);
      ring.userData.pick = { kind: 'target', idx: i };
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const hp = p.alive ? `<em>${'▲'.repeat(Math.max(0, p.hp))}${p.shield ? `<b>${'◆'.repeat(p.shield)}</b>` : ''}</em>` : '';
      const label = self ? esc(t('yourself')) : `${esc(p.name)} ${hp}`;
      const tag = this.addTag(label, self ? P.seat.at(1.35, 0, TY + 0.3) : P.seat.at(M.SEAT_R - 0.15, 0, kind === 'dead' ? 1.0 : 1.3), {
        cls: `${reason ? 'bad' : ''} ${self ? 'self' : ''}`, group: 'target',
        onClick: () => this.ui && this.ui.onPick({ kind: 'target', idx: i }, this.ui.req ? this.ui.req.snap : this.vs),
      });
      tag.idx = i;
      this.scene.add(ring);
      T.rings.push(ring);
      T.tags.push(tag);
      if (!reason) T.valid.add(i);
    });
    this.targeting = T;
    const h = this.camHome(this.viewer, 1.18);
    this.camTo(h.pos, h.look, 0.6);
    return T;
  }
  selectTarget(i) {
    if (!this.targeting) return;
    this.targeting.selected = i;
    this.targeting.rings.forEach((r) => {
      const sel = r.userData.pick.idx === i;
      r.material = basic(sel ? 0xff4030 : (this.targeting.valid.has(r.userData.pick.idx) ? (r.userData.pick.idx === this.viewer ? 0x88ccff : 0xffcc55) : 0x6a6a6a), { transparent: true, opacity: 0.95, depthWrite: false });
    });
    this.targeting.tags.forEach((tg) => tg.el.classList.toggle('sel', tg.idx === i));
    sfx('ui');
  }
  endTargeting(instant) {
    const T = this.targeting;
    if (!T) return;
    this.targeting = null;
    T.rings.forEach((m) => this.scene.remove(m));
    this.removeTags('target');
    if (!instant && this.camMode === 'seat') this.goHome(0.5);
  }
  // Look at one player's items and let the viewer tap one.
  startItemPick(target) {
    this.endItemPick(true);
    this.itemPick = { target, selected: null };
    const P = this.P[target];
    const look = P.seat.at(1.16, 0, TY);
    // stay below and beside the hanging lamp (its shade spans y≈2.8–3.1 over the middle)
    const pos = this.camera.aspect < 1 ? P.seat.at(-0.62, 0, TY + 1.65) : P.seat.at(-0.15, 0, TY + 1.5);
    this.camTo(pos, look, 0.7);
  }
  selectItem(slot) { if (this.itemPick) { this.itemPick.selected = slot; sfx('ui'); } }
  endItemPick(instant) {
    const I = this.itemPick;
    if (!I) return;
    this.itemPick = null;
    for (const m of this.itemMeshes.values()) if (m.userData.owner === I.target && m.userData.base) m.position.copy(m.userData.base);
    if (!instant && this.camMode === 'seat') this.goHome(0.5);
  }

  // ---------------- hands ----------------
  async handTo(hand, pos, dur = 0.35, arc = 0.08, q) {
    if (hand.parent !== this.scene) this.scene.attach(hand);
    const ps = [moveTo(hand, pos, dur, { arc })];
    if (q) ps.push(turnTo(hand, q, dur));
    await Promise.all(ps);
  }
  async handHome(P, k, dur = 0.35) {
    const h = P.hands[k];
    if (h.parent !== this.scene) this.scene.attach(h);
    const c0 = h.userData.curl;
    await Promise.all([
      moveTo(h, P.rest[k], dur, { arc: 0.06 }),
      turnTo(h, P.restQ, dur),
      animate(dur, (e) => M.setCurl(h, c0 * (1 - e))),
    ]);
  }
  async curl(hand, to, dur = 0.12) {
    const c0 = hand.userData.curl;
    await animate(dur, (e) => M.setCurl(hand, c0 + (to - c0) * e));
  }
  async carryToSlot(P, mesh, owner, slot, handIdx = 1) {
    const hand = P.hands[handIdx];
    const wp = mesh.getWorldPosition(V3());
    await this.handTo(hand, wp.clone().add(V3(0, 0.05, 0)), 0.38, 0.12);
    await this.curl(hand, 1);
    sfx('pickup');
    hand.attach(mesh);
    const dst = this.slotPos(owner, slot);
    await this.handTo(hand, dst.clone().add(V3(0, 0.05, 0)), 0.45, 0.25);
    this.scene.attach(mesh);
    const p0 = mesh.position.clone(), q0 = mesh.quaternion.clone(), s0 = mesh.scale.clone();
    const q1 = this.slotQuat(owner, slot);
    await Promise.all([
      animate(0.15, (e) => { mesh.position.lerpVectors(p0, dst, e); mesh.quaternion.slerpQuaternions(q0, q1, e); mesh.scale.lerpVectors(s0, V3(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE), e); }),
      this.curl(hand, 0, 0.15),
    ]);
    mesh.userData.base = dst.clone();
    sfx('thud');
    this.handHome(P, handIdx, 0.3);
  }

  // ---------------- naming helpers ----------------
  A(i) { return { n: this.names[i], me: i === this.viewer }; }
  say(text, dur) { if (this.ui && this.ui.say) this.ui.say(text, dur); }
  hud() { if (this.ui && this.ui.hud && this.vs) this.ui.hud(this.vs, this.viewer); }

  // ---------------- event playback ----------------
  async play(events, snap) {
    for (const e of events) {
      try { await this.playOne(e); } catch (err) { console.error('anim error', e, err); }
    }
    this.sync(snap);
  }

  async playOne(e) {
    const vs = this.vs;
    const pl = (i) => vs.players[i];
    switch (e.t) {
      case 'gameStart':
        this.say(t('c_first', { a: this.A(e.first) }), 2.2);
        await wait(1.2);
        break;
      case 'roundStart': await this.roundStart(e); break;
      case 'load': await this.load(e); break;
      case 'tray': {
        if (e.order && e.mode !== 'draft' && e.order.length > 1) {
          // whoever shoots next gets first pick
          this.say(t('c_firstPick', { a: this.A(e.order[0]) }), 1.8);
          await wait(1.3);
        }
        if (e.mode === 'shop') this.say(e.player === this.viewer ? t('c_shopYou', { chips: e.chips }) : t('c_shopOther', { a: this.A(e.player), chips: e.chips }), 3);
        else if (e.mode === 'draft') this.say(t('c_draft', { picks: e.picks, a: this.A(e.order[0]) }), 3.6);
        else {
          const free = pl(e.player).slots.filter((s) => !s).length;
          this.say(e.player === this.viewer ? t('c_progYou', { free }) : t('c_progOther', { a: this.A(e.player), k: e.items.length }), 3);
        }
        vs.decision = e.player >= 0 ? { kind: e.mode, player: e.player } : null;
        this.hud();
        await this.showTray(e.items, e.mode === 'shop');
        break;
      }
      case 'take': case 'buy': {
        const m = this.trayItems.get(e.uid) || (() => { const x = this.makeItemMesh(e.id, e.uid); x.position.copy(this.tray.position); this.scene.add(x); return x; })();
        this.trayItems.delete(e.uid);
        if (m.userData.label) { this.domTags = this.domTags.filter((tg) => tg !== m.userData.label); m.userData.label.el.remove(); m.userData.label = null; }
        m.userData.pick = { kind: 'item', uid: e.uid };
        m.userData.owner = e.player;
        m.userData.slot = e.slot;
        this.itemMeshes.set(e.uid, m);
        pl(e.player).slots[e.slot] = { uid: e.uid, id: e.id };
        if (e.t === 'buy') { pl(e.player).chips = e.chips; sfx('coin'); }
        const item = itemName(e.id);
        this.say(e.t === 'buy' ? t('c_bought', { a: this.A(e.player), item, chips: e.chips }) : t('c_took', { a: this.A(e.player), item }), 2);
        await this.carryToSlot(this.P[e.player], m, e.player, e.slot);
        this.hud();
        break;
      }
      case 'trayEnd': {
        if (e.lost.length && e.reason === 'full') this.say(t('c_lost', { k: e.lost.length }), 2.4);
        else if (e.lost.length && e.reason === 'leftover') this.say(t('c_leftover'), 2);
        for (const uid of e.lost) { const m = this.trayItems.get(uid); if (m) scaleTo(m, 0.01, 0.3, ease.in); }
        if (e.lost.length) await wait(0.4);
        await this.hideTray(false);
        break;
      }
      case 'turn': {
        this.say(t('c_turn', { a: this.A(e.player) }), 2);
        vs.turn = e.player;
        vs.decision = { kind: 'turn', player: e.player };
        this.hud();
        const h = this.P[e.player].char.userData.head;
        const y0 = h.position.y;
        await animate(0.4, (k) => { h.position.y = y0 + Math.sin(k * Math.PI) * 0.04; });
        break;
      }
      case 'jammed': {
        pl(e.player).hacked = false;
        pl(e.player).jammed = true;
        sfx('hack');
        this.say(t('c_jammed', { a: this.A(e.player) }), 2.4);
        this.hud();
        await wait(1.0);
        break;
      }
      case 'cuffSkip':
        this.say(t('c_cuffSkip', { a: this.A(e.player) }), 2.4);
        sfx('chain');
        this.setCuffs(e.player, false);
        pl(e.player).cuffed = false;
        await wait(1.2);
        break;
      case 'item': await this.useItem(e); break;
      case 'shot': await this.shot(e); break;
      case 'damage': await this.damage(e); break;
      case 'death': await this.death(e); break;
      case 'revive': await this.revive(e); break;
      case 'mgResult': {
        const losers = e.losers.map((i) => (i === this.viewer ? t('you') : this.names[i])).join(', ');
        this.say(t('c_mgResult', { losers, k: e.dmg || 1 }), 3);
        await wait(1.4);
        break;
      }
      case 'roundEnd': {
        this.say(t('c_empty'), 1.8);
        await wait(1.0);
        if (e.gains && e.gains.length) {
          const parts = e.gains.map((g) => `${g.player === this.viewer ? t('you') : this.names[g.player]} +${g.gain}`).join(', ');
          e.gains.forEach((g) => { pl(g.player).chips = g.chips; });
          sfx('coin');
          this.say(t('c_chips', { parts }), 2.6);
          this.hud();
          await wait(1.6);
        }
        break;
      }
      case 'gameOver': {
        sfx('win');
        const w = e.winner;
        this.say(t('c_last', { a: this.A(w) }), 4);
        if (this.P[w]) {
          const h = this.P[w].char.userData.head;
          const y0 = h.position.y;
          await animate(1.2, (k) => { h.position.y = y0 + Math.abs(Math.sin(k * Math.PI * 3)) * 0.05; });
        }
        await wait(1.2);
        break;
      }
    }
  }

  async roundStart(e) {
    const vs = this.vs;
    vs.round = e.round;
    vs.shellsLeft = e.total;
    this.clearSpent(false);
    this.say(t('c_round', { r: e.round }), 1.6);
    await wait(0.9);
    // Belt showcase: pops up right in front of the camera. The display order is
    // shuffled on its own — it says nothing about the order inside the gun.
    const belt = M.makeBelt(e.total);
    const cam = this.camera;
    const dist = 0.5;
    const visH = 2 * dist * Math.tan((cam.fov * Math.PI) / 360);
    const visW = visH * cam.aspect;
    const sc = Math.min(1.0, (0.8 * visW) / belt.userData.width);
    this.showLight.intensity = 2.2;
    belt.scale.setScalar(sc);
    belt.position.set(0, -visH * 0.8, -dist);
    belt.rotation.x = 0.15;
    cam.add(belt);
    sfx('whoosh');
    await moveTo(belt, V3(0, -0.035 * sc, -dist), 0.5, { e: ease.out });
    const shells = [];
    for (let k = 0; k < e.total; k++) shells.push(k < e.live);
    for (let i = shells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shells[i], shells[j]] = [shells[j], shells[i]]; }
    this.say(t('c_shells', { live: e.live, blank: e.blank }), 3.4);
    for (let k = 0; k < shells.length; k++) {
      const s = M.makeShell(shells[k]);
      s.position.set(-belt.userData.width / 2 + 0.07 + k * 0.06, 0.3, 0.02);
      belt.add(s);
      sfx('shellIn');
      moveTo(s, V3(s.position.x, 0.0, 0.02), 0.18, { e: ease.out });
      await wait(0.12);
    }
    await wait(1.9);
    await moveTo(belt, V3(0, -visH * 0.9, -dist), 0.4, { e: ease.in });
    cam.remove(belt);
    this.showLight.intensity = 0;
  }

  async load(e) {
    const g = this.gun;
    for (let k = 0; k < e.total; k++) {
      sfx('shellIn');
      g.userData.body.position.y = 0.01;
      await wait(0.09);
      g.userData.body.position.y = 0;
      await wait(0.06);
    }
    await this.rack([]);
    if (this.vs.round === 1) this.say(t('c_loaded'), 2.2);
    await wait(0.5);
  }

  async rack(shells) {
    const pump = this.gun.userData.pump;
    sfx('rack');
    await animate(0.12, (k) => { pump.position.z = 0.2 - 0.1 * k; });
    shells.forEach((live, idx) => this.ejectShell(live, idx));
    await wait(0.08);
    await animate(0.12, (k) => { pump.position.z = 0.1 + 0.1 * k; });
  }
  spentSpot() {
    const side = Math.random() < 0.5 ? 1 : -1;
    const a = side * Math.PI / 2 + (Math.random() - 0.5) * 1.5;
    const r = 0.28 + Math.random() * 0.35;
    return V3(Math.cos(a) * r, TY + 0.02, Math.sin(a) * r);
  }
  ejectShell(live, idx = 0, instant = false) {
    const s = M.makeShell(live);
    s.scale.setScalar(1.3);
    const port = this.gun.localToWorld(this.gun.userData.port.clone());
    const dst = this.spentSpot();
    this.scene.add(s);
    this.spent.push(s);
    const q1 = quatFromEuler(0, Math.random() * Math.PI * 2, Math.PI / 2);
    if (instant) { s.position.copy(dst); s.quaternion.copy(q1); return; }
    s.position.copy(port);
    const p0 = port.clone();
    const spin = 8 + Math.random() * 6;
    animate(0.55 + idx * 0.08, (k) => {
      s.position.lerpVectors(p0, dst, k);
      s.position.y += Math.sin(k * Math.PI) * 0.45;
      s.rotation.set(k * spin, k * spin * 0.6, 0);
    }, ease.linear).then(() => { s.quaternion.copy(q1); s.position.copy(dst); sfx('shellDrop'); });
  }
  clearSpent(instant) {
    for (const s of this.spent) {
      if (instant) this.scene.remove(s);
      else scaleTo(s, 0.01, 0.4).then(() => this.scene.remove(s));
    }
    this.spent = [];
  }

  // ---------------- the gun ----------------
  headPos(i) { return this.P[i].seat.at(M.SEAT_R, 0, 1.66); }
  async pickUpGun(P) {
    const g = this.gun;
    const [L, R] = P.hands;
    const grip = g.localToWorld(g.userData.grip.clone());
    const fore = g.localToWorld(g.userData.fore.clone());
    await Promise.all([this.handTo(R, grip.add(V3(0, 0.05, 0)), 0.4, 0.1), this.handTo(L, fore.add(V3(0, 0.05, 0)), 0.4, 0.1)]);
    sfx('pickup');
    for (const [h, lp, rz] of [[R, V3(0.07, -0.06, -0.17), -Math.PI / 2], [L, V3(-0.07, -0.03, 0.2), Math.PI / 2]]) {
      g.attach(h);
      const p0 = h.position.clone(), q0 = h.quaternion.clone();
      const q1 = quatFromEuler(0, 0, rz);
      animate(0.25, (k) => { h.position.lerpVectors(p0, lp, k); h.quaternion.slerpQuaternions(q0, q1, k); M.setCurl(h, k * 0.85); });
    }
    await wait(0.2);
  }
  async putDownGun(P, instant) {
    const g = this.gun;
    if (instant) {
      g.position.copy(this.gunHomeP);
      g.quaternion.copy(this.gunHomeQ);
      g.userData.body.position.set(0, 0, 0);
      g.userData.body.rotation.set(0, 0, 0);
      P.hands.forEach((h, k) => { this.scene.attach(h); h.position.copy(P.rest[k]); h.quaternion.copy(P.restQ); M.setCurl(h, 0); });
      return;
    }
    await Promise.all([moveTo(g, this.gunHomeP, 0.5, { arc: 0.12 }), turnTo(g, this.gunHomeQ, 0.5)]);
    sfx('thud');
    await Promise.all([this.handHome(P, 0), this.handHome(P, 1)]);
  }

  async shot(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    const selfAim = e.target === e.player;
    const me = e.player === this.viewer;
    const g = this.gun;
    this.say(selfAim ? t('c_aimSelf', { a: this.A(e.player) }) : t('c_aim', { a: this.A(e.player), b: this.A(e.target) }), 3);
    await this.pickUpGun(P);
    let pos, aim;
    if (selfAim) {
      if (me) {
        const cam = this.camPos.clone();
        pos = cam.clone().lerp(V3(0, TY + 0.3, 0), 0.42);
        aim = cam.clone().add(V3(0, -0.05, 0));
      } else {
        pos = P.seat.at(1.52, 0, TY + 0.7);
        aim = this.headPos(e.player);
      }
    } else {
      pos = P.seat.at(1.62, 0.12, TY + 0.5);
      aim = this.headPos(e.target);
      if (e.target === this.viewer) aim = this.camPos.clone().add(V3(0, -0.1, 0));
    }
    const q = lookQuat(pos, aim);
    const home = this.camHome();
    let camP = home.pos, camL = home.look;
    if (!me) {
      camL = pos.clone().lerp(aim, selfAim ? 0.5 : 0.3);
      camP = home.pos.clone().lerp(camL, 0.3);
    }
    sfx('whoosh');
    await Promise.all([moveTo(g, pos, 0.7, { arc: 0.15 }), turnTo(g, q, 0.7), this.camTo(camP, camL, 0.8)]);
    if (e.double) this.say(t('c_both'), 1.6);
    // whoever is at the wrong end of the barrel trembles (the camera, if it's you); so do the hands holding it
    const victim = e.target;
    this.tremble = { chars: victim === this.viewer ? [] : [victim], cam: victim === this.viewer, gun: true };
    sfx('heartbeat');
    await wait(0.6);
    sfx('heartbeat');
    await wait(0.55);
    if (e.bounced || e.parried) {
      const doll = this.P[e.target].status.doll;
      this.say(t('c_dollTwitch', { b: this.A(e.target) }), 1.6);
      sfx('zap');
      if (doll) await animate(0.6, (k) => { doll.rotation.z = Math.sin(k * 30) * 0.4; }); else await wait(0.6);
      if (e.parried) {
        const mine = P.status.doll;
        this.say(t('c_parry', { a: this.A(e.player) }), 1.8);
        sfx('zap');
        if (mine) await animate(0.5, (k) => { mine.rotation.z = Math.sin(k * 30) * 0.4; mine.scale.setScalar(1.05 + Math.sin(k * Math.PI) * 0.4); }); else await wait(0.5);
        vs.players[e.player].doll = false;
        vs.players[e.target].doll = false;
        this.setStatus(e.player, 'doll', false);
        this.setStatus(e.target, 'doll', false);
      }
    }
    this.stopTremble();
    const live = e.shells.some(Boolean);
    const body = g.userData.body;
    vs.players[e.player].double = false;
    vs.players[e.player].saw = false;
    this.setStatus(e.player, 'double', false);
    this.setStatus(e.player, 'saw', false);
    if (live) {
      g.userData.flash.visible = true;
      g.userData.flash.rotation.z = Math.random() * Math.PI;
      g.userData.light.intensity = 60;
      sfx('blast');
      this.shake(0.35);
      this.ui.flash && this.ui.flash();
      body.position.z = -0.12;
      body.rotation.x = -0.35;
      await wait(0.08);
      g.userData.flash.visible = false;
      g.userData.light.intensity = 0;
      this.ui.black && this.ui.black(true, 0);
      await wait(0.25);
      this.putDownGun(P, true);
      sfx('rack');
      e.shells.forEach((l, k) => this.ejectShell(l, k, true));
      this.gunState(vs);
      if (e.bounced) { vs.players[e.target].doll = false; this.setStatus(e.target, 'doll', false, true); this.say(t('c_dollBack'), 1.6); }
      const vic = this.P[e.actual];
      vic.char.userData.body.rotation.x = -0.25;
      this.camHomeNow();
      await wait(0.9);
      this.ui.black && this.ui.black(false, 0.5);
      await wait(0.2);
      if (vic.alive) animate(0.6, (k) => { vic.char.userData.body.rotation.x = -0.25 * (1 - k); });
      await wait(0.3);
    } else {
      sfx('click');
      this.shake(0.05);
      await animate(0.12, (k) => { body.position.z = -0.03 * Math.sin(k * Math.PI); });
      if (e.bounced) { vs.players[e.target].doll = false; this.setStatus(e.target, 'doll', false); }
      const k = e.shells.length;
      this.say(selfAim ? t('c_blankSelf', { a: this.A(e.player), k }) : t('c_blank', { k }), 2.4);
      await wait(0.5);
      await this.rack(e.shells);
      await wait(0.3);
      await Promise.all([this.putDownGun(P, false), this.goHome(0.6)]);
      this.gunState(vs);
    }
    vs.shellsLeft = e.shellsLeft;
    this.hud();
  }

  async damage(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    vs.players[e.player].hp = e.hp;
    vs.players[e.player].shield = e.shield;
    if (e.immune) {
      sfx('clang');
      this.puff(P.char.position.clone().add(V3(0, 1.1, 0)), 0xe8c040, 2);
      this.say(t('c_immune', { a: this.A(e.player) }), 2);
      await wait(0.8);
    }
    if (e.blocked) {
      sfx('clang');
      this.setShields(P, e.shield, true);
      this.say(t('c_blocked', { a: this.A(e.player), k: e.blocked }), 2);
      await wait(0.8);
    }
    if (e.amount > 0) {
      sfx('hurt');
      const mats = P.char.userData.mats;
      mats.forEach((m) => { m.emissive.setHex(0xaa0000); });
      animate(0.8, (k) => mats.forEach((m) => m.emissive.setRGB(0.67 * (1 - k), 0, 0)));
      const b = P.char.userData.body;
      animate(0.5, (k) => { b.position.x = Math.sin(k * 40) * 0.03 * (1 - k); });
      for (let k = P.candles.length - 1; k >= 0; k--) {
        if (k >= e.hp && P.candles[k].userData.lit) { this.lightCandle(P.candles[k], false); await wait(0.18); }
      }
      this.say(t('c_damage', { a: this.A(e.player), k: e.amount }), 2.2);
      if (e.player === this.viewer) this.ui.hurt && this.ui.hurt();
      if (e.hp === 1) { this.hud(); await wait(1.1); this.say(t('c_lastLife', { a: this.A(e.player) }), 2.4); }
    }
    this.hud();
    await wait(e.amount > 0 ? 1.0 : 0.3);
  }

  async death(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    Object.assign(vs.players[e.player], { alive: false, hp: 0, cuffed: false, doll: false, hacked: false, jammed: false });
    P.alive = false;
    sfx('death');
    this.say(t('c_dead', { a: this.A(e.player) }), 2.6);
    const b = P.char.userData.body;
    P.char.userData.eyes.forEach((x) => { x.visible = false; });
    P.candles.forEach((c) => this.lightCandle(c, false, false));
    this.setShields(P, 0, true);
    for (const m of this.itemMeshes.values()) if (m.userData.owner === e.player) scaleTo(m, 0.01, 0.5);
    STATUS_ORDER.forEach((k) => this.setStatus(e.player, k, false));
    this.setCuffs(e.player, false);
    P.hands.forEach((h) => scaleTo(h, 0.01, 0.5).then(() => { h.visible = false; h.scale.setScalar(1.25); }));
    await animate(0.9, (k) => { b.rotation.x = -0.9 * k; b.position.y = -0.25 * k; }, ease.in);
    sfx('thud');
    this.hud();
    await wait(1.0);
  }

  async revive(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    vs.players[e.player].hp = e.hp;
    if (e.via === 'insurance') {
      vs.players[e.player].insured = false;
      this.setStatus(e.player, 'insured', false);
      this.say(t('c_reviveIns', { a: this.A(e.player) }), 2.6);
    } else {
      vs.players[e.player].slots[e.slot] = null;
      const m = this.itemMeshes.get(e.uid);
      this.itemMeshes.delete(e.uid);
      if (m) {
        await moveTo(m, this.headPos(e.player).add(V3(0, 0.35, 0)), 0.6, { arc: 0.2 });
        this.puff(m.position.clone(), 0xfff4d0, 2);
        await scaleTo(m, 0.01, 0.3);
        m.parent && m.parent.remove(m);
      }
      this.say(t('c_reviveWings', { a: this.A(e.player), k: e.hp }), 2.6);
    }
    sfx('heal');
    P.candles.forEach((c, k) => this.lightCandle(c, k < e.hp));
    const b = P.char.userData.body;
    await animate(0.5, (k) => { b.position.y = Math.sin(k * Math.PI) * 0.08; });
    this.hud();
    await wait(0.8);
  }

  // ---------------- items ----------------
  async useItem(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    const a = this.A(e.player);
    vs.players[e.player].slots[e.slot] = null;
    let m = this.itemMeshes.get(e.uid);
    this.itemMeshes.delete(e.uid);
    if (!m) { m = this.makeItemMesh(e.id, e.uid); this.placeItem(m, e.player, e.slot); this.scene.add(m); }
    m.userData.pick = null;
    const hand = P.hands[1];
    const wp = m.getWorldPosition(V3());
    await this.handTo(hand, wp.add(V3(0, 0.05, 0)), 0.35, 0.1);
    await this.curl(hand, 1);
    sfx('pickup');
    hand.attach(m);
    await this.handTo(hand, P.seat.at(1.25, 0.08, TY + 0.4), 0.35, 0.05);
    this.say(t('c_uses', { a, item: itemName(e.id) }), 2);
    let keep = false;
    const gunTop = () => this.gun.position.clone().add(V3(0, 0.12, 0));
    const tipPos = () => this.gun.localToWorld(V3(0, 0.035, 0.42));
    const vanish = async () => { await scaleTo(m, 0.01, 0.25, ease.in); m.parent && m.parent.remove(m); };
    const toFace = () => (e.player === this.viewer
      ? this.camPos.clone().add(V3(0, -0.4, 0)).lerp(V3(0, TY, 0), 0.2)
      : this.headPos(e.player).lerp(V3(0, TY, 0), 0.25));

    switch (e.id) {
      case 'stethoscope': {
        await this.handTo(hand, gunTop(), 0.4, 0.1);
        await wait(0.3);
        if (e.secret) {
          // only the user hears it: a heartbeat for a live shell, silence for a blank
          if (e.secret.live) { sfx('heartbeat'); await wait(0.45); sfx('heartbeat'); }
          await wait(0.5);
          this.say(e.secret.live ? t('c_stethLive') : t('c_stethBlank'), 3.2);
        } else {
          sfx('item');
          this.say(t('c_stethOther', { a }), 2.2);
        }
        await wait(1.0);
        break;
      }
      case 'prybar': {
        await this.handTo(hand, gunTop(), 0.4, 0.1);
        await animate(0.3, (k) => { m.rotation.z = -k * 0.8; });
        sfx('rack');
        this.shake(0.03);
        this.ejectShell(e.shell, 0);
        vs.shellsLeft = e.shellsLeft;
        this.say(t('c_pry', { a, live: e.shell }), 2.6);
        await wait(1.0);
        break;
      }
      case 'saw': {
        // saw across the barrel, then the tip drops off
        const tp = tipPos();
        const side = V3().subVectors(tp, this.gun.position).cross(UP).normalize().multiplyScalar(0.06);
        await this.handTo(hand, tp.clone().add(V3(0, 0.06, 0)), 0.4, 0.1);
        for (let k = 0; k < 5; k++) {
          sfx('saw');
          await moveTo(hand, tp.clone().add(V3(0, 0.06, 0)).add(side), 0.09, { e: ease.linear });
          await moveTo(hand, tp.clone().add(V3(0, 0.06, 0)).sub(side), 0.09, { e: ease.linear });
        }
        vs.players[e.player].saw = true;
        this.gunState(vs);
        const piece = M.makeBarrelTip();
        piece.position.copy(this.gun.localToWorld(V3(0, 0.035, 0.52)));
        piece.quaternion.copy(this.gun.quaternion);
        piece.scale.setScalar(1.1);
        this.scene.add(piece);
        const p0 = piece.position.clone();
        sfx('thud');
        await animate(0.4, (k) => { piece.position.set(p0.x, p0.y - k * 0.03 + Math.sin(k * Math.PI) * 0.05, p0.z); piece.rotation.y += 0.1; }, ease.out);
        this.say(t('c_saw', { a }), 2.6);
        await vanish();
        keep = true;
        this.setStatus(e.player, 'saw', true);
        setTimeout(() => scaleTo(piece, 0.01, 0.4).then(() => this.scene.remove(piece)), 1500);
        await wait(0.4);
        break;
      }
      case 'bandage': case 'medkit': {
        await this.handTo(hand, toFace(), 0.4, 0.05);
        await animate(0.5, (k) => { m.rotation.y = k * 8; });
        sfx('heal');
        vs.players[e.player].hp = e.hp;
        P.candles.forEach((c, k) => this.lightCandle(c, k < e.hp));
        this.say(t('c_heal', { a, k: e.amount }), 2.2);
        await wait(0.6);
        break;
      }
      case 'doll': case 'insurance': {
        const key = e.id === 'insurance' ? 'insured' : 'doll';
        const k = STATUS_ORDER.indexOf(key);
        await this.handTo(hand, P.seat.at(0.8, 0.16 + k * 0.1, TY + 0.1), 0.4, 0.1);
        sfx(e.id === 'insurance' ? 'paper' : 'zap');
        this.say(t(key === 'doll' ? 'c_doll' : 'c_insured', { a }), 3);
        vs.players[e.player][key] = true;
        m.parent && m.parent.remove(m);
        this.setStatus(e.player, key, true, true);
        keep = true;
        await wait(0.9);
        break;
      }
      case 'double': {
        // power-up: the gun swells and shrinks a few times and grows a second barrel
        await this.handTo(hand, gunTop(), 0.4, 0.1);
        await vanish();
        keep = true;
        const g = this.gun;
        const p0 = g.position.clone();
        await moveTo(g, p0.clone().add(V3(0, 0.18, 0)), 0.25, { e: ease.out });
        sfx('powerup');
        const seq = [1.45, 1.1, 1.6, 1.1, 1.75, 1.1];
        const ex = g.userData.extra;
        for (let i = 0; i < seq.length; i++) {
          g.scale.setScalar(seq[i]);
          ex.visible = i % 2 === 0;
          await wait(0.11);
        }
        ex.visible = true;
        vs.players[e.player].double = true;
        this.gunState(vs);
        this.say(t('c_double', { a }), 2.6);
        await animate(0.3, (k) => g.scale.setScalar(1.1 + Math.sin(k * Math.PI) * 0.2));
        await moveTo(g, p0, 0.3, { e: ease.in });
        sfx('thud');
        this.setStatus(e.player, 'double', true);
        await wait(0.3);
        break;
      }
      case 'shield': {
        const n = e.shield;
        await this.handTo(hand, P.seat.at(0.64, -0.14 - (n - 1) * 0.07, TY + 0.1), 0.4, 0.1);
        sfx('clang');
        await vanish();
        keep = true;
        vs.players[e.player].shield = n;
        this.setShields(P, n, true);
        this.say(t('c_shield', { a, k: n }), 2.4);
        await wait(0.6);
        break;
      }
      case 'mirror': {
        sfx('shimmer');
        await animate(0.6, (k) => { m.rotation.y = k * Math.PI * 4; });
        const tg = e.target;
        this.say(t('c_mirror', { a, b: this.A(tg) }), 2.8);
        await vanish();
        keep = true;
        vs.players[e.player].slots = e.slotsP;
        vs.players[tg].slots = e.slotsT;
        const moves = [];
        for (const [owner, slots] of [[e.player, e.slotsP], [tg, e.slotsT]]) {
          slots.forEach((s, slot) => {
            if (!s) return;
            const im = this.itemMeshes.get(s.uid);
            if (!im) return;
            im.userData.owner = owner;
            im.userData.slot = slot;
            moves.push(moveTo(im, this.slotPos(owner, slot), 0.8, { arc: 0.5 }), turnTo(im, this.slotQuat(owner, slot), 0.8));
          });
        }
        sfx('whoosh');
        await Promise.all(moves);
        await wait(0.3);
        break;
      }
      case 'dice': {
        const dst = V3((Math.random() - 0.5) * 0.4, TY + 0.02, (Math.random() - 0.5) * 0.4);
        this.scene.attach(m);
        const p0 = m.position.clone();
        sfx('dice');
        await animate(0.7, (k) => { m.position.lerpVectors(p0, dst, k); m.position.y += Math.sin(k * Math.PI) * 0.3; m.rotation.set(k * 12, k * 7, k * 5); }, ease.out);
        this.shake(0.02);
        this.say(t('c_dice', { a }), 2.6);
        await animate(0.4, (k) => { this.gun.userData.body.rotation.z = Math.sin(k * 30) * 0.1 * (1 - k); });
        await wait(0.6);
        break;
      }
      case 'glove': case 'goldglove': {
        const tg = e.target;
        const stolenM = this.itemMeshes.get(e.stolen.uid);
        await vanish();
        keep = true;
        vs.players[tg].slots[e.from] = null;
        vs.players[e.player].slots[e.to] = { ...e.stolen };
        this.say(t('c_steal', { a, b: this.A(tg), item: itemName(e.stolen.id) }), 2.6);
        if (stolenM) {
          stolenM.userData.owner = e.player;
          stolenM.userData.slot = e.to;
          await this.curl(hand, 0, 0.1);
          await this.carryToSlot(P, stolenM, e.player, e.to, 1);
        }
        await wait(0.3);
        break;
      }
      case 'trash': {
        const tg = e.target;
        const victimM = this.itemMeshes.get(e.removed.uid);
        this.itemMeshes.delete(e.removed.uid);
        vs.players[tg].slots[e.from] = null;
        this.scene.attach(m);
        const dst = victimM ? victimM.position.clone().add(V3(0, 0.02, 0)) : this.slotPos(tg, e.from);
        await moveTo(m, dst, 0.6, { arc: 0.35 });
        sfx('trash');
        if (victimM) {
          const v0 = victimM.position.clone();
          await animate(0.4, (k) => { victimM.position.set(v0.x, v0.y + k * 0.1, v0.z); victimM.scale.setScalar(ITEM_SCALE * (1 - k)); victimM.rotation.y += 0.3; });
          victimM.parent && victimM.parent.remove(victimM);
        }
        this.say(t('c_trash', { a, b: this.A(tg), item: itemName(e.removed.id) }), 2.6);
        await animate(0.3, (k) => { m.rotation.z = Math.sin(k * 20) * 0.2; });
        break;
      }
      case 'stinktrash': {
        this.scene.attach(m);
        await moveTo(m, V3(0.15, TY + 0.02, 0.2), 0.5, { arc: 0.3 });
        sfx('stink');
        for (let k = 0; k < 4; k++) this.puff(m.position.clone().add(V3((Math.random() - 0.5) * 0.2, 0.15, (Math.random() - 0.5) * 0.2)), 0x7aa030, 2);
        await wait(0.5);
        for (const r of e.removed) {
          vs.players[r.player].slots[r.slot] = null;
          const im = this.itemMeshes.get(r.uid);
          this.itemMeshes.delete(r.uid);
          if (!im) continue;
          this.puff(im.position.clone().add(V3(0, 0.05, 0)), 0x7aa030, 1.4);
          scaleTo(im, 0.01, 0.6).then(() => im.parent && im.parent.remove(im));
        }
        this.say(t('c_stink', { a, k: e.removed.length }), 2.8);
        await wait(1.0);
        break;
      }
      case 'fake': {
        await this.handTo(hand, gunTop(), 0.4, 0.1);
        sfx('shellIn');
        vs.shellsLeft = e.shellsLeft;
        this.say(t('c_fake', { a }), 2.6);
        await wait(0.9);
        break;
      }
      case 'switch': {
        await this.handTo(hand, gunTop(), 0.4, 0.1);
        sfx('zap');
        this.shake(0.03);
        this.gun.userData.light.color.setHex(0x66aaff);
        this.gun.userData.light.intensity = 8;
        await wait(0.25);
        this.gun.userData.light.intensity = 0;
        this.gun.userData.light.color.setHex(0xffb060);
        this.say(t('c_switch', { a }), 3.2);
        await wait(1.0);
        break;
      }
      case 'syringe': {
        sfx('needle');
        await animate(0.5, (k) => { m.rotation.z = Math.sin(k * 20) * 0.2; });
        if (e.good) {
          sfx('heal');
          vs.players[e.player].hp = e.hp;
          P.candles.forEach((c, k) => this.lightCandle(c, k < e.hp));
          this.say(t('c_syrGood', { a, k: e.amount }), 2.6);
        } else this.say(t('c_syrBad'), 1.6);
        await wait(0.8);
        break;
      }
      case 'cuffs': {
        // the cuffs fly over, swell up, and snap shut around both wrists
        const tg = e.target;
        const tP = this.P[tg];
        this.scene.attach(m);
        const mid = tP.hands[0].position.clone().add(tP.hands[1].position).multiplyScalar(0.5).add(V3(0, 0.12, 0));
        await moveTo(m, mid, 0.55, { arc: 0.4 });
        await scaleTo(m, ITEM_SCALE * 2.6, 0.25, ease.out);
        sfx('chain');
        m.parent && m.parent.remove(m);
        keep = true;
        vs.players[tg].cuffed = true;
        this.setCuffs(tg, true, false);
        await wait(0.3);
        sfx('lock');
        this.say(t('c_cuffs', { a, b: this.A(tg) }), 2.8);
        await wait(0.8);
        break;
      }
      case 'hack': {
        const tg = e.target;
        const tP = this.P[tg];
        this.scene.attach(m);
        await moveTo(m, tP.seat.at(1.1, 0, TY + 0.25), 0.55, { arc: 0.3 });
        sfx('hack');
        for (const im of this.itemMeshes.values()) {
          if (im.userData.owner !== tg) continue;
          const y0 = im.position.y;
          animate(0.6, (k) => { im.position.y = y0 + Math.sin(k * Math.PI * 6) * 0.02; });
        }
        await wait(0.6);
        vs.players[tg].hacked = true;
        this.setStatus(tg, 'hacked', true);
        this.say(t('c_hack', { a, b: this.A(tg) }), 2.8);
        await wait(0.6);
        break;
      }
      case 'rotator': {
        this.scene.attach(m);
        await moveTo(m, V3(0.25, TY + 0.02, 0.25), 0.4, { arc: 0.15 });
        sfx('whoosh');
        await animate(0.9, (k) => { m.rotation.y = k * Math.PI * 4 * (e.dir > 0 ? 1 : -1); });
        vs.dir = e.dir;
        this.say(t('c_rotator', { a }), 2.4);
        await wait(0.5);
        break;
      }
      case 'phone': {
        await this.handTo(hand, e.player === this.viewer ? this.camPos.clone().lerp(V3(0, TY, 0), 0.25).add(V3(0.2, -0.1, 0)) : this.headPos(e.player).lerp(V3(0, TY, 0), 0.2), 0.4, 0.05);
        sfx('phone');
        await wait(1.0);
        if (e.secret) this.say(t('c_phoneSecret', e.secret), 3.6);
        else this.say(t('c_phoneOther', { a }), 2.6);
        await wait(1.2);
        break;
      }
      case 'wings': {
        const tg = e.target;
        const tP = this.P[tg];
        this.scene.attach(m);
        await moveTo(m, this.headPos(tg).add(V3(0, 0.4, 0)), 0.7, { arc: 0.3 });
        sfx('heal');
        this.puff(m.position.clone(), 0xfff4d0, 2.5);
        await scaleTo(m, ITEM_SCALE * 2, 0.3, ease.out);
        Object.assign(vs.players[tg], { alive: true, hp: e.hp });
        tP.alive = true;
        tP.char.userData.eyes.forEach((x) => { x.visible = true; });
        const b = tP.char.userData.body;
        tP.hands.forEach((h, k) => { h.visible = true; h.scale.setScalar(1.25); h.position.copy(tP.rest[k]); });
        await animate(0.8, (k) => { b.rotation.x = -0.9 * (1 - k); b.position.y = -0.25 * (1 - k); }, ease.out);
        tP.candles.forEach((c, k) => this.lightCandle(c, k < e.hp));
        for (const im of this.itemMeshes.values()) if (im.userData.owner === tg) { im.visible = true; im.scale.setScalar(ITEM_SCALE); }
        this.say(t('c_wings', { a, b: this.A(tg), k: e.hp }), 2.8);
        await vanish();
        keep = true;
        await wait(0.5);
        break;
      }
      case 'handheld': {
        await this.handTo(hand, toFace(), 0.45, 0.05);
        await animate(0.4, (k) => { m.scale.setScalar(ITEM_SCALE * (1 + k * 0.6)); });
        sfx('boot');
        this.say(t('c_handheld', { a, game: gameName(e.game) }), 3);
        await wait(0.9);
        break;
      }
    }
    if (!keep) await vanish();
    this.hud();
    await this.handHome(P, 1, 0.35);
  }

  // ---------------- picking ----------------
  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // While choosing a target or one of their items, use the nearest one on
    // screen within a finger-sized radius: forgiving on phones, no raycast misses.
    const reach = Math.max(46, Math.min(rect.width, rect.height) * 0.09);
    const nearest = (objs, anchor) => {
      let best = null, bd = reach;
      for (const o of objs) {
        const v = anchor(o).project(this.camera);
        if (v.z > 1) continue;
        const d = Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - v.y) / 2) * rect.height - clientY);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    };
    if (this.targeting) {
      const ring = nearest(this.targeting.rings, (r) => r.position.clone());
      if (ring) return { ...ring.userData.pick };
    }
    if (this.itemPick) {
      const theirs = [...this.itemMeshes.values()].filter((m) => m.userData.owner === this.itemPick.target && m.visible);
      const m = nearest(theirs, (o) => o.position.clone().add(V3(0, 0.06, 0)));
      if (m) return { ...m.userData.pick, owner: m.userData.owner, slot: m.userData.slot };
    }
    const targets = [this.gun, ...this.itemMeshes.values(), ...this.trayItems.values(), ...this.P.filter((p) => p.char.visible).map((p) => p.char)];
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && o.userData.pick)) o = o.parent;
      if (o && o.visible) return { ...o.userData.pick, owner: o.userData.owner, slot: o.userData.slot };
    }
    return null;
  }

  // ---------------- item thumbnails (for the HTML UI) ----------------
  makeThumbs(ids) {
    const S = 64;
    const rt = new THREE.WebGLRenderTarget(S, S);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xfff4e0, 0x403020, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 2.5);
    dl.position.set(1, 2, 2);
    sc.add(dl);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
    const out = {};
    const buf = new Uint8Array(S * S * 4);
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const prevSnap = snapUniform.value.clone();
    snapUniform.value.set(S * 0.5, S * 0.5);
    const r = this.renderer;
    const oldClear = r.getClearColor(new THREE.Color());
    const oldAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const id of ids) {
      const m = M.makeItem(id, { glow: false });
      const bb = new THREE.Box3().setFromObject(m);
      const ctr = bb.getCenter(V3());
      const size = bb.getSize(V3()).length();
      m.position.sub(ctr);
      sc.add(m);
      cam.position.set(0, size * 1.45, size * 1.25); // steeper, so flat items read well
      cam.lookAt(0, 0, 0);
      r.setRenderTarget(rt);
      r.clear();
      r.render(sc, cam);
      r.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const si = ((S - 1 - y) * S + x) * 4, di = (y * S + x) * 4;
          for (let ch = 0; ch < 3; ch++) img.data[di + ch] = Math.round(255 * Math.pow(buf[si + ch] / 255, 1 / 2.2));
          img.data[di + 3] = buf[si + 3];
        }
      }
      g.putImageData(img, 0, 0);
      out[id] = c.toDataURL();
      sc.remove(m);
    }
    r.setRenderTarget(null);
    r.setClearColor(oldClear, oldAlpha);
    snapUniform.value.copy(prevSnap);
    rt.dispose();
    return out;
  }
}
