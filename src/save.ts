// What the game remembers: stars for each level, today's daily board, and a
// few records. Saved on the device (sdk.storage) and, for a signed-in player,
// to their dingn account (sdk.progress).
import type { DingnGame, Json } from "../sdk/dingn-sdk.js";
import { LAST_LEVEL, LEVELS_PER_WORLD, NOVA_COST, coinsFor } from "./levels";

export type Saved = {
  /** Best stars for each level (index 0 is level 1); 0 for not cleared. */
  stars: number[];
  /** Best score for each level. */
  best: number[];
  /** The last daily board played to the end: its UTC day and best score. */
  daily: { day: string; score: number; paid: boolean } | null;
  /** The longest chain ever. */
  chain: number;
  /**
   * Every coin a play has been worth, whether or not dingn paid it: each
   * NOVA_COST of them charges a Supernova.
   */
  earned: number;
  /** Supernovas set off so far. */
  novasUsed: number;
  /** Supernovas won as round rewards and in lucky draws. */
  novasWon: number;
  /** Lucky draws spun: one is owed for each round finished. */
  drawsDone: number;
};
type Sdk = Pick<DingnGame, "storage" | "progress" | "player">;

export const empty = (): Saved => ({
  stars: new Array(LAST_LEVEL).fill(0),
  best: new Array(LAST_LEVEL).fill(0),
  daily: null,
  chain: 0,
  earned: 0,
  novasUsed: 0,
  novasWon: 0,
  drawsDone: 0,
});
const whole = (value: unknown, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : 0;
};

/** The highest level cleared, 0 for none. */
export const highest = (s: Saved) => {
  let n = 0;
  while (n < LAST_LEVEL && s.stars[n] > 0) n++;
  return n;
};

/** Rounds finished: each round ends with its last level cleared. */
export const roundsFinished = (s: Saved) => {
  let n = 0;
  for (let i = LEVELS_PER_WORLD - 1; i < s.stars.length; i += LEVELS_PER_WORLD) if (s.stars[i] > 0) n++;
  return n;
};
/** Lucky draws earned by finishing a round but not spun yet. */
export const drawsOwed = (s: Saved) => Math.max(0, roundsFinished(s) - s.drawsDone);

/** Supernovas ready to set off. */
export const novas = (s: Saved) =>
  Math.max(0, Math.floor(s.earned / NOVA_COST) + s.novasWon - s.novasUsed);
/** Coins towards the next Supernova, 0 to NOVA_COST - 1. */
export const novaCharge = (s: Saved) => s.earned % NOVA_COST;

/** Reads a saved value, ignoring anything that isn't the right shape. */
export function parse(value: Json): Saved {
  const saved = empty();
  if (!value || typeof value !== "object" || Array.isArray(value)) return saved;
  // Stars are stored as a string of digits (older saves: a list), and the
  // best scores as a list that starts at level `bestFrom` + 1.
  const stars = value.stars;
  const best = value.best;
  const from = whole(value.bestFrom, LAST_LEVEL);
  saved.stars = Array.from({ length: LAST_LEVEL }, (_, i) =>
    typeof stars === "string" || Array.isArray(stars) ? whole(stars[i], 3) : 0,
  );
  saved.best = Array.from({ length: LAST_LEVEL }, (_, i) =>
    Array.isArray(best) && i >= from ? whole(best[i - from], 1e9) : 0,
  );
  saved.chain = whole(value.chain, 1000);
  // A save from before Supernovas is credited with what its stars were worth.
  saved.earned =
    value.earned === undefined
      ? saved.stars.reduce((sum, stars, i) => sum + coinsFor(i + 1, stars), 0)
      : whole(value.earned, 1e9);
  saved.novasUsed = whole(value.novasUsed, 1e7);
  saved.novasWon = whole(value.novasWon, 1e7);
  // Saves from before the player stopped the wheel drew at once, so every
  // round they finished has had its draw.
  saved.drawsDone =
    value.drawsDone === undefined ? roundsFinished(saved) : whole(value.drawsDone, LAST_LEVEL);
  const d = value.daily;
  if (
    d &&
    typeof d === "object" &&
    !Array.isArray(d) &&
    typeof d.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.day)
  )
    saved.daily = { day: d.day, score: whole(d.score, 1e9), paid: d.paid === true };
  return saved;
}

/** Combines two saves, keeping the better of each. */
export function merge(a: Saved, b: Saved): Saved {
  let daily = a.daily ?? b.daily;
  if (a.daily && b.daily)
    daily =
      a.daily.day !== b.daily.day
        ? a.daily.day > b.daily.day
          ? a.daily
          : b.daily
        : {
            day: a.daily.day,
            score: Math.max(a.daily.score, b.daily.score),
            paid: a.daily.paid || b.daily.paid,
          };
  return {
    stars: a.stars.map((s, i) => Math.max(s, b.stars[i])),
    best: a.best.map((s, i) => Math.max(s, b.best[i])),
    daily,
    chain: Math.max(a.chain, b.chain),
    earned: Math.max(a.earned, b.earned),
    novasUsed: Math.max(a.novasUsed, b.novasUsed),
    novasWon: Math.max(a.novasWon, b.novasWon),
    drawsDone: Math.max(a.drawsDone, b.drawsDone),
  };
}

const KEY = "gemsurge";
/** How many levels' best scores a save keeps. */
export const BEST_KEPT = 600;
export async function loadSaved(sdk: Sdk): Promise<Saved> {
  let device = empty();
  try {
    device = parse(await sdk.storage.get(KEY));
  } catch {}
  if (!sdk.player.signedIn) return device;
  try {
    return merge(parse(await sdk.progress.load()), device);
  } catch {
    return device;
  }
}
export async function store(sdk: Sdk, saved: Saved) {
  // A save has to stay under the 16 KB the SDK allows, even at level 10,000:
  // stars go as one digit a level, only as far as the last level played, and
  // best scores are kept for the last BEST_KEPT of those levels.
  let length = saved.stars.length;
  while (length > 0 && !saved.stars[length - 1] && !saved.best[length - 1]) length--;
  const bestFrom = Math.max(0, length - BEST_KEPT);
  const value = {
    ...saved,
    stars: saved.stars.slice(0, length).join(""),
    best: saved.best.slice(bestFrom, length),
    bestFrom,
  } as unknown as Json;
  await sdk.storage.set(KEY, value).catch(() => {});
  if (sdk.player.signedIn) await sdk.progress.save(value).catch(() => {});
}
