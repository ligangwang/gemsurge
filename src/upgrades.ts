// Gem Surge's permanent upgrades, bought with dingn coins. They are listed in
// game.json's "shop" (dingn checks prices and asks the player to confirm);
// this file says what each one does, what the player owns and what's next.
import type { DingnGame, ShopItem } from "../sdk/dingn-sdk.js";
import type { Special } from "./engine/board";
import type { Boosts } from "./engine/session";

export type UpgradeKind = "moves" | "blaster" | "bomb" | "prism" | "fever" | "undo";
export const UPGRADE_KINDS: UpgradeKind[] = ["moves", "blaster", "bomb", "prism", "fever", "undo"];

/** Each tier's price, matching game.json (dingn caps a price at 1,000). */
export const PRICES: Record<UpgradeKind, number[]> = {
  moves: [60, 150, 300, 500, 800],
  blaster: [80, 250, 500],
  bomb: [120, 350, 700],
  prism: [400, 1000],
  fever: [100, 300, 600],
  // One more undo a level after level 100; the first 100 levels have all three free.
  undo: [100, 250, 500],
};
/** How much faster each Fever tier fills the meter. */
export const FEVER_STEP = 0.15;

export type Owned = Record<UpgradeKind, number>;
export const NONE: Owned = { moves: 0, blaster: 0, bomb: 0, prism: 0, fever: 0, undo: 0 };

export const upgradeId = (kind: UpgradeKind, tier: number) => `${kind}-${tier}`;

/** The tiers owned of each upgrade, from dingn's list of the shop. */
export function ownedFrom(shop: ShopItem[]): Owned {
  const have = new Set(shop.filter((i) => i.owned).map((i) => i.id));
  const out = { ...NONE };
  for (const kind of UPGRADE_KINDS) {
    while (out[kind] < PRICES[kind].length && have.has(upgradeId(kind, out[kind] + 1)))
      out[kind]++;
  }
  return out;
}

/** What the upgrades add to a level. */
export function boostsFor(owned: Owned): Boosts {
  const specials: Special[] = [];
  for (let i = 0; i < owned.blaster; i++) specials.push(i % 2 ? "col" : "row");
  for (let i = 0; i < owned.bomb; i++) specials.push("bomb");
  for (let i = 0; i < owned.prism; i++) specials.push("prism");
  return { moves: owned.moves, specials, fever: 1 + owned.fever * FEVER_STEP, undos: owned.undo };
}

/** The next tier to buy, or null when an upgrade is maxed out. */
export function nextTier(kind: UpgradeKind, owned: Owned) {
  const tier = owned[kind] + 1;
  if (tier > PRICES[kind].length) return null;
  return { id: upgradeId(kind, tier), tier, price: PRICES[kind][tier - 1] };
}

type Shop = Pick<DingnGame, "player"> & {
  rewards: Pick<DingnGame["rewards"], "spend" | "shop">;
};

/** The player's upgrades; none when signed out or dingn can't say. */
export async function loadOwned(sdk: Shop): Promise<Owned> {
  if (!sdk.player.signedIn) return { ...NONE };
  try {
    return ownedFrom(await sdk.rewards.shop());
  } catch {
    return { ...NONE };
  }
}

export type BuyResult = "bought" | "cancelled" | "poor" | "failed";

/** Buys an upgrade tier. dingn asks the player to confirm first. */
export async function buy(sdk: Shop, id: string): Promise<BuyResult> {
  try {
    await sdk.rewards.spend(id);
    return "bought";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "cancelled") return "cancelled";
    if (code === "not_enough_coins") return "poor";
    console.warn("Gem Surge upgrade", id, err);
    return "failed";
  }
}

/** game.json's shop entries, generated from PRICES (see tests). */
export const UPGRADE_TITLES: Record<UpgradeKind, (tier: number) => { en: string; zh: string }> = {
  moves: (t) => ({ en: `Extra moves +${t}`, zh: `额外步数 +${t}` }),
  blaster: (t) => ({ en: `Start with ${t} line blaster${t > 1 ? "s" : ""}`, zh: `开局带 ${t} 个激光` }),
  bomb: (t) => ({ en: `Start with ${t} bomb${t > 1 ? "s" : ""}`, zh: `开局带 ${t} 个炸弹` }),
  prism: (t) => ({ en: `Start with ${t} prism${t > 1 ? "s" : ""}`, zh: `开局带 ${t} 个棱镜` }),
  fever: (t) => ({ en: `Fever charge +${t * 15}%`, zh: `狂热充能 +${t * 15}%` }),
  undo: (t) => ({ en: `${t} undo${t > 1 ? "s" : ""} a level after level 100`, zh: `100 关后每关撤回 ${t} 次` }),
};

export function shopManifest() {
  return UPGRADE_KINDS.flatMap((kind) =>
    PRICES[kind].map((price, i) => ({
      id: upgradeId(kind, i + 1),
      price,
      title: UPGRADE_TITLES[kind](i + 1),
      ...(i ? { requires: upgradeId(kind, i) } : {}),
    })),
  );
}
