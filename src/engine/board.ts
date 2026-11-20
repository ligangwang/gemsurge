// The match-3 board: gems, ice, swaps, matches, specials, cascades and
// refills. Pure TypeScript with no three.js or DOM, so the tests run it in
// Node. Every move returns the steps it took, which the scene animates.
//
// Coordinates: x is the column (0 at the left), y is the row (0 at the top).
// Gems fall towards y = SIZE - 1.
//
// Specials:
// - A straight line of 4 makes a line blaster across the line: a horizontal
//   4 makes a column blaster ("col"), a vertical 4 a row blaster ("row").
// - An L, T or + shape makes a bomb that clears the 3×3 around it.
// - A straight line of 5 or more makes a prism, which matches nothing by
//   itself. Swapped with a gem, it clears every gem of that colour.
// - Swapping two specials combines them (see `combine`).
import { below, next, shuffleInPlace, type Rng } from "./random";

export const SIZE = 8;
export const MAX_COLORS = 7;

export type Special = "row" | "col" | "bomb" | "prism";
/** A gem. A prism has colour -1. */
export type Gem = { id: number; color: number; special?: Special };
export type Pos = { x: number; y: number };

export type Board = {
  /** SIZE × SIZE cells, row by row. Every cell holds a gem between moves. */
  cells: (Gem | null)[];
  /** Ice layers under each cell (0-2). Clearing a gem there cracks one. */
  ice: number[];
  /** How many colours fall (3-7). */
  colors: number;
  rng: Rng;
  nextId: number;
};

export type Blast =
  /** Clears `width` rows (1 or 3) centred on y. */
  | { kind: "row"; x: number; y: number; width: number }
  /** Clears `width` columns centred on x. */
  | { kind: "col"; x: number; y: number; width: number }
  | { kind: "bomb"; x: number; y: number; radius: number }
  /** Lightning from the prism to every gem of one colour. */
  | { kind: "prism"; x: number; y: number; color: number; targets: Pos[] }
  /** Two prisms: the whole board. */
  | { kind: "wipe"; x: number; y: number };

export type Cleared = Pos & { id: number; color: number; special?: Special };

export type Step = {
  /** 1 for the swap's own matches, 2 and up for each cascade after it. */
  chain: number;
  /** Gems turned into specials before anything goes off (prism combos, the finale). */
  converted: (Pos & { gem: Gem })[];
  blasts: Blast[];
  cleared: Cleared[];
  /** Specials made by this step's matches, from the cells that made them. */
  created: (Pos & { gem: Gem; from: Pos[] })[];
  /** Cells whose ice cracked, with the layers left. */
  ice: (Pos & { left: number })[];
  score: number;
  /** The board after gems fell and new ones dropped in. */
  cells: (Gem | null)[];
  /** Ids of the gems that dropped in. */
  spawned: number[];
};

export type MoveResult = {
  steps: Step[];
  score: number;
  /** Gems cleared of each colour. */
  collected: number[];
  iceBroken: number;
  /** Two specials swapped together. */
  combo: string | null;
  /** The longest chain of the move. */
  chain: number;
  specialsMade: number;
  blasts: number;
  /** The board was shuffled after the move because no swap was left. */
  shuffled: (Gem | null)[] | null;
};

export const idx = (x: number, y: number) => y * SIZE + x;
export const pos = (i: number): Pos => ({ x: i % SIZE, y: Math.floor(i / SIZE) });
export const inside = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const adjacent = (a: Pos, b: Pos) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

export const SCORE = {
  gem: 10,
  made: { row: 40, col: 40, bomb: 80, prism: 150 } as Record<Special, number>,
};

const newGem = (b: Board, color: number, special?: Special): Gem =>
  special ? { id: b.nextId++, color, special } : { id: b.nextId++, color };

export const cloneBoard = (b: Board): Board => ({
  cells: b.cells.map((g) => (g ? { ...g } : null)),
  ice: [...b.ice],
  colors: b.colors,
  rng: { ...b.rng },
  nextId: b.nextId,
});

/** A full board with no matches and at least one swap. */
export function createBoard(
  seed: number,
  colors: number,
  ice: number[] = [],
): Board {
  const b: Board = {
    cells: [],
    ice: Array.from({ length: SIZE * SIZE }, (_, i) => ice[i] ?? 0),
    colors: Math.min(MAX_COLORS, Math.max(3, colors)),
    rng: { seed },
    nextId: 1,
  };
  do {
    b.cells = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const { x, y } = pos(i);
      let color: number;
      do color = below(b.rng, b.colors);
      while (
        (x >= 2 &&
          b.cells[i - 1]!.color === color &&
          b.cells[i - 2]!.color === color) ||
        (y >= 2 &&
          b.cells[i - SIZE]!.color === color &&
          b.cells[i - 2 * SIZE]!.color === color)
      );
      b.cells.push(newGem(b, color));
    }
  } while (!findHint(b));
  return b;
}

/** Turns gems into specials, such as the bomb an upgrade starts with. */
export function placeSpecials(b: Board, specials: Special[]) {
  const free = shuffleInPlace(
    b.rng,
    b.cells.map((_, i) => i).filter((i) => !b.cells[i]!.special),
  );
  for (const s of specials) {
    const i = free.pop();
    if (i === undefined) return;
    const g = b.cells[i]!;
    b.cells[i] = newGem(b, s === "prism" ? -1 : g.color, s);
  }
}

// ---------------------------------------------------------------- matching

type Run = { cells: number[]; dir: "h" | "v" };
type Group = { cells: number[]; runs: Run[] };

const colorAt = (cells: (Gem | null)[], i: number) => cells[i]?.color ?? -1;

function findRuns(cells: (Gem | null)[]): Run[] {
  const runs: Run[] = [];
  for (const dir of ["h", "v"] as const) {
    for (let a = 0; a < SIZE; a++) {
      let start = 0;
      for (let b = 1; b <= SIZE; b++) {
        const at = (k: number) => (dir === "h" ? idx(k, a) : idx(a, k));
        const c = colorAt(cells, at(start));
        if (b < SIZE && c >= 0 && colorAt(cells, at(b)) === c) continue;
        if (c >= 0 && b - start >= 3)
          runs.push({
            cells: Array.from({ length: b - start }, (_, k) => at(start + k)),
            dir,
          });
        start = b;
      }
    }
  }
  return runs;
}

/** Runs of 3 or more, joined into groups where they share a gem. */
export function findGroups(cells: (Gem | null)[]): Group[] {
  const runs = findRuns(cells);
  const parent = runs.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  const owner = new Map<number, number>();
  runs.forEach((run, r) => {
    for (const c of run.cells) {
      const o = owner.get(c);
      if (o === undefined) owner.set(c, r);
      else parent[root(o)] = root(r);
    }
  });
  const groups = new Map<number, Group>();
  runs.forEach((run, r) => {
    const g = groups.get(root(r)) ?? { cells: [], runs: [] };
    g.runs.push(run);
    for (const c of run.cells) if (!g.cells.includes(c)) g.cells.push(c);
    groups.set(root(r), g);
  });
  return [...groups.values()];
}

/** The special a group makes, if any. */
export function specialFor(group: Group): Special | null {
  const longest = Math.max(...group.runs.map((r) => r.cells.length));
  const h = group.runs.some((r) => r.dir === "h");
  const v = group.runs.some((r) => r.dir === "v");
  if (longest >= 5) return "prism";
  if (h && v) return "bomb";
  if (longest === 4) return group.runs[0].dir === "h" ? "col" : "row";
  return null;
}

/** Where a group's special appears: a swapped cell, else the corner, else the middle. */
function spotFor(
  cells: (Gem | null)[],
  group: Group,
  special: Special,
  preferred: number[],
): number | null {
  const plain = (i: number) => !cells[i]!.special;
  for (const p of preferred) if (group.cells.includes(p) && plain(p)) return p;
  if (special === "bomb" || special === "prism") {
    for (const c of group.cells) {
      const inRuns = group.runs.filter((r) => r.cells.includes(c)).length;
      if (inRuns > 1 && plain(c)) return c;
    }
  }
  const run = [...group.runs].sort((a, b) => b.cells.length - a.cells.length)[0];
  const order = [...run.cells.slice(1), run.cells[0]];
  order.sort(
    (a, b) =>
      Math.abs(run.cells.indexOf(a) - (run.cells.length - 1) / 2) -
      Math.abs(run.cells.indexOf(b) - (run.cells.length - 1) / 2),
  );
  for (const c of order) if (plain(c)) return c;
  return group.cells.find(plain) ?? null;
}

// ------------------------------------------------------------------ blasts

function blastCells(blast: Blast): number[] {
  const out: number[] = [];
  const add = (x: number, y: number) => inside(x, y) && out.push(idx(x, y));
  switch (blast.kind) {
    case "row": {
      const half = (blast.width - 1) / 2;
      for (let y = blast.y - half; y <= blast.y + half; y++)
        for (let x = 0; x < SIZE; x++) add(x, y);
      break;
    }
    case "col": {
      const half = (blast.width - 1) / 2;
      for (let x = blast.x - half; x <= blast.x + half; x++)
        for (let y = 0; y < SIZE; y++) add(x, y);
      break;
    }
    case "bomb":
      for (let y = blast.y - blast.radius; y <= blast.y + blast.radius; y++)
        for (let x = blast.x - blast.radius; x <= blast.x + blast.radius; x++)
          add(x, y);
      break;
    case "prism":
      for (const t of blast.targets) add(t.x, t.y);
      break;
    case "wipe":
      for (let i = 0; i < SIZE * SIZE; i++) out.push(i);
  }
  return out;
}

/** The colour a prism caught in a blast clears: the commonest one left. */
function commonestColor(b: Board, skip: Set<number>): number {
  const counts = new Array(MAX_COLORS).fill(0);
  b.cells.forEach((g, i) => {
    if (g && g.color >= 0 && !skip.has(i)) counts[g.color]++;
  });
  let best = 0;
  for (let c = 1; c < MAX_COLORS; c++) if (counts[c] > counts[best]) best = c;
  return best;
}

const colorTargets = (b: Board, color: number): Pos[] =>
  b.cells.flatMap((g, i) => (g && g.color === color ? [pos(i)] : []));

function blastOf(b: Board, gem: Gem, at: Pos, clearing: Set<number>): Blast {
  switch (gem.special) {
    case "row":
      return { kind: "row", ...at, width: 1 };
    case "col":
      return { kind: "col", ...at, width: 1 };
    case "bomb":
      return { kind: "bomb", ...at, radius: 1 };
    default: {
      const color = commonestColor(b, clearing);
      return { kind: "prism", ...at, color, targets: colorTargets(b, color) };
    }
  }
}

// ------------------------------------------------------------------- steps

type Seed = {
  clear: number[];
  blasts: Blast[];
  /** Specials already spent by the seed's blasts. */
  spent: number[];
  created: (Pos & { gem: Gem; from: Pos[] })[];
  converted: (Pos & { gem: Gem })[];
  /** Cells that crack ice without clearing (where specials appear). */
  hit: number[];
};

const emptySeed = (): Seed => ({
  clear: [],
  blasts: [],
  spent: [],
  created: [],
  converted: [],
  hit: [],
});

/** The matches on the board as a seed, making their specials. */
function matchSeed(b: Board, preferred: number[]): Seed | null {
  const groups = findGroups(b.cells);
  if (!groups.length) return null;
  const seed = emptySeed();
  for (const group of groups) {
    const special = specialFor(group);
    const spot = special ? spotFor(b.cells, group, special, preferred) : null;
    for (const c of group.cells) {
      if (c === spot) seed.hit.push(c);
      else seed.clear.push(c);
    }
    if (special && spot !== null) {
      const color = special === "prism" ? -1 : b.cells[spot]!.color;
      seed.created.push({
        ...pos(spot),
        gem: { id: 0, color, special },
        from: group.cells.filter((c) => c !== spot).map(pos),
      });
    }
  }
  return seed;
}

/**
 * Clears a seed and everything its specials set off, cracks ice, then lets
 * gems fall and new ones drop in. Returns the step for the scene.
 */
function runStep(b: Board, seed: Seed, chain: number): Step {
  const created = new Set(seed.created.map((c) => idx(c.x, c.y)));
  const spent = new Set(seed.spent);
  const clearing = new Set<number>();
  const queue = [...seed.clear];
  const blasts: Blast[] = [];
  for (const blast of seed.blasts) {
    blasts.push(blast);
    queue.push(...blastCells(blast));
  }
  while (queue.length) {
    const i = queue.shift()!;
    if (clearing.has(i) || created.has(i)) continue;
    const gem = b.cells[i];
    if (!gem) continue;
    clearing.add(i);
    if (gem.special && !spent.has(gem.id)) {
      spent.add(gem.id);
      const blast = blastOf(b, gem, pos(i), clearing);
      blasts.push(blast);
      queue.push(...blastCells(blast));
    }
  }

  const cleared: Cleared[] = [...clearing].map((i) => ({
    ...pos(i),
    ...b.cells[i]!,
  }));
  const ice: Step["ice"] = [];
  for (const i of new Set([...clearing, ...seed.hit])) {
    if (b.ice[i] > 0) {
      b.ice[i]--;
      ice.push({ ...pos(i), left: b.ice[i] });
    }
  }
  for (const i of clearing) b.cells[i] = null;
  let score = cleared.length * SCORE.gem * chain;
  const made = seed.created.map((c) => {
    const gem = newGem(b, c.gem.color, c.gem.special);
    b.cells[idx(c.x, c.y)] = gem;
    score += SCORE.made[gem.special!];
    return { ...c, gem };
  });

  const spawned = fall(b);
  return {
    chain,
    converted: seed.converted,
    blasts,
    cleared,
    created: made,
    ice,
    score,
    cells: b.cells.map((g) => (g ? { ...g } : null)),
    spawned,
  };
}

/** Gems fall into the gaps and new ones drop in from the top. */
function fall(b: Board): number[] {
  const spawned: number[] = [];
  for (let x = 0; x < SIZE; x++) {
    let write = SIZE - 1;
    for (let y = SIZE - 1; y >= 0; y--) {
      const g = b.cells[idx(x, y)];
      if (!g) continue;
      b.cells[idx(x, y)] = null;
      b.cells[idx(x, write--)] = g;
    }
    for (let y = write; y >= 0; y--) {
      const g = newGem(b, below(b.rng, b.colors));
      b.cells[idx(x, y)] = g;
      spawned.push(g.id);
    }
  }
  return spawned;
}

/** Runs a first step, then every cascade, and shuffles if no swap is left. */
function settle(b: Board, first: Seed | null, combo: string | null): MoveResult {
  const steps: Step[] = [];
  let seed: Seed | null = first;
  while (seed) {
    steps.push(runStep(b, seed, steps.length + 1));
    seed = matchSeed(b, []);
  }
  const collected = new Array(MAX_COLORS).fill(0);
  let iceBroken = 0;
  let specialsMade = 0;
  let blasts = 0;
  for (const s of steps) {
    for (const c of s.cleared) if (c.color >= 0) collected[c.color]++;
    iceBroken += s.ice.length;
    specialsMade += s.created.length;
    blasts += s.blasts.length;
  }
  let shuffled: MoveResult["shuffled"] = null;
  if (!findHint(b)) {
    shuffle(b);
    shuffled = b.cells.map((g) => (g ? { ...g } : null));
  }
  return {
    steps,
    score: steps.reduce((sum, s) => sum + s.score, 0),
    collected,
    iceBroken,
    combo,
    chain: steps.length,
    specialsMade,
    blasts,
    shuffled,
  };
}

// ------------------------------------------------------------------- swaps

const isLine = (s?: Special) => s === "row" || s === "col";

/** Whether swapping a and b does anything. */
export function canSwap(b: Board, a: Pos, c: Pos): boolean {
  if (!inside(a.x, a.y) || !inside(c.x, c.y) || !adjacent(a, c)) return false;
  const ga = b.cells[idx(a.x, a.y)];
  const gc = b.cells[idx(c.x, c.y)];
  if (!ga || !gc) return false;
  if (ga.special === "prism" || gc.special === "prism") return true;
  if (ga.special && gc.special) return true;
  return matchesAfterSwap(b.cells, idx(a.x, a.y), idx(c.x, c.y)) > 0;
}

/** How many gems the swap of i and j lines up (0 for none). */
function matchesAfterSwap(cells: (Gem | null)[], i: number, j: number) {
  const ci = colorAt(cells, i);
  const cj = colorAt(cells, j);
  if (ci === cj) return 0;
  const color = (k: number) => (k === i ? cj : k === j ? ci : colorAt(cells, k));
  let total = 0;
  for (const at of [i, j]) {
    const c = color(at);
    if (c < 0) continue;
    const { x, y } = pos(at);
    const count = (dx: number, dy: number) => {
      let n = 0;
      for (
        let px = x + dx, py = y + dy;
        inside(px, py) && color(idx(px, py)) === c;
        px += dx, py += dy
      )
        n++;
      return n;
    };
    const h = count(-1, 0) + count(1, 0) + 1;
    const v = count(0, -1) + count(0, 1) + 1;
    if (h >= 3) total += h;
    if (v >= 3) total += v;
  }
  return total;
}

/** The best swap on the board (most gems, specials first), or null for none. */
export function findHint(b: Board): [Pos, Pos] | null {
  let best: [Pos, Pos] | null = null;
  let bestValue = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = pos(i);
    for (const c of [
      { x: a.x + 1, y: a.y },
      { x: a.x, y: a.y + 1 },
    ]) {
      if (!inside(c.x, c.y)) continue;
      const j = idx(c.x, c.y);
      const ga = b.cells[i];
      const gc = b.cells[j];
      if (!ga || !gc) continue;
      let value = matchesAfterSwap(b.cells, i, j);
      if (ga.special === "prism" || gc.special === "prism") value = 20;
      else if (ga.special && gc.special) value = 15;
      else if (value && (ga.special || gc.special)) value += 4;
      if (value > bestValue) {
        bestValue = value;
        best = [a, c];
      }
    }
  }
  return best;
}

/** Swaps two neighbouring gems and plays out the move, or null when it does nothing. */
export function swap(b: Board, a: Pos, c: Pos): MoveResult | null {
  if (!canSwap(b, a, c)) return null;
  const ia = idx(a.x, a.y);
  const ic = idx(c.x, c.y);
  [b.cells[ia], b.cells[ic]] = [b.cells[ic], b.cells[ia]];
  // The gem the player moved now sits at c; the other one at a.
  const moved = b.cells[ic]!;
  const other = b.cells[ia]!;
  if (moved.special && other.special) return combine(b, c, a);
  if (moved.special === "prism" || other.special === "prism") {
    const prismAt = moved.special === "prism" ? c : a;
    const gemAt = moved.special === "prism" ? a : c;
    const color = b.cells[idx(gemAt.x, gemAt.y)]!.color;
    const prism = b.cells[idx(prismAt.x, prismAt.y)]!;
    const seed = emptySeed();
    seed.blasts.push({
      kind: "prism",
      ...prismAt,
      color,
      targets: colorTargets(b, color),
    });
    seed.spent.push(prism.id);
    seed.clear.push(idx(prismAt.x, prismAt.y));
    return settle(b, seed, null);
  }
  return settle(b, matchSeed(b, [ic, ia])!, null);
}

/**
 * Two specials swapped together, centred where the moved one landed:
 * - two line blasters: a row and a column;
 * - a line blaster and a bomb: three rows and three columns;
 * - two bombs: the 5×5 around them;
 * - a prism and a line blaster or bomb: every gem of that one's colour turns
 *   into one, then they all go off;
 * - two prisms: the whole board.
 */
function combine(b: Board, at: Pos, from: Pos): MoveResult {
  const g1 = b.cells[idx(at.x, at.y)]!;
  const g2 = b.cells[idx(from.x, from.y)]!;
  const kinds = [g1.special!, g2.special!].sort().join("+");
  const seed = emptySeed();
  seed.spent.push(g1.id, g2.id);
  seed.clear.push(idx(at.x, at.y), idx(from.x, from.y));
  const lines = isLine(g1.special) && isLine(g2.special);
  const prism = g1.special === "prism" ? g1 : g2.special === "prism" ? g2 : null;
  if (g1.special === "prism" && g2.special === "prism") {
    seed.blasts.push({ kind: "wipe", ...at });
  } else if (prism) {
    const partner = prism === g1 ? g2 : g1;
    const color = partner.color;
    const targets = colorTargets(b, color);
    seed.blasts.push({ kind: "prism", ...at, color, targets });
    for (const t of targets) {
      const i = idx(t.x, t.y);
      const g = b.cells[i]!;
      if (g.special) continue;
      const special: Special =
        partner.special === "bomb" ? "bomb" : next(b.rng) < 0.5 ? "row" : "col";
      const gem = newGem(b, color, special);
      b.cells[i] = gem;
      seed.converted.push({ ...t, gem });
    }
  } else if (lines) {
    seed.blasts.push(
      { kind: "row", ...at, width: 1 },
      { kind: "col", ...at, width: 1 },
    );
  } else if (g1.special === "bomb" && g2.special === "bomb") {
    seed.blasts.push({ kind: "bomb", ...at, radius: 2 });
  } else {
    seed.blasts.push(
      { kind: "row", ...at, width: 3 },
      { kind: "col", ...at, width: 3 },
    );
  }
  return settle(b, seed, kinds);
}

/**
 * The end-of-level surge: `count` random gems become line blasters and every
 * special on the board goes off, then the cascades play out.
 */
export function surge(b: Board, count: number): MoveResult {
  const seed = emptySeed();
  const plain = shuffleInPlace(
    b.rng,
    b.cells.map((_, i) => i).filter((i) => !b.cells[i]!.special),
  );
  for (const i of plain.slice(0, count)) {
    const g = b.cells[i]!;
    const gem = newGem(b, g.color, next(b.rng) < 0.5 ? "row" : "col");
    b.cells[i] = gem;
    seed.converted.push({ ...pos(i), gem });
  }
  b.cells.forEach((g, i) => g?.special && seed.clear.push(i));
  return settle(b, seed.clear.length ? seed : null, null);
}

/** A Supernova: the whole board goes off at once, then the cascades play out. */
export function supernova(b: Board): MoveResult {
  const seed = emptySeed();
  seed.blasts.push({ kind: "wipe", x: SIZE / 2 - 1, y: SIZE / 2 - 1 });
  return settle(b, seed, null);
}

/** Rearranges the gems so there is no match and at least one swap. */
export function shuffle(b: Board) {
  const gems = b.cells.filter((g): g is Gem => !!g);
  for (let tries = 0; tries < 200; tries++) {
    shuffleInPlace(b.rng, gems);
    b.cells = [...gems];
    if (!findGroups(b.cells).length && findHint(b)) return;
  }
  // Very unlikely: recolour from scratch, keeping ids.
  const fresh = createBoard(b.rng.seed, b.colors, b.ice);
  b.cells = fresh.cells.map((g, i) => ({ ...g!, id: gems[i]?.id ?? b.nextId++ }));
  b.rng = fresh.rng;
}

/** The ids of the gems at each cell, for the scene. */
export const ids = (cells: (Gem | null)[]) => cells.map((g) => g?.id ?? 0);
