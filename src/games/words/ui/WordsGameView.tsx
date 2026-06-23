import { useEffect, useMemo, useRef, useState } from "react";
import { playTurnComplete, playWin } from "../../../ui/sounds";
import { buildIndex, currentPlayerId, scorePlay } from "../engine";
import { commitWordsPlay, exchangeWordsTiles, passWordsTurn } from "../sync";
import { GameError } from "../../../platform/model";
import type { WordsGameState, Placement } from "../model";
import { LetterTile } from "./LetterTile";
import { WordsBoard } from "./WordsBoard";

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
  const [staged, setStaged] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = currentPlayerId(game);
  const myTurn = activeId === me && game.status === "playing";
  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);

  // Clear the working play whenever the turn or committed board moves.
  useEffect(() => {
    setStaged([]);
    setSelected(null);
    setError(null);
  }, [game.currentTurn, game.board.length, game.status]);

  // Turn chime / win flourish, matching Rummle's GameView.
  const [prevTurn, prevStatus] = [useRef(game.currentTurn), useRef(game.status)];
  useEffect(() => {
    if (game.status === "finished" && prevStatus.current !== "finished") playWin();
    else if (game.status === "playing" && game.currentTurn !== prevTurn.current) playTurnComplete();
    prevTurn.current = game.currentTurn;
    prevStatus.current = game.status;
  }, [game.currentTurn, game.status]);

  const stagedIds = new Set(staged.map((p) => p.tileId));
  const rackTiles = (game.racks[me] ?? [])
    .filter((id) => !stagedIds.has(id))
    .map((id) => index.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t);

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

  function placeAt(r: number, c: number) {
    if (!myTurn || !selected) return;
    const tile = index.get(selected);
    if (!tile) return;
    let letter = tile.letter ?? "";
    if (tile.isBlank) {
      const ans = window.prompt("Assign a letter to the blank (A–Z):")?.trim().toUpperCase();
      if (!ans || !/^[A-Z]$/.test(ans)) return setError("A blank needs a single letter A–Z");
      letter = ans;
    }
    setStaged((s) => [...s, { r, c, tileId: selected, letter }]);
    setSelected(null);
    setError(null);
  }

  function recall(tileId: string) {
    setStaged((s) => s.filter((p) => p.tileId !== tileId));
  }

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

  const onCommit = () => run(() => commitWordsPlay(game.id, staged));
  const onPass = () => run(() => passWordsTurn(game.id));
  const onExchange = () => {
    if (!selected) return setError("Select a rack tile to exchange first");
    void run(() => exchangeWordsTiles(game.id, [selected])).then(() => setSelected(null));
  };

  const winner = game.winnerId ? game.players[game.winnerId]?.name : null;

  return (
    <div className="game wgame">
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
        staged={staged}
        index={index}
        interactive={myTurn}
        onPlace={placeAt}
        onRecall={recall}
      />

      <div className="wrack">
        {rackTiles.map((tile) => (
          <LetterTile
            key={tile.id}
            tile={tile}
            selected={selected === tile.id}
            onClick={myTurn ? () => setSelected((s) => (s === tile.id ? null : tile.id)) : undefined}
          />
        ))}
        {rackTiles.length === 0 && <span className="hint">Rack empty.</span>}
      </div>

      {preview && (
        <p className={`wpreview${preview.error ? " is-bad" : ""}`}>
          {preview.error ?? `+${preview.score} points`}
        </p>
      )}
      {error && <p className="error game-error">{error}</p>}

      <footer className="action-bar">
        {game.status === "finished" ? (
          <span className="hint">Game over.</span>
        ) : myTurn ? (
          <>
            <button className="btn btn-action is-reset" disabled={busy || staged.length === 0} onClick={() => setStaged([])}>
              Recall
            </button>
            {staged.length > 0 ? (
              <button className="btn btn-action is-commit" disabled={busy || !!preview?.error} onClick={onCommit}>
                Commit play
              </button>
            ) : (
              <>
                <button className="btn btn-action is-draw" disabled={busy || !selected} onClick={onExchange}>
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
