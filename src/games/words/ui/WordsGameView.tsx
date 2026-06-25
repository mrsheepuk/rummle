import { useEffect, useMemo, useRef, useState } from "react";
import { playTurnComplete, playWin } from "../../../ui/sounds";
import { buildIndex, currentPlayerId, scorePlay } from "../engine";
import { commitWordsPlay, exchangeWordsTiles, passWordsTurn } from "../sync";
import { GameError } from "../../../platform/model";
import type { WordsGameState } from "../model";
import { WordsBoard, type WordsBoardHandle } from "./WordsBoard";

export function WordsGameView({
  game,
  me,
  onLeave,
  stale,
}: {
  game: WordsGameState;
  me: string;
  onLeave: () => void;
  stale: boolean;
}) {
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

  const activeId = currentPlayerId(game);
  const myTurn = activeId === me && game.status === "playing";
  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);

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

  const onCommit = () => run(() => commitWordsPlay(game.id, handle.current.staged));
  const onPass = () => run(() => passWordsTurn(game.id));
  const onRecall = () => {
    setError(null);
    setResetNonce((k) => k + 1);
  };
  const onExchange = () => {
    if (handle.current.exchange.length === 0) return setError("Drag tiles into the exchange tray first");
    void run(() => exchangeWordsTiles(game.id, handle.current.exchange)).then(() => setResetNonce((k) => k + 1));
  };

  const winner = game.winnerId ? game.players[game.winnerId]?.name : null;
  const working = staged.length > 0 || exchange.length > 0;

  return (
    <div className={`game wgame${zoomed ? "" : " fit"}`}>
      <header className="game-bar">
        <div className="turn-track">
          {players.map((p) => (
            <div
              key={p.uid}
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
            {zoomed ? "⛶" : "🔍"}
          </button>
          <button className="btn btn-icon" aria-label="Home" onClick={onLeave}>
            ⎋
          </button>
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
        board={game.board}
        rack={game.racks[me] ?? []}
        index={index}
        myTurn={myTurn}
        zoomed={zoomed}
        storageKey={`words:rack:${game.id}:${me}`}
        resetNonce={resetNonce}
        onChange={(h) => {
          handle.current = h;
          setStaged(h.staged);
          setExchange(h.exchange);
        }}
      />

      {myTurn && preview && (
        <p className={`wpreview${preview.error ? " is-bad" : ""}`}>
          {preview.error ?? `+${preview.score} points`}
        </p>
      )}
      {myTurn && !preview && exchange.length > 0 && (
        <p className="wpreview is-muted">{exchange.length} tile{exchange.length > 1 ? "s" : ""} to exchange</p>
      )}
      {error && <p className="error game-error">{error}</p>}

      <footer className="action-bar">
        {game.status === "finished" ? (
          <span className="hint">Game over.</span>
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
