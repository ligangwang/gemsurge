// The game screens: the level map, a level in play with its HUD, the end of
// a level, and the upgrade shop. The 3D board (gem-scene.ts) stays mounted
// behind them all.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findHint, type Pos } from "./engine/board";
import { FEVER_MOVES, FREE_UNDO_LEVELS, Session, type Goal, type Turn } from "./engine/session";
import { version } from "../game.json";
import { AnimationCancelled, CHEERS, GEM_OUTLINES, GemScene, STONE_CSS, type Collected } from "./gem-scene";
import { useDingn, useLocale } from "./dingn";
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
import { highest, loadSaved, merge, novaCharge, novas, store, type Saved } from "./save";
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
import { DRAW, ROUND, WHEEL, draw, isMilestone, lastLevelOf, rewardOf, roundOf, sliceFor, storyOf, titleOf, worldOf } from "./rounds";

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
};
type RoundEnd = {
  round: number;
  /** Supernovas from the round's reward and from the lucky draw. */
  novas: number;
  luck: { index: number; novas: number };
  /** dingn coins paid for the round, or null when signed out. */
  coins: number | null;
};

const HINT_AFTER = 7000;

export function GemGame({ initial, prefs }: { initial: Saved; prefs: { muted: boolean } }) {
  const sdk = useDingn();
  const { t } = useLocale();
  const [saved, setSaved] = useState(initial);
  const [screen, setScreen] = useState<Screen>("menu");
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
  const goalsDone = useRef<number[]>([]);
  const landed = (key: string) =>
    setGoalsShown((now) => {
      const i = session.current?.progress().findIndex((g) => goalKey(g.goal) === key) ?? -1;
      if (!now || i < 0) return now;
      const next = [...now];
      next[i] = Math.min(next[i] + 1, goalsDone.current[i] ?? next[i]);
      return next;
    });
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
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

  useEffect(() => setMuted(muted), [muted]);

  // The upgrades the player owns, and their account's progress merged with
  // this device's, again after they sign in.
  useEffect(() => {
    let live = true;
    badges.reset();
    loadOwned(sdk).then((o) => live && setOwned(o));
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
    s.setBannerListener((text, shown) => CHEERS.has(text) && say(shown, sdk.locale));
    scene.current = s;
    // A board to look at behind the menu.
    const demo = new Session(levelSpec(Math.max(1, top)));
    s.setBoard(demo.board.cells, [], demo.spec.world, worldCycle(demo.spec.level));
    s.setInput(false);
    return () => {
      s.dispose();
      scene.current = null;
      clearTimeout(hintTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlock = (ids: string[]) => {
    badges.unlock(sdk, ids).catch(() => {});
  };

  function start(level: number) {
    const spec = level === 0 ? dailySpec(today) : levelSpec(level);
    const s = new Session(spec, level === 0 ? boostsFor(NONE) : boostsFor(owned));
    session.current = s;
    setShown(0);
    setEnd(null);
    setScreen("play");
    rerender();
    scene.current?.setBoard(s.board.cells, s.board.ice, spec.world, worldCycle(spec.level));
    scene.current?.setInput(true);
    scene.current?.banner(level === 0 ? "Daily board" : `Level ${level}`, 2);
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

  /** Plays a swap, or a Supernova when there is no `pair`. */
  async function play(pair: [Pos, Pos] | null) {
    const s = session.current;
    const sc = scene.current;
    if (!s || !sc || busy.current || screen !== "play") return;
    if (!pair && (s.outcome || !s.spec.level || novas(savedRef.current) < 1)) return;
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
        const next = { ...savedRef.current, novasUsed: savedRef.current.novasUsed + 1 };
        savedRef.current = next;
        setSaved(next);
        store(sdk, next).catch(() => {});
        sc.banner("Supernova!", 6);
      }
      // The goals fill as their pieces land, not all at once.
      goalsDone.current = s.progress().map((g) => g.have);
      setGoalsShown(goalsBefore);
      rerender();
      let running = before;
      await sc.playTurn(turn, pair, {
        onStep: (_, points) => {
          running += points;
          setShown(running);
        },
      });
      setShown(s.score);
      setGoalsShown(null);
      if (turn.feverStarted) {
        sc.banner("Fever!", 6);
        sfx.fever();
      }
      sc.setFever(s.fever);
      unlock(playBadges(s));
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
      setGoalsShown(null);
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
    sc.setBoard(s.board.cells, s.board.ice, s.spec.world, worldCycle(s.spec.level));
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
      sc.banner(s.movesLeft > 0 ? "Surge!" : "Clear!", 6);
      sfx.win();
      const surge = s.finish();
      if (surge) {
        const from = s.score - surge.points;
        let running = from;
        await sc.playTurn(surge, null, {
          onStep: (_, p) => {
            running += p;
            setShown(running);
          },
        });
      }
      setShown(s.score);
      await sc.celebrate();
    } else {
      sfx.lose();
      sc.banner("Out of moves", 1);
    }
    await reward(s);
  }

  async function reward(s: Session, show = true) {
    if (rewarded.has(s)) return;
    rewarded.add(s);
    const won = s.outcome === "won";
    const level = s.spec.level;
    const stars = s.stars;
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
        const luck = draw(Math.random());
        next.novasWon += prize.novas + luck.novas;
        round = { round: roundOf(level), novas: prize.novas, luck, coins: null };
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
    setEnd({ outcome: won ? "won" : "lost", stars, score: s.score, coins: paid, chain: chainPaid, note, best, novas: charged, round });
    if (round) {
      scene.current?.banner("Round complete!", 6);
      sfx.fanfare();
    }
    if (charged) setTimeout(() => sfx.fever(), 900);
    setScreen("end");
    stars && [1, 2, 3].slice(0, stars).forEach((n, i) => setTimeout(() => sfx.star(n), 300 + i * 250));
  }

  function toMenu() {
    session.current = null;
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
      setShopNote(t("Upgrade bought! It works from your next level."));
      sfx.win();
    } else if (r === "poor") setShopNote(t("Not enough coins yet. Clear levels and the daily board to earn more."));
    else if (r === "failed") setShopNote(t("That didn't go through. Try again in a moment."));
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
          shown={shown}
          goalsShown={goalsShown}
          muted={muted}
          onMute={toggleMute}
          onMenu={toMenu}
          owned={owned}
          novas={novas(saved)}
          charge={novaCharge(saved)}
          onNova={() => play(null)}
          onUndo={undo}
          canNova={screen === "play" && !s.outcome}
        />
      )}

      {screen === "end" && end && s && end.round && (
        <RoundPanel
          end={end}
          round={end.round}
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
          onRetry={() => start(s.spec.level)}
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
          note={shopNote}
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
  shown: number;
  /** How much of each goal to show during a move, or null for the real progress. */
  goalsShown: number[] | null;
  muted: boolean;
  owned: Owned;
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
          <h2>{spec.level ? t("Level {0}", String(spec.level)) : utcDay()}</h2>
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
        <button className="secondary-button hud-undo" disabled={!props.canNova || !s.canUndo} onClick={props.onUndo}>
          ↶ {t("Undo")} ×{s.undosLeft}
        </button>
      )}
      {spec.level > FREE_UNDO_LEVELS && !props.owned.undo && (
        <p className="hud-note">{t("Buy Undo in Upgrades to use it after level 100.")}</p>
      )}
      {spec.level > 0 && s.chainCoins > 0 && (
        <p className="hud-note hud-chain">
          <span className="coin" aria-hidden /> {t("Chain reactions: +{0} coins", String(s.chainCoins))}
        </p>
      )}
      {spec.level > 0 && (
        <div className="hud-nova">
          <button className="button nova" disabled={!props.canNova || props.novas < 1} onClick={props.onNova}>
            <span className="nova-star" aria-hidden>
              ✹
            </span>
            {t("Supernova")} ×{props.novas}
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
        {daily && props.dailyBest > 0 && <p className="end-sub">{t("Your best today: {0}", props.dailyBest.toLocaleString())}</p>}
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
function RoundPanel(props: { end: EndInfo; round: RoundEnd; last: boolean; onNext: () => void; onMenu: () => void }) {
  const { t } = useLocale();
  const { end, round } = props;
  const title = titleOf(round.round + 1);
  const milestone = isMilestone(round.round);
  // The prize is already won and saved; the player spins the wheel to see it.
  const [stage, setStage] = useState<"ready" | "spinning" | "landed">("ready");
  const [turn, setTurn] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const spin = () => {
    if (stage !== "ready") return;
    const slice = sliceFor(round.luck.novas, Math.random());
    const step = 360 / WHEEL.length;
    // Six full turns, then on to the slice, stopping a little off its middle.
    setTurn(360 * 6 - (slice + 0.5) * step + (Math.random() - 0.5) * step * 0.6);
    setStage("spinning");
    // Ticks that slow down with the wheel.
    for (let i = 0, at = 0; at < SPIN_MS - 300; i++) {
      timers.current.push(setTimeout(() => sfx.select(), at));
      at += 60 + i * i * 1.6;
    }
    timers.current.push(
      setTimeout(() => {
        setStage("landed");
        if (round.luck.index === DRAW.length - 1) sfx.fanfare();
        else sfx.star(3);
      }, SPIN_MS),
    );
  };
  const landed = stage === "landed";
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
        <div className={`round-draw ${stage}`}>
          <p className="round-draw-title">🎁 {t("Lucky draw")}</p>
          <div className="wheel-box">
            <Wheel turn={turn} won={landed ? round.luck.novas : 0} />
            <span className="wheel-pin" aria-hidden />
          </div>
          {landed ? (
            <p className="round-won" role="status">
              {t("You won")} <strong>✹ {t("Supernova")} ×{round.luck.novas}</strong>
              {round.luck.index === DRAW.length - 1 ? ` · ${t("Jackpot!")}` : ""}
            </p>
          ) : (
            <button className="button big" onClick={spin} disabled={stage !== "ready"}>
              {stage === "ready" ? t("Spin the wheel") : t("Spinning…")}
            </button>
          )}
        </div>
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

/** How long the wheel turns before it stops. */
const SPIN_MS = 4200;
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
      style={{ transform: `rotate(${turn}deg)`, transitionDuration: `${SPIN_MS}ms` }}
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
