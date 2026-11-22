// Challenges: a link that dares anyone to beat a score on the same round.
// A round is a day's daily board, or a level played with a set of upgrades;
// this file turns one into dingn's challenge (mode, seed and rules) and back.
import type { Challenge } from "../sdk/dingn-sdk.js";
import { LAST_LEVEL } from "./levels";
import { NONE, PRICES, UPGRADE_KINDS, type Owned, type UpgradeKind } from "./upgrades";

export type ChallengeRound =
  /** The daily board of a UTC day, which has no upgrades. */
  | { mode: "daily"; day: string }
  /** A level, played with these upgrades whatever the player owns. */
  | { mode: "level"; level: number; owned: Owned };

/** The upgrades as a challenge's rules, "moves2.bomb1"; nothing for none. */
export function rulesOf(owned: Owned): string | undefined {
  const parts = UPGRADE_KINDS.filter((kind) => owned[kind] > 0).map((kind) => `${kind}${owned[kind]}`);
  return parts.length ? parts.join(".") : undefined;
}

/** The upgrades in a challenge's rules, or null when they make no sense. */
export function ownedFromRules(rules: string | undefined): Owned | null {
  const owned = { ...NONE };
  if (!rules) return owned;
  for (const part of rules.split(".")) {
    const match = /^([a-z]+)(\d)$/.exec(part);
    const kind = match?.[1] as UpgradeKind | undefined;
    const tier = Number(match?.[2]);
    if (!kind || !UPGRADE_KINDS.includes(kind) || owned[kind] || tier < 1 || tier > PRICES[kind].length) return null;
    owned[kind] = tier;
  }
  return owned;
}

/** The challenge that dares a friend to beat `score` on this round. */
export function toChallenge(round: ChallengeRound, score: number): Challenge {
  if (round.mode === "daily") return { mode: "daily", seed: round.day, score, unit: "points" };
  const rules = rulesOf(round.owned);
  return { mode: "level", seed: String(round.level), score, unit: "points", ...(rules ? { rules } : {}) };
}

/** The round a challenge asks for, or null for one this version can't play. */
export function roundFrom(challenge: Challenge | null): ChallengeRound | null {
  if (!challenge) return null;
  const seed = challenge.seed ?? "";
  if (challenge.mode === "daily") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(seed) || Number.isNaN(Date.parse(seed))) return null;
    return { mode: "daily", day: seed };
  }
  if (challenge.mode === "level") {
    const level = /^\d{1,6}$/.test(seed) ? Number(seed) : 0;
    const owned = ownedFromRules(challenge.rules);
    if (level < 1 || level > LAST_LEVEL || !owned) return null;
    return { mode: "level", level, owned };
  }
  return null;
}
