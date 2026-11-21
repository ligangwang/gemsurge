import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../game.json" with { type: "json" };
import zh from "../src/zh-CN.json" with { type: "json" };
import { SIZE, findHint } from "../src/engine/board";
import { CHAIN_COIN_CAP, Session, chainCoinsFor } from "../src/engine/session";
import { DAILY_COINS, HAND_MADE, LAST_LEVEL, WORLDS, LEVELS_PER_WORLD, coinsFor, dailySpec, levelSpec, worldCycle } from "../src/levels";
import { DAILY, levelBadges, CHAIN_5, CHAIN_8, COMBO, FEVER, PRISM, THREE_STARS, WIPE } from "../src/badges";
import { boostsFor, nextTier, NONE, ownedFrom, PRICES, shopManifest, upgradeId } from "../src/upgrades";
import { BEST_KEPT, novas, novaCharge, empty, highest, merge, parse, store } from "../src/save";
import { DRAW, ROUND, ROUNDS, STORY, TITLES, WHEEL, draw, isMilestone, lastLevelOf, rewardOf, roundOf, sliceFor, storyOf, titleOf, worldOf } from "../src/rounds";

test("every level has goals it can meet", () => {
  assert.equal(HAND_MADE, 30);
  assert.equal(LAST_LEVEL, 10000);
  for (let n = 1; n <= LAST_LEVEL; n++) {
    const spec = levelSpec(n);
    assert.equal(spec.level, n);
    assert.equal(spec.ice.length, SIZE * SIZE);
    assert.ok(spec.goals.length > 0, `level ${n}`);
    for (const g of spec.goals) {
      // A colour goal asks for a stone the board drops.
      const stones = spec.palette ?? Array.from({ length: spec.colors }, (_, i) => i);
      if (g.kind === "color") assert.ok(stones.includes(g.color), `level ${n} colour`);
      if (g.kind === "ice") assert.ok(spec.ice.some((i) => i > 0), `level ${n} ice`);
    }
    const [one, two, three] = spec.stars;
    assert.ok(one <= two && two < three, `level ${n} stars`);
    assert.ok(spec.world >= 0 && spec.world < WORLDS.length, `level ${n} world`);
    assert.ok(spec.moves >= 16, `level ${n} moves`);
  }
  assert.equal(levelSpec(11).world, 1);
  // Past the hand-made levels come new worlds, which only come round again after level 80.
  assert.equal(WORLDS.length, 8);
  assert.equal(levelSpec(31).world, 3);
  assert.equal(levelSpec(45).world, 4);
  assert.equal(levelSpec(80).world, 7);
  assert.equal(levelSpec(81).world, 0);
  assert.equal(worldCycle(80), 0);
  assert.equal(worldCycle(81), 1);
  assert.deepEqual(levelSpec(777), levelSpec(777));
  assert.notEqual(levelSpec(777).seed, levelSpec(778).seed);
});

test("the daily board is the same all day and different the next", () => {
  assert.deepEqual(dailySpec("2026-11-15"), dailySpec("2026-11-15"));
  assert.notEqual(dailySpec("2026-11-15").seed, dailySpec("2026-11-16").seed);
  assert.equal(dailySpec("2026-11-15").allMoves, true);
});

test("coins pay 1 to 10 for a cleared level", () => {
  assert.equal(coinsFor(1, 0), 0);
  assert.equal(coinsFor(1, 1), 4);
  assert.equal(coinsFor(1, 3), 8);
  assert.equal(coinsFor(30, 3), 10);
  assert.equal(DAILY_COINS, 10);
  for (let n = 1; n <= LAST_LEVEL; n++)
    for (let s = 1; s <= 3; s++) assert.ok(coinsFor(n, s) >= 1 && coinsFor(n, s) <= 10);
});

test("every badge the game awards is in game.json", () => {
  const ids = new Set(game.badges.map((b) => b.id));
  for (const id of [...levelBadges(LAST_LEVEL), THREE_STARS, CHAIN_5, CHAIN_8, COMBO, FEVER, PRISM, WIPE, DAILY])
    assert.ok(ids.has(id), id);
  assert.equal(ids.size, game.badges.length);
});

test("game.json lists Gem Surge under Casual", () => {
  assert.equal(game.category, "casual");
});

test("game.json's shop matches the upgrades", () => {
  assert.deepEqual(game.shop, shopManifest());
  for (const item of game.shop) assert.ok(item.price > 0 && item.price <= 1000, item.id);
});

test("owned upgrades become boosts", () => {
  const owned = ownedFrom(
    shopManifest().map((i) => ({
      id: i.id,
      price: i.price,
      title: i.title.en,
      owned: ["moves-1", "moves-2", "bomb-1", "fever-1", "prism-2"].includes(i.id),
    })),
  );
  // prism-2 without prism-1 doesn't count.
  assert.deepEqual(owned, { ...NONE, moves: 2, bomb: 1, fever: 1 });
  assert.deepEqual(boostsFor(owned), { moves: 2, specials: ["bomb"], fever: 1.15, undos: 0 });
  assert.deepEqual(nextTier("moves", owned), { id: "moves-3", tier: 3, price: PRICES.moves[2] });
  assert.equal(nextTier("prism", { ...NONE, prism: 2 }), null);
  assert.equal(upgradeId("bomb", 3), "bomb-3");
});

test("saves read safely and merge to the better of each", () => {
  assert.deepEqual(parse(null), empty());
  assert.deepEqual(parse({ stars: [9, -1, "x"] } as never).stars.slice(0, 3), [0, 0, 0]);
  const a = { ...empty(), stars: [3, 1, ...new Array(LAST_LEVEL - 2).fill(0)], chain: 4 };
  const b = { ...empty(), stars: [1, 2, 2, ...new Array(LAST_LEVEL - 3).fill(0)], daily: { day: "2026-11-15", score: 5, paid: true } };
  const m = merge(a, b);
  assert.deepEqual(m.stars.slice(0, 4), [3, 2, 2, 0]);
  assert.equal(highest(m), 3);
  assert.equal(m.chain, 4);
  assert.deepEqual(parse(JSON.parse(JSON.stringify(m))), m);
});

test("every Chinese pattern keeps its placeholders", () => {
  for (const [en, cn] of Object.entries(zh as Record<string, string>)) {
    const holes = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join();
    assert.equal(holes(cn), holes(en), en);
  }
});

test("the first 100 levels are eased, and the easing fades out by level 101", () => {
  // Level 1 is "20 moves, score 3000" in the table.
  assert.equal(levelSpec(1).moves, 26);
  assert.deepEqual(levelSpec(1).goals, [{ kind: "score", target: 2400 }]);
  // Level 2 is "collect 30".
  assert.deepEqual(levelSpec(2).goals, [{ kind: "color", color: 0, target: 24 }]);
  for (let n = 71; n <= 101; n++) {
    assert.ok(levelSpec(n).moves <= 39, `level ${n} moves`);
  }
  // Past the eased levels the moves are the generator's own: 16 to 30, plus
  // 2 for each colour beyond the design's (seven colours: up to 4 more).
  for (let n = 101; n <= 130; n++) assert.ok(levelSpec(n).moves <= 34, `level ${n} moves`);
});

test("every 100 coins a play is worth charge a Supernova", () => {
  const saved = { ...empty(), earned: 250, novasUsed: 1 };
  assert.equal(novas(saved), 1);
  assert.equal(novaCharge(saved), 50);
  assert.equal(novas({ ...saved, novasUsed: 5 }), 0);
  // A save from before Supernovas is credited with what its stars were worth.
  const old = parse({ stars: [3, 3, 1] });
  assert.equal(old.earned, coinsFor(1, 3) + coinsFor(2, 3) + coinsFor(3, 1));
  assert.equal(parse({ stars: [3], earned: 7, novasUsed: 2 }).earned, 7);
  assert.equal(merge({ ...empty(), earned: 120, novasUsed: 0 }, { ...empty(), earned: 90, novasUsed: 1 }).novasUsed, 1);
});

test("a Supernova clears the whole board and costs no move", () => {
  const s = new Session(levelSpec(13));
  const moves = s.movesLeft;
  const ice = s.iceLeft;
  const turn = s.nova()!;
  assert.ok(turn.steps[0].cleared.length >= SIZE * SIZE);
  assert.equal(s.movesLeft, moves);
  assert.ok(s.iceLeft < ice);
  assert.ok(s.score > 0);
  assert.equal(s.novas, 1);
});

test("a full save of 10,000 levels fits in 16 KB and reads back", async () => {
  const saved = { ...empty(), stars: new Array(LAST_LEVEL).fill(3), best: new Array(LAST_LEVEL).fill(123456), earned: 99999, novasWon: 40 };
  let written: unknown = null;
  const sdk = { player: { signedIn: false }, storage: { set: async (_: string, v: unknown) => void (written = v), get: async () => null }, progress: {} };
  await store(sdk as never, saved);
  assert.ok(JSON.stringify(written).length < 16000, `save is ${JSON.stringify(written).length} bytes`);
  const back = parse(written as never);
  assert.deepEqual(back.stars, saved.stars);
  assert.equal(back.best[LAST_LEVEL - 1], 123456);
  assert.equal(back.best[LAST_LEVEL - BEST_KEPT], 123456);
  assert.equal(back.best[LAST_LEVEL - BEST_KEPT - 1], 0);
  assert.equal(back.novasWon, 40);
  // A short save keeps every best score, and an old save's list of stars still reads.
  const short = { ...empty(), stars: [3, 2, ...new Array(LAST_LEVEL - 2).fill(0)], best: [900, 800, ...new Array(LAST_LEVEL - 2).fill(0)] };
  await store(sdk as never, short);
  assert.deepEqual(parse(written as never).best.slice(0, 3), [900, 800, 0]);
  assert.deepEqual(parse({ stars: [3, 1], best: [50, 40] }).best.slice(0, 2), [50, 40]);
});

test("rounds: ten levels each, a title, a reward and a story line", () => {
  assert.equal(ROUND, 10);
  assert.equal(ROUNDS, 1000);
  assert.equal(roundOf(1), 1);
  assert.equal(roundOf(10), 1);
  assert.equal(roundOf(11), 2);
  assert.equal(lastLevelOf(3), 30);
  assert.equal(TITLES.length, 25);
  assert.deepEqual(titleOf(1), { name: "Novice Traveller", numeral: "" });
  assert.deepEqual(titleOf(25), { name: "Grand Master", numeral: "" });
  assert.deepEqual(titleOf(26), { name: "Novice Traveller", numeral: " II" });
  assert.deepEqual(titleOf(1000), { name: "Grand Master", numeral: " XL" });
  assert.equal(worldOf(1).id, "neon");
  assert.equal(worldOf(4).id, levelSpec(31).world === 3 ? "lake" : "");
  // Every 100 levels is a milestone, which pays more.
  assert.equal(isMilestone(10), true);
  assert.equal(isMilestone(9), false);
  assert.ok(rewardOf(10).novas > rewardOf(9).novas);
  assert.ok(rewardOf(10).coins > rewardOf(9).coins);
  assert.ok(rewardOf(40).novas > rewardOf(4).novas);
  assert.ok(Math.abs(DRAW.reduce((sum, d) => sum + d.chance, 0) - 1) < 1e-9);
  assert.equal(draw(0).novas, 1);
  assert.equal(draw(0.999).novas, 5);
  for (let round = 1; round <= ROUNDS; round++) assert.ok(storyOf(round));
  for (const text of [...TITLES, ...STORY, storyOf(100), storyOf(101), storyOf(102)])
    assert.ok((zh as Record<string, string>)[text], `no Chinese for "${text}"`);
});

test("a move can be taken back three times a level", () => {
  const s = new Session(levelSpec(1));
  assert.equal(s.canUndo, false);
  for (let n = 0; n < 4; n++) {
    const before = { cells: JSON.stringify(s.board.cells), moves: s.movesLeft, score: s.score };
    const [a, b] = findHint(s.board)!;
    s.move(a, b);
    assert.equal(s.movesLeft, before.moves - 1);
    if (n < 3) {
      assert.equal(s.undo(), true);
      assert.deepEqual(
        { cells: JSON.stringify(s.board.cells), moves: s.movesLeft, score: s.score },
        before,
      );
      assert.equal(s.undosLeft, 2 - n);
      assert.equal(s.undo(), false, "only the last move comes back");
    } else assert.equal(s.undo(), false, "the fourth undo is refused");
  }
});

test("generated ice levels each have their own mirrored shape", () => {
  const shapes = new Set<string>();
  let levels = 0;
  for (let n = 31; n <= 400; n++) {
    const ice = levelSpec(n).ice;
    if (!ice.some((c) => c > 0)) continue;
    levels++;
    shapes.add(ice.join(""));
    for (let i = 0; i < ice.length; i++) {
      const x = i % 8;
      const y = Math.floor(i / 8);
      assert.equal(ice[i], ice[y * 8 + (7 - x)]);
      assert.equal(ice[i], ice[(7 - y) * 8 + x]);
    }
    assert.deepEqual(levelSpec(n).ice, ice, "the same level is always the same shape");
  }
  assert.ok(levels > 50);
  assert.ok(shapes.size > levels * 0.9, `${shapes.size} shapes in ${levels} levels`);
});

test("undo is free up to level 100, then an upgrade of one undo a tier", () => {
  assert.equal(new Session(levelSpec(100)).undosLeft, 3);
  assert.equal(new Session(levelSpec(101)).undosLeft, 0);
  const two = boostsFor({ ...NONE, undo: 2 });
  assert.equal(new Session(levelSpec(101), two).undosLeft, 2);
  assert.equal(new Session(levelSpec(50), two).undosLeft, 3);
  const s = new Session(levelSpec(101));
  const [a, b] = findHint(s.board)!;
  s.move(a, b);
  assert.equal(s.canUndo, false);
  assert.deepEqual(PRICES.undo, [100, 250, 500]);
});

test("chain reactions earn coins, more for longer chains, up to a cap a play", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(chainCoinsFor), [0, 1, 2, 3, 5, 5]);
  const s = new Session(levelSpec(1));
  let expected = 0;
  while (!s.outcome) {
    const [a, b] = findHint(s.board)!;
    const turn = s.move(a, b)!;
    expected = Math.min(CHAIN_COIN_CAP, expected + chainCoinsFor(turn.chain));
    assert.equal(s.chainCoins, expected);
  }
  // Taking a move back takes its chain coins back too.
  const u = new Session(levelSpec(2));
  for (let n = 0; n < 20 && !u.outcome; n++) {
    const coins = u.chainCoins;
    const [a, b] = findHint(u.board)!;
    u.move(a, b);
    if (u.chainCoins > coins && u.canUndo) {
      u.undo();
      assert.equal(u.chainCoins, coins);
      break;
    }
  }
});

test("the draw's wheel shows the true odds and stops on the prize that was drawn", () => {
  for (const { novas, chance } of DRAW) {
    assert.equal(WHEEL.filter((n) => n === novas).length / WHEEL.length, chance);
    for (const roll of [0, 0.3, 0.6, 0.999]) assert.equal(WHEEL[sliceFor(novas, roll)], novas);
  }
});

test("levels have 5 colours to 50, 6 with the morganite to 100, and all 7 after", () => {
  for (let n = 1; n <= 300; n++) {
    const spec = levelSpec(n);
    const stones = spec.palette ?? Array.from({ length: spec.colors }, (_, i) => i);
    const want = n <= 50 ? [0, 1, 2, 3, 4] : n <= 100 ? [0, 1, 2, 3, 4, 6] : [0, 1, 2, 3, 4, 5, 6];
    assert.deepEqual([...stones], want, `level ${n}`);
    // The morganite falls on the board from level 51.
    if (n >= 51 && n <= 120)
      assert.ok(
        new Session(spec).board.cells.some((g) => g?.color === 6),
        `level ${n} board`,
      );
  }
  // Up to level 50 the boards are drawn as before stones could be listed.
  assert.equal(levelSpec(20).palette, undefined);
  // A level designed for six colours gets two fewer moves with five, and one
  // designed for five two more for each colour it gains.
  assert.equal(levelSpec(11).colors, 5);
});
