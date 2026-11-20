import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeFor, readChallenge, sameRound } from "../src/challenge";

test("reads a friend's daily-board and level challenges", () => {
  assert.deepEqual(readChallenge({ mode: "daily", seed: "2026-11-20", score: 12400, unit: "points" }), {
    kind: "daily",
    day: "2026-11-20",
    score: 12400,
  });
  assert.deepEqual(readChallenge({ mode: "level", seed: "37", score: 5000, unit: "points" }), {
    kind: "level",
    level: 37,
    score: 5000,
  });
});

test("ignores other games' challenges and malformed ones", () => {
  assert.equal(readChallenge(null), null);
  assert.equal(readChallenge({ mode: "ladder", seed: "2026-11-16", score: 10, unit: "digits" }), null);
  assert.equal(readChallenge({ mode: "daily", seed: "2026-11-20", score: 10, unit: "stars" }), null);
  assert.equal(readChallenge({ mode: "daily", seed: "yesterday", score: 10, unit: "points" }), null);
  assert.equal(readChallenge({ mode: "daily", score: 10, unit: "points" }), null);
  assert.equal(readChallenge({ mode: "level", seed: "0", score: 10, unit: "points" }), null);
  assert.equal(readChallenge({ mode: "level", seed: "10001", score: 10, unit: "points" }), null);
  assert.equal(readChallenge({ mode: "level", seed: "3", score: -1, unit: "points" }), null);
  assert.equal(readChallenge({ mode: "level", seed: "3", score: 1.5, unit: "points" }), null);
});

test("a challenge made from a round reads back as that round", () => {
  for (const round of [
    { kind: "daily", day: "2026-11-20", score: 800 } as const,
    { kind: "level", level: 12, score: 4321 } as const,
  ]) {
    const back = readChallenge(challengeFor(round));
    assert.deepEqual(back, round);
    assert.ok(sameRound(back!, { ...round, score: 0 }));
  }
  assert.equal(sameRound({ kind: "level", level: 3, score: 1 }, { kind: "level", level: 4, score: 1 }), false);
  assert.equal(sameRound({ kind: "daily", day: "2026-11-20", score: 1 }, { kind: "level", level: 1, score: 1 }), false);
});
