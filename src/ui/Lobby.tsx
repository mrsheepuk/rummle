import { useState } from "react";
import { beginGame } from "../sync/gameSync";
import { beginWordsGame } from "../games/words/sync";
import { addTestPlayer } from "../games/registry";
import { GAME_LABELS, MAX_PLAYERS, MIN_PLAYERS, type BaseGameState } from "../platform/model";

export function Lobby({
  game,
  me,
  onLeave,
}: {
  game: BaseGameState;
  me: string;
  onLeave: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);
  const isHost = game.hostId === me;
  // `?test` unlocks a solo start so you can try the game on your own without a
  // second browser. Hidden by default — see CLAUDE.md / engine `allowSolo`.
  const testMode = new URLSearchParams(location.search).has("test");
  const canStart = players.length >= (testMode ? 1 : MIN_PLAYERS);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const begin = game.gameType === "words" ? beginWordsGame : beginGame;
      await begin(game.id, { allowSolo: testMode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start game");
    } finally {
      setBusy(false);
    }
  }

  // `?test`: seat a fake player so one browser can fill the lobby. The host
  // drives every seat once the game starts (see GameView/WordsGameView).
  async function addFake() {
    setAdding(true);
    setError(null);
    try {
      await addTestPlayer(game.id, `Bot ${players.length + 1}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add player");
    } finally {
      setAdding(false);
    }
  }

  function copyLink() {
    const url = `${location.origin}/g/${game.id}`;
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
        <h2>{GAME_LABELS[game.gameType]} lobby</h2>

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

        {testMode && isHost && players.length < MAX_PLAYERS && (
          <button className="btn btn-small" disabled={adding} onClick={addFake}>
            {adding ? "Adding…" : "Add fake player (test)"}
          </button>
        )}

        {isHost ? (
          <button className="btn btn-primary" disabled={!canStart || busy} onClick={start}>
            {!canStart
              ? `Need ${MIN_PLAYERS}+ players`
              : testMode && players.length < MIN_PLAYERS
                ? "Start solo (test)"
                : "Start game"}
          </button>
        ) : (
          <p className="hint">Waiting for the host to start…</p>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-link" onClick={onLeave}>
          Home
        </button>
      </div>
    </div>
  );
}
