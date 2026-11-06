// Plays thousands of bot-vs-bot games through the real rules engine and checks
// invariants. Run: npm test
import { Game, MAX_SLOTS, MINIGAME_IDS, MINIGAME_DMG, MINIGAME_HEAL, INSURANCE_ROUNDS, MAX_PER_ROUND, HANDOUT_CAP, TEMP_HP, JOKER_ROUNDS, ITEMS, itemProblem, itemsForRound, handoutFor, itemWeight, roundSpeed, MAX_SPEED, redactEvents, mulberry32 } from '../js/engine.js';
import { botAction } from '../js/bot.js';

let failures = 0;
function assert(c, msg) { if (!c) { failures++; if (failures < 20) console.error('FAIL:', msg); } }

function play({ levels, mode, hp, seed }) {
  const rng = mulberry32(seed * 7 + 1);
  const g = new Game({ players: levels.map((l, i) => ({ name: 'P' + i })), hp, itemMode: mode, seed });
  let events = g.start();
  let steps = 0, itemStreak = 0;
  const counts = {};
  while (!g.over) {
    if (++steps > 5000) { assert(false, `game did not finish (${mode}, ${levels})`); break; }
    const d = g.decision;
    assert(d && g.players[d.player].alive, 'decision for a dead/missing player');
    let a = d.kind === 'minigame'
      ? { type: 'scores', scores: g.players.map(() => Math.floor(rng() * 100)) }
      : botAction(g, d.player, levels[d.player], rng);
    if (d.kind === 'turn' && a.type === 'item') { itemStreak++; if (itemStreak > 12) a = { type: 'shoot', target: d.player }; }
    else itemStreak = 0;
    const r = g.act(d.player, a);
    if (r.error) {
      assert(false, `bot made illegal move ${JSON.stringify(a)} -> ${r.error} (${levels[d.player]})`);
      const r2 = g.act(d.player, d.kind === 'turn' ? { type: 'shoot', target: d.player } : { type: 'done' });
      if (r2.error) { assert(false, 'fallback failed ' + r2.error); break; }
      events = r2.events;
    } else events = r.events;
    for (const e of events) {
      counts[e.t] = (counts[e.t] || 0) + 1;
      if (e.t === 'item' && e.id === 'handheld') assert(MINIGAME_IDS.includes(e.game), 'bad minigame id');
      if (e.secret) {
        const red = redactEvents([e], (e.secret.for + 1) % levels.length)[0];
        assert(!red.secret, 'secret leaked');
      }
    }
    for (const p of g.players) {
      assert(p.slots.length === MAX_SLOTS, 'slot count changed');
      assert(p.hp >= 0 && p.hp <= p.maxHp, 'hp out of range ' + p.hp);
      assert(p.shield >= 0, 'negative shield');
      assert(p.temp >= 0 && p.temp <= TEMP_HP, 'temp hp out of range ' + p.temp);
      assert(p.alive === p.hp > 0, 'alive flag mismatch');
      const uids = p.slots.filter(Boolean).map((s) => s.uid);
      assert(new Set(uids).size === uids.length, 'duplicate item uid');
    }
    assert(g.shells.length <= 10, 'too many shells');
    if (!g.over) assert(g.shells.length > 0 || g.phase !== 'turn', 'turn phase with empty gun');
  }
  assert(g.winner >= 0 && g.players[g.winner].alive, 'no valid winner');
  assert(g.alive().length === 1, 'more than one survivor');
  return { winner: g.winner, rounds: g.round, counts };
}

const LEVELS = ['easy', 'hard', 'xhard', 'pro'];
const MODES = ['progressive', 'draft', 'shop', 'duo', 'none'];
let seed = 1;
let games = 0;
const allCounts = {};
for (const mode of MODES) {
  for (const n of [2, 3, 4]) {
    for (let k = 0; k < 150; k++) {
      const levels = Array.from({ length: n }, (_, i) => LEVELS[(k + i) % 4]);
      const r = play({ levels, mode, hp: 2 + (k % 5), seed: seed++ });
      games++;
      for (const [t, c] of Object.entries(r.counts)) allCounts[t] = (allCounts[t] || 0) + c;
    }
  }
}
console.log(`${games} random games finished.`);

// Head-to-head strength check: each level vs easy, many games, 2 players.
function winRate(a, b, mode, N = 1500) {
  let w = 0;
  for (let k = 0; k < N; k++) {
    const swap = k % 2 === 1;
    const levels = swap ? [b, a] : [a, b];
    const r = play({ levels, mode, hp: 4, seed: 100000 + k });
    if ((r.winner === 0) !== swap) w++;
  }
  return w / N;
}
for (const mode of ['progressive', 'shop']) {
  const rows = [];
  for (const [a, b] of [['hard', 'easy'], ['xhard', 'easy'], ['pro', 'easy'], ['xhard', 'hard'], ['pro', 'hard'], ['pro', 'xhard']]) {
    rows.push(`${a} vs ${b}: ${(winRate(a, b, mode) * 100).toFixed(1)}%`);
  }
  console.log(`[${mode}] ` + rows.join(' | '));
}
// ---- targeted rule checks ----
{
  assert(MAX_SLOTS === 6, 'six item slots');
  const tiers = {
    medkit: 'legendary', doll: 'legendary', stinktrash: 'rare', insurance: 'mythic', wings: 'legendary', hack: 'rare', handheld: 'legendary',
    stethoscope: 'rare', goldglove: 'epic', adrenaline: 'epic', joker: 'mythic',
  };
  for (const [id, tier] of Object.entries(tiers)) assert(ITEMS[id].tier === tier, `${id} should be ${tier}`);
  // last life: healing items are refused, and do nothing even if forced
  const g = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 4, itemMode: 'none', seed: 5 });
  g.start();
  const p = g.decision.player;
  g.players[p].hp = 1;
  for (const id of ['bandage', 'medkit', 'syringe']) assert(itemProblem(g.players, g.shells.length, p, id) === 'lastLife', `${id} blocked on last life`);
  g.players[p].hp = 2;
  assert(itemProblem(g.players, g.shells.length, p, 'bandage') === null, 'bandage fine at 2 HP');
  g.players[p].hp = 1;
  g.players[p].slots[0] = { uid: 999, id: 'bandage' };
  assert(g.act(p, { type: 'item', slot: 0 }).error === 'lastLife', 'act refuses healing on last life');
  // shields still work on the last life
  g.players[p].shield = 1;
  g.damage(p, 1, null);
  assert(g.players[p].alive && g.players[p].hp === 1 && g.players[p].shield === 0, 'shield blocks on last life');
  // admin tools
  assert(g.adminGive(p, 'medkit') && g.players[p].slots.some((x) => x && x.id === 'medkit'), 'adminGive');
  g.adminImmune(p, true);
  g.ev = [];
  g.damage(p, 3, null);
  assert(g.players[p].hp === 1 && g.players[p].alive, 'immune takes no damage');
  g.adminImmune(p, false);
  const before = g.decision.player;
  g.adminSkip();
  assert(g.decision.kind !== 'turn' || g.decision.player !== before, 'adminSkip moves the turn');
  const idx = g.adminAddPlayer('c');
  assert(idx === 2 && g.players.length === 3 && g.knowledge.length === 3, 'adminAddPlayer');
  g.adminNextShell(true);
  assert(g.shells.length === 0 || g.shells[0].live === true, 'adminNextShell');
  // Pocket Duo: losers take MINIGAME_DMG
  const h = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 4, itemMode: 'none', seed: 9 });
  h.start();
  const q = h.decision.player;
  h.players[q].slots[0] = { uid: 998, id: 'handheld' };
  h.act(q, { type: 'item', slot: 0, pick: 'mash' });
  assert(h.decision.kind === 'minigame', 'handheld starts a minigame');
  const sc = [];
  sc[q] = 50; sc[1 - q] = 10;
  const r = h.act(q, { type: 'scores', scores: sc });
  const mg = r.events.find((e) => e.t === 'mgResult');
  assert(mg && mg.losers[0] === 1 - q && mg.dmg === MINIGAME_DMG && h.players[1 - q].hp === 4 - MINIGAME_DMG, 'minigame losers lose 2 HP');
  // ...and the owner heals 2 if they came first (capped at max HP)
  assert(mg.first && mg.first.player === q && h.players[q].hp === 4, 'first place at full HP heals nothing');
  // ...even on the last life
  const hl = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 4, itemMode: 'none', seed: 21 });
  hl.start();
  const ql = hl.decision.player;
  hl.players[ql].hp = 1;
  hl.players[ql].slots[0] = { uid: 994, id: 'handheld' };
  assert(!hl.act(ql, { type: 'item', slot: 0, pick: 'mash' }).error, 'Pocket Duo usable on the last life');
  const scl = [];
  scl[ql] = 60; scl[1 - ql] = 5;
  hl.act(ql, { type: 'scores', scores: scl });
  assert(hl.players[ql].hp === 1 + MINIGAME_HEAL, 'Pocket Duo heals on the last life');
  const h2 = new Game({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], hp: 5, itemMode: 'none', seed: 11 });
  h2.start();
  const q2 = h2.decision.player;
  h2.players[q2].hp = 2;
  h2.players[q2].slots[0] = { uid: 997, id: 'handheld' };
  h2.act(q2, { type: 'item', slot: 0, pick: 'draw' });
  const sc2 = [5, 5, 5];
  sc2[q2] = 99;
  const mg2 = h2.act(q2, { type: 'scores', scores: sc2 }).events.find((e) => e.t === 'mgResult');
  assert(mg2.first && mg2.first.amount === MINIGAME_HEAL && h2.players[q2].hp === 2 + MINIGAME_HEAL, 'Pocket Duo owner heals 2 when first');
  // not first: no heal
  const h3 = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 5, itemMode: 'none', seed: 12 });
  h3.start();
  const q3 = h3.decision.player;
  h3.players[q3].hp = 4;
  h3.players[q3].slots[0] = { uid: 996, id: 'handheld' };
  h3.act(q3, { type: 'item', slot: 0, pick: 'draw' });
  const sc3 = [];
  sc3[q3] = 1; sc3[1 - q3] = 80;
  const mg3 = h3.act(q3, { type: 'scores', scores: sc3 }).events.find((e) => e.t === 'mgResult');
  assert(!mg3.first && h3.players[q3].hp === 4 - MINIGAME_DMG, 'no heal when not first');
  // Life Insurance covers 3 rounds (the current one included), then expires
  const li = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 4, itemMode: 'none', seed: 13 });
  li.start();
  const p4 = li.decision.player;
  li.players[p4].slots[0] = { uid: 995, id: 'insurance' };
  li.act(p4, { type: 'item', slot: 0 });
  assert(li.players[p4].insured === INSURANCE_ROUNDS, 'insurance starts at 3 rounds');
  let ends = 0;
  for (let k = 0; k < INSURANCE_ROUNDS; k++) {
    assert(li.players[p4].insured > 0, `insured during round ${k + 1}`);
    li.decision = { kind: 'turn', player: li.turn };
    ends += li.adminReload().filter((e) => e.t === 'insuranceEnd').length;
  }
  assert(li.players[p4].insured === 0 && ends === 1, 'insurance expires after 3 rounds');
  // Life Insurance revives at full HP
  const lr = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 5, itemMode: 'none', seed: 31 });
  lr.start();
  lr.players[0].insured = 2;
  lr.players[0].hp = 1;
  lr.damage(0, 1, null);
  assert(lr.players[0].alive && lr.players[0].hp === 5, 'insurance revives at full HP');
  // Cuffs / hacking device can't be reapplied until the target has had a real turn
  const cg = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 6, itemMode: 'none', seed: 41 });
  cg.start();
  const ca = cg.decision.player, cb = 1 - ca;
  cg.players[ca].slots[0] = { uid: 801, id: 'cuffs' };
  cg.players[ca].slots[1] = { uid: 802, id: 'cuffs' };
  cg.players[ca].slots[2] = { uid: 803, id: 'hack' };
  cg.players[ca].slots[3] = { uid: 804, id: 'hack' };
  assert(!cg.act(ca, { type: 'item', slot: 0, target: cb }).error, 'cuff');
  assert(!cg.act(ca, { type: 'item', slot: 2, target: cb }).error, 'hack');
  cg.shells = [{ id: 9001, live: false }, { id: 9002, live: false }, { id: 9003, live: true }, { id: 9004, live: true }];
  cg.act(ca, { type: 'shoot', target: cb }); // blank at b: b is cuffed, so it's a's turn again
  assert(cg.decision.player === ca && cg.players[cb].cuffSafe, 'cuff skip, and b is safe from cuffs now');
  assert(cg.act(ca, { type: 'item', slot: 1, target: cb }).error === 'cuffCooldown', 'no cuffing twice in a row');
  assert(itemProblem(cg.players, cg.shells.length, ca, 'hack', cb) === 'allHacked', 'hack still pending');
  cg.act(ca, { type: 'shoot', target: cb }); // blank: b's (jammed) turn
  assert(cg.decision.player === cb && cg.players[cb].jammed && cg.players[cb].hackSafe && !cg.players[cb].cuffSafe, 'b plays, jammed');
  cg.act(cb, { type: 'shoot', target: ca }); // live at a, turn passes back
  assert(cg.decision.player === ca && itemProblem(cg.players, cg.shells.length, ca, 'hack', cb) === 'hackCooldown', 'no hacking again before a free turn');
  assert(itemProblem(cg.players, cg.shells.length, ca, 'cuffs', cb) === null, 'cuffs fine again after b played');
  // Cuffs and hacks don't carry over into the next round
  const cr = new Game({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], hp: 4, itemMode: 'none', seed: 45 });
  cr.start();
  const cx = cr.decision.player, cy = (cx + 1) % 3, cz = (cx + 2) % 3;
  cr.players[cy].cuffed = true;
  cr.players[cz].hacked = true;
  cr.players[cz].hackSafe = true;
  const crEv = cr.adminReload();
  const fr = crEv.find((e) => e.t === 'statusClear');
  assert(fr && fr.freed.length === 2, 'statusClear lists both');
  assert(cr.players.every((q) => !q.cuffed && !q.hacked && !q.jammed && !q.cuffSafe && !q.hackSafe), 'cuffs and hacks end with the round');
  assert(!crEv.some((e) => e.t === 'cuffSkip'), 'no cuff skip in the new round');
  // Adrenaline: 8 temporary HP, soaks damage after shields, wears off 1 per turn
  const ad = new Game({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], hp: 4, itemMode: 'none', seed: 51 });
  ad.start();
  const pa = ad.decision.player;
  ad.players[pa].slots[0] = { uid: 701, id: 'adrenaline' };
  ad.act(pa, { type: 'item', slot: 0 });
  assert(ad.players[pa].temp === TEMP_HP, 'adrenaline gives 8 temp hp');
  assert(itemProblem(ad.players, ad.shells.length, pa, 'adrenaline') === 'tempFull', 'no stacking');
  ad.damage(pa, 3, null);
  assert(ad.players[pa].hp === 4 && ad.players[pa].temp === TEMP_HP - 3, 'temp hp soaks damage');
  ad.afterAction('pass');
  assert(ad.players[pa].temp === TEMP_HP - 4, 'temp hp decays each turn');
  // Joker: wipes every item, matches the leader's HP, no handouts for 2 rounds
  const jk = new Game({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], hp: 5, itemMode: 'progressive', seed: 61 });
  jk.start();
  jk.round = 6;
  const pj = jk.decision.player;
  jk.players[pj].hp = 1;
  jk.players[(pj + 1) % 3].hp = 4;
  jk.players[pj].slots[0] = { uid: 601, id: 'joker' };
  jk.players[pj].slots[1] = { uid: 602, id: 'saw' };
  jk.players[(pj + 2) % 3].slots[3] = { uid: 603, id: 'medkit' };
  const je = jk.act(pj, { type: 'item', slot: 0 }).events.find((e) => e.t === 'item');
  assert(je.removed.length === 2 && jk.players.every((q) => q.slots.every((x) => !x)), 'joker wipes all items');
  assert(jk.players[pj].hp === 5 && jk.itemBan === JOKER_ROUNDS, 'joker matches the top HP and bans items');
  let bans = 0;
  for (let k = 0; k < 3; k++) {
    jk.decision = { kind: 'turn', player: jk.turn };
    const ev = jk.adminReload();
    if (ev.some((e) => e.t === 'itemBan')) bans++;
    while (jk.decision && jk.decision.kind === 'take') jk.act(jk.decision.player, { type: 'done' });
  }
  assert(bans === JOKER_ROUNDS, 'two rounds without handouts');
  // Pocket Duo mode: one Duo each round, nothing else
  const dm = new Game({ players: [{ name: 'a' }, { name: 'b' }], hp: 4, itemMode: 'duo', seed: 71 });
  const dev = dm.start();
  assert(dev.filter((e) => e.t === 'take' && e.id === 'handheld').length === 2 && dm.decision.kind === 'turn', 'Pocket Duo mode hands out Duos from round 1');
  // items per round cap at 5; rarer items get more common later on
  assert(MAX_PER_ROUND === 3 && [1, 2, 3, 4, 5, 9].map(itemsForRound).join() === '0,1,2,2,3,3', 'items per round: 0,1,2,2,3...');
  const stocked = { slots: [{}, {}, {}, null, null, null] };
  assert(handoutFor(stocked, 9) === HANDOUT_CAP - 3 && handoutFor({ slots: [{}, {}, {}, {}, null, null] }, 9) === 0, 'handouts stop at the cap');
  for (const id of ['hack', 'medkit', 'wings', 'joker']) assert(itemWeight(id, 20) > itemWeight(id, 2), `${id} gets a bit more common`);
  const tierW = (tier) => ITEMS[Object.keys(ITEMS).find((id) => ITEMS[id].tier === tier)].weight;
  assert(tierW('rare') > tierW('epic') && tierW('epic') > tierW('legendary') && tierW('legendary') > tierW('mythic'), 'tiers get rarer');
  assert(itemWeight('prybar', 20) === ITEMS.prybar.weight, 'common weights stay');
  assert(roundSpeed(1) === 1 && roundSpeed(5) > roundSpeed(2) && MAX_SPEED === 3, 'round speed grows');
}
const itemUse = Object.keys(allCounts).sort().map((k) => `${k}:${allCounts[k]}`).join(' ');
console.log('event counts:', itemUse);
if (failures) { console.error(`${failures} failures`); process.exit(1); }
console.log('All checks passed.');
