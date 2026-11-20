// The level ladder, the daily board, and what a play pays.
import { SIZE } from "./engine/board";
import { below, hashSeed, next, shuffleInPlace } from "./engine/random";
import type { Goal, LevelSpec } from "./engine/session";

export type World = { id: string; name: string };
/**
 * Ten levels a world (one round, see rounds.ts), each with its own look in
 * the scene. The worlds come round again after the last, in new colours each
 * time (see `worldCycle`).
 */
export const WORLDS: World[] = [
  { id: "neon", name: "Neon City" },
  { id: "sea", name: "Deep Sea" },
  { id: "space", name: "Outer Space" },
  { id: "lake", name: "Lantern Lake" },
  { id: "aurora", name: "Aurora Peaks" },
  { id: "desert", name: "Golden Desert" },
  { id: "forest", name: "Firefly Forest" },
  { id: "clouds", name: "Cloud Kingdom" },
];
export const LEVELS_PER_WORLD = 10;

/** The world a level is in, counted from 0 and never wrapping: level 81 is in world 8. */
export const worldNumber = (level: number) => Math.floor((Math.max(1, level) - 1) / LEVELS_PER_WORLD);
/** How many times the worlds have come round by this level: 0 for the first 80 levels. */
export const worldCycle = (level: number) => Math.floor(worldNumber(level) / WORLDS.length);

export const COLOR_NAMES = ["Ruby", "Diamond", "Emerald", "Sapphire", "Amethyst", "Topaz"];

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

/** The first levels are laid out by hand in TABLE; the rest are generated from them. */
export const HAND_MADE = TABLE.length;
export const LAST_LEVEL = 10000;
/** Generated levels get harder up to this level, then hold steady. */
const HARDEST = 1000;

/**
 * A generated level: one of the hand-made levels from the second world on,
 * with the goal colours shuffled, a new board, and targets that creep up
 * (and moves that creep down) the further you go. The same number always
 * makes the same level.
 */
function generated(n: number): [number, number, string] {
  const rng = { seed: hashSeed(`gemsurge-generated-${n}`) };
  const [moves, colors, text] = TABLE[LEVELS_PER_WORLD + below(rng, HAND_MADE - LEVELS_PER_WORLD)];
  const far = Math.min(1, (n - HAND_MADE) / (HARDEST - HAND_MADE));
  const swap = shuffleInPlace(rng, Array.from({ length: colors }, (_, i) => i));
  const grow = (target: number, step: number) => Math.round((target * (1 + 0.3 * far)) / step) * step;
  const goals = text.split(" ").map((part) => {
    if (part[0] === "s") return `s${grow(Number(part.slice(1)), 100)}`;
    if (part[0] === "c") {
      const [color, target] = part.slice(1).split(":").map(Number);
      return `c${swap[color]}:${grow(target, 1)}`;
    }
    return part;
  });
  return [moves - Math.round(2 * far), colors, goals.join(" ")];
}

/**
 * A generated level's own ice: a new four-way mirrored shape for each level,
 * with as many cells and as many double layers as the hand-made pattern it
 * stands in for, so it is about as hard.
 */
function variedIce(level: number, pattern: number[]): number[] {
  const rng = { seed: hashSeed(`gemsurge-ice-${level}`) };
  const half = SIZE / 2;
  const cells = Math.max(1, Math.round(pattern.filter((n) => n > 0).length / 4));
  const doubles = Math.round(pattern.filter((n) => n > 1).length / 4);
  // Grow a shape in the top-left quarter, one touching cell at a time; the
  // rest of the board mirrors it. The board's rim is the hardest place to
  // match, so the shape leans away from it.
  const rim = (q: number) => q % half === 0 || q < half;
  const order = shuffleInPlace(rng, Array.from({ length: half * half }, (_, i) => i));
  const quarter = [order.find((q) => !rim(q))!];
  while (quarter.length < cells) {
    const touching = order.filter(
      (q) =>
        !quarter.includes(q) &&
        quarter.some((p) => Math.abs((p % half) - (q % half)) + Math.abs(Math.floor(p / half) - Math.floor(q / half)) === 1),
    );
    quarter.push((next(rng) < 0.7 && touching.find((q) => !rim(q))) || touching[0]);
  }
  const ice = new Array(SIZE * SIZE).fill(0);
  quarter.slice(0, cells).forEach((q, rank) => {
    const x = q % half;
    const y = Math.floor(q / half);
    for (const [cx, cy] of [[x, y], [SIZE - 1 - x, y], [x, SIZE - 1 - y], [SIZE - 1 - x, SIZE - 1 - y]])
      ice[cy * SIZE + cx] = rank < doubles ? 2 : 1;
  });
  return ice;
}

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

/** The first levels are gentler than their tables say, to ease a new player in. */
export const EASY_LEVELS = 100;
/**
 * How much gentler: 1 through level 70, fading to 0 just past level 100, so
 * there is no sudden wall. A fully eased level has 30% more moves and
 * targets a fifth lower.
 */
const ease = (n: number) => Math.min(1, Math.max(0, (EASY_LEVELS + 1 - n) / 30));

/** Rough points a move scores with 5 or 6 colours, used to set the star scores. */
const PER_MOVE: Record<number, number> = { 5: 200, 6: 110 };

export function levelSpec(level: number): LevelSpec {
  const n = Math.min(Math.max(1, level), LAST_LEVEL);
  const [tableMoves, colors, text] = n <= HAND_MADE ? TABLE[n - 1] : generated(n);
  const { goals, ice } = parseGoals(text);
  const easy = ease(n);
  const moves = Math.round(tableMoves * (1 + 0.3 * easy));
  for (const goal of goals) {
    if (goal.kind === "score") goal.target = Math.round((goal.target * (1 - 0.2 * easy)) / 100) * 100;
    else if (goal.kind === "color") goal.target = Math.round(goal.target * (1 - 0.2 * easy));
  }
  const per = PER_MOVE[colors] ?? 110;
  const scoreGoal = goals.find((g) => g.kind === "score");
  const base = scoreGoal?.kind === "score" ? scoreGoal.target : 0;
  const two = round(Math.max(base * 1.4, per * moves * 0.9));
  const three = round(Math.max(base * 2, per * moves * 1.5));
  return {
    level: n,
    world: worldNumber(n) % WORLDS.length,
    moves,
    colors,
    goals,
    ice: ice && n > HAND_MADE ? variedIce(n, iceCells(ice)) : iceCells(ice),
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

/** Coins earned in Gem Surge that charge one Supernova. */
export const NOVA_COST = 100;

/**
 * dingn coins for a level: 2 for clearing it, 2 more a star, and a bonus in
 * the later worlds, up to 10. A loss that got halfway pays 1.
 * sdk.rewards.earn caps what a game pays a player each day.
 */
export function coinsFor(level: number, stars: number) {
  if (!stars) return 0;
  const tens = Math.floor((level - 1) / 10);
  return Math.min(10, 2 + stars * 2 + tens);
}
export const DAILY_COINS = 10;
