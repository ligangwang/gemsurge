// One play of a level: the board, moves left, goals, score, stars and Fever.
import {
  MAX_COLORS,
  SIZE,
  createBoard,
  placeSpecials,
  surge,
  swap,
  type Board,
  type MoveResult,
  type Pos,
  type Special,
} from "./board";

export type Goal =
  | { kind: "score"; target: number }
  | { kind: "color"; color: number; target: number }
  | { kind: "ice" };

export type LevelSpec = {
  /** 1-based level number, or 0 for the daily board. */
  level: number;
  /** Index into the worlds (themes). */
  world: number;
  moves: number;
  colors: number;
  goals: Goal[];
  /** Ice layers per cell, SIZE × SIZE, row by row. */
  ice: number[];
  /** Scores for 1, 2 and 3 stars. Meeting the goals always gives 1. */
  stars: [number, number, number];
  seed: number;
  /** Play every move even after the goals are met (the daily board). */
  allMoves?: boolean;
};

/** What the player's upgrades add to every level. */
export type Boosts = { moves: number; specials: Special[]; fever: number };
export const NO_BOOSTS: Boosts = { moves: 0, specials: [], fever: 1 };

/** Fever lasts this many moves and doubles their score. */
export const FEVER_MOVES = 3;
/** The most moves the end-of-level surge turns into blasters. */
export const SURGE_MAX = 12;

export type Turn = MoveResult & {
  /** The move's score after Fever. */
  points: number;
  /** This move was played in Fever. */
  inFever: boolean;
  /** This move filled the meter and started Fever. */
  feverStarted: boolean;
};

export type GoalProgress = { goal: Goal; have: number; target: number; done: boolean };

export class Session {
  board: Board;
  movesLeft: number;
  score = 0;
  collected = new Array(MAX_COLORS).fill(0);
  iceTotal: number;
  iceLeft: number;
  /** Fever meter, 0 to 1. */
  meter = 0;
  feverMoves = 0;
  bestChain = 0;
  specialsMade = 0;
  combos: string[] = [];
  prismsFired = 0;
  fevers = 0;
  movesMade = 0;
  finished = false;

  constructor(
    readonly spec: LevelSpec,
    readonly boosts: Boosts = NO_BOOSTS,
  ) {
    this.board = createBoard(spec.seed, spec.colors, spec.ice);
    placeSpecials(this.board, boosts.specials);
    this.movesLeft = spec.moves + boosts.moves;
    this.iceTotal = this.iceLeft = spec.ice.reduce((a, b) => a + b, 0);
  }

  get fever() {
    return this.feverMoves > 0;
  }

  progress(): GoalProgress[] {
    return this.spec.goals.map((goal) => {
      const [have, target] =
        goal.kind === "score"
          ? [this.score, goal.target]
          : goal.kind === "color"
            ? [this.collected[goal.color], goal.target]
            : [this.iceTotal - this.iceLeft, this.iceTotal];
      return { goal, have: Math.min(have, target), target, done: have >= target };
    });
  }

  get goalsMet() {
    return this.progress().every((g) => g.done);
  }

  /** "won" or "lost" once the level is over, else null. */
  get outcome(): "won" | "lost" | null {
    if (this.spec.allMoves) {
      if (this.movesLeft > 0) return null;
      return this.goalsMet ? "won" : "lost";
    }
    if (this.goalsMet) return "won";
    return this.movesLeft > 0 ? null : "lost";
  }

  /** Swaps two gems; null when the swap does nothing or the level is over. */
  move(a: Pos, b: Pos): Turn | null {
    if (this.outcome) return null;
    const result = swap(this.board, a, b);
    if (!result) return null;
    this.movesLeft--;
    this.movesMade++;
    const inFever = this.fever;
    if (inFever) this.feverMoves--;
    const points = result.score * (inFever ? 2 : 1);
    this.record(result, points);
    let feverStarted = false;
    if (!inFever) {
      this.meter = Math.min(1, this.meter + feverGain(result) * this.boosts.fever);
      if (this.meter >= 1) {
        this.meter = 0;
        this.feverMoves = FEVER_MOVES;
        this.fevers++;
        feverStarted = true;
      }
    }
    return { ...result, points, inFever, feverStarted };
  }

  /** The end-of-level surge for a win with moves left; null if there is nothing to do. */
  finish(): Turn | null {
    if (this.finished || this.outcome !== "won") return null;
    this.finished = true;
    const count = Math.min(this.movesLeft, SURGE_MAX);
    const hasSpecial = this.board.cells.some((g) => g?.special);
    if (!count && !hasSpecial) return null;
    const result = surge(this.board, count);
    this.movesLeft = 0;
    this.record(result, result.score);
    return { ...result, points: result.score, inFever: false, feverStarted: false };
  }

  private record(result: MoveResult, points: number) {
    this.score += points;
    result.collected.forEach((n, c) => (this.collected[c] += n));
    this.iceLeft = this.board.ice.reduce((a, b) => a + b, 0);
    this.bestChain = Math.max(this.bestChain, result.chain);
    this.specialsMade += result.specialsMade;
    if (result.combo) this.combos.push(result.combo);
    for (const s of result.steps)
      for (const blast of s.blasts) if (blast.kind === "prism") this.prismsFired++;
  }

  /** Stars for the play so far: 0 until the goals are met. */
  get stars() {
    if (!this.goalsMet) return 0;
    const [, two, three] = this.spec.stars;
    return this.score >= three ? 3 : this.score >= two ? 2 : 1;
  }
}

/** How much a move fills the Fever meter. */
export function feverGain(r: MoveResult) {
  return (
    Math.max(0, r.chain - 1) * 0.08 +
    r.specialsMade * 0.1 +
    r.blasts * 0.06 +
    (r.combo ? 0.3 : 0)
  );
}

export const cellCount = SIZE * SIZE;
