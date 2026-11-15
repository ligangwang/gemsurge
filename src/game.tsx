// The game screens: the level map, a level in play with its HUD, the end of
// a level, and the upgrade shop. The 3D board (gem-scene.ts) stays mounted
// behind them all.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findHint, type Pos } from "./engine/board";
import { FEVER_MOVES, Session, type Goal, type Turn } from "./engine/session";
import { GEM_CSS, GemScene } from "./gem-scene";
import { useDingn, useLocale } from "./dingn";
import {
  COLOR_NAMES,
  DAILY_COINS,
  LAST_LEVEL,
  LEVELS_PER_WORLD,
  WORLDS,
  coinsFor,
  dailySpec,
  levelSpec,
  utcDay,
} from "./levels";
import { badges, endBadges, playBadges } from "./badges";
import { highest, store, type Saved } from "./save";
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
import { isMuted, music, setMuted, sfx } from "./sound";

type Screen = "menu" | "play" | "end" | "shop";
type EndInfo = {
  outcome: "won" | "lost";
  stars: number;
  score: number;
  coins: number | null;
  /** Why no coins were paid, when none were. */
  note: string;
  best: boolean;
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
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [shopNote, setShopNote] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<GemScene | null>(null);
  const session = useRef<Session | null>(null);
  const busy = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const rerender = () => setTick((n) => n + 1);
  const signedIn = sdk.player.signedIn;
  const top = highest(saved);
  const today = utcDay();
  const dailyDone = saved.daily?.day === today;

  useEffect(() => setMuted(muted), [muted]);

  // The upgrades the player owns, again after they sign in.
  useEffect(() => {
    let live = true;
    badges.reset();
    loadOwned(sdk).then((o) => live && setOwned(o));
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
      });
    } catch (err) {
      console.warn("Gem Surge: no WebGL", err);
      setWebgl(false);
      return;
    }
    s.setBannerTranslator(t);
    scene.current = s;
    // A board to look at behind the menu.
    const demo = new Session(levelSpec(Math.max(1, top)));
    s.setBoard(demo.board.cells, [], demo.spec.world);
    s.setInput(false);
    return () => {
      s.dispose();
      scene.current = null;
      clearTimeout(hintTimer.current);
      music(-1);
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
    scene.current?.setBoard(s.board.cells, s.board.ice, spec.world);
    scene.current?.setInput(true);
    scene.current?.banner(level === 0 ? "Daily board" : `Level ${level}`, 2);
    if (!isMuted()) music(spec.world);
    armHint();
  }

  // A handle for the browser checks while developing.
  if (import.meta.env.DEV)
    (window as unknown as { gemsurge: unknown }).gemsurge = { session, hint: () => session.current && findHint(session.current.board), swap: (a: Pos, b: Pos) => onSwap.current(a, b), start };

  onSwap.current = async (a, b) => {
    const s = session.current;
    const sc = scene.current;
    if (!s || !sc || busy.current || screen !== "play") return;
    busy.current = true;
    sc.setInput(false);
    clearTimeout(hintTimer.current);
    sc.showHint(null);
    try {
      const before = s.score;
      const turn = s.move(a, b);
      if (!turn) {
        await sc.playInvalid(a, b);
        return;
      }
      rerender();
      let running = before;
      await sc.playTurn(turn, [a, b], {
        onStep: (_, points) => {
          running += points;
          setShown(running);
        },
      });
      setShown(s.score);
      if (turn.feverStarted) {
        sc.banner("Fever!", 6);
        sfx.fever();
      }
      sc.setFever(s.fever);
      unlock(playBadges(s));
      rerender();
      if (s.outcome) await finish(s);
    } finally {
      busy.current = false;
      if (session.current === s && !s.outcome) {
        sc.setInput(true);
        armHint();
      }
    }
  };

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

  async function reward(s: Session) {
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
    let note = "";
    if (level > 0) {
      best = s.score > next.best[level - 1];
      next.stars[level - 1] = Math.max(next.stars[level - 1], stars);
      next.best[level - 1] = Math.max(next.best[level - 1], s.score);
      if (won) coins = coinsFor(level, stars);
      else if (s.progress().some((g) => g.have >= g.target / 2)) coins = 1;
    } else {
      const prev = next.daily?.day === today ? next.daily : null;
      best = !prev || s.score > prev.score;
      const pay = won && !prev?.paid;
      if (pay) coins = DAILY_COINS;
      else if (won) note = "Today's daily coins are already paid.";
      next.daily = { day: today, score: Math.max(prev?.score ?? 0, s.score), paid: !!prev?.paid || pay };
    }
    setSaved(next);
    store(sdk, next).catch(() => {});
    unlock(endBadges(s, highest(next)));
    let paid: number | null = null;
    if (coins > 0) {
      if (!signedIn) note = "Sign in to earn coins and badges";
      else {
        try {
          const r = await sdk.rewards.earn(coins);
          paid = r.coins;
          if (!r.coins) note = "You've earned all of today's coins from this game.";
        } catch {
          note = "Coins couldn't be paid just now.";
        }
      }
    }
    setEnd({ outcome: won ? "won" : "lost", stars, score: s.score, coins: paid, note, best });
    setScreen("end");
    stars && [1, 2, 3].slice(0, stars).forEach((n, i) => setTimeout(() => sfx.star(n), 300 + i * 250));
  }

  function toMenu() {
    session.current = null;
    clearTimeout(hintTimer.current);
    scene.current?.setInput(false);
    scene.current?.setFever(false);
    scene.current?.showHint(null);
    music(-1);
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
    if (!m && screen === "play" && session.current) music(session.current.spec.world);
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
          muted={muted}
          onMute={toggleMute}
          onMenu={toMenu}
          owned={owned}
        />
      )}

      {screen === "end" && end && s && (
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
      </header>
      <section className="gem-worlds" aria-label={t("Levels")}>
        <p className="eyebrow">
          {t("Levels")} · ★ {props.totalStars} / {LAST_LEVEL * 3}
        </p>
        {WORLDS.map((w, wi) => (
          <div key={w.id} className={`gem-world world-${w.id}`}>
            <h3>{t(w.name)}</h3>
            <div className="gem-levels">
              {Array.from({ length: LEVELS_PER_WORLD }, (_, k) => {
                const n = wi * LEVELS_PER_WORLD + k + 1;
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
        ))}
      </section>
    </div>
  );
}

// --------------------------------------------------------------------- HUD

function GoalIcon({ goal }: { goal: Goal }) {
  if (goal.kind === "color")
    return <span className={`goal-gem gem-${goal.color}`} style={{ background: GEM_CSS[goal.color] }} />;
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
  muted: boolean;
  owned: Owned;
  onMute: () => void;
  onMenu: () => void;
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
        {s.progress().map((g, i) => (
          <div key={i} className={`goal${g.done ? " done" : ""}`}>
            <GoalIcon goal={g.goal} />
            <span className="goal-label">{goalLabel(g.goal, t)}</span>
            <span className="goal-count">
              {g.done ? "✓" : `${g.have.toLocaleString()} / ${g.target.toLocaleString()}`}
            </span>
          </div>
        ))}
        {spec.allMoves && <p className="goal-note">{t("Use all {0} moves. Everyone gets this board today.", String(spec.moves))}</p>}
      </div>
      <div className={`hud-fever${s.fever ? " on" : ""}`}>
        <p className="eyebrow">{s.fever ? t("Fever ×2 · {0} moves", String(s.feverMoves)) : t("Fever")}</p>
        <div className="fever-bar">
          <div className="fill" style={{ width: `${(s.fever ? s.feverMoves / FEVER_MOVES : s.meter) * 100}%` }} />
        </div>
      </div>
      {boosts && <p className="hud-boosts">{t("Upgrades")}: {boosts}</p>}
      <details className="hud-help">
        <summary>{t("How to play")}</summary>
        <ul>
          <li>{t("Drag a gem onto a neighbour, or click two neighbours, to swap them.")}</li>
          <li>{t("Line up 4 for a line blaster, an L or T for a bomb, 5 for a prism.")}</li>
          <li>{t("Swap two specials together for a bigger blast.")}</li>
          <li>{t("Chains and blasts fill the Fever meter: Fever doubles your points for 3 moves.")}</li>
          <li>{t("Moves left at the end turn into blasters for a final surge.")}</li>
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
          </p>
        )}
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

// -------------------------------------------------------------------- shop

const UPGRADE_TEXT: Record<UpgradeKind, { name: string; what: string }> = {
  moves: { name: "Extra moves", what: "Every level starts with more moves: +1 a tier." },
  blaster: { name: "Line blasters", what: "Every level starts with a line blaster on the board: one more a tier." },
  bomb: { name: "Bombs", what: "Every level starts with a bomb on the board: one more a tier." },
  prism: { name: "Prisms", what: "Every level starts with a prism on the board: one more a tier." },
  fever: { name: "Fever charge", what: "The Fever meter fills 15% faster a tier." },
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
