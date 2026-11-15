// Gem Surge's dingn badges. They are declared in game.json (dingn checks that
// list and decides what each tier pays); this file says when they are earned.
import type { DingnGame } from "../sdk/dingn-sdk.js";
import type { Session } from "./engine/session";

/** A badge for clearing each of these levels. */
export const LEVEL_MILESTONES = [5, 10, 15, 20, 25, 30];
export const levelBadge = (level: number) => `level-${level}`;
export const THREE_STARS = "three-stars";
export const CHAIN_5 = "chain-5";
export const CHAIN_8 = "chain-8";
export const PRISM = "prism";
export const COMBO = "combo";
export const WIPE = "board-wipe";
export const FEVER = "fever";
export const DAILY = "daily-board";

/** The level badges for having cleared up to `level`. */
export const levelBadges = (level: number) =>
  LEVEL_MILESTONES.filter((m) => m <= level).map(levelBadge);

/** Badges a play earned so far, wherever it is. */
export function playBadges(s: Session): string[] {
  const out: string[] = [];
  if (s.bestChain >= 5) out.push(CHAIN_5);
  if (s.bestChain >= 8) out.push(CHAIN_8);
  if (s.prismsFired) out.push(PRISM);
  if (s.combos.length) out.push(COMBO);
  if (s.combos.includes("prism+prism")) out.push(WIPE);
  if (s.fevers) out.push(FEVER);
  return out;
}

/** Badges for the end of a play. */
export function endBadges(s: Session, highest: number): string[] {
  const out = playBadges(s);
  if (s.outcome === "won") {
    if (s.spec.level === 0) out.push(DAILY);
    else {
      if (s.stars === 3) out.push(THREE_STARS);
      out.push(...levelBadges(highest));
    }
  }
  return out;
}

type Badged = Pick<DingnGame, "player"> & {
  rewards: Pick<DingnGame["rewards"], "unlock" | "list">;
};

/**
 * Unlocks badges, skipping ones the player already has. dingn shows the
 * popups and pays the coins. Never throws: badges must not get in the way.
 */
export function createBadgeTracker() {
  let earned: Promise<Set<string>> | null = null;
  const known = (sdk: Badged) =>
    (earned ??= sdk.rewards
      .list()
      .then((all) => new Set(all.filter((b) => b.earned).map((b) => b.id)))
      .catch(() => new Set<string>()));
  return {
    reset() {
      earned = null;
    },
    async unlock(sdk: Badged, ids: string[]) {
      if (!sdk.player.signedIn || !ids.length) return [];
      const have = await known(sdk);
      const unlocked: string[] = [];
      for (const id of new Set(ids)) {
        if (have.has(id)) continue;
        have.add(id);
        try {
          await sdk.rewards.unlock(id);
          unlocked.push(id);
        } catch {
          have.delete(id);
        }
      }
      return unlocked;
    },
  };
}
export const badges = createBadgeTracker();
