// The level ladder, the daily board, and what a play pays.
import { SIZE } from "./engine/board";
import { hashSeed } from "./engine/random";
import type { Goal, LevelSpec } from "./engine/session";

export type World = { id: string; name: string };
/** Ten levels a world, each with its own look in the scene. */
export const WORLDS: World[] = [
  { id: "neon", name: "Neon City" },
  { id: "sea", name: "Deep Sea" },
  { id: "space", name: "Outer Space" },
];
export const LEVELS_PER_WORLD = 10;

export const COLOR_NAMES = ["Ruby", "Topaz", "Emerald", "Sapphire", "Amethyst", "Pearl"];

const ICE: Record<string, string[]> = {
  center: ["........", "........", "..1111..", "..1111..", "..1111..", "..1111..", "........", "........"],
  stripes: ["........", "11111111", "........", "........", "........", "........", "11111111", "........"],
  corners: ["111..111", "11....11", "1......1", "........", "........", "1......1", "11....11", "111..111"],
  cross: ["...11...", "...11...", "...11...", "11122111", "11122111", "...11...", "...11...", "...11..."],
  floor: ["........", "........", "........", "........", "........", "11111111", "12222221", "11111111"],
  diamond: ["...11...", "..1221..", ".122221.", "12222221", "12222221", ".122221.", "..1221..", "...11..."],
  frame: ["11111111", "1......1", "1.2222.1", "1.2..2.1", "1.2..2.1", "1.2222.1", "1......1", "11111111"],
  checks: ["1.1.1.1.", ".1.1.1.1", "1.1.1.1.", ".1.1.1.1", "1.1.1.1.", ".1.1.1.1", "1.1.1.1.", ".1.1.1.1"],
};

const iceCells = (name?: string) =>
  name
    ? ICE[name].join("").split("").map((c) => (c === "." ? 0 : Number(c)))
    : new Array(SIZE * SIZE).fill(0);

/**
 * Each level: moves, colours, and its goals in a short form: "s3000" is a
 * score, "c0:25" collects 25 gems of colour 0, "i:center" breaks the ice laid
 * out as `center`.
 */
const TABLE: [number, number, string][] = [
  // Neon City
  [20, 5, "s3000"],
  [20, 5, "c0:30"],
  [18, 5, "i:center"],
  [20, 5, "c2:25 c3:25"],
  [22, 5, "s5000"],
  [20, 5, "i:stripes"],
  [20, 5, "c1:30 c4:30"],
  [24, 5, "i:corners"],
  [20, 5, "s5500"],
  [24, 5, "i:cross c0:20"],
  // Deep Sea
  [24, 6, "s2200"],
  [24, 6, "c3:22"],
  [25, 5, "i:floor"],
  [25, 6, "c0:16 c2:16"],
  [28, 5, "i:diamond"],
  [26, 6, "s2400"],
  [26, 6, "c1:16 c4:16 c5:16"],
  [28, 5, "i:frame"],
  [24, 6, "i:center c3:18"],
  [28, 5, "i:checks"],
  // Outer Space
  [22, 6, "s2200"],
  [22, 6, "c5:22"],
  [28, 5, "i:diamond c1:20"],
  [22, 6, "c0:18 c3:18"],
  [28, 5, "i:frame c2:24"],
  [24, 6, "s2500"],
  [28, 5, "i:checks c4:24"],
  [24, 6, "c1:16 c2:16 c3:16"],
  [28, 5, "i:cross s6000"],
  [30, 5, "i:frame c0:24 c4:24"],
];

export const LAST_LEVEL = TABLE.length;

function parseGoals(text: string): { goals: Goal[]; ice?: string } {
  const goals: Goal[] = [];
  let ice: string | undefined;
  for (const part of text.split(" ")) {
    if (part[0] === "s") goals.push({ kind: "score", target: Number(part.slice(1)) });
    else if (part[0] === "c") {
      const [color, target] = part.slice(1).split(":").map(Number);
      goals.push({ kind: "color", color, target });
    } else if (part[0] === "i") {
      ice = part.slice(2);
      goals.unshift({ kind: "ice" });
    }
  }
  return { goals, ice };
}

/** Rough points a move scores with 5 or 6 colours, used to set the star scores. */
const PER_MOVE: Record<number, number> = { 5: 200, 6: 110 };

export function levelSpec(level: number): LevelSpec {
  const n = Math.min(Math.max(1, level), LAST_LEVEL);
  const [moves, colors, text] = TABLE[n - 1];
  const { goals, ice } = parseGoals(text);
  const per = PER_MOVE[colors] ?? 110;
  const scoreGoal = goals.find((g) => g.kind === "score");
  const base = scoreGoal?.kind === "score" ? scoreGoal.target : 0;
  const two = round(Math.max(base * 1.4, per * moves * 0.9));
  const three = round(Math.max(base * 2, per * moves * 1.5));
  return {
    level: n,
    world: Math.floor((n - 1) / LEVELS_PER_WORLD),
    moves,
    colors,
    goals,
    ice: iceCells(ice),
    stars: [base, two, three],
    seed: hashSeed(`gemsurge-level-${n}`),
  };
}

const round = (n: number) => Math.round(n / 500) * 500;

/** Today's UTC day, as 2026-11-15. */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/** The daily board: 20 moves to score as much as you can, the same for everyone. */
export const DAILY_MOVES = 20;
export function dailySpec(day: string): LevelSpec {
  const seed = hashSeed(`gemsurge-daily-${day}`);
  const patterns = Object.keys(ICE);
  const pattern = patterns[Math.abs(seed) % patterns.length];
  return {
    level: 0,
    world: Math.abs(seed >> 3) % WORLDS.length,
    moves: DAILY_MOVES,
    colors: 5,
    goals: [{ kind: "score", target: 2000 }],
    ice: iceCells(pattern),
    stars: [2000, 5000, 9000],
    seed,
    allMoves: true,
  };
}

/**
 * dingn coins for a level: 2 for clearing it, 2 more a star, and a bonus in
 * the later worlds, up to 10. A loss that got halfway pays 1.
 * sdk.rewards.earn caps what a game pays a player each day.
 */
export function coinsFor(level: number, stars: number) {
  if (!stars) return 0;
  const world = Math.floor((level - 1) / LEVELS_PER_WORLD);
  return Math.min(10, 2 + stars * 2 + world);
}
export const DAILY_COINS = 10;
