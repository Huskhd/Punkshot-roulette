// Muckshot — the 3D table: scene, camera, and the animation for every game event.
// The view never decides anything; it replays events from the rules engine and
// then snaps to the authoritative snapshot (sync) so it can't drift.
import {
  THREE, snapUniform, animate, wait, ease, moveTo, turnTo, scaleTo, tickAnims, finishAll, lookQuat, quatFromEuler, basic, lam,
} from './gfx.js';
import * as M from './models.js';
import { ITEMS } from './engine.js';
import { sfx } from './audio.js';

const TY = M.TABLE_Y;
const ITEM_SCALE = 1.75;
const SLOT_ROWS = [1.3, 1.02];
const SLOT_COLS = [-0.48, -0.16, 0.16, 0.48];
const STATUS_ORDER = ['doll', 'hollow', 'insured', 'double'];
const STATUS_ITEM = { doll: 'doll', hollow: 'hollow', insured: 'insurance', double: 'double' };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

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
    this.clock = new THREE.Clock();
    this.time = 0;
    this.raycaster = new THREE.Raycaster();

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
    if (this.camMode === 'seat' && !this.camBusy) { const h0 = this.camHome(); this.camPos.copy(h0.pos); this.camLook.copy(h0.look); }
  }
  setRetro(on) { this.retro = on; this.resize(); }

  frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    const t = this.time;
    tickAnims(dt);
    this.lamp.rotation.z = Math.sin(t * 0.5) * 0.035;
    this.lamp.rotation.x = Math.cos(t * 0.37) * 0.025;
    const flick = Math.random() < 0.01 ? 0.55 : 1;
    this.spot.intensity = this.spotBase * flick * (0.97 + Math.sin(t * 9) * 0.03);
    this.glow.intensity = 7 * flick;
    for (const p of this.P) {
      if (p.alive) {
        p.char.userData.body.scale.y = 1 + Math.sin(t * 1.6 + p.phase) * 0.012;
        p.char.userData.head.rotation.y = Math.sin(t * 0.4 + p.phase) * 0.12 + p.lookY;
        p.char.userData.head.rotation.z = Math.sin(t * 0.3 + p.phase * 2) * 0.04;
      }
      for (const c of p.candles) {
        if (c.userData.lit) c.userData.flame.scale.set(1, 1 + Math.sin(t * 13 + c.userData.phase) * 0.18 + Math.random() * 0.1, 1);
      }
    }
    if (this.camMode === 'orbit') {
      const a = t * 0.08;
      this.camPos.set(Math.sin(a) * 3.6, 2.5, Math.cos(a) * 3.6);
      this.camLook.set(0, TY + 0.2, 0);
    }
    this.camera.position.copy(this.camPos);
    if (this.shakeAmt > 0.0005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

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
  camHome(v = this.viewer) {
    const s = this.seat(v);
    const aspect = this.camera.aspect;
    let dist, elev;
    if (aspect >= 1.2) { dist = 3.25; elev = 0.56; } else if (aspect >= 0.8) { dist = 3.9; elev = 0.66; } else { dist = 4.9; elev = 0.6; }
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
    for (const p of this.P) {
      this.scene.remove(p.char);
      p.hands.forEach((h) => { h.parent && h.parent.remove(h); });
      p.candles.forEach((c) => this.scene.remove(c));
      Object.values(p.status).forEach((s) => s && this.scene.remove(s));
      if (p.cuffsProp) this.scene.remove(p.cuffsProp);
    }
    this.P = [];
    for (const m of this.itemMeshes.values()) m.parent && m.parent.remove(m);
    this.itemMeshes.clear();
    this.clearSpent(true);
    this.hideTray(true);
    this.gun.position.copy(this.gunHomeP);
    this.gun.quaternion.copy(this.gunHomeQ);
    this.gun.userData.body.position.set(0, 0, 0);
    this.gun.userData.body.rotation.set(0, 0, 0);
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
      const P = { idx: i, seat: s, char: ch, hands, rest, restQ, candles: [], status: {}, cuffsProp: null, alive: true, phase: Math.random() * 6, lookY: 0 };
      this.P.push(P);
    });
    this.camMode = 'seat';
    this.P.forEach((p, i) => { p.char.visible = i !== viewer; });
    this.camHomeNow();
    if (snap) this.sync(snap, true);
  }

  // Title screen: four patrons and the gun, slow orbiting camera.
  setupDemo() {
    this.setup([0, 1, 2, 3].map((k) => ({ name: M.CHARACTERS[k].name, char: k })), -1);
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
  lightCandle(c, on, instant) {
    if (c.userData.lit === on) return;
    c.userData.lit = on;
    c.userData.flame.visible = on;
    if (!on && !instant) this.puff(c.position.clone().add(V3(0, 0.15, 0)));
  }
  puff(pos, color = 0x6a6a60) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), basic(color, { transparent: true, opacity: 0.6, depthWrite: false }));
    m.position.copy(pos);
    this.scene.add(m);
    const p0 = pos.clone();
    animate(1.0, (k) => {
      m.position.set(p0.x, p0.y + k * 0.25, p0.z);
      m.scale.setScalar(1 + k * 3);
      m.material.opacity = 0.6 * (1 - k);
    }, ease.out).then(() => { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  slotPos(i, slot) {
    const P = this.P[i];
    return P.seat.at(SLOT_ROWS[slot >> 2], SLOT_COLS[slot & 3], TY);
  }
  slotQuat(i, slot) {
    return quatFromEuler(0, this.P[i].seat.a + (((slot * 37) % 7) - 3) * 0.05, 0);
  }
  makeItemMesh(id, uid) {
    const m = M.makeItem(id);
    m.userData.uid = uid;
    m.userData.pick = { kind: 'item', uid };
    return m;
  }
  placeItem(m, i, slot) {
    m.position.copy(this.slotPos(i, slot));
    m.quaternion.copy(this.slotQuat(i, slot));
    m.scale.setScalar(ITEM_SCALE);
    if (m.parent !== this.scene) this.scene.attach(m);
  }

  // ---------------- authoritative sync ----------------
  sync(snap, instant) {
    if (!snap || !this.P.length) return;
    this.vs = JSON.parse(JSON.stringify(snap));
    snap.players.forEach((pl, i) => {
      const P = this.P[i];
      if (!P) return;
      this.setCandles(P, pl.hp, pl.maxHp);
      if (pl.alive !== P.alive) this.setAlivePose(P, pl.alive);
      for (const key of STATUS_ORDER) this.setStatus(i, key, !!pl[key], true);
      this.setCuffs(i, pl.cuffed, true);
      const want = new Set();
      pl.slots.forEach((s, slot) => {
        if (!s) return;
        want.add(s.uid);
        let m = this.itemMeshes.get(s.uid);
        if (!m) { m = this.makeItemMesh(s.id, s.uid); this.itemMeshes.set(s.uid, m); this.scene.add(m); }
        m.userData.owner = i;
        m.userData.slot = slot;
        this.placeItem(m, i, slot);
        m.visible = pl.alive;
      });
      for (const [uid, m] of this.itemMeshes) {
        if (m.userData.owner === i && !want.has(uid)) { m.parent && m.parent.remove(m); this.itemMeshes.delete(uid); }
      }
    });
    // stray meshes whose owner no longer holds them
    const held = new Set();
    snap.players.forEach((pl) => pl.slots.forEach((s) => s && held.add(s.uid)));
    for (const [uid, m] of this.itemMeshes) if (!held.has(uid)) { m.parent && m.parent.remove(m); this.itemMeshes.delete(uid); }
    // tray
    const d = snap.decision;
    const trayPhase = d && (d.kind === 'take' || d.kind === 'draft' || d.kind === 'shop') && snap.tray.length;
    if (trayPhase) this.ensureTray(snap.tray, d.kind === 'shop');
    else if (this.tray.visible) this.hideTray(instant);
    // gun & hands home
    if (this.gun.parent !== this.scene) this.scene.attach(this.gun);
    this.gun.position.copy(this.gunHomeP);
    this.gun.quaternion.copy(this.gunHomeQ);
    this.P.forEach((P) => P.hands.forEach((h, k) => {
      if (h.parent !== this.scene) this.scene.attach(h);
      h.position.copy(P.rest[k]);
      h.quaternion.copy(P.restQ);
      M.setCurl(h, 0);
      h.visible = P.alive;
    }));
    if (!trayPhase && this.camMode === 'seat') this.camHomeNow();
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
      const m = M.makeItem(STATUS_ITEM[key]);
      const k = STATUS_ORDER.indexOf(key);
      m.position.copy(P.seat.at(0.8, 0.16 + k * 0.12, TY));
      m.rotation.y = P.seat.a;
      m.scale.setScalar(instant ? 1.15 : 0.01);
      this.scene.add(m);
      P.status[key] = m;
      if (!instant) scaleTo(m, 1.15, 0.35, ease.back);
    } else if (!on && cur) {
      P.status[key] = null;
      if (instant) this.scene.remove(cur);
      else scaleTo(cur, 0.01, 0.3).then(() => this.scene.remove(cur));
    }
  }
  setCuffs(i, on, instant) {
    const P = this.P[i];
    if (on && !P.cuffsProp) {
      const m = M.makeItem('cuffs');
      m.position.copy(P.seat.at(1.5, 0, TY + 0.03));
      m.rotation.y = P.seat.a;
      m.scale.setScalar(instant ? 1.6 : 0.01);
      this.scene.add(m);
      P.cuffsProp = m;
      if (!instant) scaleTo(m, 1.6, 0.3, ease.back);
    } else if (!on && P.cuffsProp) {
      const m = P.cuffsProp;
      P.cuffsProp = null;
      if (instant) this.scene.remove(m); else scaleTo(m, 0.01, 0.3).then(() => this.scene.remove(m));
    }
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
    const have = new Set(items.map((t) => t.uid));
    for (const [uid, m] of this.trayItems) if (!have.has(uid)) { m.parent && m.parent.remove(m); this.trayItems.delete(uid); }
    const missing = items.filter((t) => !this.trayItems.has(t.uid));
    if (missing.length || !this.tray.visible) {
      if (!this.tray.visible) this.showTrayInstant();
      const { pts, scale } = this.layoutTray(items.length);
      let k = 0;
      for (const t of items) {
        if (this.trayItems.has(t.uid)) { k++; continue; }
        const m = this.makeTrayItem(t, shop, pts[k++], scale);
        this.tray.add(m);
      }
    }
  }
  makeTrayItem(t, shop, p, scale) {
    const m = M.makeItem(t.id);
    m.userData.uid = t.uid;
    m.userData.pick = { kind: 'tray', uid: t.uid };
    m.position.set(p.x, this.tray.userData.top, p.z);
    m.rotation.y = (Math.random() - 0.5) * 1.2;
    m.scale.setScalar(scale);
    if (shop) {
      const lab = M.makeLabel(`${t.price}¢`, { color: '#ffe9a0', scale: 0.09 });
      lab.position.set(0, 0.075, 0);
      m.add(lab);
      m.userData.label = lab;
    }
    this.trayItems.set(t.uid, m);
    return m;
  }
  showTrayInstant() {
    const { pos, q } = this.trayPose();
    this.tray.visible = true;
    this.tray.position.copy(pos);
    this.tray.quaternion.copy(q);
    this.tray.scale.setScalar(1);
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
    for (const m of this.trayItems.values()) m.parent && m.parent.remove(m);
    this.trayItems.clear();
    const { pos, q } = this.trayPose();
    const { pts, scale } = this.layoutTray(items.length);
    items.forEach((t, k) => this.tray.add(this.makeTrayItem(t, shop, pts[k], scale)));
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
  // Hand grabs a mesh (anywhere), carries it to a player's slot.
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
    sfx('thud');
    this.handHome(P, handIdx, 0.3);
  }

  // ---------------- naming helpers ----------------
  isMe(i) { return i === this.viewer; }
  nm(i) { return i === this.viewer ? 'You' : this.names[i]; }
  nmObj(i) { return i === this.viewer ? 'you' : this.names[i]; }
  poss(i) { return i === this.viewer ? 'your' : `${this.names[i]}'s`; }
  v(i, you, they) { return i === this.viewer ? you : they; }
  say(text, dur) { if (this.ui && this.ui.say) this.ui.say(text, dur); }

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
        this.say(`${this.nm(e.first)} ${this.v(e.first, 'go', 'goes')} first.`, 2.2);
        await wait(1.2);
        break;
      case 'roundStart': await this.roundStart(e); break;
      case 'load': await this.load(e); break;
      case 'tray': {
        if (e.mode === 'shop') this.say(e.player === this.viewer ? `Shop — you have ${e.chips} chips. Buy what you need.` : `${this.names[e.player]} is shopping (${e.chips} chips).`, 3);
        else if (e.mode === 'draft') this.say(`Draft: ${e.picks} item${e.picks > 1 ? 's' : ''} each. Take turns picking from the tray.`, 3.2);
        else {
          const free = pl(e.player).slots.filter((s) => !s).length;
          this.say(e.player === this.viewer ? `Your items. Pick what you keep — ${free} free slot${free === 1 ? '' : 's'}.` : `${this.names[e.player]} gets ${e.items.length} items.`, 3);
        }
        vs.decision = e.player >= 0 ? { kind: e.mode, player: e.player } : null;
        this.ui.hud && this.ui.hud(vs, this.viewer);
        await this.showTray(e.items, e.mode === 'shop');
        break;
      }
      case 'take': case 'buy': {
        const m = this.trayItems.get(e.uid) || (() => { const x = this.makeItemMesh(e.id, e.uid); x.position.copy(this.tray.position); this.scene.add(x); return x; })();
        this.trayItems.delete(e.uid);
        if (m.userData.label) { m.remove(m.userData.label); m.userData.label = null; }
        m.userData.pick = { kind: 'item', uid: e.uid };
        m.userData.owner = e.player;
        m.userData.slot = e.slot;
        this.itemMeshes.set(e.uid, m);
        pl(e.player).slots[e.slot] = { uid: e.uid, id: e.id };
        if (e.t === 'buy') { pl(e.player).chips = e.chips; sfx('coin'); }
        const what = ITEMS[e.id].name;
        this.say(e.t === 'buy' ? `${this.nm(e.player)} bought the ${what} (${e.chips} chips left).` : `${this.nm(e.player)} took the ${what}.`, 2);
        await this.carryToSlot(this.P[e.player], m, e.player, e.slot);
        this.ui.hud && this.ui.hud(vs, this.viewer);
        break;
      }
      case 'trayEnd': {
        if (e.lost.length && e.reason === 'full') this.say(`No room left — ${e.lost.length} item${e.lost.length > 1 ? 's' : ''} lost.`, 2.4);
        else if (e.lost.length && e.reason === 'leftover') this.say('The leftovers go back in the box.', 2);
        for (const uid of e.lost) {
          const m = this.trayItems.get(uid);
          if (m) scaleTo(m, 0.01, 0.3, ease.in);
        }
        if (e.lost.length) await wait(0.4);
        await this.hideTray(false);
        break;
      }
      case 'turn': {
        this.say(e.player === this.viewer ? 'Your turn.' : `${this.names[e.player]}'s turn.`, 2);
        vs.turn = e.player;
        vs.decision = { kind: 'turn', player: e.player };
        this.ui.hud && this.ui.hud(vs, this.viewer);
        const P = this.P[e.player];
        const h = P.char.userData.head;
        const y0 = h.position.y;
        await animate(0.4, (k) => { h.position.y = y0 + Math.sin(k * Math.PI) * 0.04; });
        break;
      }
      case 'cuffSkip':
        this.say(`${this.nm(e.player)} ${this.v(e.player, 'are', 'is')} cuffed and ${this.v(e.player, 'skip', 'skips')} this turn.`, 2.4);
        sfx('chain');
        this.setCuffs(e.player, false);
        pl(e.player).cuffed = false;
        await wait(1.2);
        break;
      case 'item': await this.useItem(e); break;
      case 'shot': await this.shot(e); break;
      case 'damage': await this.damage(e); break;
      case 'death': await this.death(e); break;
      case 'revive': {
        const P = this.P[e.player];
        pl(e.player).hp = e.hp;
        pl(e.player).insured = false;
        this.setStatus(e.player, 'insured', false);
        sfx('heal');
        this.say(`Life Insurance pays out! ${this.nm(e.player)} ${this.v(e.player, 'are', 'is')} back with 1 HP.`, 2.6);
        this.lightCandle(P.candles[0], true);
        const b = P.char.userData.body;
        await animate(0.5, (k) => { b.position.y = Math.sin(k * Math.PI) * 0.08; });
        await wait(0.8);
        break;
      }
      case 'roundEnd': {
        this.say('The gun is empty.', 1.8);
        await wait(1.0);
        if (e.gains && e.gains.length) {
          const parts = e.gains.map((g) => `${this.nm(g.player)} +${g.gain}`);
          e.gains.forEach((g) => { pl(g.player).chips = g.chips; });
          sfx('coin');
          this.say(`Survivors earn chips: ${parts.join(', ')}.`, 2.6);
          this.ui.hud && this.ui.hud(vs, this.viewer);
          await wait(1.6);
        }
        vs.players.forEach((p) => { p.insured = false; });
        vs.players.forEach((p, i) => this.setStatus(i, 'insured', false));
        break;
      }
      case 'gameOver': {
        sfx('win');
        const w = e.winner;
        this.say(w === this.viewer ? 'You are the last one standing.' : `${this.names[w]} is the last one standing.`, 4);
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
    this.say(`Round ${e.round}.`, 1.6);
    await wait(0.9);
    // Belt showcase: pops up right in front of the camera.
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
    this.say(`${e.live} live. ${e.blank} blank.`, 3.4);
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
    if (this.vs.round === 1) this.say('In they go — in an order nobody knows.', 2.2);
    await wait(0.5);
  }

  // pump back, eject shells, pump forward
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
    // attach hands to the gun at fixed grips
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
    const me = this.isMe(e.player);
    const g = this.gun;
    vs.players[e.player].double = false;
    this.setStatus(e.player, 'double', false);
    this.say(selfAim
      ? (me ? 'You point the gun at yourself.' : `${this.names[e.player]} points the gun at themself.`)
      : `${this.nm(e.player)} ${this.v(e.player, 'aim', 'aims')} at ${this.nmObj(e.target)}.`, 3);
    await this.pickUpGun(P);
    // hold pose
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
      if (this.isMe(e.target)) aim = this.camPos.clone().add(V3(0, -0.1, 0));
    }
    const q = lookQuat(pos, aim);
    // camera pops toward the action
    const home = this.camHome();
    let camP = home.pos, camL = home.look;
    if (!me) {
      camL = pos.clone().lerp(aim, selfAim ? 0.5 : 0.3);
      camP = home.pos.clone().lerp(camL, 0.3);
    }
    sfx('whoosh');
    await Promise.all([moveTo(g, pos, 0.7, { arc: 0.15 }), turnTo(g, q, 0.7), this.camTo(camP, camL, 0.8)]);
    if (e.double) this.say('Both barrels at once...', 1.6);
    sfx('heartbeat');
    await wait(0.6);
    sfx('heartbeat');
    await wait(0.55);
    const tP = this.P[e.target];
    if (e.bounced) {
      const doll = tP.status.doll;
      this.say(`${this.poss(e.target).replace(/^./, (c) => c.toUpperCase())} Boodoo Doll twitches...`, 1.6);
      sfx('zap');
      if (doll) await animate(0.6, (k) => { doll.rotation.z = Math.sin(k * 30) * 0.4; });
      else await wait(0.6);
    }
    const live = e.shells.some(Boolean);
    const body = g.userData.body;
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
      // in the dark: rack, gun down, victim reels
      this.putDownGun(P, true);
      sfx('rack');
      e.shells.forEach((l, k) => this.ejectShell(l, k, true));
      if (e.bounced) { vs.players[e.target].doll = false; this.setStatus(e.target, 'doll', false, true); this.say('The doll sends it right back!', 1.6); }
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
      if (e.bounced) {
        vs.players[e.target].doll = false;
        this.setStatus(e.target, 'doll', false);
      }
      const blanks = e.shells.length > 1 ? 'Blanks.' : 'Blank.';
      if (selfAim) this.say(`*click* ${blanks} ${this.nm(e.player)} ${this.v(e.player, 'go', 'goes')} again.`, 2.4);
      else this.say(`*click* ${blanks}`, 1.8);
      await wait(0.5);
      await this.rack(e.shells);
      await wait(0.3);
      await Promise.all([this.putDownGun(P, false), this.goHome(0.6)]);
    }
    vs.shellsLeft = e.shellsLeft;
    if (e.hollow) { vs.players[e.player].hollow = false; this.setStatus(e.player, 'hollow', false); }
    this.ui.hud && this.ui.hud(vs, this.viewer);
  }

  async damage(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    vs.players[e.player].hp = e.hp;
    sfx('hurt');
    const mats = P.char.userData.mats;
    mats.forEach((m) => { m.emissive.setHex(0xaa0000); });
    animate(0.8, (k) => mats.forEach((m) => m.emissive.setRGB(0.67 * (1 - k), 0, 0)));
    const b = P.char.userData.body;
    animate(0.5, (k) => { b.position.x = Math.sin(k * 40) * 0.03 * (1 - k); });
    for (let k = P.candles.length - 1; k >= 0; k--) {
      if (k >= e.hp && P.candles[k].userData.lit) { this.lightCandle(P.candles[k], false); await wait(0.18); }
    }
    const amt = e.amount;
    this.say(`${this.nm(e.player)} ${this.v(e.player, 'take', 'takes')} ${amt} damage.`, 2.2);
    this.ui.hud && this.ui.hud(vs, this.viewer);
    if (this.isMe(e.player)) this.ui.hurt && this.ui.hurt();
    await wait(1.0);
  }

  async death(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    vs.players[e.player].alive = false;
    vs.players[e.player].hp = 0;
    P.alive = false;
    sfx('death');
    this.say(this.isMe(e.player) ? 'You are dead.' : `${this.names[e.player]} is dead.`, 2.6);
    const b = P.char.userData.body;
    P.char.userData.eyes.forEach((x) => { x.visible = false; });
    P.candles.forEach((c) => this.lightCandle(c, false, false));
    for (const [uid, m] of this.itemMeshes) if (m.userData.owner === e.player) scaleTo(m, 0.01, 0.5);
    STATUS_ORDER.forEach((k) => this.setStatus(e.player, k, false));
    this.setCuffs(e.player, false);
    P.hands.forEach((h) => scaleTo(h, 0.01, 0.5).then(() => { h.visible = false; h.scale.setScalar(1.25); }));
    await animate(0.9, (k) => { b.rotation.x = -0.9 * k; b.position.y = -0.25 * k; }, ease.in);
    sfx('thud');
    this.ui.hud && this.ui.hud(vs, this.viewer);
    await wait(1.0);
  }

  // ---------------- items ----------------
  async useItem(e) {
    const vs = this.vs;
    const P = this.P[e.player];
    const me = this.isMe(e.player);
    const name = ITEMS[e.id].name;
    const who = this.nm(e.player);
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
    const show = P.seat.at(1.25, 0.08, TY + 0.4);
    await this.handTo(hand, show, 0.35, 0.05);
    this.say(`${who} ${this.v(e.player, 'use', 'uses')} the ${name}.`, 2);
    let keep = false; // mesh handled elsewhere
    const gunPos = () => this.gun.position.clone().add(V3(0, 0.12, 0));
    const vanish = async () => { await scaleTo(m, 0.01, 0.25, ease.in); m.parent && m.parent.remove(m); };

    switch (e.id) {
      case 'stethoscope': {
        await this.handTo(hand, gunPos(), 0.4, 0.1);
        sfx('heartbeat');
        await wait(0.7);
        if (e.secret) { this.say(`The stethoscope hears... ${e.secret.live ? 'a LIVE shell.' : 'a BLANK.'}`, 3.2); sfx(e.secret.live ? 'hurt' : 'ui'); }
        else this.say(`${who} ${this.v(e.player, 'listen', 'listens')} closely to the gun...`, 2.2);
        await wait(1.0);
        break;
      }
      case 'prybar': {
        await this.handTo(hand, gunPos(), 0.4, 0.1);
        await animate(0.3, (k) => { m.rotation.z = -k * 0.8; });
        sfx('rack');
        this.shake(0.03);
        this.ejectShell(e.shell, 0);
        vs.shellsLeft = e.shellsLeft;
        this.say(`${who} ${this.v(e.player, 'pry', 'pries')} out a ${e.shell ? 'LIVE' : 'BLANK'} shell.`, 2.6);
        await wait(1.0);
        break;
      }
      case 'hollow': {
        await this.handTo(hand, gunPos(), 0.4, 0.1);
        sfx('shellIn');
        this.say(`${who} ${this.v(e.player, 'load', 'loads')} a hollow point. ${me ? 'Your' : 'Their'} next live shot deals 2 damage.`, 2.8);
        vs.players[e.player].hollow = true;
        await vanish();
        this.setStatus(e.player, 'hollow', true);
        keep = true;
        await wait(0.5);
        break;
      }
      case 'bandage': {
        await this.handTo(hand, this.isMe(e.player) ? this.camPos.clone().add(V3(0, -0.4, 0)).lerp(V3(0, TY, 0), 0.2) : this.headPos(e.player).add(V3(0, 0, 0)).lerp(V3(0, TY, 0), 0.25), 0.4, 0.05);
        await animate(0.5, (k) => { m.rotation.y = k * 8; });
        sfx('heal');
        vs.players[e.player].hp = e.hp;
        this.lightCandle(P.candles[e.hp - 1], true);
        this.say(e.amount ? `${who} ${this.v(e.player, 'patch', 'patches')} up. +1 HP.` : `${who} ${this.v(e.player, 'patch', 'patches')} up.`, 2.2);
        await wait(0.6);
        break;
      }
      case 'doll': case 'insurance': case 'double': {
        const key = e.id === 'insurance' ? 'insured' : e.id;
        const k = STATUS_ORDER.indexOf(key);
        await this.handTo(hand, P.seat.at(0.8, 0.16 + k * 0.12, TY + 0.1), 0.4, 0.1);
        sfx(e.id === 'insurance' ? 'paper' : e.id === 'doll' ? 'zap' : 'lock');
        const txt = {
          doll: `${who} ${this.v(e.player, 'set', 'sets')} down a Boodoo Doll. The next shot aimed at ${this.nmObj(e.player)} bounces back.`,
          insured: `${who} ${this.v(e.player, 'sign', 'signs')} a Life Insurance policy. Die this round, come back with 1 HP.`,
          double: `${who} ${this.v(e.player, 'rig', 'rigs')} the gun. The next shot fires two shells at once.`,
        }[key];
        this.say(txt, 3);
        vs.players[e.player][key] = true;
        m.parent && m.parent.remove(m);
        this.setStatus(e.player, key, true, true);
        keep = true;
        await wait(0.9);
        break;
      }
      case 'mirror': {
        sfx('shimmer');
        await animate(0.6, (k) => { m.rotation.y = k * Math.PI * 4; });
        const t = e.target;
        this.say(`${who} ${this.v(e.player, 'swap', 'swaps')} every item with ${this.nmObj(t)}.`, 2.8);
        await vanish();
        keep = true;
        vs.players[e.player].slots = e.slotsP;
        vs.players[t].slots = e.slotsT;
        const moves = [];
        for (const [owner, slots] of [[e.player, e.slotsP], [t, e.slotsT]]) {
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
        this.say(`${who} ${this.v(e.player, 'roll', 'rolls')} the rigged dice. The shells are reshuffled.`, 2.6);
        await animate(0.4, (k) => { this.gun.userData.body.rotation.z = Math.sin(k * 30) * 0.1 * (1 - k); });
        await wait(0.6);
        break;
      }
      case 'glove': case 'goldglove': {
        const t = e.target;
        const stolenM = this.itemMeshes.get(e.stolen.uid);
        await vanish();
        keep = true;
        vs.players[t].slots[e.from] = null;
        vs.players[e.player].slots[e.to] = { ...e.stolen };
        this.say(`${who} ${this.v(e.player, 'steal', 'steals')} ${this.poss(t)} ${ITEMS[e.stolen.id].name}!`, 2.6);
        if (stolenM) {
          stolenM.userData.owner = e.player;
          stolenM.userData.slot = e.to;
          await this.curl(hand, 0, 0.1);
          await this.carryToSlot(P, stolenM, e.player, e.to, 1);
        }
        await wait(0.3);
        break;
      }
      case 'fake': {
        await this.handTo(hand, gunPos(), 0.4, 0.1);
        sfx('shellIn');
        vs.shellsLeft = e.shellsLeft;
        this.say(`${who} ${this.v(e.player, 'slip', 'slips')} a fake blank into the gun. Somewhere.`, 2.6);
        await wait(0.9);
        break;
      }
      case 'switch': {
        await this.handTo(hand, gunPos(), 0.4, 0.1);
        sfx('zap');
        this.shake(0.03);
        this.gun.userData.light.color.setHex(0x66aaff);
        this.gun.userData.light.intensity = 8;
        await wait(0.25);
        this.gun.userData.light.intensity = 0;
        this.gun.userData.light.color.setHex(0xffb060);
        this.say(`${who} ${this.v(e.player, 'flip', 'flips')} the switch. Every live shell is now blank, every blank now live.`, 3.2);
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
          this.say(`The drugs kick in. ${who} ${this.v(e.player, 'heal', 'heals')} ${e.amount} HP.`, 2.6);
        } else {
          this.say('Bad batch...', 1.6);
        }
        await wait(0.8);
        break;
      }
      case 'cuffs': {
        const t = e.target;
        const tP = this.P[t];
        this.scene.attach(m);
        await moveTo(m, tP.seat.at(1.5, 0, TY + 0.03), 0.6, { arc: 0.4 });
        sfx('chain');
        m.parent && m.parent.remove(m);
        keep = true;
        vs.players[t].cuffed = true;
        this.setCuffs(t, true, true);
        this.say(`${who} ${this.v(e.player, 'cuff', 'cuffs')} ${this.nmObj(t)}. ${this.isMe(t) ? 'You skip' : 'They skip'} ${this.isMe(t) ? 'your' : 'their'} next turn.`, 2.8);
        await wait(0.9);
        break;
      }
      case 'rotator': {
        this.scene.attach(m);
        await moveTo(m, V3(0.25, TY + 0.02, 0.25), 0.4, { arc: 0.15 });
        sfx('whoosh');
        await animate(0.9, (k) => { m.rotation.y = k * Math.PI * 4 * (e.dir > 0 ? 1 : -1); });
        vs.dir = e.dir;
        this.say(`${who} ${this.v(e.player, 'spin', 'spins')} the Rotator. Turn order reversed.`, 2.4);
        await wait(0.5);
        break;
      }
      case 'phone': {
        await this.handTo(hand, this.isMe(e.player) ? this.camPos.clone().lerp(V3(0, TY, 0), 0.25).add(V3(0.2, -0.1, 0)) : this.headPos(e.player).lerp(V3(0, TY, 0), 0.2).add(V3(0, 0, 0)), 0.4, 0.05);
        sfx('phone');
        await wait(1.0);
        if (e.secret) this.say(`A voice whispers: "Shell number ${e.secret.pos} of ${e.secret.total}... ${e.secret.live ? 'LIVE' : 'BLANK'}."`, 3.6);
        else this.say(`${who} ${this.v(e.player, 'take', 'takes')} a call. Someone on the line knows something.`, 2.6);
        await wait(1.2);
        break;
      }
    }
    if (!keep) await vanish();
    this.ui.hud && this.ui.hud(vs, this.viewer);
    await this.handHome(P, 1, 0.35);
  }

  // ---------------- picking ----------------
  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
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
      const m = M.makeItem(id);
      const bb = new THREE.Box3().setFromObject(m);
      const ctr = bb.getCenter(V3());
      const size = bb.getSize(V3()).length();
      m.position.sub(ctr);
      sc.add(m);
      cam.position.set(0, size * 1.1, size * 1.6);
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
