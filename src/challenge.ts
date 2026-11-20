// Challenge links: after a level or the daily board, a player can send a
// friend a link to the same round with their score to beat. dingn makes the
// link and its preview ("A friend scored 12,400 points in Gem Surge. Can you
// beat it?"); following it opens the game with that challenge, and the game
// starts that round.
import type { Challenge } from "../sdk/dingn-sdk.js";
import { LAST_LEVEL } from "./levels";

/** The round a challenge is for, and the score to beat. */
export type Round =
  | { kind: "daily"; day: string; score: number }
  | { kind: "level"; level: number; score: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The round a friend's challenge asks for, or null for one Gem Surge does
 * not know (another game's, or a malformed one).
 */
export function readChallenge(c: Challenge | null | undefined): Round | null {
  if (!c || c.unit !== "points" || !Number.isInteger(c.score) || c.score < 0) return null;
  if (c.mode === "daily" && c.seed && DAY.test(c.seed) && !Number.isNaN(Date.parse(c.seed)))
    return { kind: "daily", day: c.seed, score: c.score };
  if (c.mode === "level" && c.seed && /^\d{1,5}$/.test(c.seed)) {
    const level = Number(c.seed);
    if (level >= 1 && level <= LAST_LEVEL) return { kind: "level", level, score: c.score };
  }
  return null;
}

/** The challenge for a round just played, to make a link with. */
export function challengeFor(round: Round): Challenge {
  return round.kind === "daily"
    ? { mode: "daily", seed: round.day, score: round.score, unit: "points" }
    : { mode: "level", seed: String(round.level), score: round.score, unit: "points" };
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
