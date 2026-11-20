// Challenge links: after a level or the daily board, a player can send a
// friend a link to the same round with their score to beat. dingn makes the
// link and its preview ("A friend scored 12,400 points in Gem Surge. Can you
// beat it?"); following it opens the game with that challenge, and the game
// starts that round.
//
// A challenge also carries the rules its round was played with: the
// upgrades the player had and how many Supernovas they set off. The friend
// plays under exactly those rules, whatever they own themselves, so the two
// scores are fair to compare.
import type { Challenge } from "../sdk/dingn-sdk.js";
import { LAST_LEVEL } from "./levels";
import { NONE, PRICES, UPGRADE_KINDS, type Owned } from "./upgrades";

/** The upgrade tiers a round was played with, and the Supernovas it allowed. */
export type Rules = { owned: Owned; novas: number };
/** A daily board's rules: no upgrades and no Supernovas, for everyone. */
export const DAILY_RULES: Rules = { owned: NONE, novas: 0 };
/** Supernovas one challenge round may allow at most. */
export const MAX_NOVAS = 9;

/** The round a challenge is for, the score to beat, and the rules it was played with. */
/** `mine` marks the player's own challenge, opened by them: their own score to beat. */
export type Round =
  | { kind: "daily"; day: string; score: number; rules: Rules; mine?: boolean }
  | { kind: "level"; level: number; score: number; rules: Rules; mine?: boolean };

/** Rules as dingn keeps them: "u" and each upgrade's tier, then "n" and the Supernovas, e.g. "u3-1-0-0-2-0.n1". */
export const writeRules = (r: Rules) => `u${UPGRADE_KINDS.map((k) => r.owned[k]).join("-")}.n${r.novas}`;

/** Rules written by writeRules, or null for anything else. */
export function readRules(text: string | undefined): Rules | null {
  const m = /^u(\d)-(\d)-(\d)-(\d)-(\d)-(\d)\.n(\d)$/.exec(text ?? "");
  if (!m) return null;
  const owned = { ...NONE };
  for (const [i, kind] of UPGRADE_KINDS.entries()) {
    const tier = Number(m[i + 1]);
    if (tier > PRICES[kind].length) return null;
    owned[kind] = tier;
  }
  const novas = Number(m[7]);
  return novas <= MAX_NOVAS ? { owned, novas } : null;
}

/** Whether `rules` give anything beyond what the player owns (a higher tier, or Supernovas). */
export const beyond = (rules: Rules, owned: Owned) =>
  rules.novas > 0 || UPGRADE_KINDS.some((k) => rules.owned[k] > owned[k]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether dingn says the player opening the challenge made it. */
const own = (c: Challenge) => (c.mine === true ? { mine: true } : {});

/**
 * The round a friend's challenge asks for, or null for one Gem Surge does
 * not know (another game's, a malformed one, or one without its rules).
 */
export function readChallenge(c: Challenge | null | undefined): Round | null {
  if (!c || c.unit !== "points" || !Number.isInteger(c.score) || c.score < 0) return null;
  const rules = readRules(c.rules);
  if (!rules) return null;
  if (c.mode === "daily" && c.seed && DAY.test(c.seed) && !Number.isNaN(Date.parse(c.seed)))
    // The daily board is played without upgrades or Supernovas.
    return { kind: "daily", day: c.seed, score: c.score, rules: DAILY_RULES, ...own(c) };
  if (c.mode === "level" && c.seed && /^\d{1,5}$/.test(c.seed)) {
    const level = Number(c.seed);
    if (level >= 1 && level <= LAST_LEVEL) return { kind: "level", level, score: c.score, rules, ...own(c) };
  }
  return null;
}

/** The challenge for a round just played, to make a link with. */
export function challengeFor(round: Round): Challenge {
  const rules = writeRules(round.kind === "daily" ? DAILY_RULES : round.rules);
  return round.kind === "daily"
    ? { mode: "daily", seed: round.day, score: round.score, unit: "points", rules }
    : { mode: "level", seed: String(round.level), score: round.score, unit: "points", rules };
}

/** Whether a challenge is for this round (the same daily board or level). */
export const sameRound = (a: Round, b: Round) =>
  a.kind === b.kind && (a.kind === "daily" ? a.day === (b as typeof a).day : a.level === (b as typeof a).level);

/**
 * Shares a challenge link: the phone's share sheet where there is one,
 * otherwise the clipboard. Says which happened, or "failed" when neither
 * worked, so the game can show the link to copy by hand.
 */
export async function shareLink(url: string, text: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Gem Surge", text, url });
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
      // Not allowed here: fall back to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
