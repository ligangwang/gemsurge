# AGENTS.md

Notes for AI coding agents working on Gem Surge.

- This is a dingn game published like any outside developer's game: the
  dingn website (repo `ligangwang/dingn`) runs it in a sandboxed frame and the
  game talks to it only through the SDK in `sdk/`. Don't import from the
  dingn repo. Refresh `sdk/` with `npm run update-sdk`.
- Run `npm test` before committing. `npm run pack` builds the upload zip.
- Merging to `main` publishes on dingn (`.github/workflows/release.yml`)
  when `version` in `game.json` is new.
- Bump `version` in `game.json` for every release; dingn refuses a version it
  already has.
- Save with `sdk.storage` / `sdk.progress`, never `localStorage` or cookies,
  which the sandbox blocks. Keep every URL relative (`base: "./"`).
- UI strings go through `t()` with translations in `src/zh-CN.json`.
- `src/engine/` is the match-3 rules (board, specials, cascades, sessions).
  Keep it free of three.js and the DOM so the tests can run it in Node, and
  keep it deterministic: every random choice goes through the board's seeded
  generator, so the daily board is the same for everyone.
- `game.json`'s `shop` is generated from `src/upgrades.ts` (a test checks they
  match). When you change prices or tiers, update both.
- Gem Surge is an original game: don't copy names, art, levels or sounds from
  other match-3 games. The gems are three.js shapes and the sounds are
  synthesised, so there are no third-party assets to credit.
