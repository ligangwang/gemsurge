# Gem Surge (宝石狂潮)

A 3D match-3 for [dingn](https://dingn.com): swap glowing gems, build
specials, combine them for huge chain reactions, and surge through 10,000 levels
in rounds of 10, across eight worlds. Play it at <https://dingn.com/play/gemsurge/>.

- **Match 3 or more** neighbouring gems of a colour; the gems above fall and
  new ones drop in, and every cascade raises the chain.
- **Specials**: a straight 4 makes a **line blaster** (a laser across the
  row or column), an L or T makes a **bomb** (a 3×3 shockwave), and a
  straight 5 makes a **prism** (lightning to every gem of one colour).
- **Combos**: swap two specials together. Two blasters fire a cross, a
  blaster and a bomb fire three rows and three columns, two bombs clear 5×5,
  a prism turns every gem of the other special's colour into one, and two
  prisms clear the whole board.
- **Fever**: chains, specials and combos fill the meter; Fever doubles points
  for 3 moves. Moves left when you win become blasters for a final **surge**.
- **Rounds**: every 10 levels is a round. Finishing one holds a ceremony with a new title, Supernovas and coins, a lucky draw and a line of story; every 10th round is a milestone that pays more. The reward is shown ahead on the menu and on a round's last two levels.
- **Undo**: take your last move back, up to 3 times a level. It is free up to level 100; after that each tier of the Undo upgrade gives one undo a level.
- **Encouragement**: words such as Nice, Good and Awesome for chains and big clears, said aloud in a bright, girlish voice by the device's own speech (it varies by device; mute silences it).
- **Levels**: 10,000 levels through eight worlds, a new one every 10 levels (Neon City, Deep Sea, Outer Space, Lantern Lake, Aurora Peaks, Golden Desert, Firefly Forest and Cloud Kingdom; they come round again in new colours after level 80; the first 30 levels are hand-made, the rest generated from them, each with its own mirrored ice shape, and no harder after level 1000), the first 100 eased with extra moves and lower targets, each with its
  own background. Goals are scores, gems of a colour, and ice
  to break (1 or 2 layers), within a move limit. 1 to 3 stars by score.
- **Daily board**: 20 moves, the same board and refills for everyone each UTC
  day.
- English and Chinese.

## Coins and upgrades

Gem Surge earns and spends dingn coins:

- Every 100 coins a player's levels are worth (paid or not) charge a
  **Supernova**: a button in the level that clears the whole board at three
  times the score and costs no move. The count is kept in the save
  (`earned` and `novasUsed` in `src/save.ts`), not in dingn's shop.
- A cleared level pays 2 coins plus 2 a star, plus 1 in Deep Sea and 2 in
  Outer Space, up to 10 (`coinsFor` in `src/levels.ts`), through
  `sdk.rewards.earn`. A lost level that got at least halfway on a goal pays 1.
  dingn caps what a game pays a player each day.
- The daily board pays 10 coins once a day.
- 19 badges (levels 5 to 1000, 3 stars, prisms, combos, Fever, chains of 5 and
  8, a board wipe, the daily board) pay what dingn gives their tier.
- The **Upgrades** shop sells 19 permanent tiers (`src/upgrades.ts`, listed in
  `game.json`'s `shop`): extra moves (5 tiers, 60 to 800 coins), starting line
  blasters (3), bombs (3), prisms (2, up to 1,000) a faster Fever meter
  (3) and undos after level 100 (3, 100 to 500 coins). dingn asks the player to confirm each purchase. Upgrades don't apply
  to the daily board, so it stays fair.

## Develop

```sh
npm install
npm run dev     # http://localhost:5173/
npm test        # typecheck, engine and rules tests, component tests
```

To play it inside dingn while developing, open the
[playground](https://dingn.com/developers/playground/) and load
`http://localhost:5173/`.

## What's where

- `src/engine/board.ts`: the board: matches, specials, combos, cascades,
  refills, ice, hints and shuffles. Each move returns the steps it took.
- `src/engine/session.ts`: one play of a level: moves, goals, score, stars,
  Fever and the end-of-level surge.
- `src/engine/random.ts`: the seeded generator.
- `src/gem-scene.ts`: the three.js board: gems, bloom, backgrounds, particles,
  lasers, shockwaves, lightning, screen shake, slow motion and input.
- `src/game.tsx`: the menu, level map, HUD, end screen and shop.
- `src/levels.ts`: the levels, the daily board and coins.
- `src/badges.ts`, `src/upgrades.ts`, `src/save.ts`: badges, the shop and
  what's saved (stars and best score a level, the daily board). Saved on the
  device with `sdk.storage`, and to the player's account with `sdk.progress`
  when signed in.
- `src/sound.ts`: synthesised sound effects.

## Release a new version

1. In a pull request, raise `version` in `game.json`. Every release needs a
   new version.
2. Merge it to `main`. The **Build and publish** Action tests the game,
   builds `release/gemsurge-<version>.zip` and uploads it to dingn with the
   `DINGN_UPLOAD_KEY` secret.
3. The new version waits in dingn's review queue and goes live once it is
   approved.

A merge that doesn't raise the version builds and tests but uploads nothing.
Every run also keeps the zip as a workflow artifact.

To upload by hand instead: `npm run pack`, then upload the zip on
<https://dingn.com/developers/games/>, or run
`DINGN_UPLOAD_KEY=... npm run upload`.

### The upload key

Create a key on <https://dingn.com/developers/games/> (signed in as the
account that owns the game), then add it to this repository under
**Settings → Secrets and variables → Actions** as `DINGN_UPLOAD_KEY`. dingn
shows the key once; if it is lost, revoke it and create another.

## The dingn SDK

`sdk/` is a copy of the dingn game SDK (`https://dingn.com/sdk/v1/`), bundled
into the game. Run `npm run update-sdk` to refresh it. The full guide is at
<https://dingn.com/developers/>.

## Credits

Written by Ligang Wang. Built with [three.js](https://threejs.org/) and
[React](https://react.dev/). Every gem is a three.js shape and every sound is
synthesised in the browser, so the game ships no third-party assets.
