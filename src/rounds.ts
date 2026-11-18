// Rounds: every 10 levels is one round. Finishing a round raises the player's
// title, pays a reward and a lucky draw, tells a line of the story, and opens
// the next world.
import { LAST_LEVEL, LEVELS_PER_WORLD, WORLDS } from "./levels";

export const ROUND = LEVELS_PER_WORLD;
export const ROUNDS = LAST_LEVEL / ROUND;
/** Every tenth round (100 levels) is a milestone, with a bigger reward. */
export const MILESTONE = 10;

/** The round a level is in, from 1. */
export const roundOf = (level: number) => Math.floor((Math.max(1, level) - 1) / ROUND) + 1;
export const lastLevelOf = (round: number) => round * ROUND;
export const isMilestone = (round: number) => round % MILESTONE === 0;
/** The world a round is played in. */
export const worldOf = (round: number) => WORLDS[(round - 1) % WORLDS.length];

/**
 * The titles, one a round. After the last they come round again with a
 * number: "Novice Traveller II".
 */
export const TITLES = [
  "Novice Traveller",
  "Pebble Picker",
  "Treasure Seeker",
  "Gem Apprentice",
  "Stone Cutter",
  "Collector",
  "Appraiser",
  "Jeweller",
  "Gem Merchant",
  "Treasure Hunter",
  "Master Jeweller",
  "Vault Keeper",
  "Tycoon",
  "Gem Baron",
  "Gem Count",
  "Gem Duke",
  "Crown Jeweller",
  "Gem Prince",
  "Gem King",
  "Gem Emperor",
  "Star Collector",
  "Legend",
  "Myth",
  "Gem Sage",
  "Grand Master",
];
/** 2 is " II", 14 is " XIV"; 1 is nothing. */
function numeral(n: number) {
  if (n <= 1) return "";
  let out = "";
  for (const [value, letters] of [[40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const)
    while (n >= value) {
      out += letters;
      n -= value;
    }
  return ` ${out}`;
}

/** The title held while playing `round`: its name and the number after it. */
export function titleOf(round: number) {
  const r = Math.min(Math.max(1, round), ROUNDS) - 1;
  return { name: TITLES[r % TITLES.length], numeral: numeral(Math.floor(r / TITLES.length) + 1) };
}

/** A line of the story for finishing each of the first rounds; later rounds share the last few. */
export const STORY = [
  "Your journey has begun. The road ahead glitters.",
  "Your bag grows heavier. There is more treasure out there.",
  "You found a secret: an old map, drawn in gemstone dust.",
  "The map points across the lake, where lanterns never go out.",
  "A locked chest opens, and the map shows a new path.",
  "A stranger trades you a key for a single ruby.",
  "The key fits a door in the forest that nobody else can see.",
  "Behind the door: a staircase of clouds.",
  "At the top, someone has been leaving gems for you to find.",
  "The trail of gems was left by the last Grand Master.",
  "Their workshop is empty, but the tools are still warm.",
  "You cut your first perfect stone. It hums.",
  "The humming stone points north, like a compass.",
  "Merchants begin to ask for you by name.",
  "A hidden vault under the city answers to your stone.",
  "Inside the vault is a crown with one setting empty.",
  "The missing stone is said to have fallen from the sky.",
  "You follow a falling star across the desert.",
  "It landed in the deep sea. You dive.",
  "The star-stone is yours, bright as morning.",
  "The crown is whole again, and it fits.",
  "Stories about you travel faster than you do.",
  "Young seekers follow your trail of gems.",
  "You leave a map for them, drawn in gemstone dust.",
  "A Grand Master's road never ends. A new chapter opens.",
];
const LATER = [
  "Another round done. New lands are on the map.",
  "The road goes on, and so do you.",
  "Somewhere ahead, something is glittering.",
];
export const storyOf = (round: number) => STORY[round - 1] ?? LATER[round % LATER.length];

export type RoundReward = {
  /** Supernovas for finishing the round. */
  novas: number;
  /** dingn coins on top of the level's own. */
  coins: number;
  milestone: boolean;
};
/** What finishing a round pays: more at each milestone, and more the further in. */
export function rewardOf(round: number): RoundReward {
  const milestone = isMilestone(round);
  const depth = Math.min(3, Math.floor((round - 1) / 25));
  return { novas: (milestone ? 3 : 1) + depth, coins: milestone ? 30 : 10, milestone };
}

/** The lucky draw: extra Supernovas. `roll` is a number in [0, 1). */
export const DRAW = [
  { novas: 1, chance: 0.5 },
  { novas: 2, chance: 0.3 },
  { novas: 3, chance: 0.15 },
  { novas: 5, chance: 0.05 },
];
export function draw(roll: number) {
  let at = 0;
  for (let i = 0; i < DRAW.length; i++) {
    at += DRAW[i].chance;
    if (roll < at) return { index: i, novas: DRAW[i].novas };
  }
  return { index: 0, novas: DRAW[0].novas };
}
