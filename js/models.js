// Muckshot — every model is built in code from basic shapes.
// Swap any make*() function for a loaded CC0 model later if you like: callers
// only rely on the returned Group (and the userData hooks documented below).
import { THREE, lam, basic, OUTLINE, planksTex, noiseTex, tableTopTex, canvasTex, rand } from './gfx.js';

export const TABLE_Y = 0.9;
export const TABLE_R = 1.75;
export const SEAT_R = 2.35;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, mat) => mesh(new THREE.BoxGeometry(w, h, d), mat);
const cyl = (rt, rb, h, seg, mat, open = false) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
const sph = (r, ws, hs, mat) => mesh(new THREE.SphereGeometry(r, ws, hs), mat);
const cone = (r, h, seg, mat) => mesh(new THREE.ConeGeometry(r, h, seg), mat);
const torus = (R, r, rs, ts, arc, mat) => mesh(new THREE.TorusGeometry(R, r, rs, ts, arc), mat);
function put(m, x, y, z, rx = 0, ry = 0, rz = 0) { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; }
function sc(m, x, y, z) { m.scale.set(x, y, z); return m; }
function group(...kids) { const g = new THREE.Group(); kids.forEach((k) => g.add(k)); return g; }

// Box with a black "inverted hull" outline — cartoon look for the hands.
function obox(w, h, d, mat, t = 0.0055) {
  const m = box(w, h, d, mat);
  const o = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * t, h + 2 * t, d + 2 * t), OUTLINE);
  m.add(o);
  return m;
}

// ---------------- room ----------------
export function makeRoom() {
  const room = new THREE.Group();
  const W = 11, H = 4.4;
  const floorMat = lam(0xffffff, { map: planksTex(0x4a3524, { planks: 4, vertical: false, seed: 5, repeat: [6, 6] }) });
  const floor = mesh(new THREE.PlaneGeometry(W, W), floorMat);
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const wallMat = lam(0xffffff, { map: planksTex(0x4b5536, { planks: 5, seed: 9, grime: 0x0d1408, repeat: [7, 2] }) });
  for (let i = 0; i < 4; i++) {
    const wall = mesh(new THREE.PlaneGeometry(W, H), wallMat);
    const a = (i * Math.PI) / 2;
    wall.position.set(Math.sin(a) * W / 2, H / 2, Math.cos(a) * W / 2);
    wall.rotation.y = a + Math.PI;
    room.add(wall);
  }
  const ceil = mesh(new THREE.PlaneGeometry(W, W), lam(0xffffff, { map: planksTex(0x2a2218, { planks: 6, seed: 2, repeat: [5, 5] }) }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  room.add(ceil);
  // beams
  const beamMat = lam(0x2b1d12);
  for (let k = -2; k <= 2; k++) room.add(put(box(0.18, 0.22, W, beamMat), k * 2.2, H - 0.11, 0));

  // window with swampy moonlight
  const win = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), basic(0x1d3a33));
  win.add(glass);
  const frameMat = lam(0x22180f);
  win.add(put(box(1.75, 0.1, 0.1, frameMat), 0, 0.53, 0));
  win.add(put(box(1.75, 0.1, 0.1, frameMat), 0, -0.53, 0));
  win.add(put(box(0.1, 1.15, 0.1, frameMat), -0.83, 0, 0));
  win.add(put(box(0.1, 1.15, 0.1, frameMat), 0.83, 0, 0));
  win.add(put(box(0.06, 1.0, 0.06, frameMat), 0, 0, 0.02));
  win.add(put(box(1.6, 0.06, 0.06, frameMat), 0, 0, 0.02));
  // moon + dead trees silhouette painted into the glass
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), basic(0xb9c9a0));
  moon.position.set(0.45, 0.25, 0.005);
  win.add(moon);
  for (let k = 0; k < 4; k++) {
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.5 + k * 0.1), basic(0x07100c));
    tr.position.set(-0.6 + k * 0.33, -0.3, 0.006);
    win.add(tr);
  }
  win.position.set(-2.2, 2.2, -W / 2 + 0.06);
  room.add(win);

  // shelf with pickled jars
  const shelf = new THREE.Group();
  const wood = lam(0x3a2817);
  shelf.add(put(box(2.2, 0.06, 0.35, wood), 0, 0, 0));
  shelf.add(put(box(2.2, 0.06, 0.35, wood), 0, 0.6, 0));
  const R = rand(11);
  const jarCols = [0x6b7f2a, 0x8a5a1e, 0x3f6b5a, 0x7a2a1e, 0x9a8a3a];
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 6; k++) {
      const h = 0.18 + R() * 0.16;
      const jar = cyl(0.07, 0.07, h, 7, lam(jarCols[(k + row) % 5], { emissive: jarCols[(k + row) % 5], emissiveIntensity: 0.15 }));
      jar.position.set(-0.95 + k * 0.38 + R() * 0.05, row * 0.6 + 0.03 + h / 2, 0);
      shelf.add(jar);
      const lid = cyl(0.075, 0.075, 0.03, 7, lam(0x2a2a2a));
      lid.position.set(jar.position.x, row * 0.6 + 0.03 + h + 0.015, 0);
      shelf.add(lid);
    }
  }
  shelf.position.set(2.6, 1.6, -W / 2 + 0.2);
  room.add(shelf);

  // barrels
  const barrelMat = lam(0x4a3220);
  const bandMat = lam(0x222222);
  [[-4.2, -3.9], [-3.6, -4.5], [4.3, 3.8]].forEach(([x, z]) => {
    const b = cyl(0.38, 0.34, 0.95, 9, barrelMat);
    b.position.set(x, 0.475, z);
    room.add(b);
    [0.2, 0.75].forEach((y) => { const band = cyl(0.39, 0.39, 0.05, 9, bandMat); band.position.set(x, y, z); room.add(band); });
  });
  // door
  const door = group(put(box(1.1, 2.3, 0.08, lam(0x2e2216)), 0, 1.15, 0), put(sph(0.04, 5, 4, lam(0x8a7a3a)), 0.42, 1.1, 0.06));
  door.position.set(W / 2 - 0.05, 0, 1.5);
  door.rotation.y = -Math.PI / 2;
  room.add(door);
  // a mounted gator skull over the door, sort of
  const skull = group(
    put(box(0.5, 0.14, 0.18, lam(0xcfc6a8)), 0, 0, 0),
    put(box(0.45, 0.06, 0.12, lam(0xb8ae90)), 0.4, -0.04, 0),
    put(box(0.08, 0.04, 0.04, basic(0x000000)), 0.05, 0.06, 0.07),
  );
  skull.position.set(W / 2 - 0.12, 2.9, 1.5);
  skull.rotation.y = -Math.PI / 2;
  room.add(skull);
  // floor rug
  const rug = mesh(new THREE.CircleGeometry(2.9, 10), lam(0xffffff, { map: noiseTex(0x3b2a22, { amt: 0.25, seed: 8, spots: 30, spotColor: 0x1a120c, repeat: [3, 3] }) }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.01;
  room.add(rug);
  return room;
}

export function makeTable() {
  const g = new THREE.Group();
  const topMat = lam(0xffffff, { map: tableTopTex() });
  const top = cyl(TABLE_R, TABLE_R, 0.08, 20, [lam(0x2a1a0e), topMat, lam(0x2a1a0e)]);
  top.position.y = TABLE_Y - 0.04;
  g.add(top);
  const rim = torus(TABLE_R, 0.04, 4, 24, Math.PI * 2, lam(0x22150b));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = TABLE_Y - 0.02;
  g.add(rim);
  const leg = cyl(0.16, 0.22, TABLE_Y - 0.08, 7, lam(0x24170c));
  leg.position.y = (TABLE_Y - 0.08) / 2;
  g.add(leg);
  const foot = cyl(0.7, 0.75, 0.06, 7, lam(0x24170c));
  foot.position.y = 0.03;
  g.add(foot);
  top.userData.isTable = true;
  return g;
}

export function makeLamp() {
  const g = new THREE.Group(); // pivot at ceiling
  const cordLen = 1.35;
  g.add(put(cyl(0.008, 0.008, cordLen, 4, basic(0x111111)), 0, -cordLen / 2, 0));
  const shadeMat = lam(0x5a6248, { side: THREE.DoubleSide });
  const shadeM = mesh(new THREE.ConeGeometry(0.42, 0.32, 9, 1, true), shadeMat);
  shadeM.position.y = -cordLen - 0.1;
  g.add(shadeM);
  g.add(put(cyl(0.05, 0.05, 0.08, 6, lam(0x333333)), 0, -cordLen + 0.05, 0));
  const bulb = sph(0.075, 7, 5, basic(0xfff1c0));
  bulb.castShadow = false;
  bulb.position.y = -cordLen - 0.2;
  g.add(bulb);
  g.userData.bulb = bulb;
  g.userData.bulbY = -cordLen - 0.2;
  return g;
}

// ---------------- characters ----------------
export const CHARACTERS = [
  { name: 'Croaker', blurb: 'frog-faced bait seller' },
  { name: 'Old Heron', blurb: 'tall, quiet, sharp beak' },
  { name: 'Moss Mother', blurb: 'nobody has seen her face' },
  { name: 'Gatorjaw', blurb: 'smiles too much' },
];

// Returns a Group facing +z, seated. userData: { head, eyes:[mesh], mats:[material], torso }
export function makeCharacter(kind) {
  const g = new THREE.Group();
  const mats = [];
  const m = (c, o) => { const x = lam(c, { ...(o || {}) }); mats.push(x); return x; };
  const glow = (c) => basic(c, {});
  const body = new THREE.Group();
  g.add(body);
  const head = new THREE.Group();
  body.add(head);
  const eyes = [];

  // chair
  const chairMat = lam(0x2a1b10);
  g.add(put(box(0.7, 1.0, 0.07, chairMat), 0, 1.0, -0.36));
  g.add(put(box(0.7, 0.06, 0.6, chairMat), 0, 0.5, -0.05));
  [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.22], [0.3, 0.22]].forEach(([x, z]) => g.add(put(box(0.06, 0.5, 0.06, chairMat), x, 0.25, z)));

  if (kind === 0) { // Croaker — frog head, waxed coat
    const coat = m(0x3b4526), skin = m(0x6e8f37), belly = m(0xb7b06a);
    body.add(put(cyl(0.27, 0.33, 0.85, 6, coat), 0, 0.97, 0));
    body.add(put(box(0.74, 0.16, 0.34, coat), 0, 1.36, 0));
    body.add(put(box(0.2, 0.5, 0.05, belly), 0, 1.05, 0.27));
    head.position.set(0, 1.62, 0.02);
    head.add(sc(put(sph(0.3, 8, 6, skin), 0, 0, 0), 1.35, 0.72, 1.1));
    head.add(put(box(0.5, 0.025, 0.05, basic(0x1a0f08)), 0, -0.07, 0.31));
    for (const s of [-1, 1]) {
      head.add(put(sph(0.095, 7, 5, skin), s * 0.2, 0.17, 0.12));
      const eye = put(sph(0.07, 6, 5, glow(0xe8e0a0)), s * 0.2, 0.2, 0.18);
      head.add(eye);
      const pupil = put(box(0.07, 0.025, 0.02, basic(0x050505)), s * 0.2, 0.2, 0.25);
      head.add(pupil);
      eyes.push(eye);
    }
  } else if (kind === 1) { // Old Heron — long beak, straw hat
    const coat = m(0x3f4a5b), feather = m(0xc3c9cf), beak = m(0xd09a3a), straw = m(0x8f7d45);
    body.add(put(cyl(0.22, 0.28, 0.95, 6, coat), 0, 1.0, 0));
    body.add(put(box(0.6, 0.14, 0.3, coat), 0, 1.42, 0));
    body.add(put(cyl(0.08, 0.1, 0.25, 6, feather), 0, 1.58, 0));
    head.position.set(0, 1.82, 0);
    head.add(put(sph(0.18, 7, 5, feather), 0, 0, 0));
    head.add(put(cone(0.06, 0.5, 5, beak), 0, -0.03, 0.36, Math.PI / 2, 0, 0));
    head.add(put(cyl(0.38, 0.38, 0.03, 10, straw), 0, 0.15, 0));
    head.add(put(cyl(0.16, 0.19, 0.14, 8, straw), 0, 0.23, 0));
    head.add(put(cyl(0.195, 0.195, 0.03, 8, m(0x6a2a1a)), 0, 0.18, 0));
    for (const s of [-1, 1]) {
      const eye = put(sph(0.03, 5, 4, glow(0xff4020)), s * 0.12, 0.03, 0.12);
      head.add(eye);
      eyes.push(eye);
    }
  } else if (kind === 2) { // Moss Mother — hooded, glowing eyes in the dark
    const robe = m(0x39361f), moss = m(0x56702b), dark = basic(0x030303);
    body.add(put(cyl(0.22, 0.42, 0.95, 7, robe), 0, 0.98, 0));
    head.position.set(0, 1.62, 0);
    head.add(put(sph(0.3, 8, 6, robe), 0, 0, 0));
    head.add(sc(put(sph(0.22, 7, 5, dark), 0, -0.02, 0.12), 1, 1.1, 0.8));
    const R = rand(4);
    for (let k = 0; k < 14; k++) {
      const a = R() * Math.PI * 2, y = R() * 1.0;
      const tuft = mesh(new THREE.IcosahedronGeometry(0.06 + R() * 0.05, 0), moss);
      if (k < 9) tuft.position.set(Math.sin(a) * 0.3, 0.6 + y * 0.9, Math.cos(a) * 0.3 * (Math.cos(a) > 0 ? 0.6 : 1));
      else tuft.position.set(Math.sin(a) * 0.25, 1.75 + R() * 0.15, Math.cos(a) * 0.2 - 0.05);
      body.add(tuft);
    }
    for (const s of [-1, 1]) {
      const eye = put(box(0.07, 0.035, 0.02, glow(0xffd040)), s * 0.08, 0.02, 0.29);
      head.add(eye);
      eyes.push(eye);
    }
  } else { // Gatorjaw — long snout, teeth, bowler hat
    const suit = m(0x2a2d24), skin = m(0x4b6a33), teeth = m(0xe8e2c8), hat = m(0x161616);
    body.add(put(box(0.6, 0.85, 0.4, suit), 0, 0.97, 0));
    body.add(put(box(0.76, 0.16, 0.42, suit), 0, 1.36, 0));
    body.add(put(box(0.12, 0.4, 0.02, m(0x7a1a1a)), 0, 1.1, 0.21));
    head.position.set(0, 1.62, 0);
    head.add(put(box(0.36, 0.24, 0.34, skin), 0, 0, 0));
    head.add(put(box(0.26, 0.1, 0.4, skin), 0, 0.02, 0.34));
    head.add(put(box(0.24, 0.07, 0.38, skin), 0, -0.08, 0.32));
    for (let k = 0; k < 5; k++) {
      for (const s of [-1, 1]) head.add(put(cone(0.015, 0.04, 3, teeth), s * 0.115, -0.03, 0.2 + k * 0.08, Math.PI, 0, 0));
    }
    for (const s of [-1, 1]) {
      head.add(put(box(0.09, 0.07, 0.09, skin), s * 0.12, 0.14, 0.1));
      const eye = put(box(0.06, 0.03, 0.02, glow(0xe8d040)), s * 0.12, 0.15, 0.15);
      head.add(eye);
      eyes.push(eye);
    }
    head.add(put(cyl(0.3, 0.3, 0.02, 10, hat), 0, 0.13, 0));
    head.add(sc(put(sph(0.18, 8, 4, hat), 0, 0.14, 0), 1, 0.9, 1));
  }
  g.userData = { body, head, eyes, mats, baseHeadY: head.position.y };
  return g;
}

// ---------------- cartoon hands ----------------
// White cartoon hands with black outlines. Fingers point along +z, palm down.
// side: 1 = right hand, -1 = left hand. userData.fingers / thumb for curling.
let HAND_MAT = null;
export function makeHand(side = 1) {
  if (!HAND_MAT) HAND_MAT = lam(0xf2eee4, { emissive: 0x4a463e });
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  inner.add(put(obox(0.15, 0.045, 0.14, HAND_MAT), 0, 0.03, 0));
  inner.add(put(obox(0.11, 0.05, 0.06, HAND_MAT), 0, 0.03, -0.09)); // wrist
  const lens = [0.075, 0.095, 0.1, 0.09];
  const fingers = [];
  for (let k = 0; k < 4; k++) {
    const idx = side > 0 ? k : 3 - k; // pinky outside
    const len = lens[idx];
    const x = (-0.0525 + k * 0.035) * 1;
    const piv = new THREE.Group();
    piv.position.set(x, 0.035, 0.07);
    const s1 = put(obox(0.03, 0.036, len * 0.55, HAND_MAT), 0, 0, len * 0.275);
    piv.add(s1);
    const p2 = new THREE.Group();
    p2.position.set(0, 0, len * 0.55);
    p2.add(put(obox(0.028, 0.034, len * 0.5, HAND_MAT), 0, 0, len * 0.25));
    piv.add(p2);
    piv.userData.seg2 = p2;
    inner.add(piv);
    fingers.push(piv);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-side * 0.075, 0.03, 0.0);
  thumb.rotation.y = -side * 0.7;
  thumb.add(put(obox(0.034, 0.036, 0.085, HAND_MAT), 0, 0, 0.04));
  inner.add(thumb);
  g.userData = { fingers, thumb, side, inner, curl: 0 };
  g.scale.setScalar(1.25);
  return g;
}
export function setCurl(hand, k) {
  const u = hand.userData;
  u.curl = k;
  u.fingers.forEach((f, i) => {
    f.rotation.x = k * 1.25;
    f.userData.seg2.rotation.x = k * 1.5;
  });
  u.thumb.rotation.x = k * 0.6;
  u.thumb.rotation.y = -u.side * (0.7 - k * 0.6);
}

// ---------------- shotgun ----------------
// Muzzle points +z. userData: body (recoil group), pump, flash, light, muzzle, port, grip, fore
export function makeGun() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const metal = lam(0x2b2d30), dark = lam(0x18191b), wood = lam(0x5a3518), woodDark = lam(0x3e2410);
  body.add(put(box(0.075, 0.12, 0.3, wood), 0, -0.02, -0.33, 0.12, 0, 0)); // stock
  body.add(put(box(0.07, 0.09, 0.06, woodDark), 0, -0.07, -0.16, 0.5, 0, 0)); // grip
  body.add(put(box(0.075, 0.095, 0.24, metal), 0, 0.01, -0.05)); // receiver
  body.add(put(box(0.02, 0.03, 0.06, dark), 0.04, 0.025, -0.06)); // ejection port
  body.add(put(cyl(0.022, 0.022, 0.56, 7, dark), 0, 0.035, 0.34, Math.PI / 2, 0, 0)); // barrel
  body.add(put(cyl(0.017, 0.017, 0.46, 6, metal), 0, -0.012, 0.29, Math.PI / 2, 0, 0)); // mag tube
  body.add(put(box(0.012, 0.02, 0.012, lam(0xbbaa66)), 0, 0.065, 0.61)); // bead
  body.add(put(torus(0.03, 0.006, 4, 8, Math.PI, dark), 0, -0.05, -0.08, 0, Math.PI / 2, 0)); // trigger guard
  const pump = new THREE.Group();
  pump.add(put(cyl(0.033, 0.033, 0.17, 7, wood), 0, 0, 0, Math.PI / 2, 0, 0));
  for (let k = 0; k < 4; k++) pump.add(put(cyl(0.035, 0.035, 0.012, 7, woodDark), 0, 0, -0.06 + k * 0.04, Math.PI / 2, 0, 0));
  pump.position.set(0, -0.012, 0.2);
  body.add(pump);
  // muzzle flash
  const flash = new THREE.Group();
  const fm = basic(0xffd27a, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fm2 = basic(0xffffff, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.45, 6, 1, true), fm);
  c1.rotation.x = -Math.PI / 2;
  c1.position.z = 0.22;
  flash.add(c1);
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 5, 1, true), fm2);
  c2.rotation.x = -Math.PI / 2;
  c2.position.z = 0.12;
  flash.add(c2);
  for (let k = 0; k < 4; k++) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.05), fm);
    sp.rotation.set(0, Math.PI / 2, (k * Math.PI) / 4);
    sp.position.z = 0.05;
    flash.add(sp);
  }
  flash.position.set(0, 0.035, 0.62);
  flash.visible = false;
  body.add(flash);
  const light = new THREE.PointLight(0xffb060, 0, 7, 1.5);
  light.position.set(0, 0.05, 0.75);
  body.add(light);
  g.traverse((o) => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
  g.userData = {
    body, pump, flash, light,
    muzzle: V(0, 0.035, 0.62), port: V(0.05, 0.03, -0.06),
    grip: V(0, -0.08, -0.17), fore: V(0, -0.02, 0.2),
  };
  return g;
}

// ---------------- shells ----------------
const SHELL_LIVE = 0xb3232b, SHELL_BLANK = 0x2c5b9e, SHELL_FAKE = 0x2c5b9e;
export function makeShell(live) {
  const g = new THREE.Group();
  g.add(put(cyl(0.019, 0.019, 0.062, 8, lam(live ? SHELL_LIVE : SHELL_BLANK)), 0, 0.049, 0));
  g.add(put(cyl(0.0205, 0.0205, 0.018, 8, lam(0xc9a13a)), 0, 0.009, 0));
  g.add(put(cyl(0.0215, 0.0215, 0.004, 8, lam(0xb08a2a)), 0, 0.002, 0));
  return g;
}

// Bandolier belt for the round-start showcase.
export function makeBelt(count) {
  const g = new THREE.Group();
  const w = Math.max(0.3, count * 0.06 + 0.08);
  g.add(put(box(w, 0.05, 0.012, lam(0x4a2c16)), 0, 0.03, -0.01));
  g.add(put(box(w, 0.006, 0.014, lam(0x2e1a0c)), 0, 0.055, -0.01));
  g.add(put(box(w, 0.006, 0.014, lam(0x2e1a0c)), 0, 0.005, -0.01));
  for (let k = 0; k < count; k++) {
    g.add(put(box(0.05, 0.03, 0.02, lam(0x5a3a1e)), -w / 2 + 0.07 + k * 0.06, 0.03, 0.006));
  }
  g.userData.width = w;
  return g;
}

export function makeTray() {
  const g = new THREE.Group();
  const tin = lam(0xffffff, { map: noiseTex(0x6b5a44, { amt: 0.35, seed: 21, spots: 40, spotColor: 0x3a1e0e }) });
  const W = 1.2, D = 0.75;
  g.add(put(box(W, 0.025, D, tin), 0, 0, 0));
  g.add(put(box(W + 0.05, 0.06, 0.025, tin), 0, 0.03, D / 2));
  g.add(put(box(W + 0.05, 0.06, 0.025, tin), 0, 0.03, -D / 2));
  g.add(put(box(0.025, 0.06, D, tin), W / 2, 0.03, 0));
  g.add(put(box(0.025, 0.06, D, tin), -W / 2, 0.03, 0));
  g.add(put(box(W * 0.94, 0.004, D * 0.92, lam(0x2d3a26)), 0, 0.014, 0)); // felt
  g.userData = { W, D, top: 0.016 };
  return g;
}

export function makeCandle() {
  const g = new THREE.Group();
  const h = 0.07 + Math.random() * 0.03;
  g.add(put(cyl(0.017, 0.02, h, 6, lam(0xd8cfae)), 0, h / 2, 0));
  g.add(put(cyl(0.022, 0.022, 0.01, 6, lam(0x8a7a5a)), 0, 0.005, 0));
  g.add(put(box(0.004, 0.012, 0.004, basic(0x111111)), 0, h + 0.006, 0));
  const flame = new THREE.Group();
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.04, 5), basic(0xffb347, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  f1.position.y = 0.02;
  flame.add(f1);
  const f2 = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), basic(0xfff0b0));
  f2.position.y = 0.01;
  flame.add(f2);
  flame.position.y = h + 0.01;
  g.add(flame);
  g.userData = { flame, lit: true, phase: Math.random() * 10 };
  return g;
}

export function makeLabel(text, { color = '#f4f0e6', bg = 'rgba(0,0,0,0.75)', w = 64, h = 24, scale = 0.16 } = {}) {
  const tex = canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.font = 'bold 16px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(scale, (scale * h) / w, 1);
  sp.renderOrder = 10;
  return sp;
}

// ---------------- items ----------------
function diceFaces() {
  const pips = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
  return [1, 6, 2, 5, 3, 4].map((n) => lam(0xffffff, {
    map: canvasTex(12, 12, (g) => {
      g.fillStyle = '#a81e1e';
      g.fillRect(0, 0, 12, 12);
      g.fillStyle = '#f2e8d0';
      pips[n].forEach(([x, y]) => g.fillRect(2 + x * 3, 2 + y * 3, 2, 2));
    }),
  }));
}
let DICE_MATS = null;

function gloveModel(color, emissive) {
  const mat = lam(color, emissive ? { emissive, emissiveIntensity: 0.35 } : undefined);
  const g = new THREE.Group();
  g.add(put(box(0.09, 0.025, 0.08, mat), 0, 0.013, 0));
  for (let k = 0; k < 4; k++) g.add(put(box(0.018, 0.02, 0.055, mat), -0.03 + k * 0.02, 0.011, 0.065 - Math.abs(k - 1.5) * 0.006));
  g.add(put(box(0.02, 0.02, 0.05, mat), 0.055, 0.011, 0.015, 0, 0.6, 0));
  g.add(put(cyl(0.045, 0.05, 0.035, 7, lam(emissive ? 0x8a6a10 : 0x3a2a1a)), 0, 0.02, -0.055, Math.PI / 2, 0, 0));
  return g;
}

export function makeItem(id) {
  const g = new THREE.Group();
  const chrome = lam(0xa8aeb4), black = lam(0x1a1a1a);
  switch (id) {
    case 'stethoscope': {
      const tube = torus(0.055, 0.008, 4, 12, Math.PI * 1.5, lam(0x202020));
      tube.rotation.x = Math.PI / 2;
      tube.position.y = 0.01;
      g.add(tube);
      g.add(put(cyl(0.028, 0.028, 0.014, 9, chrome), 0.055, 0.008, 0));
      g.add(put(cyl(0.02, 0.02, 0.006, 9, lam(0x222222)), 0.055, 0.017, 0));
      g.add(put(sph(0.01, 5, 4, black), 0, 0.012, -0.06));
      g.add(put(sph(0.01, 5, 4, black), -0.05, 0.012, -0.03));
      break;
    }
    case 'prybar': {
      const red = lam(0xa3261c);
      g.add(put(box(0.22, 0.018, 0.022, red), 0, 0.011, 0));
      g.add(put(box(0.06, 0.018, 0.022, red), 0.12, 0.02, 0.02, 0, 0.9, 0.4));
      g.add(put(box(0.03, 0.012, 0.024, chrome), -0.115, 0.01, 0));
      break;
    }
    case 'hollow': {
      const brass = lam(0xc9a13a), copper = lam(0xb05a2a);
      for (const x of [-0.025, 0.025]) {
        g.add(put(cyl(0.017, 0.017, 0.06, 8, brass), x, 0.03, 0));
        g.add(put(cone(0.017, 0.035, 8, copper), x, 0.077, 0));
        g.add(put(cyl(0.007, 0.007, 0.004, 6, black), x, 0.093, 0));
      }
      break;
    }
    case 'bandage': {
      g.add(put(cyl(0.04, 0.04, 0.055, 9, lam(0xe8e4d8)), 0, 0.0275, 0));
      g.add(put(cyl(0.015, 0.015, 0.057, 6, lam(0x9a8a6a)), 0, 0.0275, 0));
      g.add(put(box(0.05, 0.004, 0.045, lam(0xe8e4d8)), 0.04, 0.003, 0.02, 0, 0.4, 0));
      g.add(put(box(0.022, 0.006, 0.006, lam(0xc02020)), 0, 0.058, 0));
      g.add(put(box(0.006, 0.006, 0.022, lam(0xc02020)), 0, 0.058, 0));
      break;
    }
    case 'doll': {
      const burlap = lam(0xffffff, { map: noiseTex(0x9a7a4a, { amt: 0.4, w: 8, h: 8, seed: 31 }) });
      g.add(put(box(0.05, 0.06, 0.03, burlap), 0, 0.045, 0));
      g.add(put(sph(0.032, 6, 5, burlap), 0, 0.1, 0));
      g.add(put(box(0.07, 0.016, 0.016, burlap), 0, 0.06, 0, 0, 0, 0.2));
      g.add(put(box(0.018, 0.035, 0.018, burlap), -0.014, 0.008, 0));
      g.add(put(box(0.018, 0.035, 0.018, burlap), 0.014, 0.008, 0));
      for (const s of [-1, 1]) {
        g.add(put(box(0.012, 0.003, 0.003, black), s * 0.012, 0.105, 0.031, 0, 0, 0.8));
        g.add(put(box(0.012, 0.003, 0.003, black), s * 0.012, 0.105, 0.031, 0, 0, -0.8));
      }
      for (const [x, y, rz] of [[0.02, 0.07, -0.8], [-0.01, 0.11, 0.5]]) {
        g.add(put(cyl(0.0025, 0.0025, 0.05, 4, chrome), x, y, 0.015, 0.6, 0, rz));
        g.add(put(sph(0.007, 5, 4, lam(0xcc1111)), x + Math.sin(-rz) * 0.025, y + 0.02, 0.03));
      }
      break;
    }
    case 'mirror': {
      const gold = lam(0xc9a13a, { emissive: 0x6a5010, emissiveIntensity: 0.6 });
      const m = new THREE.Group();
      const fr = torus(0.045, 0.008, 4, 12, Math.PI * 2, gold);
      m.add(fr);
      m.add(put(cyl(0.044, 0.044, 0.004, 12, basic(0x9fd8e8)), 0, 0, 0, Math.PI / 2, 0, 0));
      m.add(put(cyl(0.008, 0.008, 0.07, 5, gold), 0, -0.08, 0));
      m.position.y = 0.06;
      m.rotation.x = -0.35;
      g.add(m);
      g.add(put(box(0.03, 0.012, 0.02, gold), 0, 0.006, 0.02));
      g.userData.rare = true;
      break;
    }
    case 'dice': {
      if (!DICE_MATS) DICE_MATS = diceFaces();
      const d1 = mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), DICE_MATS);
      d1.position.set(-0.03, 0.0225, 0);
      d1.rotation.y = 0.4;
      const d2 = mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), DICE_MATS);
      d2.position.set(0.032, 0.0225, 0.02);
      d2.rotation.set(Math.PI / 2, 0.9, 0);
      g.add(d1, d2);
      break;
    }
    case 'glove': g.add(gloveModel(0x6a4a2e)); break;
    case 'goldglove': g.add(gloveModel(0xd8b040, 0x8a6a10)); g.userData.rare = true; break;
    case 'fake': {
      const s = makeShell(false);
      s.children[0].material = lam(0x6f7d62);
      s.rotation.z = Math.PI / 2;
      s.position.set(0.035, 0.02, 0);
      g.add(s);
      g.add(put(box(0.07, 0.004, 0.005, lam(0xd8d0b0)), 0, 0.04, 0.0));
      const s2 = makeShell(false);
      s2.children[0].material = lam(0x6f7d62);
      s2.position.set(-0.04, 0, 0.02);
      g.add(s2);
      break;
    }
    case 'insurance': {
      const paper = lam(0xffffff, {
        map: canvasTex(16, 20, (c) => {
          c.fillStyle = '#e8e0c8'; c.fillRect(0, 0, 16, 20);
          c.fillStyle = '#5a5040';
          for (let y = 3; y < 15; y += 2) c.fillRect(2, y, 8 + ((y * 7) % 4), 1);
          c.fillStyle = '#a01818'; c.fillRect(10, 14, 4, 4);
        }),
      });
      g.add(put(box(0.1, 0.004, 0.13, paper), 0, 0.004, 0, 0, 0.15, 0));
      g.add(put(box(0.1, 0.004, 0.13, lam(0xd8d0b8)), 0.008, 0.001, 0.006, 0, 0.25, 0));
      g.add(put(cyl(0.016, 0.016, 0.008, 8, lam(0xb01818, { emissive: 0x500000 })), 0.025, 0.01, 0.04));
      g.userData.rare = true;
      break;
    }
    case 'double': {
      const wood = lam(0x5a3518);
      for (const x of [-0.016, 0.016]) g.add(put(cyl(0.015, 0.015, 0.2, 7, lam(0x2b2d30)), x, 0.016, 0.02, Math.PI / 2, 0, 0));
      g.add(put(box(0.06, 0.03, 0.07, wood), 0, 0.015, -0.1));
      g.add(put(box(0.05, 0.01, 0.01, lam(0x888888)), 0, 0.034, 0.1));
      break;
    }
    case 'switch': {
      g.add(put(box(0.08, 0.03, 0.06, lam(0x3a3a2a)), 0, 0.015, 0));
      g.add(put(box(0.05, 0.006, 0.04, lam(0xc9b020)), 0, 0.031, 0));
      g.add(put(cyl(0.005, 0.005, 0.06, 5, chrome), 0, 0.055, 0, 0.5, 0, 0));
      g.add(put(sph(0.012, 6, 5, lam(0xc02020)), 0, 0.08, 0.015));
      break;
    }
    case 'syringe': {
      const s = new THREE.Group();
      s.add(put(cyl(0.015, 0.015, 0.1, 8, lam(0xd8e8e0, { transparent: true, opacity: 0.6 })), 0, 0, 0));
      s.add(put(cyl(0.012, 0.012, 0.07, 8, basic(0x7ad02a)), 0, 0.01, 0));
      s.add(put(cyl(0.003, 0.002, 0.05, 4, chrome), 0, 0.075, 0));
      s.add(put(cyl(0.005, 0.005, 0.03, 4, chrome), 0, -0.065, 0));
      s.add(put(cyl(0.02, 0.02, 0.006, 8, lam(0x333333)), 0, -0.08, 0));
      s.add(put(box(0.05, 0.006, 0.012, lam(0x333333)), 0, -0.045, 0));
      s.rotation.z = Math.PI / 2;
      s.position.y = 0.02;
      g.add(s);
      break;
    }
    case 'cuffs': {
      for (const x of [-0.035, 0.035]) {
        const c = torus(0.03, 0.006, 4, 10, Math.PI * 2, chrome);
        c.rotation.x = Math.PI / 2;
        c.position.set(x, 0.007, 0);
        g.add(c);
      }
      g.add(put(box(0.02, 0.006, 0.006, lam(0x777777)), 0, 0.007, 0));
      break;
    }
    case 'rotator': {
      g.add(put(cyl(0.06, 0.065, 0.014, 10, lam(0x3a2a1a)), 0, 0.007, 0));
      const arc = torus(0.04, 0.007, 4, 12, Math.PI * 1.5, lam(0xe0b020));
      arc.rotation.x = Math.PI / 2;
      arc.position.y = 0.018;
      g.add(arc);
      g.add(put(cone(0.016, 0.03, 4, lam(0xe0b020)), 0.04, 0.018, -0.012, Math.PI / 2, 0, 0));
      break;
    }
    case 'phone': {
      const p = new THREE.Group();
      p.add(put(box(0.05, 0.12, 0.025, lam(0x2a2c2a)), 0, 0, 0));
      p.add(put(box(0.036, 0.025, 0.004, basic(0x7ab04a)), 0, 0.03, 0.013));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) p.add(put(box(0.008, 0.006, 0.004, lam(0x999999)), -0.012 + c * 0.012, -0.005 - r * 0.012, 0.013));
      p.add(put(cyl(0.004, 0.004, 0.05, 4, black), 0.015, 0.08, 0));
      p.rotation.x = -1.2;
      p.position.y = 0.02;
      g.add(p);
      break;
    }
    default:
      g.add(put(box(0.06, 0.06, 0.06, lam(0xff00ff)), 0, 0.03, 0));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.userData.itemId = id;
  return g;
}
