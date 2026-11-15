import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../game.json" with { type: "json" };
import zh from "../src/zh-CN.json" with { type: "json" };
import { SIZE } from "../src/engine/board";
import { DAILY_COINS, LAST_LEVEL, WORLDS, LEVELS_PER_WORLD, coinsFor, dailySpec, levelSpec } from "../src/levels";
import { DAILY, levelBadges, CHAIN_5, CHAIN_8, COMBO, FEVER, PRISM, THREE_STARS, WIPE } from "../src/badges";
import { boostsFor, nextTier, NONE, ownedFrom, PRICES, shopManifest, upgradeId } from "../src/upgrades";
import { empty, highest, merge, parse } from "../src/save";

test("every level has goals it can meet", () => {
  assert.equal(LAST_LEVEL, WORLDS.length * LEVELS_PER_WORLD);
  for (let n = 1; n <= LAST_LEVEL; n++) {
    const spec = levelSpec(n);
    assert.equal(spec.level, n);
    assert.equal(spec.ice.length, SIZE * SIZE);
    assert.ok(spec.goals.length > 0, `level ${n}`);
    for (const g of spec.goals) {
      if (g.kind === "color") assert.ok(g.color < spec.colors, `level ${n} colour`);
      if (g.kind === "ice") assert.ok(spec.ice.some((i) => i > 0), `level ${n} ice`);
    }
    const [one, two, three] = spec.stars;
    assert.ok(one <= two && two < three, `level ${n} stars`);
  }
  assert.equal(levelSpec(11).world, 1);
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
  assert.deepEqual(boostsFor(owned), { moves: 2, specials: ["bomb"], fever: 1.15 });
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
