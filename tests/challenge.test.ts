import { test } from "node:test";
import assert from "node:assert/strict";
import { beyond, challengeFor, DAILY_RULES, readChallenge, readRules, sameRound, writeRules } from "../src/challenge";
import { NONE } from "../src/upgrades";

const rules = "u0-0-0-0-0-0.n0";
const lent = { owned: { moves: 3, blaster: 1, bomb: 0, prism: 0, fever: 2, undo: 0 }, novas: 1 };

test("reads a friend's daily-board and level challenges", () => {
  assert.deepEqual(readChallenge({ mode: "daily", seed: "2026-11-20", score: 12400, unit: "points", rules }), {
    kind: "daily",
    day: "2026-11-20",
    score: 12400,
    rules: DAILY_RULES,
  });
  assert.deepEqual(readChallenge({ mode: "level", seed: "37", score: 5000, unit: "points", rules: "u3-1-0-0-2-0.n1" }), {
    kind: "level",
    level: 37,
    score: 5000,
    rules: lent,
  });
  // The daily board is played without upgrades, whatever a link says.
  assert.deepEqual(
    readChallenge({ mode: "daily", seed: "2026-11-20", score: 1, unit: "points", rules: "u3-1-0-0-2-0.n1" })?.rules,
    DAILY_RULES,
  );
});

test("ignores other games' challenges and malformed ones", () => {
  assert.equal(readChallenge(null), null);
  assert.equal(readChallenge({ mode: "ladder", seed: "2026-11-16", score: 10, unit: "digits" }), null);
  assert.equal(readChallenge({ mode: "daily", seed: "2026-11-20", score: 10, unit: "stars", rules }), null);
  assert.equal(readChallenge({ mode: "daily", seed: "yesterday", score: 10, unit: "points", rules }), null);
  assert.equal(readChallenge({ mode: "daily", score: 10, unit: "points", rules }), null);
  assert.equal(readChallenge({ mode: "level", seed: "0", score: 10, unit: "points", rules }), null);
  assert.equal(readChallenge({ mode: "level", seed: "10001", score: 10, unit: "points", rules }), null);
  assert.equal(readChallenge({ mode: "level", seed: "3", score: -1, unit: "points", rules }), null);
  assert.equal(readChallenge({ mode: "level", seed: "3", score: 1.5, unit: "points", rules }), null);
  // Without its rules, or with rules Gem Surge can't have written, it isn't a fair match.
  assert.equal(readChallenge({ mode: "level", seed: "3", score: 1, unit: "points" }), null);
  for (const bad of ["u0-0-0-0-0.n0", "u6-0-0-0-0-0.n0", "u0-0-0-0-0-0.n10", "u0-0-0-0-0-0", "x"])
    assert.equal(readRules(bad), null, bad);
});

test("a challenge made from a round reads back as that round", () => {
  for (const round of [
    { kind: "daily", day: "2026-11-20", score: 800, rules: DAILY_RULES } as const,
    { kind: "level", level: 12, score: 4321, rules: lent } as const,
  ]) {
    const back = readChallenge(challengeFor(round));
    assert.deepEqual(back, round);
    assert.ok(sameRound(back!, { ...round, score: 0 }));
  }
  const r = DAILY_RULES;
  assert.equal(sameRound({ kind: "level", level: 3, score: 1, rules: r }, { kind: "level", level: 4, score: 1, rules: r }), false);
  assert.equal(sameRound({ kind: "daily", day: "2026-11-20", score: 1, rules: r }, { kind: "level", level: 1, score: 1, rules: r }), false);
});

test("rules are written compactly and read back", () => {
  assert.equal(writeRules(lent), "u3-1-0-0-2-0.n1");
  assert.deepEqual(readRules(writeRules(lent)), lent);
  assert.match(writeRules(lent), /^[A-Za-z0-9._-]{1,64}$/);
});

test("a challenge's rules are more than the player's when any tier or a Supernova is lent", () => {
  assert.equal(beyond(DAILY_RULES, NONE), false);
  assert.equal(beyond({ owned: NONE, novas: 1 }, NONE), true);
  assert.equal(beyond(lent, { ...lent.owned }), true); // the Supernova
  assert.equal(beyond({ ...lent, novas: 0 }, { ...lent.owned }), false);
  assert.equal(beyond({ ...lent, novas: 0 }, { ...lent.owned, fever: 1 }), true);
  assert.equal(beyond({ ...lent, novas: 0 }, { ...lent.owned, moves: 5 }), false);
});
