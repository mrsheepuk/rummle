import { useState } from "react";
import { useMyGames } from "./useMyGames";
import type { GameSummary } from "../sync/gameSync";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Your games" — lets a returning player jump back into, or switch between, any
 * game they're in without re-entering a code. Identity is the anonymous uid, so
 * this is just navigation: tapping a card routes to `/g/CODE`.
 *
 * Games idle for more than 24h fold away behind "Show older" to keep the list
 * focused on what's active. Sorted most-recently-active first by the query.
 */
export function MyGames({
  uid,
  currentId,
  onOpen,
}: {
  uid: string;
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  const { games, loading } = useMyGames(uid);
  const [showOlder, setShowOlder] = useState(false);

  if (loading || games.length === 0) return null;

  const now = Date.now();
  const recent = games.filter((g) => now - g.updatedAtMs < DAY_MS);
  const older = games.filter((g) => now - g.updatedAtMs >= DAY_MS);
  const shown = showOlder ? games : recent;

  return (
    <div className="card games-card">
      <h2>Your games</h2>
      <ul className="games-list">
        {shown.map((g) => (
          <GameCard key={g.id} game={g} isCurrent={g.id === currentId} onOpen={onOpen} />
        ))}
      </ul>
      {older.length > 0 && (
        <button className="btn btn-link" onClick={() => setShowOlder((v) => !v)}>
          {showOlder ? "Hide older games" : `Show ${older.length} older game${older.length > 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

function GameCard({
  game,
  isCurrent,
  onOpen,
}: {
  game: GameSummary;
  isCurrent: boolean;
  onOpen: (id: string) => void;
}) {
  const status = describeStatus(game);
  return (
    <li>
      <button
        className={`game-card${game.myTurn ? " is-turn" : ""}`}
        onClick={() => onOpen(game.id)}
      >
        <span className="game-card-main">
          <span className="game-card-code">{game.id}</span>
          <span className="game-card-players">{game.playerNames.join(", ")}</span>
        </span>
        <span className="game-card-meta">
          <span className={`badge ${status.className}`}>{status.label}</span>
          <span className="game-card-time">
            {isCurrent ? "Open" : relativeTime(game.updatedAtMs)}
          </span>
        </span>
      </button>
    </li>
  );
}

function describeStatus(g: GameSummary): { label: string; className: string } {
  if (g.status === "finished") {
    return { label: g.winnerName ? `${g.winnerName} won` : "Finished", className: "badge-done" };
  }
  if (g.myTurn) return { label: "Your turn", className: "badge-turn" };
  if (g.status === "lobby") return { label: "In lobby", className: "badge-lobby" };
  return { label: "Their turn", className: "" };
}

function relativeTime(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
