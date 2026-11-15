import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DingnGame, Locale, ShopItem } from "../sdk/dingn-sdk.js";
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
    async playInvalid() {}
    async playTurn() {}
    async celebrate() {}
    dispose() {}
  },
}));

let sdk: DingnGame;
const calls = { save: vi.fn(), earn: vi.fn(), unlock: vi.fn(), spend: vi.fn() };
let owned: string[] = [];
function fakeSdk(signedIn: boolean, locale: Locale = "en") {
  const stored = new Map<string, unknown>();
  owned = [];
  calls.save.mockReset().mockResolvedValue(undefined);
  calls.earn.mockReset().mockImplementation(async (coins: number) => ({ coins, left: 100 }));
  calls.unlock.mockReset().mockResolvedValue({ new: true, coins: 10 });
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
    onPlayer: () => () => {},
    storage: {
      get: async (key) => (stored.get(key) ?? null) as never,
      set: async (key, value) => void stored.set(key, value),
    },
    progress: { load: async () => null, save: calls.save },
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
  expect(screen.getByText("20")).toBeTruthy();
  await playOut();
  const s = session();
  if (s.outcome === "won") {
    expect(await screen.findByText("Level complete!")).toBeTruthy();
    expect(calls.earn).toHaveBeenCalledWith(2 + s.stars * 2);
    expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({ stars: expect.arrayContaining([s.stars]) }));
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
  expect(session().movesLeft).toBe(21);
});

test("signed-out players are asked to sign in to buy", async () => {
  fakeSdk(false);
  play();
  fireEvent.click(screen.getByRole("button", { name: "Upgrades" }));
  expect(screen.getByRole("button", { name: "Sign in to buy upgrades" })).toBeTruthy();
});

test("speaks Chinese", () => {
  fakeSdk(false, "zh-CN");
  play();
  expect(screen.getByRole("button", { name: "开始" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "每日棋盘" })).toBeTruthy();
  expect(screen.getByText("霓虹都市")).toBeTruthy();
  expect(screen.getByText("登录以赚取金币和徽章")).toBeTruthy();
});
