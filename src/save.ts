// What the game remembers: stars for each level, today's daily board, and a
// few records. Saved on the device (sdk.storage) and, for a signed-in player,
// to their dingn account (sdk.progress).
import type { DingnGame, Json } from "../sdk/dingn-sdk.js";
import { LAST_LEVEL } from "./levels";

export type Saved = {
  /** Best stars for each level (index 0 is level 1); 0 for not cleared. */
  stars: number[];
  /** Best score for each level. */
  best: number[];
  /** The last daily board played to the end: its UTC day and best score. */
  daily: { day: string; score: number; paid: boolean } | null;
  /** The longest chain ever. */
  chain: number;
};
type Sdk = Pick<DingnGame, "storage" | "progress" | "player">;

export const empty = (): Saved => ({
  stars: new Array(LAST_LEVEL).fill(0),
  best: new Array(LAST_LEVEL).fill(0),
  daily: null,
  chain: 0,
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

/** Reads a saved value, ignoring anything that isn't the right shape. */
export function parse(value: Json): Saved {
  const saved = empty();
  if (!value || typeof value !== "object" || Array.isArray(value)) return saved;
  const list = (v: Json | undefined, max: number) =>
    Array.from({ length: LAST_LEVEL }, (_, i) =>
      Array.isArray(v) ? whole(v[i], max) : 0,
    );
  saved.stars = list(value.stars, 3);
  saved.best = list(value.best, 1e9);
  saved.chain = whole(value.chain, 1000);
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
  };
}

const KEY = "gemsurge";
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
  // Only as far as the last level played, so a save stays well under the
  // 16 KB the SDK allows.
  let length = saved.stars.length;
  while (length > 0 && !saved.stars[length - 1] && !saved.best[length - 1]) length--;
  const value = {
    ...saved,
    stars: saved.stars.slice(0, length),
    best: saved.best.slice(0, length),
  } as unknown as Json;
  await sdk.storage.set(KEY, value).catch(() => {});
  if (sdk.player.signedIn) await sdk.progress.save(value).catch(() => {});
}
