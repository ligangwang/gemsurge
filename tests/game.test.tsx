import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DingnGame, Locale, ShopItem } from "../sdk/dingn-sdk.js";
import { GemGame } from "../src/game";
import { DingnProvider } from "../src/dingn";
import { empty, type Saved } from "../src/save";
import { findHint, type Pos } from "../src/engine/board";
import { shopManifest } from "../src/upgrades";

// A stand-in for the three.js scene: every animation finishes at once.
const mocks = vi.hoisted(() => ({
  scene: null as null | { onSwap: (a: Pos, b: Pos) => void; boards: number },
  /** The scene's banner translator, as the game last set it. */
  translate: (s: string) => s,
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
    setBannerTranslator(t: (s: string) => string) {
      mocks.translate = t;
    }
    setBannerListener() {}
    async playInvalid() {}
    async playTurn() {}
    async celebrate() {}
    async splash() {}
    offerSpeedUp() {}
    dispose() {}
  },
}));

let sdk: DingnGame;
const calls = { save: vi.fn(), earn: vi.fn(), unlock: vi.fn(), spend: vi.fn(), link: vi.fn(), roundEnded: vi.fn(), result: vi.fn() };
let owned: string[] = [];
let stored: Map<string, unknown>;
let account: unknown = null;
let setPlayer: (p: DingnGame["player"]) => void = () => {};
/** The game's language listeners, as dingn holds them. */
const languageListeners = new Set<(locale: Locale) => void>();
const setLanguage = (locale: Locale) => {
  for (const listener of languageListeners) listener(locale);
};
function fakeSdk(signedIn: boolean, locale: Locale = "en") {
  stored = new Map<string, unknown>();
  account = null;
  owned = [];
  calls.save.mockReset().mockResolvedValue(undefined);
  calls.earn.mockReset().mockImplementation(async (coins: number) => ({ coins, left: 100 }));
  calls.unlock.mockReset().mockResolvedValue({ new: true, coins: 10 });
  calls.link.mockReset().mockResolvedValue("https://dingn.com/play/gemsurge/?c=Xq3v9TzK1bWm");
  calls.roundEnded.mockReset();
  calls.result.mockReset().mockImplementation(async (score: number) => ({
    beat: score > (sdk.challenge?.score ?? 0),
    posted: true,
    best: score,
    rank: 2,
    players: 5,
  }));
  calls.spend.mockReset().mockImplementation(async (id: string) => {
    owned.push(id);
    return { new: true, coins: 60 };
  });
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
    onLanguage: (listener) => {
      languageListeners.add(listener);
      return () => languageListeners.delete(listener);
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
    challenge: null,
    challengeLink: calls.link,
    challengeResult: calls.result,
    roundEnded: calls.roundEnded,
    requestSignIn: () => {},
    navigate: () => {},
    ready() {},
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
  // The message follows a language switch while it is showing.
  act(() => setLanguage("es"));
  expect(screen.getByText("¡Mejora comprada! Funciona desde tu próximo nivel.")).toBeTruthy();
  act(() => setLanguage("en"));
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
  expect(screen.getByText(/水晶森林/)).toBeTruthy();
  expect(screen.getByText("登录以赚取金币和徽章")).toBeTruthy();
});

test("speaks every language dingn gives it, in its own words", () => {
  const words: Record<string, [string, string, string]> = {
    es: ["Jugar", "Tablero diario", "Bosque de Cristal"],
    "pt-BR": ["Jogar", "Tabuleiro diário", "Floresta de Cristal"],
    id: ["Main", "Papan harian", "Hutan Kristal"],
    ja: ["プレイ", "デイリーボード", "クリスタルの森"],
    ko: ["플레이", "오늘의 보드", "수정 숲"],
  };
  for (const [locale, [playWord, daily, world]] of Object.entries(words)) {
    fakeSdk(false, locale);
    play();
    expect(screen.getByRole("button", { name: playWord }), locale).toBeTruthy();
    expect(screen.getByRole("button", { name: daily }), locale).toBeTruthy();
    expect(screen.getAllByText(new RegExp(world)).length, locale).toBeGreaterThan(0);
    // Never the Chinese text (Japanese writes kanji, so look for the Chinese words).
    expect(document.body.textContent, locale).not.toMatch(locale === "ja" ? /开始|每日棋盘|水晶森林/ : /[\u4e00-\u9fff]/);
    cleanup();
  }
});

test("switching language mid-level redraws everything in it and keeps the game going", async () => {
  fakeSdk(true, "en");
  const view = play();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const [a, b] = findHint(session().board)!;
  await act(async () => mocks.scene!.onSwap(a, b));
  const before = session();
  const moves = before.movesLeft;
  const score = before.score;
  const cells = JSON.stringify(before.board.cells);
  expect(screen.getByRole("heading", { name: "Level 1" })).toBeTruthy();
  expect(mocks.translate("Surge!")).toBe("Surge!");

  act(() => setLanguage("es"));
  expect(screen.getByRole("heading", { name: "Nivel 1" })).toBeTruthy();
  expect(screen.getByText("Movimientos")).toBeTruthy();
  expect(screen.queryByText("Moves")).toBeNull();
  // The same level, mid-play: nothing restarted.
  expect(session()).toBe(before);
  expect(session().movesLeft).toBe(moves);
  expect(session().score).toBe(score);
  expect(JSON.stringify(session().board.cells)).toBe(cells);
  // The banners on the board follow the new language too.
  expect(mocks.translate("Surge!")).toBe("¡Oleada!");
  expect(mocks.translate("Level 3")).toBe("Nivel 3");
  expect(document.documentElement.lang).toBe("es");

  act(() => setLanguage("ko"));
  expect(screen.getByRole("heading", { name: "레벨 1" })).toBeTruthy();
  expect(mocks.translate("Daily board")).toBe("오늘의 보드");
  expect(session()).toBe(before);

  // And back to the menu, still in Korean.
  fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
  expect(screen.getByRole("button", { name: "레벨 2" })).toBeTruthy();

  // Leaving the game stops listening.
  expect(languageListeners.size).toBe(1);
  view.unmount();
  expect(languageListeners.size).toBe(0);
});

test("an older dingn without onLanguage still plays", () => {
  fakeSdk(false, "ja");
  delete (sdk as Partial<DingnGame>).onLanguage;
  play();
  expect(screen.getByRole("button", { name: "プレイ" })).toBeTruthy();
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
  // The draw is owed until the player spins it: only the round's own prize is paid.
  expect(screen.queryByRole("button", { name: "Start round 2" })).toBeNull();
  const before = calls.save.mock.calls.at(-1)![0] as { novasWon: number; drawsDone: number };
  expect(before.drawsDone).toBe(0);
  // Holding the button charges the spin; letting go spins the wheel.
  const spin = screen.getByRole("button", { name: "Spin the wheel" });
  fireEvent.pointerDown(spin);
  expect(await screen.findByRole("button", { name: "Let go to spin!" })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 300));
  fireEvent.pointerUp(spin);
  // The prize is paid the moment the wheel is let go, before it stops.
  await waitFor(() => expect((calls.save.mock.calls.at(-1)![0] as { drawsDone: number }).drawsDone).toBe(1));
  expect(screen.queryByRole("status")).toBeNull();
  const after = calls.save.mock.calls.at(-1)![0] as { novasWon: number; drawsDone: number };
  const won = after.novasWon - before.novasWon;
  expect([1, 2, 3, 5]).toContain(won);
  expect(await screen.findByRole("button", { name: "Start round 2" }, { timeout: 12000 })).toBeTruthy();
  // It shows the slice it came to rest on, which is what was paid.
  expect(screen.getByRole("status").textContent).toMatch(new RegExp(`You won.*Supernova ×${won}`));
  // The level's own coins, then 10 more for the round.
  expect(calls.earn).toHaveBeenLastCalledWith(10);
  expect(calls.earn.mock.calls.length).toBeGreaterThanOrEqual(2);
}, 20000);

test("a lucky draw left unspun waits on the menu", async () => {
  // Round 1 finished, but the game was closed before its wheel was spun.
  const saved = { ...empty(), earned: 100, drawsDone: 0 };
  for (let i = 0; i < 10; i++) saved.stars[i] = 1;
  play(saved);
  expect(await screen.findByText("A lucky draw is waiting for you")).toBeTruthy();
  const spin = screen.getByRole("button", { name: "Spin the wheel" });
  fireEvent.pointerDown(spin);
  await new Promise((r) => setTimeout(r, 100));
  fireEvent.pointerUp(spin);
  await waitFor(() => expect((calls.save.mock.calls.at(-1)![0] as { drawsDone: number }).drawsDone).toBe(1));
  // It stays open to show the prize, then closes for good.
  fireEvent.click(await screen.findByRole("button", { name: "Close" }, { timeout: 12000 }));
  expect(screen.queryByText("A lucky draw is waiting for you")).toBeNull();
  expect(screen.getByRole("button", { name: "Play level 11" })).toBeTruthy();
}, 20000);

test("a click alone spins the wheel too, and each waiting draw gets its own", async () => {
  // Two rounds finished with neither wheel spun.
  const saved = { ...empty(), earned: 100, drawsDone: 0 };
  for (let i = 0; i < 20; i++) saved.stars[i] = 1;
  play(saved);
  for (const spun of [1, 2]) {
    expect(await screen.findByText("A lucky draw is waiting for you")).toBeTruthy();
    // A screen reader activates the button with a click, no press or release.
    fireEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));
    await waitFor(() => expect((calls.save.mock.calls.at(-1)![0] as { drawsDone: number }).drawsDone).toBe(spun));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }, { timeout: 12000 }));
  }
  expect(screen.queryByText("A lucky draw is waiting for you")).toBeNull();
}, 30000);

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

test("after a round, a player challenges a friend to beat the score", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  play();
  fireEvent.click(screen.getByRole("button", { name: "Daily board" }));
  await playOut();
  // Each finished round is reported to dingn once.
  expect(calls.roundEnded).toHaveBeenCalledTimes(1);
  // No challenge was opened, so there is no result to report.
  expect(calls.result).not.toHaveBeenCalled();
  const score = session().score;
  const button = await screen.findByRole("button", { name: /Challenge a friend/ });
  await act(async () => fireEvent.click(button));
  const today = new Date().toISOString().slice(0, 10);
  // The daily board is played without upgrades or Supernovas, for everyone.
  expect(calls.link).toHaveBeenCalledWith({ mode: "daily", seed: today, score, unit: "points", rules: "u0-0-0-0-0-0.n0" });
  // No share sheet here, so the link is copied with a line to send.
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("https://dingn.com/play/gemsurge/?c=Xq3v9TzK1bWm"));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Can you beat my"));
  expect(await screen.findByText("Link copied. Send it to a friend!")).toBeTruthy();
});

test("a friend's challenge opens that daily board and says whether it was beaten", async () => {
  sdk.challenge = { mode: "daily", seed: "2026-11-01", score: 999999, unit: "points", rules: "u0-0-0-0-0-0.n0" };
  play();
  // Straight into the friend's board: the daily board of that day, not today's.
  expect(screen.getByRole("heading", { name: "2026-11-01" })).toBeTruthy();
  await playOut();
  expect(await screen.findByText(/Your friend scored 999,999\./)).toBeTruthy();
  // dingn is told the score, and its ranking is shown.
  expect(calls.result).toHaveBeenCalledTimes(1);
  expect(calls.result).toHaveBeenCalledWith(session().score);
  expect(screen.getByText("Place 2 of 5")).toBeTruthy();
  // An older day's board is played for the score alone: no coins or badges,
  // and it is not saved as today's (the save on sign-in has no daily board).
  expect(calls.earn).not.toHaveBeenCalled();
  expect(calls.unlock).not.toHaveBeenCalled();
  expect((stored.get("gemsurge") as { daily: unknown }).daily).toBeNull();
});

test("a friend's challenge on a level not reached yet plays it without unlocking anything", async () => {
  sdk.challenge = { mode: "level", seed: "40", score: 1, unit: "points", rules: "u0-0-0-0-0-0.n0" };
  play();
  expect(await screen.findByRole("heading", { name: "Level 40" })).toBeTruthy();
  await playOut();
  if (session().score > 1) expect(await screen.findByText("You beat your friend's 1!")).toBeTruthy();
  expect(calls.earn).not.toHaveBeenCalled();
  // Nor badges, during play or after it.
  expect(calls.unlock).not.toHaveBeenCalled();
  // No level is cleared or unlocked by it.
  expect((stored.get("gemsurge") as { stars: string }).stars).toBe("");
});

test("a challenge for another game, or a malformed one, opens the menu", () => {
  for (const challenge of [
    { mode: "ladder", seed: "2026-11-16", score: 10, unit: "digits" as const },
    // Without the rules it was played with, it can't be a fair match.
    { mode: "level", seed: "1", score: 10, unit: "points" as const },
  ]) {
    sdk.challenge = challenge;
    play();
    expect(screen.getByRole("heading", { name: /Gem Surge/ })).toBeTruthy();
    cleanup();
  }
});


test("a friend's level challenge is played with the friend's upgrades, not the player's", async () => {
  // The player owns +1 move; the friend had none.
  owned.push("moves-1");
  sdk.challenge = { mode: "level", seed: "1", score: 100, unit: "points", rules: "u0-0-0-0-0-0.n0" };
  play();
  await screen.findByRole("heading", { name: "Level 1" });
  await waitFor(() => expect(screen.getByText(/so it's a fair match/)).toBeTruthy());
  // Level 1 has 26 moves, and no Supernova to set off.
  expect(session().movesLeft).toBe(26);
  expect((screen.getByRole("button", { name: /Supernova/ }) as HTMLButtonElement).disabled).toBe(true);
});

test("a friend's upgrades last for retries of the challenge, and end at the menu", async () => {
  owned.push("moves-1");
  sdk.challenge = { mode: "level", seed: "1", score: 100, unit: "points", rules: "u2-0-0-0-0-0.n0" };
  play();
  await screen.findByRole("heading", { name: "Level 1" });
  // The player's own upgrades are known before they are compared.
  await waitFor(() => expect(screen.getByText(/so it's a fair match/)).toBeTruthy());
  expect(session().movesLeft).toBe(28);
  await playOut();
  // Trying the challenge again keeps the friend's upgrades.
  fireEvent.click(await screen.findByRole("button", { name: /Try again|Play again/ }));
  expect(session().movesLeft).toBe(28);
  // Back at the menu, the same level is played with the player's own.
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Level 1" }));
  expect(session().movesLeft).toBe(27);
  expect(screen.queryByText(/so it's a fair match/)).toBeNull();
});

test("a friend's better upgrades and Supernovas are lent for the round, which pays nothing", async () => {
  const saved = empty();
  saved.novasWon = 0;
  sdk.challenge = { mode: "level", seed: "1", score: 100, unit: "points", rules: "u2-0-0-0-0-0.n1" };
  play(saved);
  await screen.findByRole("heading", { name: "Level 1" });
  expect(session().movesLeft).toBe(28);
  // The friend set off one Supernova, so the player may too, without one of their own.
  const nova = () => screen.getByRole("button", { name: /Supernova/ }) as HTMLButtonElement;
  await waitFor(() => expect(nova().disabled).toBe(false));
  expect(nova().getAttribute("aria-label")).toBe("Supernova ×1");
  await act(async () => fireEvent.click(nova()));
  expect(session().novas).toBe(1);
  expect(nova().getAttribute("aria-label")).toBe("Supernova ×0");
  await playOut();
  // More than the player owns, so the round is for the score alone.
  expect(calls.earn).not.toHaveBeenCalled();
  expect(calls.unlock).not.toHaveBeenCalled();
  // A challenge back carries the same rules.
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  const button = await screen.findByRole("button", { name: /Challenge a friend/ });
  await act(async () => fireEvent.click(button));
  expect(calls.link).toHaveBeenCalledWith(expect.objectContaining({ mode: "level", seed: "1", rules: "u2-0-0-0-0-0.n1" }));
});

test("the player's own challenge is their score to beat", async () => {
  sdk.challenge = { mode: "level", seed: "1", score: 999999, unit: "points", rules: "u0-0-0-0-0-0.n0", mine: true };
  play();
  await screen.findByRole("heading", { name: "Level 1" });
  await waitFor(() => expect(screen.getByText("Your upgrades and Supernovas from that round.")).toBeTruthy());
  expect(screen.queryByText(/so it's a fair match/)).toBeNull();
  await playOut();
  expect(await screen.findByText(/^Your score to beat: 999,999\. [\d,]+ more to beat it\.$/)).toBeTruthy();
});

test("an older dingn without challengeResult still ends a challenge round", async () => {
  delete (sdk as Partial<DingnGame>).challengeResult;
  sdk.challenge = { mode: "daily", seed: "2026-11-01", score: 999999, unit: "points", rules: "u0-0-0-0-0-0.n0" };
  play();
  await playOut();
  expect(await screen.findByText(/Your friend scored 999,999\./)).toBeTruthy();
  expect(screen.queryByText(/Place \d+ of/)).toBeNull();
});

test("a round away from the friend's challenge reports no result", async () => {
  sdk.challenge = { mode: "level", seed: "1", score: 100, unit: "points", rules: "u0-0-0-0-0-0.n0" };
  play();
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button", { name: "Menu" })[0]);
  fireEvent.click(screen.getByRole("button", { name: /Daily board/ }));
  await playOut();
  await vi.waitFor(() => expect(calls.roundEnded).toHaveBeenCalledTimes(1));
  expect(calls.result).not.toHaveBeenCalled();
});

test("beating their own challenge sets the player a new record to beat", async () => {
  sdk.challenge = { mode: "level", seed: "1", score: 1, unit: "points", rules: "u0-0-0-0-0-0.n0", mine: true };
  play();
  await act(async () => {});
  await playOut();
  const record = session().score;
  expect(await screen.findByText("You beat your own 1!")).toBeTruthy();
  // The same moves again make the same score, which no longer beats it.
  fireEvent.click(screen.getByRole("button", { name: /Play again|Try again/ }));
  await playOut();
  expect(session().score).toBe(record);
  expect(await screen.findByText(`Your score to beat: ${record.toLocaleString()}. 1 more to beat it.`)).toBeTruthy();
  expect(calls.result).toHaveBeenCalledTimes(2);
});
