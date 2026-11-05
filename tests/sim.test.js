// Plays thousands of bot-vs-bot games through the real rules engine and checks
// invariants. Run: npm test
import { Game, MAX_SLOTS, MINIGAME_IDS, MINIGAME_DMG, ITEMS, itemProblem, redactEvents, mulberry32 } from '../js/engine.js';
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
const MODES = ['progressive', 'draft', 'shop', 'none'];
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
  const tiers = { medkit: 'epic', doll: 'epic', stinktrash: 'rare', insurance: 'legendary', wings: 'legendary', hack: 'rare', handheld: 'epic' };
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
}
const itemUse = Object.keys(allCounts).sort().map((k) => `${k}:${allCounts[k]}`).join(' ');
console.log('event counts:', itemUse);
if (failures) { console.error(`${failures} failures`); process.exit(1); }
console.log('All checks passed.');
