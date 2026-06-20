import { useMemo, useRef, useState } from "react";
import type { GameState } from "../state/model";
import { buildIndex, currentPlayerId } from "../state/engine";
import { commitTurn, drawTile } from "../sync/gameSync";
import { Board, type BoardHandle } from "./Board";

export function GameView({
  game,
  me,
  onLeave,
}: {
  game: GameState;
  me: string;
  onLeave: () => void;
}) {
  const index = useMemo(() => buildIndex(game), [game.seed]);
  const handle = useRef<BoardHandle>({ table: game.table, rack: game.hands[me] ?? [], dirty: false });
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = currentPlayerId(game);
  const myTurn = activeId === me && game.status === "playing";
  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);
  const myRack = game.hands[me] ?? [];
  const opened = game.hasOpened[me];

  async function onDraw() {
    setBusy(true);
    setError(null);
    try {
      await drawTile(game.id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    setBusy(true);
    setError(null);
    try {
      await commitTurn(game.id, handle.current.table, handle.current.rack);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function onReset() {
    setError(null);
    setResetKey((k) => k + 1);
  }

  const winner = game.winnerId ? game.players[game.winnerId]?.name : null;

  return (
    <div className="game">
      <header className="game-bar">
        <div className="turn-track">
          {players.map((p) => {
            const handCount = game.hands[p.uid]?.length ?? 0;
            return (
              <div
                key={p.uid}
                className={`turn-chip${p.uid === activeId ? " active" : ""}${p.uid === me ? " me" : ""}`}
              >
                <span className="chip-name">{p.name}</span>
                <span className="chip-count">{handCount}</span>
              </div>
            );
          })}
        </div>
        <div className="game-meta">
          <span className="pool-count">Pool: {game.pool.length}</span>
          <button className="btn btn-link" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      {game.status === "finished" && (
        <div className="winner-banner">🎉 {winner ?? "Someone"} wins!</div>
      )}

      <Board
        key={resetKey}
        table={game.table}
        rack={myRack}
        index={index}
        interactive={myTurn}
        onChange={(h) => (handle.current = h)}
      />

      {error && <p className="error game-error">{error}</p>}

      <footer className="action-bar">
        {game.status === "finished" ? (
          <span className="hint">Game over.</span>
        ) : myTurn ? (
          <>
            {!opened && <span className="hint">Opening play must total 30+ points.</span>}
            <button className="btn" disabled={busy} onClick={onReset}>
              Reset
            </button>
            <button className="btn" disabled={busy} onClick={onDraw}>
              Draw &amp; pass
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={onCommit}>
              Commit play
            </button>
          </>
        ) : (
          <span className="hint">Waiting for {game.players[activeId ?? ""]?.name ?? "…"}…</span>
        )}
      </footer>
    </div>
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
