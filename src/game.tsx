// The game screens: the level map, a level in play with its HUD, the end of
// a level, and the upgrade shop. The 3D board (gem-scene.ts) stays mounted
// behind them all.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findHint, type Pos } from "./engine/board";
import { FEVER_MOVES, FREE_UNDO_LEVELS, SURGE_MAX, Session, type Goal, type Turn } from "./engine/session";
import { version } from "../game.json";
import { AnimationCancelled, CHEERS, GEM_OUTLINES, GemScene, STONE_CSS, type Collected } from "./gem-scene";
import { useDingn, useLocale } from "./dingn";
import { frostMotifForLevel } from "./lantern-lake";
import {
  COLOR_NAMES,
  DAILY_COINS,
  LAST_LEVEL,
  LEVELS_PER_WORLD,
  NOVA_COST,
  WORLDS,
  coinsFor,
  dailySpec,
  levelSpec,
  utcDay,
  worldCycle,
} from "./levels";
import { badges, endBadges, playBadges } from "./badges";
import { drawsOwed, highest, loadSaved, merge, novaCharge, novas, store, type Saved } from "./save";
import {
  NONE,
  PRICES,
  UPGRADE_KINDS,
  boostsFor,
  buy,
  loadOwned,
  nextTier,
  type Owned,
  type UpgradeKind,
} from "./upgrades";
import { say, setMuted, sfx } from "./sound";
import { beyond, challengeFor, DAILY_RULES, readChallenge, sameRound, shareLink, type Round, type Rules } from "./challenge";
import { JACKPOT, ROUND, WHEEL, isMilestone, lastLevelOf, restAngle, rewardOf, roundOf, sliceAt, storyOf, titleOf, worldOf } from "./rounds";

type Screen = "menu" | "play" | "end" | "shop";
type EndInfo = {
  outcome: "won" | "lost";
  stars: number;
  score: number;
  coins: number | null;
  /** How many of those coins were for chain reactions. */
  chain: number;
  /** Why no coins were paid, when none were. */
  note: string;
  best: boolean;
  /** Supernovas this play charged. */
  novas: number;
  /** Set when this win finished a round for the first time. */
  round: RoundEnd | null;
  /** The round just played and its score, for a challenge link. */
  played: Round;
  /** A friend's challenge on this round, if one is being answered. */
  rival: Round | null;
  /** The player's place among everyone who answered that challenge, once dingn has posted the score. */
  place: { rank: number; players: number } | null;
  /**
   * Set for a signed-out visitor whose score dingn is holding until they
   * sign in: the place it would take, when dingn says.
   */
  unsaved: { rank: number | null; players: number } | null;
};
type RoundEnd = {
  round: number;
  /** Supernovas from the round's reward; the lucky draw adds more once spun. */
  novas: number;
  /** dingn coins paid for the round, or null when signed out. */
  coins: number | null;
};

const HINT_AFTER = 7000;

export function GemGame({ initial, prefs }: { initial: Saved; prefs: { muted: boolean } }) {
  const sdk = useDingn();
  const { locale, t } = useLocale();
  /** The player's language right now, for the scene's callbacks. */
  const localeNow = useRef(locale);
  localeNow.current = locale;
  const [saved, setSaved] = useState(initial);
  const [screen, setScreen] = useState<Screen>("menu");
  // A lucky draw left unspun (the game was closed first) waits on the menu;
  // this keeps it open to show what it won.
  const [owedOpen, setOwedOpen] = useState(false);
  // Counts the owed draws shown, so the next one starts with a fresh wheel.
  const [owedShown, setOwedShown] = useState(0);
  const [owned, setOwned] = useState<Owned>(NONE);
  const [muted, setMute] = useState(prefs.muted);
  const [webgl, setWebgl] = useState(true);
  const [, setTick] = useState(0);
  const [shown, setShown] = useState(0);
  /**
   * During a move, how much of each goal the HUD shows: what has landed so
   * far, so a goal fills as its pieces arrive. Null shows the real progress.
   */
  const [goalsShown, setGoalsShown] = useState<number[] | null>(null);
  const goalsShownNow = useRef<number[] | null>(null);
  const showGoals = (value: number[] | null) => {
    goalsShownNow.current = value;
    setGoalsShown(value);
  };
  const goalsDone = useRef<number[]>([]);
  /**
   * Whether the move has finished playing. Its last pieces can still be in
   * the air, so the HUD keeps counting them in until they have all landed.
   */
  const turnOver = useRef(true);
  const endTurnGoals = () => {
    turnOver.current = true;
    if (flying === 0) showGoals(null);
  };
  /** A piece has landed on its goal: count it, with a sound. */
  const landed = (key: string) => {
    if (key === "ice") sfx.collectIce();
    else sfx.collect();
    const goals = session.current?.progress() ?? [];
    const i = goals.findIndex((g) => goalKey(g.goal) === key);
    const now = goalsShownNow.current;
    if (!now || i < 0) return;
    const next = [...now];
    next[i] = Math.min(next[i] + 1, goalsDone.current[i] ?? next[i]);
    if (now[i] < goals[i].target && next[i] >= goals[i].target) sfx.goalDone();
    showGoals(next);
    if (turnOver.current && flying === 0) showGoals(null);
  };
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  // Kept in English and translated when shown, so it follows a language switch.
  const [shopNote, setShopNote] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<GemScene | null>(null);
  const session = useRef<Session | null>(null);
  const busy = useRef(false);
  const [rewarded] = useState(() => new WeakSet<Session>());
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const rerender = () => setTick((n) => n + 1);
  const signedIn = sdk.player.signedIn;
  const top = highest(saved);
  const today = utcDay();
  const dailyDone = saved.daily?.day === today;
  /** A friend's challenge the page opened with, until a different round is played. */
  const challenge = useRef<Round | null>(readChallenge(sdk.challenge));
  /** Each session's daily-board day, kept with the session so a late reward reads its own. */
  const [sessionDay] = useState(() => new WeakMap<Session, string>());
  /** The upgrade tiers each session was started with. */
  const [sessionOwned] = useState(() => new WeakMap<Session, Owned>());
  /**
   * A friend's challenge's rules, for the sessions played under them: the
   * friend's upgrades instead of the player's own, and the Supernovas the
   * friend set off (free, instead of the player's own) and no more.
   */
  const [sessionRules] = useState(() => new WeakMap<Session, Rules>());
  /**
   * Whether a session is played for the score alone, paying and saving
   * nothing: a friend's challenge on an older daily board, on a level the
   * player has not reached, or with rules that give more than the player owns.
   */
  const scoreOnly = (s: Session) => {
    const rules = sessionRules.get(s);
    if (rules && beyond(rules, owned)) return true;
    return s.spec.level === 0
      ? (sessionDay.get(s) ?? today) !== utcDay()
      : s.spec.level > highest(savedRef.current) + 1;
  };
  /** Set once the player's upgrades are known, to compare a challenge's with them. */
  const [ownedLoaded, setOwnedLoaded] = useState(false);
  const challengeStarted = useRef(false);

  useEffect(() => setMuted(muted), [muted]);

  // The upgrades the player owns, and their account's progress merged with
  // this device's, again after they sign in.
  useEffect(() => {
    let live = true;
    badges.reset();
    loadOwned(sdk).then((o) => {
      if (!live) return;
      setOwned(o);
      setOwnedLoaded(true);
    });
    if (signedIn)
      loadSaved(sdk).then((account) => {
        if (!live) return;
        const next = merge(savedRef.current, account);
        savedRef.current = next;
        setSaved(next);
        store(sdk, next).catch(() => {});
      });
    return () => {
      live = false;
    };
  }, [sdk, signedIn]);

  const armHint = useCallback(() => {
    clearTimeout(hintTimer.current);
    scene.current?.showHint(null);
    hintTimer.current = setTimeout(() => {
      const s = session.current;
      if (s && !busy.current && !s.outcome) scene.current?.showHint(findHint(s.board));
    }, HINT_AFTER);
  }, []);

  const onSwap = useRef<(a: Pos, b: Pos) => void>(() => {});

  // The scene, made once.
  useEffect(() => {
    if (!host.current) return;
    let s: GemScene;
    try {
      s = new GemScene(host.current, {
        onSwap: (a, b) => onSwap.current(a, b),
        onPoke: () => armHint(),
        onCollect: (what, at) => flyToGoal(what, at, landed),
      });
    } catch (err) {
      console.warn("Gem Surge: no WebGL", err);
      setWebgl(false);
      return;
    }
    s.setBannerTranslator(t);
    s.setBannerListener((text, shown) => CHEERS.has(text) && say(shown, localeNow.current, text));
    scene.current = s;
    // A board to look at behind the menu.
    const demo = new Session(levelSpec(Math.max(1, top)));
    s.setBoard(demo.board.cells, [], demo.spec.world, worldCycle(demo.spec.level), demo.board.holes);
    s.setInput(false);
    return () => {
      s.dispose();
      scene.current = null;
      clearTimeout(hintTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The player switched language: the banners on the board follow, even one
  // already showing.
  useEffect(() => {
    scene.current?.setBannerTranslator(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // Opened by a friend's challenge link: go straight to that round, under the
  // friend's rules. A level waits for the player's upgrades, which decide
  // whether the round can pay (scoreOnly).
  useEffect(() => {
    const c = challenge.current;
    const preview = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get("level")) : 0;
    if (challengeStarted.current || !scene.current) return;
    if (!c && (!Number.isInteger(preview) || preview < 1 || preview > LAST_LEVEL)) return;
    if (c?.kind !== "daily" && !ownedLoaded) return;
    challengeStarted.current = true;
    if (c?.kind === "daily") start(0, c.day);
    else start(c?.level ?? preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedLoaded]);

  const unlock = (ids: string[]) => {
    badges.unlock(sdk, ids).catch(() => {});
  };

  function start(level: number, day = today) {
    // Playing a different round leaves the friend's challenge behind.
    const c = challenge.current;
    const round: Round =
      level === 0 ? { kind: "daily", day, score: 0, rules: DAILY_RULES } : { kind: "level", level, score: 0, rules: DAILY_RULES };
    if (c && !sameRound(c, round)) challenge.current = null;
    // The friend's challenge is played under the friend's rules.
    const rules = challenge.current?.rules ?? null;
    const tiers = level === 0 ? NONE : (rules?.owned ?? owned);
    const spec = level === 0 ? dailySpec(day) : levelSpec(level);
    const s = new Session(spec, boostsFor(tiers));
    sessionDay.set(s, level === 0 ? day : today);
    sessionOwned.set(s, tiers);
    if (rules) sessionRules.set(s, rules);
    session.current = s;
    scene.current?.offerSpeedUp(false);
    setShown(0);
    setEnd(null);
    setScreen("play");
    rerender();
    scene.current?.setBoard(s.board.cells, s.board.ice, spec.world, worldCycle(spec.level), s.board.holes, spec.iceCover ? frostMotifForLevel(level) : undefined);
    scene.current?.setInput(true);
    if (spec.iceCover) scene.current?.banner("Match beside ice to break it", 2, undefined, true);
    else scene.current?.banner(level === 0 ? "Daily board" : `Level ${level}`, 2);
    armHint();
  }

  // A handle for the browser checks while developing.
  if (import.meta.env.DEV)
    (window as unknown as { gemsurge: unknown }).gemsurge = { session, hint: () => session.current && findHint(session.current.board), swap: (a: Pos, b: Pos) => onSwap.current(a, b), start, nova: () => {
      savedRef.current = { ...savedRef.current, earned: savedRef.current.earned + NOVA_COST };
      setSaved(savedRef.current);
      return play(null);
    } };

  onSwap.current = (a, b) => play([a, b]);

  /** The Supernovas a session can still set off. */
  function novasLeft(s: Session) {
    const rules = sessionRules.get(s);
    return rules ? Math.max(0, rules.novas - s.novas) : novas(savedRef.current);
  }

  /** Plays a swap, or a Supernova when there is no `pair`. */
  async function play(pair: [Pos, Pos] | null) {
    const s = session.current;
    const sc = scene.current;
    if (!s || !sc || busy.current || screen !== "play") return;
    const rules = sessionRules.get(s);
    if (!pair && (s.outcome || !s.spec.level || novasLeft(s) < 1)) return;
    busy.current = true;
    sc.setInput(false);
    clearTimeout(hintTimer.current);
    sc.showHint(null);
    try {
      const before = s.score;
      const chainBefore = s.chainCoins;
      const goalsBefore = s.progress().map((g) => g.have);
      const turn = pair ? s.move(pair[0], pair[1]) : s.nova();
      if (!turn) {
        if (pair) await sc.playInvalid(pair[0], pair[1]);
        return;
      }
      if (!pair) {
        // A challenge's Supernovas are the friend's, so the player's own stay.
        if (!rules) {
          const next = { ...savedRef.current, novasUsed: savedRef.current.novasUsed + 1 };
          savedRef.current = next;
          setSaved(next);
          store(sdk, next).catch(() => {});
        }
        sc.banner("Supernova!", 6);
      }
      // The goals fill as their pieces land, not all at once.
      goalsDone.current = s.progress().map((g) => g.have);
      turnOver.current = false;
      showGoals(goalsBefore);
      rerender();
      let running = before;
      await sc.playTurn(turn, pair, {
        onStep: (_, points) => {
          running += points;
          setShown(running);
        },
      });
      setShown(s.score);
      endTurnGoals();
      if (turn.feverStarted) {
        sc.banner("Fever!", 6);
        sfx.fever();
      }
      sc.setFever(s.fever);
      // A round played for the score alone earns no badges either.
      if (!scoreOnly(s)) unlock(playBadges(s));
      // A chain reaction earns coins, paid with the level's own when it ends.
      if (s.spec.level > 0 && s.chainCoins > chainBefore) sc.banner(`+${s.chainCoins - chainBefore} 🪙`, 3);
      // A nudge when the moves are running low.
      if (pair && !s.outcome && s.movesLeft === 5) sc.banner("Keep going!", 2);
      rerender();
      if (s.outcome) await finish(s);
    } catch (err) {
      if (!(err instanceof AnimationCancelled)) throw err;
      // The player left for another level mid-move: still save and pay.
      if (s.outcome) await reward(s, false);
    } finally {
      busy.current = false;
      endTurnGoals();
      if (session.current === s && !s.outcome) {
        sc.setInput(true);
        armHint();
      }
    }
  }

  /** Takes the last move back, so the player can choose again. */
  function undo() {
    const s = session.current;
    const sc = scene.current;
    if (!s || !sc || busy.current || screen !== "play" || !s.undo()) return;
    sc.setBoard(s.board.cells, s.board.ice, s.spec.world, worldCycle(s.spec.level), s.board.holes, s.spec.iceCover ? frostMotifForLevel(s.spec.level) : undefined);
    sc.setFever(s.fever);
    sc.setInput(true);
    setShown(s.score);
    sfx.swap();
    armHint();
    rerender();
  }

  async function finish(s: Session) {
    const sc = scene.current!;
    sc.setFever(false);
    if (s.outcome === "won") {
      sfx.win();
      const left = Math.min(s.movesLeft, SURGE_MAX);
      // The end can take a while, so a tap plays it faster.
      sc.offerSpeedUp(true);
      try {
        if (left > 0) await sc.splash("Surge!", t("{0} moves left turn into blasters", String(left)));
        else sc.banner("Clear!", 6);
        const surge = s.finish();
        if (surge) {
          const from = s.score - surge.points;
          let running = from;
          await sc.playTurn(surge, null, {
            huge: true,
            onStep: (_, p) => {
              running += p;
              setShown(running);
            },
          });
        }
        setShown(s.score);
        await sc.celebrate();
      } finally {
        sc.offerSpeedUp(false);
      }
    } else {
      sfx.lose();
      sc.banner("Out of moves", 1);
    }
    await reward(s);
  }

  async function reward(s: Session, show = true) {
    if (rewarded.has(s)) return;
    rewarded.add(s);
    sdk.roundEnded?.();
    const won = s.outcome === "won";
    const level = s.spec.level;
    const stars = s.stars;
    const day = sessionDay.get(s) ?? today;
    // The rules it was played under go with a challenge made from it.
    const rules: Rules = level === 0 ? DAILY_RULES : { owned: sessionOwned.get(s) ?? NONE, novas: s.novas };
    const played: Round = level === 0 ? { kind: "daily", day, score: s.score, rules } : { kind: "level", level, score: s.score, rules };
    const rival = challenge.current && sameRound(challenge.current, played) ? challenge.current : null;
    // dingn posts the score under the friend's challenge, ranks it and tells
    // the player how they did. Older dingn builds have no challengeResult.
    let place: EndInfo["place"] = null;
    let unsaved: EndInfo["unsaved"] = null;
    if (rival) {
      const result = await Promise.resolve(sdk.challengeResult?.(s.score)).catch(() => null);
      if (result?.posted && result.rank !== null) place = { rank: result.rank, players: result.players };
      else if (result && !result.posted && !result.test && !signedIn) unsaved = { rank: result.rank, players: result.players };
    }
    // A friend's challenge on an older daily board, or on a level not reached
    // yet, is played for the score alone: nothing is saved or paid.
    if (scoreOnly(s)) {
      if (!show) return;
      setEnd({ outcome: won ? "won" : "lost", stars, score: s.score, coins: null, chain: 0, note: "", best: false, novas: 0, round: null, played, rival, place, unsaved });
      setScreen("end");
      return;
    }
    const next: Saved = {
      ...savedRef.current,
      stars: [...savedRef.current.stars],
      best: [...savedRef.current.best],
      chain: Math.max(savedRef.current.chain, s.bestChain),
    };
    let best = false;
    let coins = 0;
    // What the play's chain reactions earned, paid on top of the level's coins.
    let chain = 0;
    let note = "";
    let round: RoundEnd | null = null;
    if (level > 0) {
      // The first win on a round's last level finishes the round.
      if (won && level % ROUND === 0 && !next.stars[level - 1]) {
        const prize = rewardOf(roundOf(level));
        // The lucky draw is owed now and paid when the player spins it.
        next.novasWon += prize.novas;
        round = { round: roundOf(level), novas: prize.novas, coins: null };
      }
      best = s.score > next.best[level - 1];
      next.stars[level - 1] = Math.max(next.stars[level - 1], stars);
      next.best[level - 1] = Math.max(next.best[level - 1], s.score);
      if (won) coins = coinsFor(level, stars);
      else if (s.progress().some((g) => g.have >= g.target / 2)) coins = 1;
      chain = s.chainCoins;
    } else {
      const prev = next.daily?.day === today ? next.daily : null;
      best = !prev || s.score > prev.score;
      if (won && !prev?.paid) coins = DAILY_COINS;
      else if (won) note = "Today's daily coins are already paid.";
      // Marked paid only once dingn has paid (below).
      next.daily = { day: today, score: Math.max(prev?.score ?? 0, s.score), paid: !!prev?.paid };
    }
    // Every coin a play is worth charges the Supernova, signed in or not.
    const ready = novas(next);
    next.earned += coins + chain;
    const charged = novas(next) - ready;
    savedRef.current = next;
    setSaved(next);
    store(sdk, next).catch(() => {});
    unlock(endBadges(s, highest(next)));
    let paid: number | null = null;
    let chainPaid = 0;
    if (coins + chain > 0) {
      if (!signedIn) note = "Sign in to earn coins and badges";
      else {
        try {
          // dingn pays at most 10 coins a call, so the chains are paid on their own.
          const r = coins > 0 ? await sdk.rewards.earn(coins) : { coins: 0 };
          const c = chain > 0 ? await sdk.rewards.earn(chain) : { coins: 0 };
          paid = r.coins + c.coins;
          chainPaid = c.coins;
          if (!paid) note = "You've earned all of today's coins from this game.";
          else if (level === 0) {
            const after = { ...savedRef.current, daily: { ...next.daily!, paid: true } };
            savedRef.current = after;
            setSaved(after);
            store(sdk, after).catch(() => {});
          }
        } catch {
          note = "Coins couldn't be paid just now.";
        }
      }
    }
    if (round && signedIn) {
      // dingn pays at most 10 coins a call.
      let paidForRound = 0;
      for (let left = rewardOf(round.round).coins; left > 0; left -= 10) {
        try {
          paidForRound += (await sdk.rewards.earn(Math.min(10, left))).coins;
        } catch {
          break;
        }
      }
      round.coins = paidForRound;
    }
    if (!show) return;
    setEnd({ outcome: won ? "won" : "lost", stars, score: s.score, coins: paid, chain: chainPaid, note, best, novas: charged, round, played, rival, place, unsaved });
    if (round) {
      scene.current?.banner("Round complete!", 6);
      sfx.fanfare();
    }
    if (charged) setTimeout(() => sfx.fever(), 900);
    setScreen("end");
    stars && [1, 2, 3].slice(0, stars).forEach((n, i) => setTimeout(() => sfx.star(n), 300 + i * 250));
  }

  /** A lucky draw came to rest on `won` Supernovas: pay them and mark it spun. */
  function drawn(won: number) {
    const now = savedRef.current;
    if (drawsOwed(now) <= 0) return;
    const next = { ...now, novasWon: now.novasWon + won, drawsDone: now.drawsDone + 1 };
    savedRef.current = next;
    setSaved(next);
    store(sdk, next).catch(() => {});
  }

  function toMenu() {
    // Back to normal play: the friend's challenge, and the upgrades and
    // Supernovas it lent, end here. "Try again" on the end screen keeps them.
    challenge.current = null;
    session.current = null;
    scene.current?.offerSpeedUp(false);
    clearTimeout(hintTimer.current);
    scene.current?.setInput(false);
    scene.current?.setFever(false);
    scene.current?.showHint(null);
    setScreen("menu");
  }

  async function purchase(kind: UpgradeKind) {
    const tier = nextTier(kind, owned);
    if (!tier) return;
    if (!signedIn) {
      sdk.requestSignIn();
      return;
    }
    setBuying(tier.id);
    setShopNote("");
    const r = await buy(sdk, tier.id);
    setBuying(null);
    if (r === "bought") {
      setOwned(await loadOwned(sdk));
      setShopNote("Upgrade bought! It works from your next level.");
      sfx.win();
    } else if (r === "poor") setShopNote("Not enough coins yet. Clear levels and the daily board to earn more.");
    else if (r === "failed") setShopNote("That didn't go through. Try again in a moment.");
  }

  function toggleMute() {
    const m = !muted;
    setMute(m);
    setMuted(m);
    sdk.storage.set("prefs", { muted: m }).catch(() => {});
  }

  // Esc leaves a level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && screen === "shop") setScreen("menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  const s = session.current;
  const nextLevel = Math.min(top + 1, LAST_LEVEL);
  const totalStars = saved.stars.reduce((a, b) => a + b, 0);

  return (
    <div className={`gem-app screen-${screen}`}>
      <div className="gem-host" ref={host} />
      {!webgl && (
        <div className="gem-panel center">
          <h2>{t("Gem Surge needs WebGL, which this browser can't draw.")}</h2>
        </div>
      )}

      {webgl && screen === "menu" && (
        <Menu
          saved={saved}
          top={top}
          totalStars={totalStars}
          dailyDone={dailyDone}
          signedIn={signedIn}
          onPlay={start}
          onShop={() => setScreen("shop")}
          muted={muted}
          onMute={toggleMute}
          nextLevel={nextLevel}
        />
      )}

      {webgl && (screen === "play" || screen === "end") && s && (
        <Hud
          session={s}
          day={sessionDay.get(s) ?? today}
          shown={shown}
          goalsShown={goalsShown}
          muted={muted}
          onMute={toggleMute}
          onMenu={toMenu}
          owned={sessionOwned.get(s) ?? owned}
          lent={sessionRules.has(s) ? (challenge.current?.mine ? "own" : "friend") : null}
          novas={novasLeft(s)}
          charge={novaCharge(saved)}
          onNova={() => play(null)}
          onUndo={undo}
          canNova={screen === "play" && !s.outcome}
        />
      )}

      {webgl && screen === "menu" && (drawsOwed(saved) > 0 || owedOpen) && (
        <OwedDraw
          key={owedShown}
          onDrawn={drawn}
          onOpen={() => setOwedOpen(true)}
          onClose={() => {
            setOwedOpen(false);
            setOwedShown((n) => n + 1);
          }}
        />
      )}

      {screen === "end" && end && s && end.round && (
        <RoundPanel
          end={end}
          round={end.round}
          onDrawn={drawn}
          onNext={() => start(Math.min(s.spec.level + 1, LAST_LEVEL))}
          onMenu={toMenu}
          last={s.spec.level >= LAST_LEVEL}
        />
      )}

      {screen === "end" && end && s && !end.round && (
        <EndPanel
          end={end}
          session={s}
          signedIn={signedIn}
          onNext={() => start(Math.min(s.spec.level + 1, LAST_LEVEL))}
          onRetry={() => start(s.spec.level, sessionDay.get(s) ?? today)}
          onMenu={toMenu}
          onShop={() => {
            toMenu();
            setScreen("shop");
          }}
          dailyBest={saved.daily?.day === today ? saved.daily.score : 0}
        />
      )}

      {screen === "shop" && (
        <Shop
          owned={owned}
          signedIn={signedIn}
          buying={buying}
          note={shopNote && t(shopNote)}
          onBuy={purchase}
          onClose={() => {
            setShopNote("");
            setScreen("menu");
          }}
          onSignIn={() => sdk.requestSignIn()}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------- menu

function Menu(props: {
  saved: Saved;
  top: number;
  totalStars: number;
  dailyDone: boolean;
  signedIn: boolean;
  nextLevel: number;
  muted: boolean;
  onPlay: (level: number) => void;
  onShop: () => void;
  onMute: () => void;
}) {
  const { t } = useLocale();
  const sdk = useDingn();
  const { saved, top } = props;
  // The map shows three rounds (worlds) at a time, starting on the page with the next level to play.
  const WORLDS_A_PAGE = 3;
  const round = roundOf(props.nextLevel);
  const title = titleOf(round);
  const cleared = top - (round - 1) * ROUND;
  const finished = top >= LAST_LEVEL;
  const PAGE = WORLDS_A_PAGE * LEVELS_PER_WORLD;
  const pages = Math.ceil(LAST_LEVEL / PAGE);
  const [page, setPage] = useState(() => Math.min(pages - 1, Math.floor((props.nextLevel - 1) / PAGE)));
  const first = page * PAGE + 1;
  return (
    <div className="gem-menu">
      <header className="gem-title">
        <h1>
          <span className="logo-gem" aria-hidden />
          {t("Gem Surge")}
        </h1>
        <p>{t("Swap gems, build blasters, bombs and prisms, and set off chain reactions.")}</p>
        <div className="gem-actions">
          <button className="button big" onClick={() => props.onPlay(props.nextLevel)}>
            {props.top === 0 ? t("Play") : t("Play level {0}", String(props.nextLevel))}
          </button>
          <button className="secondary-button" onClick={() => props.onPlay(0)}>
            {t("Daily board")}
            {props.dailyDone && <span className="tick"> ✓</span>}
          </button>
          <button className="secondary-button" onClick={props.onShop}>
            {t("Upgrades")}
          </button>
          <button className="icon-button" onClick={props.onMute} aria-label={props.muted ? t("Sound on") : t("Sound off")}>
            {props.muted ? "🔇" : "🔊"}
          </button>
        </div>
        {!props.signedIn && (
          <p className="signin-note">
            <button className="link-button" onClick={() => sdk.requestSignIn()}>
              {t("Sign in to earn coins and badges")}
            </button>
          </p>
        )}
        <div className="gem-round" aria-label={t("Your round")}>
          <p className="round-title">
            <span className="medal" aria-hidden>
              🏅
            </span>
            {t(title.name)}
            {title.numeral}
          </p>
          <p className="round-progress">
            {t("Round {0}", String(round))} · {Math.max(0, cleared)} / {ROUND}
          </p>
          <div className="round-bar" aria-hidden>
            <div className="fill" style={{ width: `${(Math.max(0, cleared) / ROUND) * 100}%` }} />
          </div>
          {!finished && (
            <p className="round-next">
              {t("Finish level {0} to win:", String(lastLevelOf(round)))} <RoundPrize round={round} />
            </p>
          )}
        </div>
      </header>
      <section className="gem-worlds" aria-label={t("Levels")}>
        <div className="gem-pager">
          <p className="eyebrow">
            {t("Levels")} {first}–{Math.min(first + PAGE - 1, LAST_LEVEL)} / {LAST_LEVEL} · ★ {props.totalStars}
          </p>
          <button className="icon-button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={t("Earlier levels")}>
            ‹
          </button>
          <button className="icon-button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label={t("Later levels")}>
            ›
          </button>
        </div>
        {Array.from({ length: WORLDS_A_PAGE }, (_, wi) => {
          const w = WORLDS[(page * WORLDS_A_PAGE + wi) % WORLDS.length];
          if (first + wi * LEVELS_PER_WORLD > LAST_LEVEL) return null;
          return (
          <div key={wi} className={`gem-world world-${w.id}`}>
            <h3>
              {t("Round {0}", String(page * WORLDS_A_PAGE + wi + 1))} · {t(w.name)}
            </h3>
            <div className="gem-levels">
              {Array.from({ length: LEVELS_PER_WORLD }, (_, k) => {
                const n = first + wi * LEVELS_PER_WORLD + k;
                if (n > LAST_LEVEL) return null;
                const locked = n > top + 1;
                const stars = saved.stars[n - 1];
                return (
                  <button
                    key={n}
                    className={`gem-level${locked ? " locked" : ""}${n === top + 1 ? " current" : ""}`}
                    disabled={locked}
                    onClick={() => props.onPlay(n)}
                    aria-label={t("Level {0}", String(n))}
                  >
                    <span className="n">{n}</span>
                    <span className="stars" aria-hidden>
                      {[1, 2, 3].map((s) => (
                        <i key={s} className={s <= stars ? "on" : ""}>
                          ★
                        </i>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </section>
      {/* The version, small in a corner, for telling which build a player has. */}
      <p className="gem-version">v{version}</p>
    </div>
  );
}

// --------------------------------------------------------------------- HUD

/** How a goal is named in the HUD, to match what is cleared to its goal. */
const goalKey = (goal: Goal) => (goal.kind === "color" ? `color-${goal.color}` : goal.kind);

/** How many pieces are flying to the goals now: past this, the rest just count. */
let flying = 0;
const MAX_FLYING = 24;

/**
 * Flies a cleared gem, or a chip of ice, from where it was on the board to
 * its goal in the HUD, and bumps the goal's count as it lands.
 */
function flyToGoal(
  what: Collected,
  at: { x: number; y: number },
  onLand: (key: string) => void,
) {
  const key = "ice" in what ? "ice" : `color-${what.color}`;
  const goal = document.querySelector<HTMLElement>(`.goal[data-goal="${key}"]:not(.done)`);
  const icon = goal?.querySelector<HTMLElement>(".goal-gem, .goal-ice");
  const count = goal?.querySelector<HTMLElement>(".goal-count");
  if (!icon || !count) return;
  const bump = () => {
    onLand(key);
    count.classList.remove("bump");
    void count.offsetWidth; // restart the animation
    count.classList.add("bump");
  };
  const to = icon.getBoundingClientRect();
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still || flying >= MAX_FLYING || !to.width || !icon.animate) return bump();
  const piece = icon.cloneNode(true) as HTMLElement;
  piece.classList.add("goal-fly");
  piece.style.left = `${at.x}px`;
  piece.style.top = `${at.y}px`;
  document.body.appendChild(piece);
  flying++;
  const dx = to.left + to.width / 2 - at.x;
  const dy = to.top + to.height / 2 - at.y;
  // Up and away first, then a quickening swoop onto the goal.
  const flight = piece.animate(
    [
      { transform: "translate(-50%, -50%) scale(1.6)", opacity: 1 },
      {
        transform: `translate(calc(-50% + ${dx * 0.25}px), calc(-50% + ${dy * 0.25 - 50}px)) scale(1.3)`,
        opacity: 1,
        offset: 0.35,
      },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)`, opacity: 0.9 },
    ],
    { duration: 620 + Math.random() * 180, easing: "cubic-bezier(0.45, 0, 0.75, 1)" },
  );
  const land = () => {
    piece.remove();
    flying--;
    bump();
  };
  flight.onfinish = land;
  flight.oncancel = land;
}

function GoalIcon({ goal }: { goal: Goal }) {
  // The same outline and colour as the stone on the board.
  if (goal.kind === "color")
    return (
      <svg className={`goal-gem gem-${goal.color}`} viewBox="-0.6 -0.6 1.2 1.2" aria-hidden>
        <path d={GEM_OUTLINES[goal.color]} fill={STONE_CSS[goal.color]} stroke="rgba(255,255,255,0.75)" strokeWidth="0.05" />
        <ellipse cx="-0.13" cy="-0.16" rx="0.12" ry="0.07" fill="rgba(255,255,255,0.7)" transform="rotate(-35 -0.13 -0.16)" />
      </svg>
    );
  if (goal.kind === "ice") return <span className="goal-ice" />;
  return <span className="goal-score">★</span>;
}

function goalLabel(goal: Goal, t: (s: string, ...a: string[]) => string) {
  if (goal.kind === "color") return t("Collect {0}", t(COLOR_NAMES[goal.color]));
  if (goal.kind === "ice") return t("Break the ice");
  return t("Score");
}

function Hud(props: {
  session: Session;
  /** The daily board's day (an older one when answering a friend's challenge). */
  day: string;
  shown: number;
  /** How much of each goal to show during a move, or null for the real progress. */
  goalsShown: number[] | null;
  muted: boolean;
  owned: Owned;
  /** Played under a friend's challenge's rules. */
  lent: "friend" | "own" | null;
  onMute: () => void;
  onMenu: () => void;
  /** Supernovas ready, and coins towards the next one. */
  novas: number;
  charge: number;
  canNova: boolean;
  onNova: () => void;
  onUndo: () => void;
}) {
  const { t } = useLocale();
  const s = props.session;
  const spec = s.spec;
  const [, two, three] = spec.stars;
  const max = three * 1.1;
  const pct = Math.min(1, props.shown / max);
  const boosts = useMemo(() => {
    if (!spec.level) return "";
    const o = props.owned;
    const parts: string[] = [];
    if (o.moves) parts.push(t("+{0} moves", String(o.moves)));
    if (o.blaster) parts.push(t("{0} line blasters", String(o.blaster)));
    if (o.bomb) parts.push(t("{0} bombs", String(o.bomb)));
    if (o.prism) parts.push(t("{0} prisms", String(o.prism)));
    if (o.fever) parts.push(t("Fever +{0}%", String(o.fever * 15)));
    return parts.join(" · ");
  }, [props.owned, spec.level, t]);
  return (
    <aside className={`gem-hud${s.fever ? " fever" : ""}`}>
      <div className="hud-top">
        <button className="icon-button" onClick={props.onMenu} aria-label={t("Menu")}>
          ☰
        </button>
        <div className="hud-level">
          <p className="eyebrow">{spec.level ? t(WORLDS[spec.world].name) : t("Daily board")}</p>
          <h2>{spec.level ? t("Level {0}", String(spec.level)) : props.day}</h2>
        </div>
        <button className="icon-button" onClick={props.onMute} aria-label={props.muted ? t("Sound on") : t("Sound off")}>
          {props.muted ? "🔇" : "🔊"}
        </button>
      </div>
      <div className="hud-moves">
        <span className="moves-n" key={s.movesLeft}>
          {s.movesLeft}
        </span>
        <span className="moves-label">{t("Moves")}</span>
      </div>
      <div className="hud-score">
        <p className="score-n">{props.shown.toLocaleString()}</p>
        <div className="score-bar">
          <div className="fill" style={{ width: `${pct * 100}%` }} />
          {[spec.stars[0], two, three].map((v, i) =>
            v > 0 ? (
              <span
                key={i}
                className={`mark${props.shown >= v ? " on" : ""}`}
                style={{ left: `${Math.min(100, (v / max) * 100)}%` }}
              >
                ★
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="hud-goals">
        <p className="eyebrow">{t("Goals")}</p>
        {s.progress().map((real, i) => {
          // A score goal follows the score; the others what has landed.
          const have = real.goal.kind === "score" ? real.have : (props.goalsShown?.[i] ?? real.have);
          const g = { ...real, have, done: have >= real.target };
          return (
          <div
            key={i}
            className={`goal${g.done ? " done" : ""}`}
            data-goal={goalKey(g.goal)}
          >
            <GoalIcon goal={g.goal} />
            <span className="goal-label">{goalLabel(g.goal, t)}</span>
            <span className="goal-count">
              {g.done ? "✓" : `${g.have.toLocaleString()} / ${g.target.toLocaleString()}`}
            </span>
          </div>
          );
        })}
        {spec.level > 0 && lastLevelOf(roundOf(spec.level)) - spec.level <= 1 && (
          <p className="goal-note round-note">
            {t("Finish level {0} to win:", String(lastLevelOf(roundOf(spec.level))))} <RoundPrize round={roundOf(spec.level)} />
          </p>
        )}
        {spec.allMoves && <p className="goal-note">{t("Use all {0} moves. Everyone gets this board today.", String(spec.moves))}</p>}
      </div>
      <div className={`hud-fever${s.fever ? " on" : ""}`}>
        <p className="eyebrow">{s.fever ? t("Fever ×2 · {0} moves", String(s.feverMoves)) : t("Fever")}</p>
        <div className="fever-bar">
          <div className="fill" style={{ width: `${(s.fever ? s.feverMoves / FEVER_MOVES : s.meter) * 100}%` }} />
        </div>
      </div>
      {spec.level > 0 && (
        <button
          className="secondary-button hud-undo"
          disabled={!props.canNova || !s.canUndo}
          onClick={props.onUndo}
          aria-label={`${t("Undo")} ×${s.undosLeft}`}
        >
          ↶ <span className="hud-word">{t("Undo")}</span> ×{s.undosLeft}
        </button>
      )}
      {props.lent && spec.level > 0 && (
        <p className="hud-note">
          {props.lent === "own"
            ? t("Your upgrades and Supernovas from that round.")
            : t("Your friend's upgrades and Supernovas, so it's a fair match.")}
        </p>
      )}
      {spec.level > FREE_UNDO_LEVELS && !props.owned.undo && !props.lent && (
        <p className="hud-note">{t("Buy Undo in Upgrades to use it after level 100.")}</p>
      )}
      {spec.level > 0 && s.chainCoins > 0 && (
        <p className="hud-note hud-chain">
          <span className="coin" aria-hidden /> {t("Chain reactions: +{0} coins", String(s.chainCoins))}
        </p>
      )}
      {spec.level > 0 && (
        <div className="hud-nova">
          <button
            className="button nova"
            disabled={!props.canNova || props.novas < 1}
            onClick={props.onNova}
            aria-label={`${t("Supernova")} ×${props.novas}`}
          >
            <span className="nova-star" aria-hidden>
              ✹
            </span>
            <span className="hud-word">{t("Supernova")}</span> ×{props.novas}
          </button>
          <div className="nova-bar" aria-hidden>
            <div className="fill" style={{ width: `${(props.charge / NOVA_COST) * 100}%` }} />
          </div>
          <p className="nova-note">
            {props.novas > 0
              ? t("Tap to clear the whole board. It costs no move.")
              : t("{0} more coins from play charge the next one.", String(NOVA_COST - props.charge))}
          </p>
        </div>
      )}
      {boosts && <p className="hud-boosts">{t("Upgrades")}: {boosts}</p>}
      <details className="hud-help">
        <summary>{t("How to play")}</summary>
        <ul>
          <li>{t("Drag a gem onto a neighbour, or click two neighbours, to swap them.")}</li>
          <li>{t("Line up 4 for a line blaster, an L or T for a bomb, 5 for a prism.")}</li>
          <li>{t("Swap two specials together for a bigger blast.")}</li>
          <li>{t("Chains and blasts fill the Fever meter: Fever doubles your points for 3 moves.")}</li>
          <li>{t("Moves left at the end turn into blasters for a final surge.")}</li>
          <li>{t("Chain reactions earn coins: the longer the chain, the more, up to 10 a level.")}</li>
          <li>{t("Undo takes your last move back, up to 3 times a level. After level 100 it is an upgrade you buy with coins.")}</li>
          <li>{t("Every 100 coins you earn by playing charge a Supernova, which clears the whole board.")}</li>
        </ul>
      </details>
    </aside>
  );
}

// --------------------------------------------------------------------- end

function EndPanel(props: {
  end: EndInfo;
  session: Session;
  signedIn: boolean;
  dailyBest: number;
  onNext: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onShop: () => void;
}) {
  const { t } = useLocale();
  const sdk = useDingn();
  const { end, session: s } = props;
  const daily = s.spec.level === 0;
  const won = end.outcome === "won";
  return (
    <div className="gem-end" role="dialog" aria-label={won ? t("Level complete") : t("Out of moves")}>
      <div className="gem-panel">
        <p className="eyebrow">{daily ? t("Daily board") : t("Level {0}", String(s.spec.level))}</p>
        <h2>{won ? (daily ? t("Board complete!") : t("Level complete!")) : t("Out of moves")}</h2>
        {won && (
          <div className="end-stars" aria-label={t("{0} stars", String(end.stars))}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= end.stars ? "on" : ""} style={{ animationDelay: `${0.25 * n}s` }}>
                ★
              </span>
            ))}
          </div>
        )}
        <p className="end-score">
          {end.score.toLocaleString()}
          {end.best && end.score > 0 && <span className="best">{t("New best!")}</span>}
        </p>
        {daily && props.dailyBest > 0 && end.played.kind === "daily" && end.played.day === utcDay() && (
          <p className="end-sub">{t("Your best today: {0}", props.dailyBest.toLocaleString())}</p>
        )}
        {end.rival && (
          <p className={`end-rival${end.score > end.rival.score ? " beaten" : ""}`}>
            {end.score > end.rival.score
              ? end.rival.mine
                ? t("You beat your own {0}!", end.rival.score.toLocaleString())
                : t("You beat your friend's {0}!", end.rival.score.toLocaleString())
              : t(
                  end.rival.mine ? "Your score to beat: {0}. {1} more to beat it." : "Your friend scored {0}. {1} more to beat it.",
                  end.rival.score.toLocaleString(),
                  (end.rival.score - end.score + 1).toLocaleString(),
                )}
            {end.place && <small> {t("Place {0} of {1}", String(end.place.rank), String(end.place.players))}</small>}
            {end.unsaved && !props.signedIn && (
              <button className="link-button end-unsaved" onClick={() => sdk.requestSignIn()}>
                {end.unsaved.rank !== null
                  ? t("Ranked No. {0} of {1}. Sign in free to save it.", String(end.unsaved.rank), String(end.unsaved.players))
                  : t("Sign in free to save your score and see your rank.")}
              </button>
            )}
          </p>
        )}
        {!won && (
          <ul className="end-goals">
            {s.progress().map((g, i) => (
              <li key={i} className={g.done ? "done" : ""}>
                <GoalIcon goal={g.goal} /> {goalLabel(g.goal, t)} {g.have.toLocaleString()} / {g.target.toLocaleString()}
              </li>
            ))}
          </ul>
        )}
        {end.coins !== null && end.coins > 0 && (
          <p className="end-coins">
            <span className="coin" aria-hidden /> {t("+{0} coins", String(end.coins))}
            {end.chain > 0 && <small> ({t("{0} for chain reactions", String(end.chain))})</small>}
          </p>
        )}
        {won && !daily && s.spec.level % ROUND === ROUND - 1 && (
          <p className="end-nova">
            {t("One more level finishes the round!")} <RoundPrize round={roundOf(s.spec.level)} />
          </p>
        )}
        {end.novas > 0 && <p className="end-nova">✹ {t("Supernova charged! Use it on any level.")}</p>}
        {end.note &&
          (end.note === "Sign in to earn coins and badges" ? (
            <button className="link-button end-note" onClick={() => sdk.requestSignIn()}>
              {t(end.note)}
            </button>
          ) : (
            <p className="end-note">{t(end.note)}</p>
          ))}
        {/* A round that answers a challenge posts under it, so it makes no challenge of its own. */}
        {end.score > 0 && !end.rival && <ChallengeButton played={end.played} />}
        <div className="gem-actions">
          {won && !daily && s.spec.level < LAST_LEVEL && (
            <button className="button" onClick={props.onNext}>
              {t("Next level")}
            </button>
          )}
          <button className={won ? "secondary-button" : "button"} onClick={props.onRetry}>
            {won ? t("Play again") : t("Try again")}
          </button>
          {!won && props.signedIn && (
            <button className="secondary-button" onClick={props.onShop}>
              {t("Get upgrades")}
            </button>
          )}
          <button className="secondary-button" onClick={props.onMenu}>
            {t("Menu")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Challenge a friend": a link to this round with the score to beat, through
 * the phone's share sheet or copied, or shown to copy by hand.
 */
function ChallengeButton({ played }: { played: Round }) {
  const { t } = useLocale();
  const sdk = useDingn();
  const [state, setState] = useState<"idle" | "busy" | "copied" | "shared" | "unavailable">("idle");
  const [link, setLink] = useState("");
  async function send() {
    setState("busy");
    let url: string;
    try {
      url = await sdk.challengeLink(challengeFor(played));
    } catch {
      setState("unavailable");
      return;
    }
    const text = t("Can you beat my {0} points in Gem Surge?", played.score.toLocaleString());
    const how = await shareLink(url, text);
    if (how === "failed") setLink(url);
    setState(how === "copied" ? "copied" : how === "shared" ? "shared" : "idle");
  }
  if (state === "unavailable") return null;
  return (
    <div className="end-challenge">
      <button className="button challenge-button" onClick={send} disabled={state === "busy"}>
        ⚔ {t("Challenge a friend")}
      </button>
      {state === "copied" && <p className="end-sub">{t("Link copied. Send it to a friend!")}</p>}
      {link && (
        <input className="challenge-link" readOnly value={link} aria-label={t("Challenge link")} onFocus={(e) => e.target.select()} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------- round

/** What finishing a round wins, in a line: the next title, Supernovas, a draw and the next world. */
function RoundPrize({ round }: { round: number }) {
  const { t } = useLocale();
  const next = titleOf(round + 1);
  const prize = rewardOf(round);
  return (
    <span className="round-prize">
      🏅 {t(next.name)}
      {next.numeral} · ✹ ×{prize.novas} · {t("a lucky draw")} · {t(worldOf(round + 1).name)}
      {prize.milestone ? ` · ${t("milestone bonus")}` : ""}
    </span>
  );
}

/** The ceremony for finishing a round: a new title, the reward, the draw and a line of the story. */
function RoundPanel(props: {
  end: EndInfo;
  round: RoundEnd;
  last: boolean;
  onDrawn: (novas: number) => void;
  onNext: () => void;
  onMenu: () => void;
}) {
  const { t } = useLocale();
  const { end, round } = props;
  const title = titleOf(round.round + 1);
  const milestone = isMilestone(round.round);
  const [landed, setLanded] = useState(false);
  return (
    <div className="gem-end round-end" role="dialog" aria-label={t("Round complete!")}>
      <div className={`gem-panel round-panel${milestone ? " milestone" : ""}`}>
        <div className="round-rays" aria-hidden />
        <p className="eyebrow">
          {t("Level {0}", String(lastLevelOf(round.round)))} · {end.score.toLocaleString()}
        </p>
        <h2>{milestone ? t("Milestone! Round {0} complete!", String(round.round)) : t("Round {0} complete!", String(round.round))}</h2>
        <div className="end-stars" aria-label={t("{0} stars", String(end.stars))}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= end.stars ? "on" : ""} style={{ animationDelay: `${0.25 * n}s` }}>
              ★
            </span>
          ))}
        </div>
        <p className="round-new">{t("New title")}</p>
        <p className="round-rank">
          🏅 {t(title.name)}
          {title.numeral}
        </p>
        <ul className="round-rewards">
          <li>
            ✹ {t("Supernova")} ×{round.novas}
          </li>
          {round.coins !== null && round.coins > 0 && (
            <li>
              <span className="coin" aria-hidden /> {t("+{0} coins", String(round.coins + (end.coins ?? 0)))}
            </li>
          )}
        </ul>
        <LuckyDraw onDrawn={props.onDrawn} onLanded={() => setLanded(true)} />
        {landed && (
          <>
            <p className="round-story">“{t(storyOf(round.round))}”</p>
            {!props.last && (
              <p className="round-next">
                {t("Next")}: {t("Round {0}", String(round.round + 1))} · {t(worldOf(round.round + 1).name)}
              </p>
            )}
            <div className="gem-actions">
              {!props.last && (
                <button className="button big" onClick={props.onNext}>
                  {t("Start round {0}", String(round.round + 1))}
                </button>
              )}
              <button className="secondary-button" onClick={props.onMenu}>
                {t("Menu")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A lucky draw owed from a round whose wheel was never spun. */
function OwedDraw(props: { onDrawn: (novas: number) => void; onOpen: () => void; onClose: () => void }) {
  const { t } = useLocale();
  const [landed, setLanded] = useState(false);
  return (
    <div className="gem-end round-end" role="dialog" aria-label={t("Lucky draw")}>
      <div className="gem-panel round-panel">
        <p className="eyebrow">{t("A lucky draw is waiting for you")}</p>
        <LuckyDraw
          onDrawn={(won) => {
            // Stay open to show the prize, though the draw is no longer owed.
            props.onOpen();
            props.onDrawn(won);
          }}
          onLanded={() => setLanded(true)}
        />
        {landed && (
          <div className="gem-actions">
            <button className="button big" onClick={props.onClose}>
              {t("Close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** How fast a spinning wheel slows down, in degrees per millisecond squared. */
const FRICTION = 0.0003;
/** How long the button's power bar takes to fill. */
const CHARGE_MS = 900;

/**
 * The lucky draw: the player spins the wheel as hard as they like, by swiping
 * it or by holding the button while a power bar fills, and wins the slice it
 * comes to rest on. The prize is paid (`onDrawn`) the moment the wheel is let
 * go, so leaving while it turns changes nothing.
 */
function LuckyDraw(props: { onDrawn: (novas: number) => void; onLanded: (novas: number) => void }) {
  const { t } = useLocale();
  const [stage, setStage] = useState<"ready" | "charging" | "spinning" | "landed">("ready");
  const [turn, setTurn] = useState(0);
  const [power, setPower] = useState(0);
  const [won, setWon] = useState(0);
  const angle = useRef(0);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const frame = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; at: number; samples: { t: number; a: number }[] } | null>(null);
  const charge = useRef({ start: 0, power: 0 });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const turnTo = (a: number) => {
    angle.current = a;
    setTurn(a);
  };

  /** Lets the wheel go with a push that would carry it `push` degrees. */
  const letGo = (push: number) => {
    cancelAnimationFrame(frame.current);
    stageRef.current = "spinning";
    const start = angle.current;
    const rest = restAngle(start, push, Math.random());
    const prize = WHEEL[sliceAt(rest)];
    props.onDrawn(prize);
    setStage("spinning");
    // It slows down evenly, from just the speed that carries it to rest.
    const dir = Math.sign(rest - start);
    const distance = Math.abs(rest - start);
    const speed = Math.sqrt(2 * FRICTION * distance);
    const duration = speed / FRICTION;
    const begun = performance.now();
    let slice = sliceAt(start);
    let ticked = 0;
    const step = (now: number) => {
      const t = Math.min(duration, now - begun);
      const a = start + dir * (speed * t - (FRICTION * t * t) / 2);
      turnTo(a);
      // The pin clicks over each slice it passes, as often as it can be heard.
      if (sliceAt(a) !== slice) {
        slice = sliceAt(a);
        if (now - ticked > 45) {
          ticked = now;
          sfx.select();
        }
      }
      if (t < duration) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      turnTo(rest);
      setWon(prize);
      setStage("landed");
      if (prize === JACKPOT) sfx.fanfare();
      else sfx.star(3);
      props.onLanded(prize);
    };
    frame.current = requestAnimationFrame(step);
  };

  // Swiping the wheel: it follows the finger, and spins on with the speed it
  // had when let go.
  const pointerAngle = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(x, -y) * 180) / Math.PI;
  };
  const onWheelDown = (e: React.PointerEvent) => {
    if (stageRef.current !== "ready") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const a = pointerAngle(e);
    drag.current = { id: e.pointerId, at: a, samples: [{ t: performance.now(), a: angle.current }] };
  };
  const onWheelMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const a = pointerAngle(e);
    // The change in angle, taking the short way round.
    const delta = ((((a - d.at) % 360) + 540) % 360) - 180;
    d.at = a;
    turnTo(angle.current + delta);
    const now = performance.now();
    d.samples.push({ t: now, a: angle.current });
    while (d.samples.length > 2 && now - d.samples[0].t > 120) d.samples.shift();
  };
  const onWheelUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = performance.now() - first.t;
    const speed = dt > 0 ? (last.a - first.a) / dt : 0;
    // Too gentle to count as a spin: the wheel just stays where it was put.
    if (Math.abs(speed) < 0.2) return;
    // The distance a wheel let go at this speed would roll before stopping.
    letGo((Math.sign(speed) * speed * speed) / (2 * FRICTION));
  };

  // Holding the button: a power bar fills and empties again; letting go
  // spins the wheel as hard as the bar shows.
  const startCharge = () => {
    if (stageRef.current !== "ready") return;
    setStage("charging");
    charge.current = { start: performance.now(), power: 0 };
    const fill = (now: number) => {
      if (stageRef.current !== "charging") return;
      const k = ((now - charge.current.start) / CHARGE_MS) % 2;
      charge.current.power = k < 1 ? k : 2 - k;
      setPower(charge.current.power);
      frame.current = requestAnimationFrame(fill);
    };
    frame.current = requestAnimationFrame(fill);
  };
  const endCharge = () => {
    if (stageRef.current !== "charging") return;
    letGo(360 + charge.current.power * 360 * 4);
  };
  // A click with no press and release before it (a screen reader's, say)
  // still spins the wheel, with a middling push.
  const clickSpin = () => {
    if (stageRef.current === "ready") letGo(360 * 2.5);
  };
  const key = (e: React.KeyboardEvent, down: boolean) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && !e.repeat) startCharge();
    if (!down) endCharge();
  };

  return (
    <div className={`round-draw ${stage}`}>
      <p className="round-draw-title">🎁 {t("Lucky draw")}</p>
      <div
        className="wheel-box"
        ref={box}
        onPointerDown={onWheelDown}
        onPointerMove={onWheelMove}
        onPointerUp={onWheelUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <Wheel turn={turn} won={stage === "landed" ? won : 0} />
        <span className="wheel-pin" aria-hidden />
      </div>
      {stage === "landed" ? (
        <p className="round-won" role="status">
          {t("You won")} <strong>✹ {t("Supernova")} ×{won}</strong>
          {won === JACKPOT ? ` · ${t("Jackpot!")}` : ""}
        </p>
      ) : (
        <>
          <button
            className="button big draw-button"
            disabled={stage === "spinning"}
            onPointerDown={startCharge}
            onPointerUp={endCharge}
            onPointerLeave={endCharge}
            onKeyDown={(e) => key(e, true)}
            onKeyUp={(e) => key(e, false)}
            onClick={clickSpin}
            onContextMenu={(e) => e.preventDefault()}
          >
            {stage === "spinning" ? t("Spinning…") : stage === "charging" ? t("Let go to spin!") : t("Spin the wheel")}
          </button>
          <div className="draw-power" aria-hidden style={{ visibility: stage === "charging" ? "visible" : "hidden" }}>
            <span style={{ width: `${Math.round(power * 100)}%` }} />
          </div>
          {stage === "ready" && <p className="draw-hint">{t("Swipe the wheel, or hold the button: the harder the push, the longer it spins.")}</p>}
        </>
      )}
    </div>
  );
}
const SLICE_COLORS: Record<number, string> = { 1: "#22306e", 2: "#5a2a9c", 3: "#0b7a4a", 5: "#d9a21b" };

/** The lucky draw's wheel: a slice for each twentieth of the odds. */
function Wheel({ turn, won }: { turn: number; won: number }) {
  const step = (Math.PI * 2) / WHEEL.length;
  const at = (angle: number, r: number) => [Math.sin(angle) * r, -Math.cos(angle) * r].map((n) => n.toFixed(2)).join(" ");
  return (
    <svg
      className="wheel"
      viewBox="-104 -104 208 208"
      aria-hidden
      style={{ transform: `rotate(${turn}deg)` }}
    >
      <circle r="100.5" fill="#120e26" stroke="#ffe9a8" strokeWidth="5" />
      {WHEEL.map((novas, i) => {
        const mid = (i + 0.5) * step;
        const [x, y] = at(mid, 78).split(" ");
        return (
          <g key={i} className={won && novas !== won ? "dim" : ""}>
            <path d={`M0 0 L${at(i * step, 98)} A98 98 0 0 1 ${at((i + 1) * step, 98)} Z`} fill={SLICE_COLORS[novas]} stroke="#ffe9a8" strokeWidth="1" />
            <text x={x} y={y} transform={`rotate(${((mid * 180) / Math.PI).toFixed(1)} ${x} ${y})`} textAnchor="middle" dominantBaseline="central">
              {novas}
            </text>
          </g>
        );
      })}
      <circle r="20" fill="#1a1436" stroke="#ffe9a8" strokeWidth="3" />
      <text className="hub" textAnchor="middle" dominantBaseline="central">
        ✹
      </text>
    </svg>
  );
}

// -------------------------------------------------------------------- shop

const UPGRADE_TEXT: Record<UpgradeKind, { name: string; what: string }> = {
  moves: { name: "Extra moves", what: "Every level starts with more moves: +1 a tier." },
  blaster: { name: "Line blasters", what: "Every level starts with a line blaster on the board: one more a tier." },
  bomb: { name: "Bombs", what: "Every level starts with a bomb on the board: one more a tier." },
  prism: { name: "Prisms", what: "Every level starts with a prism on the board: one more a tier." },
  fever: { name: "Fever charge", what: "The Fever meter fills 15% faster a tier." },
  undo: { name: "Undo", what: "Undo is free up to level 100. After that, each tier gives one undo a level." },
};

function Shop(props: {
  owned: Owned;
  signedIn: boolean;
  buying: string | null;
  note: string;
  onBuy: (kind: UpgradeKind) => void;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="gem-end" role="dialog" aria-label={t("Upgrades")}>
      <div className="gem-panel shop">
        <div className="shop-head">
          <div>
            <p className="eyebrow">{t("Spend your dingn coins")}</p>
            <h2>{t("Upgrades")}</h2>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label={t("Close")}>
            ✕
          </button>
        </div>
        <p className="shop-intro">{t("Upgrades are yours to keep and work on every level. The daily board stays the same for everyone.")}</p>
        {!props.signedIn && (
          <p className="shop-signin">
            <button className="button" onClick={props.onSignIn}>
              {t("Sign in to buy upgrades")}
            </button>
          </p>
        )}
        <ul className="shop-list">
          {UPGRADE_KINDS.map((kind) => {
            const have = props.owned[kind];
            const tiers = PRICES[kind].length;
            const next = nextTier(kind, props.owned);
            return (
              <li key={kind} className={`shop-item kind-${kind}`}>
                <span className={`shop-icon icon-${kind}`} aria-hidden />
                <div className="shop-text">
                  <h3>{t(UPGRADE_TEXT[kind].name)}</h3>
                  <p>{t(UPGRADE_TEXT[kind].what)}</p>
                  <div className="tiers" aria-label={t("Tier {0} of {1}", String(have), String(tiers))}>
                    {Array.from({ length: tiers }, (_, i) => (
                      <i key={i} className={i < have ? "on" : ""} />
                    ))}
                  </div>
                </div>
                {next ? (
                  <button
                    className="button buy"
                    disabled={!!props.buying || !props.signedIn}
                    onClick={() => props.onBuy(kind)}
                  >
                    <span className="coin" aria-hidden /> {next.price}
                  </button>
                ) : (
                  <span className="maxed">{t("Maxed")}</span>
                )}
              </li>
            );
          })}
        </ul>
        {props.note && <p className="shop-note">{props.note}</p>}
      </div>
    </div>
  );
}
