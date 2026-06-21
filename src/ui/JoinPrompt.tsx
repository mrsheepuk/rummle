import { useState } from "react";
import { NAME_KEY } from "../constants";
import { joinGame } from "../sync/gameSync";
import type { GameState } from "../state/model";

/**
 * Shown when a signed-in user lands on `/g/CODE` (e.g. via a share link) but
 * isn't yet a member of the game. They see who's already in, then confirm a
 * display name to join — pre-filled with their remembered name so it's a single
 * click. Joining just adds them via `joinGame`; the live game subscription then
 * picks up their membership and `App` routes them into the lobby.
 */
export function JoinPrompt({
  game,
  onLeave,
}: {
  game: GameState;
  onLeave: () => void;
}) {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);

  async function join() {
    if (!name.trim()) return setError("Enter a display name first");
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(NAME_KEY, name.trim());
      await joinGame(game.id, name.trim());
      // Success: the subscription will re-render us into the lobby, so we
      // intentionally stay "busy" until this component unmounts.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join game");
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <div className="card">
        <h2>Join game</h2>

        <div className="code-display">
          <span className="code-label">Share code</span>
          <span className="code-value">{game.id}</span>
        </div>

        <ul className="player-list">
          {players.map((p) => (
            <li key={p.uid}>
              <span className="seat">{p.seat + 1}</span>
              <span className="name">{p.name}</span>
              {p.uid === game.hostId && <span className="badge">Host</span>}
            </li>
          ))}
        </ul>

        <label className="field">
          <span>Display name</span>
          <input
            value={name}
            maxLength={20}
            placeholder="e.g. Alex"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void join();
            }}
          />
        </label>

        <button className="btn btn-primary" disabled={busy} onClick={join}>
          Join game
        </button>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-link" onClick={onLeave}>
          Back home
        </button>
      </div>
    </div>
  );
}
