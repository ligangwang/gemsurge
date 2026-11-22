import type { OpeningGem } from "./engine/board";
import { hashSeed, shuffleInPlace } from "./engine/random";
import type { LevelSpec } from "./engine/session";

const FROST_MOTIFS = ["shard", "hexagon", "diamond"] as const;
export type FrostMotif = (typeof FROST_MOTIFS)[number];

type Puzzle = Pick<LevelSpec, "moves" | "goals" | "stars"> & {
  layout: string[];
  ice: string[];
};

// Digits are stone colours, dots are holes, and letters are starting specials.
const SPECIALS: Record<string, OpeningGem> = {
  b: { color: 2, special: "bomb" },
  r: { color: 0, special: "row" },
  p: { color: -1, special: "prism" },
};

const PUZZLES: Partial<Record<number, Puzzle>> = {
  // Build a ruby row blaster in the channel and fire it across both shores.
  31: {
    moves: 16,
    goals: [{ kind: "ice" }],
    stars: [0, 2500, 4500],
    layout: [
      "..1421..", "..1440..", "..3032..", ".110044.",
      "40120340", "43004302", ".143443.", "..4202..",
    ],
    ice: [
      "........", "........", "..1..1..", ".1....1.",
      "111..111", "12....21", ".11..11.", "........",
    ],
  },
  // The bomb and blaster peel back a wide patch. Finish the deeper ice and collect emeralds.
  32: {
    moves: 20,
    goals: [{ kind: "ice" }, { kind: "color", color: 2, target: 14 }],
    stars: [0, 3000, 5000],
    layout: [
      "013..400", "1312.114", ".210403.", "200br232",
      "22313113", ".110124.", "140.2432", "240..433",
    ],
    ice: [
      "..1..1..", "........", "..121...", "1.1..1.1",
      "1.1..1.1", "....121.", "........", "..1..1..",
    ],
  },
  // The prism clears exposed sapphires along the inner edge of the ice ring.
  33: {
    moves: 22,
    goals: [{ kind: "ice" }, { kind: "color", color: 3, target: 18 }],
    stars: [0, 3000, 5500],
    layout: [
      "...01...", "..2332..", ".302334.", "3033p323",
      "113..323", "34312330", ".330224.", "..2032..",
    ],
    ice: [
      "...11...", "..1111..", ".21..12.", "11....11",
      "1.1..1.1", "11....11", ".121121.", "..1111..",
    ],
  },
};

/** Each group of levels gets a seeded permutation so every motif appears once. */
export function frostMotifForLevel(level: number): FrostMotif {
  const index = level - 1;
  const count = FROST_MOTIFS.length;
  const group = Math.floor(index / count);
  const order = shuffleInPlace({ seed: hashSeed(`gemsurge-frost-${group}`) }, [...FROST_MOTIFS]);
  return order[index % count];
}

export function lanternLakePuzzle(level: number): Omit<LevelSpec, "level" | "world" | "colors" | "seed"> | undefined {
  const puzzle = PUZZLES[level];
  if (!puzzle) return undefined;
  const layout = [...puzzle.layout.join("")];
  return {
    moves: puzzle.moves,
    goals: puzzle.goals.map((goal) => ({ ...goal })),
    stars: [...puzzle.stars],
    iceCover: true,
    holes: layout.map((cell) => Number(cell === ".")),
    ice: [...puzzle.ice.join("")].map((cell) => (cell === "." ? 0 : Number(cell))),
    opening: layout.map((cell) => (cell === "." ? null : SPECIALS[cell] ?? { color: Number(cell) })),
  };
}
