import { useEffect, useMemo, useRef, useState } from "react";
import { playRemoteTick, playTurnComplete, playWin } from "../../../ui/sounds";
import { useTurnNotification } from "../../../ui/useTurnNotification";
import { NotifyMenuItem } from "../../../ui/NotifyMenuItem";
import { buildIndex, currentPlayerId, scorePlay } from "../engine";
import {
  challengeWordsPlay,
  commitWordsPlay,
  exchangeWordsTiles,
  passWordsTurn,
  publishWordsDraft,
  respondWordsChallenge,
  subscribeWordsDraft,
  type WordsDraft,
} from "../sync";
import { GameError, GAME_LABELS } from "../../../platform/model";
import type { Placement, WordsGameState } from "../model";
import { WordsBoard, type WordsBoardHandle } from "./WordsBoard";
import { useActiveChipScroll } from "../../../ui/useActiveChipScroll";

const DRAFT_THROTTLE_MS = 300;

export function WordsGameView({
  game,
  me: meProp,
  onLeave,
  stale,
}: {
  game: WordsGameState;
  me: string;
  onLeave: () => void;
  stale: boolean;
}) {
  // `?test` lets one host drive every seat: the effective player is always
  // whoever is to move, so committing/passing hands you to the next player.
  const testMode = new URLSearchParams(location.search).has("test");
  const activeId = currentPlayerId(game);
  const me = testMode && activeId ? activeId : meProp;

  const index = useMemo(() => buildIndex(game), [game.seed]);
  const handle = useRef<WordsBoardHandle>({ staged: [], exchange: [] });
  const [resetNonce, setResetNonce] = useState(0);
  const [staged, setStaged] = useState(handle.current.staged);
  const [exchange, setExchange] = useState(handle.current.exchange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Board view: fit-whole-board by default; the game-bar button toggles to the
  // zoomed-in slippy view.
  const [zoomed, setZoomed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<WordsDraft | null>(null);

  const activeChipRef = useActiveChipScroll(activeId);
  const myTurn = activeId === me && game.status === "playing";
  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);

  // Ping the player when it becomes their turn while they're away (matches
  // Numbers). Suppressed under ?test, where one host drives every seat.
  useTurnNotification({
    enabled: game.status === "playing" && !testMode,
    myTurn,
    currentTurn: game.currentTurn,
    turnOrder: game.turnOrder,
    players: game.players,
    gameId: game.id,
    gameLabel: GAME_LABELS[game.gameType],
  });

  // Watch the active player's in-progress turn (quasi-real-time), and mirror it
  // read-only when it's not our turn and it's for the current turn/player.
  useEffect(() => subscribeWordsDraft(game.id, setDraft), [game.id]);
  const spectated =
    !myTurn && draft && draft.turn === game.currentTurn && draft.uid === activeId ? draft.placements : undefined;

  // Faint tick whenever a spectated move streams in (not on first appearance).
  const liveKey = spectated ? JSON.stringify(spectated) : null;
  const prevLiveKey = useRef<string | null>(null);
  useEffect(() => {
    if (liveKey !== null && prevLiveKey.current !== null && prevLiveKey.current !== liveKey) playRemoteTick();
    prevLiveKey.current = liveKey;
  }, [liveKey]);

  // Throttle draft publishing to keep writes human-paced, skipping unchanged
  // placements. Mirrors Rummle's GameView.
  const publish = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; last: string }>({
    at: 0,
    timer: null,
    last: "",
  });
  function publishLater(placements: Placement[]) {
    const key = JSON.stringify(placements);
    if (key === publish.current.last) return;
    publish.current.last = key;
    if (publish.current.timer) clearTimeout(publish.current.timer);
    const fire = () => {
      publish.current.at = Date.now();
      publish.current.timer = null;
      void publishWordsDraft(game.id, game.currentTurn, placements).catch(() => undefined);
    };
    const since = Date.now() - publish.current.at;
    if (since >= DRAFT_THROTTLE_MS) fire();
    else publish.current.timer = setTimeout(fire, DRAFT_THROTTLE_MS - since);
  }
  function cancelPendingPublish() {
    if (publish.current.timer) clearTimeout(publish.current.timer);
    publish.current.timer = null;
  }
  useEffect(() => cancelPendingPublish, []);

  // Turn chime / win flourish, matching Rummle's GameView.
  const prevTurn = useRef(game.currentTurn);
  const prevStatus = useRef(game.status);
  useEffect(() => {
    if (game.status === "finished" && prevStatus.current !== "finished") playWin();
    else if (game.status === "playing" && game.currentTurn !== prevTurn.current) playTurnComplete();
    prevTurn.current = game.currentTurn;
    prevStatus.current = game.status;
  }, [game.currentTurn, game.status]);

  // Live score preview reuses the pure engine — green total or the reason it's
  // illegal, before you commit.
  const preview = useMemo(() => {
    if (staged.length === 0) return null;
    try {
      return { score: scorePlay(game.board, staged, index), error: null as string | null };
    } catch (e) {
      return { score: null, error: e instanceof GameError ? e.message : "Illegal play" };
    }
  }, [staged, game.board, index]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const onCommit = () => {
    cancelPendingPublish();
    void run(() => commitWordsPlay(game.id, handle.current.staged, me));
  };
  const onPass = () => {
    cancelPendingPublish();
    void run(() => passWordsTurn(game.id, me));
  };
  const onRecall = () => {
    setError(null);
    setResetNonce((k) => k + 1);
  };
  const onExchange = () => {
    if (handle.current.exchange.length === 0) return setError("Drag tiles into the exchange tray first");
    cancelPendingPublish();
    void run(() => exchangeWordsTiles(game.id, handle.current.exchange, me)).then(() => setResetNonce((k) => k + 1));
  };
  const onChallenge = () => {
    cancelPendingPublish();
    setResetNonce((k) => k + 1); // drop any tiles you'd started staging
    void run(() => challengeWordsPlay(game.id, me));
  };
  const onRespond = (stand: boolean) => {
    if (!game.challenge) return;
    void run(() => respondWordsChallenge(game.id, stand, game.challenge!.against));
  };

  // Challenge state (self-policing — there's no dictionary). The active player
  // can challenge the previous play; the player who made it then decides.
  const challenge = game.challenge;
  const challengerName = challenge ? game.players[challenge.by]?.name ?? "Someone" : null;
  const challengedName = challenge ? game.players[challenge.against]?.name ?? "Someone" : null;
  // In `?test` mode one host drives every seat, so let them answer for the
  // challenged player too.
  const iAmChallenged = !!challenge && (testMode || meProp === challenge.against);
  const canChallenge = myTurn && !challenge && !!game.lastPlay && game.lastPlay.uid !== me;

  const winner = game.winnerId ? game.players[game.winnerId]?.name : null;
  const working = staged.length > 0 || exchange.length > 0;

  return (
    <div className={`game wgame${zoomed ? "" : " fit"}`}>
      <header className="game-bar">
        <div className="turn-track">
          {players.map((p) => (
            <div
              key={p.uid}
              ref={p.uid === activeId ? activeChipRef : undefined}
              className={`turn-chip${p.uid === activeId ? " active" : ""}${p.uid === me ? " me" : ""}`}
            >
              <span className="chip-name">{p.name}</span>
              <span className="chip-count">{game.scores[p.uid] ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="game-meta">
          <span className="pool-count">Bag {game.bag.length}</span>
          <button
            className="btn btn-icon"
            aria-label={zoomed ? "Fit whole board" : "Zoom in"}
            title={zoomed ? "Fit whole board" : "Zoom in"}
            onClick={() => setZoomed((z) => !z)}
          >
            {zoomed ? <FitIcon /> : <ZoomIcon />}
          </button>
          <div className="menu">
            <button
              className={`btn btn-icon menu-button${menuOpen ? " is-active" : ""}`}
              aria-label="Game menu"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ☰
            </button>
            {menuOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu-dropdown" role="menu">
                  {canChallenge && (
                    <button
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onChallenge();
                      }}
                    >
                      <span className="menu-ico" aria-hidden="true">⚑</span>
                      Challenge last play
                    </button>
                  )}
                  <NotifyMenuItem onDone={() => setMenuOpen(false)} />
                  <button className="menu-item" role="menuitem" onClick={onLeave}>
                    <span className="menu-ico" aria-hidden="true">⎋</span>
                    Home
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {stale && (
        <div className="offline-banner" role="status">
          <span className="offline-dot" aria-hidden="true" />
          Reconnecting… the board may be out of date.
        </div>
      )}

      {game.status === "finished" && (
        <div className="winner-banner">🎉 {winner ?? "Someone"} wins!</div>
      )}

      <WordsBoard
        key={me}
        board={game.board}
        rack={game.racks[me] ?? []}
        index={index}
        myTurn={myTurn && !challenge}
        zoomed={zoomed}
        spectated={spectated}
        storageKey={`words:rack:${game.id}:${me}`}
        resetNonce={resetNonce}
        onChange={(h) => {
          handle.current = h;
          setStaged(h.staged);
          setExchange(h.exchange);
          if (myTurn) publishLater(h.staged);
        }}
      />

      {challenge && (
        <p className="wpreview is-muted">
          {iAmChallenged
            ? `${challengerName} challenged your word — stand by it or withdraw.`
            : `${challengerName} challenged ${challengedName}'s word.`}
        </p>
      )}
      {!challenge && myTurn && preview && (
        <p className={`wpreview${preview.error ? " is-bad" : ""}`}>
          {preview.error ?? `+${preview.score} points`}
        </p>
      )}
      {!challenge && myTurn && !preview && exchange.length > 0 && (
        <p className="wpreview is-muted">{exchange.length} tile{exchange.length > 1 ? "s" : ""} to exchange</p>
      )}
      {error && <p className="error game-error">{error}</p>}

      <footer className="action-bar">
        {game.status === "finished" ? (
          <span className="hint">Game over.</span>
        ) : challenge ? (
          iAmChallenged ? (
            <>
              <button className="btn btn-action is-commit" disabled={busy} onClick={() => onRespond(true)}>
                Stand by word
              </button>
              <button className="btn btn-action is-reset" disabled={busy} onClick={() => onRespond(false)}>
                Withdraw
              </button>
            </>
          ) : (
            <span className="hint">{challengedName} is responding to the challenge…</span>
          )
        ) : myTurn ? (
          <>
            <button className="btn btn-action is-reset" disabled={busy || !working} onClick={onRecall}>
              Recall
            </button>
            {staged.length > 0 ? (
              <button className="btn btn-action is-commit" disabled={busy || !!preview?.error} onClick={onCommit}>
                Commit play
              </button>
            ) : (
              <>
                <button className="btn btn-action is-draw" disabled={busy || exchange.length === 0} onClick={onExchange}>
                  Exchange
                </button>
                <button className="btn btn-action" disabled={busy} onClick={onPass}>
                  Pass
                </button>
              </>
            )}
          </>
        ) : (
          <span className="hint">{game.players[activeId ?? ""]?.name ?? "…"} is thinking…</span>
        )}
      </footer>
    </div>
  );
}

// Line-style icons (stroke = currentColor) so the Zoom/Fit toggle is a matched
// monochrome pair rather than a colour emoji next to a glyph.
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function ZoomIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}
