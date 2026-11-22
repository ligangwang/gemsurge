// One play of a level: the board, moves left, goals, score, stars and Fever.
import {
  MAX_COLORS,
  SIZE,
  cloneBoard,
  createBoard,
  placeSpecials,
  supernova,
  surge,
  swap,
  type Board,
  type MoveResult,
  type OpeningGem,
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
  /** Which stones the colours are, when not the first `colors` (see Board). */
  palette?: readonly number[];
  goals: Goal[];
  /** Ice layers per cell, SIZE × SIZE, row by row. */
  ice: number[];
  /** Ice forms opaque covers that crack from adjacent matches and blasts. */
  iceCover?: boolean;
  /** The board's shape: 1 for a hole, SIZE × SIZE. Missing is a full square. */
  holes?: number[];
  /** A hand-placed opening, row by row, with nulls for holes. */
  opening?: readonly (OpeningGem | null)[];
  /** Scores for 1, 2 and 3 stars. Meeting the goals always gives 1. */
  stars: [number, number, number];
  seed: number;
  /** Play every move even after the goals are met (the daily board). */
  allMoves?: boolean;
};

/** What the player's upgrades add to every level. */
export type Boosts = { moves: number; specials: Special[]; fever: number; undos?: number };
export const NO_BOOSTS: Boosts = { moves: 0, specials: [], fever: 1 };

/** Fever lasts this many moves and doubles their score. */
export const FEVER_MOVES = 3;
/** How many moves a play can take back. */
/** Coins a chain reaction of this many clears in a row is worth: 2 is the first cascade. */
export const chainCoinsFor = (chain: number) => (chain < 2 ? 0 : chain >= 5 ? 5 : chain - 1);
/** The most a play's chain reactions can pay, which is also the most dingn pays in one go. */
export const CHAIN_COIN_CAP = 10;
export const UNDOS = 3;
/** Up to this level every play has all its undos; after it they are an upgrade. */
export const FREE_UNDO_LEVELS = 100;
/** The undos a play of `level` starts with, given the undo upgrade's tier. */
export const undosFor = (level: number, owned: number) => (level <= FREE_UNDO_LEVELS ? UNDOS : Math.min(UNDOS, owned));
/** A Supernova's clear scores this many times over. */
export const NOVA_SCORE = 3;
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
  /** Coins this play's chain reactions have earned, paid when the level ends. */
  chainCoins = 0;
  specialsMade = 0;
  combos: string[] = [];
  prismsFired = 0;
  fevers = 0;
  movesMade = 0;
  /** Supernovas set off in this play. */
  novas = 0;
  /** Moves that can still be taken back. */
  undosLeft = UNDOS;
  /** The play as it stood before the last move, while that move can be taken back. */
  private before: Record<string, unknown> | null = null;
  finished = false;

  constructor(
    readonly spec: LevelSpec,
    readonly boosts: Boosts = NO_BOOSTS,
  ) {
    this.board = createBoard(spec.seed, spec.palette ?? spec.colors, spec.ice, spec.holes, spec.opening, spec.iceCover);
    placeSpecials(this.board, boosts.specials);
    this.movesLeft = spec.moves + boosts.moves;
    this.undosLeft = undosFor(spec.level, boosts.undos ?? 0);
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
    const before = this.snapshot();
    const result = swap(this.board, a, b);
    if (!result) return null;
    this.before = before;
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

  private snapshot(): Record<string, unknown> {
    return {
      board: cloneBoard(this.board),
      movesLeft: this.movesLeft,
      score: this.score,
      collected: [...this.collected],
      iceLeft: this.iceLeft,
      meter: this.meter,
      feverMoves: this.feverMoves,
      bestChain: this.bestChain,
      chainCoins: this.chainCoins,
      specialsMade: this.specialsMade,
      combos: [...this.combos],
      prismsFired: this.prismsFired,
      fevers: this.fevers,
      movesMade: this.movesMade,
    };
  }

  /** The last move can be taken back: not on the daily board, nor once the level is over. */
  get canUndo() {
    return !!this.before && this.undosLeft > 0 && !this.outcome && !this.spec.allMoves;
  }

  /**
   * Takes the last move back, so the player can choose again. The board's
   * dice go back too: the same swap makes the same gems fall.
   */
  undo(): boolean {
    if (!this.canUndo) return false;
    Object.assign(this, this.before);
    this.before = null;
    this.undosLeft--;
    return true;
  }

  /** Sets off a Supernova, which clears the whole board and costs no move. */
  nova(): Turn | null {
    if (this.outcome) return null;
    const result = supernova(this.board);
    // A Supernova is spent for good, so the move before it can't come back.
    this.before = null;
    this.novas++;
    const points = result.score * NOVA_SCORE;
    this.record(result, points);
    return { ...result, points, inFever: false, feverStarted: false };
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
    this.chainCoins = Math.min(CHAIN_COIN_CAP, this.chainCoins + chainCoinsFor(result.chain));
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
