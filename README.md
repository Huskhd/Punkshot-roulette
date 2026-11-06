# MUCKSHOT

*One gun. A few shells. No friends left.*

A low-poly, PS1-style shotgun-roulette party game for 2–4 players that runs in the browser on PC and phones.
You sit at a round table in a bayou bait-shack back room with a bunch of swamp folk — **Croaker**, **Old Heron**,
**Moss Mother** and **Gatorjaw** — under one swinging lamp.

- **VS Computer** — bots at four levels: Easy, Hard, Xtra Hard, Pro.
- **Pass & Play** — several humans on one device (with a "pass the device" screen so peeks stay private).
- **Play Online** — create a room, get a code like `KX7P`, friends join from their own phone or PC.

Everything is code: models are built from basic shapes, sounds are synthesized with Web Audio, textures are drawn
on canvases. No build step, no assets to download.

## Rules

Each round the gun is loaded with live and blank shells. Everyone sees how many of each, then they go in — in an
order nobody knows. On your turn use any items you like, then point the gun at yourself or someone else.

- Live shell → the target loses 1 HP (2 with the Saw).
- Blank at yourself → you go again. Blank at someone else → your turn ends.
- Gun empty → new round. Last player standing wins. Then: scoreboard and rematch.
- **Last life:** at 1 HP, healing items (Bandages, Medkit, Drug Syringe) stop working on you. Revives (Life Insurance,
  Angel Wings), shields, Adrenaline, the Joker and a Pocket Duo win still work.
- **No lock-downs:** a player who just sat out a turn in Handcuffs can't be cuffed again until they've played a turn,
  and a hacked player can't be hacked again until they've had a turn with their items back.
- **Fresh magazine, fresh start:** Handcuffs and hacks wear off when the round ends (along with those cooldowns).

### Item modes

| Mode | How it works |
| --- | --- |
| Progressive | Round 1 has no items, then 1, 2, 2, 3, 3, 3… each (max 3 per round). |
| Draft | Same amounts, but everyone takes turns picking from one shared tray. |
| Shop | Surviving a round earns chips (3 + damage you dealt). Spend them in the shop each round. |
| Pocket Duo only | Everyone gets one Pocket Duo every round (from round 1), and nothing else. |
| Classic | No items: only the gun and the shells. Pure nerve. |

Everyone holds at most **6 items**. Handouts stop topping you up at **4 items**: hold 3 and you get at most 1, hold 4 or
more and you get nothing that round (stealing can still take you higher). In Draft, the pool has one spare item per
player so the last picker still gets a choice.

### Items

Items come in five rarities: common, **rare** (blue glow), **epic** (purple glow), **legendary** (gold glow) and
**mythic** (crimson glow). Each draw is roughly 80% common, 11% rare, 4.6% epic, 3.2% legendary and 0.7% mythic. Later
in the game the higher tiers turn up a little more often (by round 10: about 74 / 15 / 6 / 4.6 / 1.1% in the same order). Shop prices:
rare 4, epic 5, legendary 6, mythic 8 chips.

**The game speeds up every round** (+0.15x per round, on top of the speed setting, never past x3 in total).

| Item | Effect |
| --- | --- |
| Stethoscope *(rare)* | Learn if the current shell is live or blank (only you hear it: a heartbeat means live, silence means blank). |
| Pry Bar | Pop the current shell out without firing. Everyone sees what it was. |
| Saw | Cut the barrel short: your next shot deals double damage. One shot only, live or blank. |
| Bandages | Heal 1 HP. |
| Medkit *(legendary)* | Heal to full HP. |
| Shield | Adds 1 shield to your health bar; it blocks 1 damage. Stacks. |
| Boodoo Doll *(legendary)* | The next shot another player aims at you bounces back at them. If the shooter has a doll up too, theirs parries yours. |
| Mirror *(rare)* | Swap your whole stash of items with another player. |
| Rigged Dice | Reshuffle every shell left in the gun. |
| Pickpocket Glove | Steal a random item from another player. |
| Golden Glove *(epic)* | Steal the item of your choice from another player. |
| Trash Can | Throw away one item of your choice from another player. |
| Smelly Trash Can *(rare)* | 25% of all items on the table rot away — yours too, but yours are 25% less likely to. |
| Fake Shell | Slip an extra blank into the gun at a random spot. |
| Life Insurance *(mythic)* | Sign it, and the next time you die you come back with full HP. Covers 3 rounds (one round = one magazine, the current one included), or until it pays out. |
| Angel Wings *(legendary)* | Bring a dead player back with half their HP — or keep them: if you die holding them, you come back. |
| Double Barrel | Upgrades the gun with a second barrel: your next shot fires the next two shells at once. |
| Switch | Every live shell left becomes blank and every blank becomes live. |
| Drug Syringe | 50/50: heal 3 HP, or lose 1 HP. |
| Handcuffs | Pick a player — they skip their next turn. Can't be used on them again until they've played. |
| Hacking Device *(rare)* | Pick a player — they can't use items on their next turn. Can't be used on them again until they've had a free turn. |
| Rotator | Reverse the turn order. |
| Phone | A voice tells you one random shell left in the gun and its position (only you hear it). |
| Pocket Duo *(legendary)* | Everyone plays a minigame you choose. The bottom half of the scores loses 2 HP. If you come first, you heal 2 HP — even on your last life. |
| Adrenaline *(epic)* | 8 temporary HP. Damage eats them first (after shields); they drop by 1 at the start of every player's turn. |
| Joker Card *(mythic)* | Destroys every item on the table, stops item handouts for the next 2 rounds, and raises your HP to match the healthiest player. |

Whoever is due to shoot next picks items first (Draft and Shop), so a blank on the last shell, aimed at yourself, buys
you first pick.

### Pocket Duo (handheld minigames) — prototype

An original dual-screen clamshell. The player who uses it picks a game from the menu, then everyone alive plays the
same game (same random seed) on their own screen, and scores are compared. Controls: **WASD / arrow keys + Space**
(A) / **Esc** (B); on phones, the on-screen D-pad (slide your finger around it), A/B buttons, and dragging on the
bottom screen. Bots get a simulated score based on their difficulty.

Prototype games: Paddle Panic (button mash), Quick Draw (reaction), Nail It (timing gauge), Firefly Jar (move & catch),
Shell Game (follow the cup), Lily Pad Hop (memory sequence), Count the Live Ones (counting), Steady Bobber (balance).

### Music & sound

Background music is a slow noir-jazz bar loop (walking bass, brushes, Rhodes, vibraphone), generated live with Web
Audio, so it never repeats exactly. A heartbeat joins in on your last life. **MUSIC / MÚSICA** on the title screen or
in the pause menu turns it off; **SOUND / SONIDO** mutes everything.

### Speed online

In online games only the host can change the game speed; everyone in the room follows it, so nobody's animations fall
behind.

### Admin / test panel

A password-protected panel (the small ⚙ on the title screen) for testing: give any item to any player, skip turns,
±1 HP, shields, immunity, set the next shell, reload the gun, add bots mid-game and play every seat yourself. It only
works in local games, never online. It's a browser game, so the password only keeps casual players out.

### Language

Spanish (Mexico) by default; switch with **LANGUAGE / IDIOMA** on the title screen or in the pause menu. Every player online
sees the game in their own language.

### Bots

- **Easy** — forgets what it knows and sometimes blunders.
- **Hard** — never blunders, but plays simple rules and ignores the tricky items.
- **Xtra Hard** — always makes the best move for *this* turn: information first, heal, maximum damage.
- **Pro** — the best move plus strategy across turns: handcuffs before risky shots, Switch tricks, wiping out
  others' knowledge with the dice, item theft, and smarter target choice.

## Hosting (free)

It's a static site, so any static host works. Recommended: **GitHub Pages** — this repo is already on GitHub, it
needs no build step and no settings beyond one switch:

1. Merge to your default branch.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick the branch and `/ (root)`, Save.
3. After a minute the game is live at `https://<your-user>.github.io/<repo>/`. Share that link.

Other options that work the same way: drag the folder onto [Netlify Drop](https://app.netlify.com/drop), or zip it
and upload to itch.io as an HTML game (`index.html` at the zip root).

Online play needs **no server of your own**. Each friend connects two ways at once and keeps whichever works first:

- **direct** — peer-to-peer over WebRTC via [PeerJS](https://peerjs.com/) (its free public broker only introduces the players).
- **relay** — messages pass through free public MQTT brokers (EMQX, HiveMQ, Mosquitto test servers) over secure
  WebSockets. This works from mobile data and strict routers, where direct connections often fail.

The lobby shows how each friend got in (`player · direct` or `player · relay`). The host's browser runs the game; if a
player disconnects mid-game, a bot takes their seat. If the host closes the tab, the room ends. If a message gets lost
on the way, the friend's game quietly re-syncs from the host.

> The relay brokers are shared public test servers: free and account-free, but with no uptime promise, and anyone who
> guesses a room's topic could read its moves. Fine for a game night; don't send anything private through it.
> Very locked-down networks (some schools/offices) block the relay's ports. If a friend can't join, try another network.

URL options, mostly for testing or self-hosting (invite links keep these):

| Option | Effect |
| --- | --- |
| `?relay=0` / `?p2p=0` | Use only the direct link / only the relay. |
| `?relay=wss://host:port/path` | Use your own MQTT-over-WebSocket broker(s) (comma-separated). |
| `?peer=host:port` | Use your own PeerJS broker (`npx peer --port 9000`). |

## Run locally

Any static file server works, for example:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` straight from disk won't work — browsers block ES modules on `file://`.)

Run the rules/bot tests (plays thousands of bot games and checks invariants plus bot strength ordering):

```bash
npm test
```

## Project layout

| Path | What it does |
| --- | --- |
| `js/engine.js` | Game rules. Pure logic; returns events + a snapshot. The online host runs this. |
| `js/bot.js` | Computer opponents (4 difficulties). Only uses public info plus what it learned itself. |
| `js/table.js` | Three.js scene, camera work and the animation for every game event. |
| `js/models.js` | Every model, built from basic shapes. Swap any `make*()` for a loaded CC0 model later. |
| `js/gfx.js` | PS1 vertex snapping, procedural pixel textures, tween system. |
| `js/audio.js` | Synthesized sound effects, swamp ambience and the background music. |
| `js/ui.js` | Captions, HUD, action bar, tap-at-the-table targeting, scoreboard. |
| `js/i18n.js` | All text in Spanish and English. |
| `js/minigames.js` | The Pocket Duo console interface and its minigames. |
| `js/admin.js` | The password-protected admin / test panel (local games only). |
| `js/net.js` | Online rooms: direct (PeerJS) and relay (MQTT) racing, heartbeats, re-join. |
| `js/main.js` | App flow: local, pass-and-play, online host and client sessions. |
| `lib/` | Vendored Three.js r160, PeerJS 1.5.4 and MQTT.js 5.10.1 (all MIT). |

Swapping in CC0 models: `makeItem(id)`, `makeCharacter(kind)`, `makeGun()` etc. each return a `THREE.Group`.
Replace the body of one with a loaded GLTF (keep the origin at the base and the same rough size) and the rest of the
game keeps working. The gun expects its muzzle to point along +z.
