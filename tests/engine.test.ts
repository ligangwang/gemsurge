import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIZE,
  canSwap,
  createBoard,
  findGroups,
  findHint,
  idx,
  surge,
  swap,
  type Board,
  type Gem,
  type Special,
} from "../src/engine/board";
import { Session, type LevelSpec } from "../src/engine/session";
import { below } from "../src/engine/random";

/** A board from 8 rows of letters a-f, one per colour. Specials go in with `put`. */
function board(rows: string[], seed = 1): Board {
  let id = 1;
  const cells: (Gem | null)[] = rows
    .join("")
    .split("")
    .map((ch) => ({ id: id++, color: ch.charCodeAt(0) - 97 }));
  assert.equal(cells.length, SIZE * SIZE);
  return { cells, ice: new Array(SIZE * SIZE).fill(0), colors: 6, rng: { seed }, nextId: id };
}
function put(b: Board, x: number, y: number, special: Special, color = b.cells[idx(x, y)]!.color) {
  b.cells[idx(x, y)] = { id: b.nextId++, color: special === "prism" ? -1 : color, special };
}
// A board with no matches: colours cycle so no three line up.
const BASE = [
  "abcdefab",
  "cdefabcd",
  "efabcdef",
  "abcdefab",
  "cdefabcd",
  "efabcdef",
  "abcdefab",
  "cdefabcd",
];
const settled = (b: Board) => {
  assert.equal(findGroups(b.cells).length, 0, "no matches left");
  assert.ok(b.cells.every((g) => g), "every cell has a gem");
  const ids = b.cells.map((g) => g!.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
};

test("a new board has no matches, has a swap, and is the same for a seed", () => {
  for (let seed = 1; seed < 40; seed++) {
    const b = createBoard(seed, 5);
    settled(b);
    assert.ok(findHint(b));
  }
  assert.deepEqual(createBoard(7, 6).cells, createBoard(7, 6).cells);
  assert.notDeepEqual(createBoard(7, 6).cells, createBoard(8, 6).cells);
});

test("a swap that lines nothing up does nothing", () => {
  const b = board(BASE);
  const before = JSON.stringify(b);
  assert.equal(canSwap(b, { x: 0, y: 0 }, { x: 2, y: 0 }), false);
  assert.equal(swap(b, { x: 0, y: 0 }, { x: 1, y: 0 }), null);
  assert.equal(JSON.stringify(b), before);
});

test("three in a row clear, gems fall and new ones drop in", () => {
  const b = board(BASE);
  b.cells[idx(0, 7)] = { id: 900, color: 0 };
  b.cells[idx(1, 7)] = { id: 901, color: 0 };
  b.cells[idx(2, 6)] = { id: 902, color: 0 };
  b.cells[idx(2, 7)] = { id: 903, color: 4 };
  const r = swap(b, { x: 2, y: 6 }, { x: 2, y: 7 })!;
  assert.ok(r);
  assert.deepEqual(
    r.steps[0].cleared.map((c) => c.id).sort(),
    [900, 901, 902],
  );
  assert.equal(r.collected[0] >= 3, true);
  settled(b);
  assert.equal(r.steps[0].spawned.length >= 3, true);
});

test("four in a row makes a line blaster where the gem was moved", () => {
  const b = board(BASE);
  for (const x of [0, 1, 3]) b.cells[idx(x, 7)] = { id: 800 + x, color: 4 };
  b.cells[idx(2, 6)] = { id: 850, color: 4 };
  b.cells[idx(2, 7)] = { id: 851, color: 1 };
  const r = swap(b, { x: 2, y: 6 }, { x: 2, y: 7 })!;
  const made = r.steps[0].created;
  assert.equal(made.length, 1);
  assert.equal(made[0].gem.special, "col");
  assert.deepEqual([made[0].x, made[0].y], [2, 7]);
  assert.equal(made[0].from.length, 3);
  assert.equal(r.specialsMade >= 1, true);
});

test("an L shape makes a bomb and five in a row makes a prism", () => {
  // An L: a column of two and a row of two meet at (2,7) once an "a" moves in.
  const B = board(BASE);
  for (const [x, y] of [[2, 5], [2, 6], [0, 7], [1, 7]]) B.cells[idx(x, y)] = { id: 500 + x * 10 + y, color: 0 };
  B.cells[idx(2, 7)] = { id: 590, color: 5 };
  B.cells[idx(3, 7)] = { id: 591, color: 0 };
  const rb = swap(B, { x: 3, y: 7 }, { x: 2, y: 7 })!;
  assert.ok(rb);
  assert.equal(rb.steps[0].created[0].gem.special, "bomb");
  assert.deepEqual([rb.steps[0].created[0].x, rb.steps[0].created[0].y], [2, 7]);

  const P = board(BASE);
  for (const x of [0, 1, 3, 4]) P.cells[idx(x, 7)] = { id: 400 + x, color: 2 };
  P.cells[idx(2, 6)] = { id: 450, color: 2 };
  P.cells[idx(2, 7)] = { id: 451, color: 5 };
  const rp = swap(P, { x: 2, y: 6 }, { x: 2, y: 7 })!;
  assert.equal(rp.steps[0].created[0].gem.special, "prism");
  assert.equal(rp.steps[0].created[0].gem.color, -1);
});

test("a prism swapped with a gem clears every gem of its colour", () => {
  const b = board(BASE);
  put(b, 3, 3, "prism");
  const color = b.cells[idx(4, 3)]!.color;
  const count = b.cells.filter((g) => g!.color === color).length;
  const r = swap(b, { x: 3, y: 3 }, { x: 4, y: 3 })!;
  const step = r.steps[0];
  assert.equal(step.blasts[0].kind, "prism");
  assert.equal(step.cleared.filter((c) => c.color === color).length, count);
  settled(b);
});

test("a line blaster caught in a match clears its row", () => {
  const b = board(BASE);
  b.cells[idx(0, 4)] = { id: 300, color: 0 };
  b.cells[idx(1, 4)] = { id: 301, color: 0, special: "row" };
  b.cells[idx(2, 3)] = { id: 302, color: 0 };
  const r = swap(b, { x: 2, y: 3 }, { x: 2, y: 4 })!;
  const rows = r.steps[0].cleared.filter((c) => c.y === 4);
  assert.equal(rows.length, SIZE);
  assert.ok(r.steps[0].blasts.some((bl) => bl.kind === "row" && bl.y === 4));
});

test("two specials combine", () => {
  const lines = board(BASE);
  put(lines, 3, 3, "row");
  put(lines, 4, 3, "col");
  const r1 = swap(lines, { x: 3, y: 3 }, { x: 4, y: 3 })!;
  assert.equal(r1.combo, "col+row");
  assert.equal(r1.steps[0].cleared.length, SIZE * 2 - 1);

  const bombs = board(BASE);
  put(bombs, 3, 3, "bomb");
  put(bombs, 3, 4, "bomb");
  const r2 = swap(bombs, { x: 3, y: 3 }, { x: 3, y: 4 })!;
  assert.deepEqual(r2.steps[0].blasts[0], { kind: "bomb", x: 3, y: 4, radius: 2 });
  assert.equal(r2.steps[0].cleared.length, 25);

  const mixed = board(BASE);
  put(mixed, 3, 3, "row");
  put(mixed, 3, 4, "bomb");
  const r3 = swap(mixed, { x: 3, y: 3 }, { x: 3, y: 4 })!;
  assert.equal(r3.steps[0].cleared.length, SIZE * 6 - 9);

  const prisms = board(BASE);
  put(prisms, 3, 3, "prism");
  put(prisms, 4, 3, "prism");
  const r4 = swap(prisms, { x: 3, y: 3 }, { x: 4, y: 3 })!;
  assert.equal(r4.combo, "prism+prism");
  assert.equal(r4.steps[0].cleared.length, SIZE * SIZE);
  settled(prisms);

  const pb = board(BASE);
  put(pb, 3, 3, "prism");
  put(pb, 4, 3, "bomb");
  const color = pb.cells[idx(4, 3)]!.color;
  const r5 = swap(pb, { x: 3, y: 3 }, { x: 4, y: 3 })!;
  assert.ok(r5.steps[0].converted.length > 0);
  assert.ok(r5.steps[0].converted.every((c) => c.gem.special === "bomb" && c.gem.color === color));
  settled(pb);
});

test("clearing a gem on ice cracks a layer", () => {
  const b = board(BASE);
  b.cells[idx(0, 7)] = { id: 900, color: 0 };
  b.cells[idx(1, 7)] = { id: 901, color: 0 };
  b.cells[idx(2, 6)] = { id: 902, color: 0 };
  b.cells[idx(2, 7)] = { id: 903, color: 4 };
  b.ice[idx(0, 7)] = 2;
  const r = swap(b, { x: 2, y: 6 }, { x: 2, y: 7 })!;
  assert.equal(b.ice[idx(0, 7)], 1);
  assert.equal(r.iceBroken >= 1, true);
});

test("the surge turns moves into blasters and settles the board", () => {
  const b = createBoard(3, 5);
  const r = surge(b, 5);
  assert.equal(r.steps[0].converted.length, 5);
  assert.ok(r.steps[0].blasts.length >= 5);
  settled(b);
});

test("hundreds of random moves always leave a full, settled board with a swap", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const b = createBoard(seed * 77, 4 + (seed % 3));
    const pick = { seed };
    for (let n = 0; n < 60; n++) {
      const moves: [{ x: number; y: number }, { x: number; y: number }][] = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        const a = { x: i % SIZE, y: Math.floor(i / SIZE) };
        for (const c of [{ x: a.x + 1, y: a.y }, { x: a.x, y: a.y + 1 }])
          if (canSwap(b, a, c)) moves.push([a, c]);
      }
      assert.ok(moves.length, "a swap is left");
      const [a, c] = moves[below(pick, moves.length)];
      const r = swap(b, a, c)!;
      assert.ok(r);
      for (const step of r.steps) assert.equal(step.cells.length, SIZE * SIZE);
      settled(b);
    }
  }
});

test("a session counts moves and goals and ends", () => {
  const spec: LevelSpec = {
    level: 1,
    world: 0,
    moves: 3,
    colors: 5,
    goals: [{ kind: "score", target: 1e9 }],
    ice: new Array(SIZE * SIZE).fill(0),
    stars: [1e9, 2e9, 3e9],
    seed: 5,
  };
  const s = new Session(spec, { moves: 2, specials: ["bomb", "row"], fever: 1 });
  assert.equal(s.movesLeft, 5);
  assert.equal(s.board.cells.filter((g) => g!.special).length, 2);
  while (!s.outcome) {
    const h = findHint(s.board)!;
    assert.ok(s.move(h[0], h[1]));
  }
  assert.equal(s.outcome, "lost");
  assert.equal(s.stars, 0);
  assert.equal(s.move({ x: 0, y: 0 }, { x: 1, y: 0 }), null);

  const easy = new Session({ ...spec, goals: [{ kind: "score", target: 10 }], stars: [10, 20, 30] });
  const h = findHint(easy.board)!;
  const turn = easy.move(h[0], h[1])!;
  assert.equal(easy.outcome, "won");
  assert.equal(turn.points, turn.score);
  const before = easy.score;
  const fin = easy.finish()!;
  assert.ok(fin.steps.length > 0);
  assert.equal(easy.score, before + fin.points);
  assert.equal(easy.stars, 3);
  assert.equal(easy.finish(), null);
});

test("Fever doubles points for three moves", () => {
  const s = new Session({
    level: 1,
    world: 0,
    moves: 50,
    colors: 4,
    goals: [{ kind: "score", target: 1e9 }],
    ice: new Array(SIZE * SIZE).fill(0),
    stars: [1e9, 2e9, 3e9],
    seed: 11,
  });
  let started = false;
  for (let n = 0; n < 50 && !started; n++) {
    const h = findHint(s.board)!;
    started = s.move(h[0], h[1])!.feverStarted;
  }
  assert.ok(started, "Fever started");
  assert.equal(s.feverMoves, 3);
  const h = findHint(s.board)!;
  const t = s.move(h[0], h[1])!;
  assert.equal(t.inFever, true);
  assert.equal(t.points, t.score * 2);
  assert.equal(s.feverMoves, 2);
});
