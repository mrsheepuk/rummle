import { useState } from "react";
import { beginGame } from "../sync/gameSync";
import { MAX_PLAYERS, MIN_PLAYERS, type GameState } from "../state/model";

export function Lobby({
  game,
  me,
  onLeave,
}: {
  game: GameState;
  me: string;
  onLeave: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);
  const isHost = game.hostId === me;
  const canStart = players.length >= MIN_PLAYERS;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await beginGame(game.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start game");
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    const url = `${location.origin}${location.pathname}#/g/${game.id}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  }

  return (
    <div className="lobby">
      <div className="card">
        <h2>Game lobby</h2>

        <div className="code-display">
          <span className="code-label">Share code</span>
          <span className="code-value">{game.id}</span>
          <button className="btn btn-small" onClick={copyLink}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>

        <ul className="player-list">
          {players.map((p) => (
            <li key={p.uid} className={p.uid === me ? "me" : ""}>
              <span className="seat">{p.seat + 1}</span>
              <span className="name">{p.name}</span>
              {p.uid === game.hostId && <span className="badge">Host</span>}
              {p.uid === me && <span className="badge badge-you">You</span>}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - players.length }).map((_, i) => (
            <li key={`empty-${i}`} className="empty-slot">
              <span className="seat">{players.length + i + 1}</span>
              <span className="name">Waiting…</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <button className="btn btn-primary" disabled={!canStart || busy} onClick={start}>
            {canStart ? "Start game" : `Need ${MIN_PLAYERS}+ players`}
          </button>
        ) : (
          <p className="hint">Waiting for the host to start…</p>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-link" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
