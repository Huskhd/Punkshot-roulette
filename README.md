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

- Live shell → the target loses 1 HP (2 with a Hollow Point).
- Blank at yourself → you go again. Blank at someone else → your turn ends.
- Gun empty → new round. Last player standing wins. Then: scoreboard and rematch.

### Item modes

| Mode | How it works |
| --- | --- |
| Progressive | Round 1 has no items, round 2 gives 2 each, round 3 gives 3 each… (max 6 per round). |
| Draft | Same amounts, but everyone takes turns picking from one shared tray. |
| Shop | Surviving a round earns chips (3 + damage you dealt). Spend them in the shop each round. |
| No items | Pure nerve. |

Everyone holds at most **8 items**. Anything that doesn't fit is lost.

### Items

| Item | Effect |
| --- | --- |
| Stethoscope | Learn if the current shell is live or blank (only you see it). |
| Pry Bar | Pop the current shell out without firing. Everyone sees what it was. |
| Hollow Point | Your next live shot deals 2 damage. |
| Bandage | Heal 1 HP. |
| Boodoo Doll | The next shot another player aims at you bounces back at the shooter. |
| Mirror *(rare)* | Swap your whole stash of items with another player. |
| Rigged Dice | Reshuffle every shell left in the gun. |
| Pickpocket Glove | Steal a random item from another player. |
| Golden Glove | Steal the item of your choice from another player. |
| Fake Shell | Slip an extra blank into the gun at a random spot. |
| Life Insurance *(rare)* | If you die before this round ends, come back with 1 HP. |
| Double Barrel | Your next shot fires the next two shells at once. |
| Switch | Every live shell left becomes blank and every blank becomes live. |
| Drug Syringe | 50/50: heal 3 HP, or lose 2 HP. |
| Handcuffs | Pick a player — they skip their next turn. |
| Rotator | Reverse the turn order. |
| Phone | A voice tells you one random shell left in the gun and its position (only you hear it). |

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

Online play needs **no server of your own**: rooms connect peer-to-peer over WebRTC with
[PeerJS](https://peerjs.com/), whose free public broker only introduces the players. The host's browser runs the
game; if a player disconnects mid-game, a bot takes their seat. If the host closes the tab, the room ends.

> Some strict networks (certain mobile carriers, corporate Wi-Fi) block peer-to-peer connections. If a friend
> can't join, try switching them to another network or Wi-Fi. If you'd rather run your own broker:
> `npx peer --port 9000` and open the game with `?peer=your-host:9000` (invite links keep that setting).

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
| `js/audio.js` | Synthesized sound effects and swamp ambience. |
| `js/ui.js` | Captions, HUD, action bar, pickers, scoreboard. |
| `js/net.js` | Online rooms (PeerJS). |
| `js/main.js` | App flow: local, pass-and-play, online host and client sessions. |
| `lib/` | Vendored Three.js r160 and PeerJS 1.5.4 (both MIT). |

Swapping in CC0 models: `makeItem(id)`, `makeCharacter(kind)`, `makeGun()` etc. each return a `THREE.Group`.
Replace the body of one with a loaded GLTF (keep the origin at the base and the same rough size) and the rest of the
game keeps working. The gun expects its muzzle to point along +z.
