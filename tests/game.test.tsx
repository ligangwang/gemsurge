import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Challenge, DingnGame, Locale, ShopItem } from "../sdk/dingn-sdk.js";
import { GemGame } from "../src/game";
import { DingnProvider } from "../src/dingn";
import { empty, type Saved } from "../src/save";
import { findHint, type Pos } from "../src/engine/board";
import { shopManifest } from "../src/upgrades";

// A stand-in for the three.js scene: every animation finishes at once.
const mocks = vi.hoisted(() => ({
  scene: null as null | { onSwap: (a: Pos, b: Pos) => void; boards: number },
}));
vi.mock("../src/gem-scene", () => ({
  GEM_CSS: ["#f00", "#fa0", "#0f0", "#00f", "#a0f", "#fff"],
  STONE_CSS: ["#f00", "#fa0", "#0f0", "#00f", "#a0f", "#fff"],
  GEM_OUTLINES: new Array(6).fill("M0 0Z"),
  CHEERS: new Set(),
  GemScene: class {
    boards = 0;
    onSwap: (a: Pos, b: Pos) => void;
    constructor(_host: HTMLElement, options: { onSwap: (a: Pos, b: Pos) => void }) {
      this.onSwap = options.onSwap;
      mocks.scene = this;
    }
    setBoard() {
      this.boards++;
    }
    setInput() {}
    showHint() {}
    setFever() {}
    banner() {}
    setBannerTranslator() {}
    setBannerListener() {}
    async playInvalid() {}
    async playTurn() {}
    async celebrate() {}
    dispose() {}
  },
}));

let sdk: DingnGame;
const calls = { save: vi.fn(), earn: vi.fn(), unlock: vi.fn(), spend: vi.fn(), link: vi.fn(), result: vi.fn(), ended: vi.fn() };
let owned: string[] = [];
let stored: Map<string, unknown>;
let account: unknown = null;
let setPlayer: (p: DingnGame["player"]) => void = () => {};
function fakeSdk(signedIn: boolean, locale: Locale = "en", challenge: Challenge | null = null) {
  stored = new Map<string, unknown>();
  account = null;
  owned = [];
  calls.save.mockReset().mockResolvedValue(undefined);
  calls.earn.mockReset().mockImplementation(async (coins: number) => ({ coins, left: 100 }));
  calls.unlock.mockReset().mockResolvedValue({ new: true, coins: 10 });
  calls.spend.mockReset().mockImplementation(async (id: string) => {
    owned.push(id);
    return { new: true, coins: 60 };
  });
  calls.link.mockReset().mockResolvedValue("https://dingn.com/c/abc");
  calls.result.mockReset().mockImplementation(async (score: number) => ({
    beat: score > (challenge?.score ?? 0),
    posted: signedIn,
    best: score,
    rank: 2,
    players: 5,
  }));
  calls.ended.mockReset();
  sdk = {
    gameId: "gemsurge",
    version: "1.0.0",
    locale,
    player: { signedIn, name: signedIn ? "Ada" : "", avatar: "" },
    embedded: true,
    onPlayer: (listener) => {
      setPlayer = listener;
      return () => {};
    },
    storage: {
      get: async (key) => (stored.get(key) ?? null) as never,
      set: async (key, value) => void stored.set(key, value),
    },
    progress: { load: async () => account as never, save: calls.save },
    rewards: {
      unlock: calls.unlock,
      list: async () => [],
      spend: calls.spend,
      shop: async () =>
        shopManifest().map(
          (i): ShopItem => ({ id: i.id, price: i.price, title: i.title.en, owned: owned.includes(i.id) }),
        ),
      earn: calls.earn,
    },
    requestSignIn: () => {},
    navigate: () => {},
    ready() {},
    onLanguage: () => () => {},
    challenge,
    challengeLink: calls.link,
    challengeResult: calls.result,
    roundEnded: calls.ended,
  };
}
const play = (saved: Saved = empty()) =>
  render(
    <DingnProvider sdk={sdk}>
      <GemGame initial={saved} prefs={{ muted: true }} />
    </DingnProvider>,
  );
type Hook = { session: { current: import("../src/engine/session").Session | null } };
const session = () => (window as unknown as { gemsurge: Hook }).gemsurge.session.current!;

/** Plays the hinted swap until the level ends. */
async function playOut() {
  for (let n = 0; n < 60 && !session().outcome; n++) {
    const [a, b] = findHint(session().board)!;
    await act(async () => mocks.scene!.onSwap(a, b));
  }
}

beforeEach(() => fakeSdk(true));
afterEach(() => cleanup());

test("the menu opens levels up to the next one", () => {
  const saved = empty();
  saved.stars[0] = 3;
  saved.stars[1] = 1;
  play(saved);
  expect(screen.getByRole("heading", { name: /Gem Surge/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play level 3" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Level 3" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Level 4" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a level plays to the end, saves and pays coins for a win", async () => {
  play();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(screen.getByRole("heading", { name: "Level 1" })).toBeTruthy();
  expect(screen.getByText("26")).toBeTruthy();
  await playOut();
  const s = session();
  if (s.outcome === "won") {
    expect(await screen.findByText("Level complete!")).toBeTruthy();
    expect(calls.earn).toHaveBeenCalledWith(2 + s.stars * 2);
    // Chain reactions are paid on top, in a call of their own.
    if (s.chainCoins) expect(calls.earn).toHaveBeenCalledWith(s.chainCoins);
    expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({ stars: String(s.stars) }));
    expect(screen.getByRole("button", { name: "Next level" })).toBeTruthy();
  } else {
    expect(await screen.findAllByText("Out of moves")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  }
  expect(s.movesMade).toBeGreaterThan(0);
});

test("the daily board pays once a day", async () => {
  play();
  fireEvent.click(screen.getByRole("button", { name: "Daily board" }));
  await playOut();
  expect(session().movesLeft).toBe(0);
  if (session().outcome === "won") {
    await screen.findByText("Board complete!");
    expect(calls.earn).toHaveBeenCalledWith(10);
    calls.earn.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await playOut();
    await screen.findByText("Today's daily coins are already paid.");
    expect(calls.earn).not.toHaveBeenCalled();
  }
});

test("upgrades are bought with coins and start the next level", async () => {
  play();
  fireEvent.click(screen.getByRole("button", { name: "Upgrades" }));
  const buttons = await screen.findAllByRole("button", { name: /60/ });
  await act(async () => fireEvent.click(buttons[0]));
  expect(calls.spend).toHaveBeenCalledWith("moves-1");
  expect(await screen.findByText("Upgrade bought! It works from your next level.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(session().movesLeft).toBe(27);
});

test("signed-out players are asked to sign in to buy", async () => {
  fakeSdk(false);
  play();
  fireEvent.click(screen.getByRole("button", { name: "Upgrades" }));
  expect(screen.getByRole("button", { name: "Sign in to buy upgrades" })).toBeTruthy();
});

test("signing in brings back the account's levels", async () => {
  fakeSdk(false);
  play();
  expect((screen.getByRole("button", { name: "Level 3" }) as HTMLButtonElement).disabled).toBe(true);
  const saved = empty();
  saved.stars[0] = saved.stars[1] = 2;
  account = saved;
  sdk.player = { signedIn: true, name: "Ada", avatar: "" };
  await act(async () => setPlayer(sdk.player));
  await vi.waitFor(() =>
    expect((screen.getByRole("button", { name: "Level 3" }) as HTMLButtonElement).disabled).toBe(false),
  );
});

test("a signed-out daily win leaves today's coins to claim", async () => {
  fakeSdk(false);
  play();
  fireEvent.click(screen.getByRole("button", { name: "Daily board" }));
  await playOut();
  if (session().outcome === "won") {
    await screen.findByText("Board complete!");
    expect(stored.get("gemsurge")).toMatchObject({ daily: { paid: false } });
    expect(calls.earn).not.toHaveBeenCalled();
  }
});

test("speaks Chinese", () => {
  fakeSdk(false, "zh-CN");
  play();
  expect(screen.getByRole("button", { name: "开始" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "每日棋盘" })).toBeTruthy();
  expect(screen.getByText(/霓虹都市/)).toBeTruthy();
  expect(screen.getByText("登录以赚取金币和徽章")).toBeTruthy();
});

test("a charged Supernova clears the board without using a move", async () => {
  const saved = { ...empty(), earned: 130 };
  play(saved);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const nova = screen.getByRole("button", { name: /Supernova ×1/ }) as HTMLButtonElement;
  expect(nova.disabled).toBe(false);
  const moves = session().movesLeft;
  await act(async () => fireEvent.click(nova));
  expect(session().novas).toBe(1);
  expect(session().score).toBeGreaterThan(0);
  expect(session().outcome === "won" || session().movesLeft === moves).toBe(true);
  expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({ novasUsed: 1 }));
  if (!session().outcome)
    expect((screen.getByRole("button", { name: /Supernova ×0/ }) as HTMLButtonElement).disabled).toBe(true);
});

test("finishing a round's last level holds the ceremony: a new title, a reward and a draw", async () => {
  const saved = { ...empty(), earned: 5000 };
  for (let i = 0; i < 9; i++) saved.stars[i] = 1;
  play(saved);
  // The menu shows the title held and what the round pays.
  expect(screen.getByText(/Novice Traveller/)).toBeTruthy();
  expect(screen.getByText(/Round 1 · 9 \/ 10/)).toBeTruthy();
  expect(screen.getAllByText(/Pebble Picker/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Play level 10" }));
  for (let n = 0; n < 40 && !session().outcome; n++)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Supernova ×/ })));
  expect(session().outcome).toBe("won");
  expect(await screen.findByRole("heading", { name: "Round 1 complete!" })).toBeTruthy();
  expect(screen.getByText("New title")).toBeTruthy();
  expect(screen.getAllByText(/Pebble Picker/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Lucky draw/)).toBeTruthy();
  // The draw is the player's to spin, and the round goes on once it lands.
  expect(screen.queryByRole("button", { name: "Start round 2" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));
  expect(await screen.findByRole("button", { name: "Start round 2" }, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/You won.*Supernova ×\d/);
  const last = calls.save.mock.calls.at(-1)![0] as { novasWon: number };
  expect(last.novasWon).toBeGreaterThanOrEqual(2);
  // The level's own coins, then 10 more for the round.
  expect(calls.earn).toHaveBeenLastCalledWith(10);
  expect(calls.earn.mock.calls.length).toBeGreaterThanOrEqual(2);
}, 20000);

test("undo takes the last move back, three times a level", async () => {
  play();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const undo = () => screen.getByRole("button", { name: /Undo ×/ }) as HTMLButtonElement;
  expect(undo().disabled).toBe(true);
  const moves = session().movesLeft;
  const cells = JSON.stringify(session().board.cells);
  const [a, b] = findHint(session().board)!;
  await act(async () => mocks.scene!.onSwap(a, b));
  expect(session().movesLeft).toBe(moves - 1);
  expect(undo().textContent).toContain("×3");
  await act(async () => fireEvent.click(undo()));
  expect(session().movesLeft).toBe(moves);
  expect(JSON.stringify(session().board.cells)).toBe(cells);
  expect(undo().textContent).toContain("×2");
  expect(undo().disabled).toBe(true);
});

test("a finished daily board makes a challenge link to share", async () => {
  const copied = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: copied }, configurable: true });
  play();
  fireEvent.click(screen.getByRole("button", { name: /Daily board/ }));
  await playOut();
  const s = session();
  expect(calls.ended).toHaveBeenCalledTimes(1);
  // Not opened from a challenge: there is no result to report.
  expect(calls.result).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Challenge a friend" })));
  expect(calls.link).toHaveBeenCalledWith({
    mode: "daily",
    seed: new Date().toISOString().slice(0, 10),
    score: s.score,
    unit: "points",
  });
  expect(copied).toHaveBeenCalledWith("https://dingn.com/c/abc");
  expect((screen.getByLabelText("Challenge link") as HTMLInputElement).value).toBe("https://dingn.com/c/abc");
  expect(screen.getByText("Link copied! Send it to a friend.")).toBeTruthy();
});

test("a level's challenge carries the upgrades it was played with", async () => {
  owned = ["moves-1", "moves-2", "bomb-1"];
  play();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await playOut();
  await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Challenge a friend" })));
  expect(calls.link).toHaveBeenCalledWith({
    mode: "level",
    seed: "1",
    score: session().score,
    unit: "points",
    rules: "moves2.bomb1",
  });
});

test("a friend's challenge opens its level with their upgrades and reports the score", async () => {
  fakeSdk(true, "en", { mode: "level", seed: "40", score: 1, unit: "points", rules: "moves3.prism1" });
  play();
  // Level 40 is far beyond this player's levels, and is played all the same.
  expect(screen.getByRole("heading", { name: "Level 40" })).toBeTruthy();
  expect(screen.getByText("Score to beat: 1")).toBeTruthy();
  const s = session();
  expect(s.boosts.moves).toBe(3);
  expect(s.boosts.specials).toEqual(["prism"]);
  expect(screen.queryByRole("button", { name: /Supernova/ })).toBeNull();
  await playOut();
  await screen.findByText("Challenge beaten! The score to beat was 1.");
  expect(calls.result).toHaveBeenCalledWith(s.score);
  expect(screen.getByText("Place 2 of 5")).toBeTruthy();
  // The friend's upgrades are not the player's: nothing is paid or saved.
  expect(calls.earn).not.toHaveBeenCalled();
  expect(calls.unlock).not.toHaveBeenCalled();
  expect(stored.get("gemsurge")).toMatchObject({ stars: "", earned: 0 });
  expect(screen.queryByRole("button", { name: "Next level" })).toBeNull();
  // Trying again is still the challenge.
  fireEvent.click(screen.getByRole("button", { name: /Play again|Try again/ }));
  expect(screen.getByText("Score to beat: 1")).toBeTruthy();
  // From the menu, a level of the player's own is no challenge.
  fireEvent.click(screen.getAllByRole("button", { name: "Menu" })[0]);
  expect(screen.getByRole("button", { name: "Challenge: beat 1" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await playOut();
  await waitFor(() => expect(calls.ended).toHaveBeenCalledTimes(2));
  expect(calls.result).toHaveBeenCalledTimes(1);
});

test("a challenge on today's daily board is the daily board: it pays and reports", async () => {
  const today = new Date().toISOString().slice(0, 10);
  fakeSdk(true, "en", { mode: "daily", seed: today, score: 1e9, unit: "points", mine: true });
  play();
  expect(screen.getByRole("heading", { name: today })).toBeTruthy();
  await playOut();
  expect(await screen.findAllByText("Score to beat: 1,000,000,000")).toHaveLength(2);
  expect(calls.result).toHaveBeenCalledWith(session().score);
  expect(stored.get("gemsurge")).toMatchObject({ daily: { day: today } });
});

test("a challenge this version can't play opens the menu", () => {
  fakeSdk(true, "en", { mode: "level", seed: "40", score: 5, unit: "points", rules: "wings9" });
  play();
  expect(screen.getByRole("heading", { name: /Gem Surge/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Challenge: beat/ })).toBeNull();
});
