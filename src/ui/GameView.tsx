import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../state/model";
import { buildIndex, currentPlayerId } from "../state/engine";
import { commitTurn, drawTile, publishDraft, subscribeDraft, type Draft } from "../sync/gameSync";
import type { MeldIds } from "../game/rules";
import { Board, type BoardHandle } from "./Board";
import { isMuted, playRemoteTick, playTurnComplete, playWin, setMuted } from "./sounds";

const DRAFT_THROTTLE_MS = 300;

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
  const handle = useRef<BoardHandle>({ table: game.table, rack: game.hands[me] ?? [] });
  const [resetNonce, setResetNonce] = useState(0);
  const [sortNonce, setSortNonce] = useState(0);
  const [sortMode, setSortMode] = useState<"color" | "number">("color");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [draft, setDraft] = useState<Draft | null>(null);
  // Whether the player has played at least one tile from their hand this turn
  // (drives which single action button shows).
  const [hasPlayed, setHasPlayed] = useState(false);
  // Whether the working table diverges from this turn's committed table at all
  // (staged tiles, taken-down tiles, or rearranged melds) — drives Reset.
  const [boardDirty, setBoardDirty] = useState(false);

  // Reset at every turn boundary. These are otherwise only recomputed when the
  // Board reports a layout change; if the board happens to be byte-identical
  // across a turn change (e.g. an opponent's committed table matches the draft
  // we were spectating) that report never fires and a stale `true` would leave
  // "Draw & pass" wrongly disabled until a reload. Resetting here is always safe
  // — nothing is played at the start of a turn.
  useEffect(() => {
    setHasPlayed(false);
    setBoardDirty(false);
  }, [game.currentTurn]);

  // Watch the active player's in-progress turn (quasi-real-time).
  useEffect(() => {
    const unsub = subscribeDraft(game.id, setDraft);
    return unsub;
  }, [game.id]);

  // Play a chime whenever a turn passes (any player) and a flourish on a win.
  const prevTurn = useRef(game.currentTurn);
  const prevStatus = useRef(game.status);
  useEffect(() => {
    if (game.status === "finished" && prevStatus.current !== "finished") {
      playWin();
    } else if (game.status === "playing" && game.currentTurn !== prevTurn.current) {
      playTurnComplete();
    }
    prevTurn.current = game.currentTurn;
    prevStatus.current = game.status;
  }, [game.currentTurn, game.status]);

  const activeId = currentPlayerId(game);
  const myTurn = activeId === me && game.status === "playing";
  const players = Object.values(game.players).sort((a, b) => a.seat - b.seat);
  const myRack = game.hands[me] ?? [];

  // When spectating, mirror the active player's live draft (if it's for the
  // current turn) instead of the committed table.
  const liveDraft =
    !myTurn && draft && draft.turn === game.currentTurn && draft.uid === activeId ? draft : null;
  const boardTable = myTurn ? game.table : liveDraft?.table ?? game.table;

  // Faint pip whenever a spectated move streams in (not on first appearance,
  // and not on commits — those get the turn chime).
  const liveKey = liveDraft ? JSON.stringify(liveDraft.table) : null;
  const prevLiveKey = useRef<string | null>(null);
  useEffect(() => {
    if (liveKey !== null && prevLiveKey.current !== null && prevLiveKey.current !== liveKey) {
      playRemoteTick();
    }
    prevLiveKey.current = liveKey;
  }, [liveKey]);

  // Throttle draft publishing to keep writes human-paced, and skip when the
  // table is unchanged (e.g. the player only rearranged their own rack).
  const publish = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; last: string }>({
    at: 0,
    timer: null,
    last: "",
  });
  function publishLater(table: MeldIds[]) {
    const key = JSON.stringify(table);
    if (key === publish.current.last) return;
    publish.current.last = key;
    if (publish.current.timer) clearTimeout(publish.current.timer);
    const fire = () => {
      publish.current.at = Date.now();
      publish.current.timer = null;
      void publishDraft(game.id, game.currentTurn, table).catch(() => undefined);
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

  async function onDraw() {
    cancelPendingPublish();
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
    cancelPendingPublish();
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
    setResetNonce((k) => k + 1);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
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
          <span className="pool-count">Pool {game.pool.length}</span>
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
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setSortMode("color");
                      setSortNonce((k) => k + 1);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="menu-ico" aria-hidden="true">⇅</span>
                    Sort by colour
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setSortMode("number");
                      setSortNonce((k) => k + 1);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="menu-ico" aria-hidden="true">⇅</span>
                    Sort by number
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      toggleMute();
                      setMenuOpen(false);
                    }}
                  >
                    <span className="menu-ico" aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
                    {muted ? "Unmute sounds" : "Mute sounds"}
                  </button>
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

      {game.status === "finished" && (
        <div className="winner-banner">🎉 {winner ?? "Someone"} wins!</div>
      )}

      <Board
        committedTable={boardTable}
        hand={myRack}
        index={index}
        myTurn={myTurn}
        storageKey={`rummle:rack:${game.id}:${me}`}
        resetNonce={resetNonce}
        sortNonce={sortNonce}
        sortMode={sortMode}
        onChange={(h) => {
          handle.current = h;
          if (myTurn) publishLater(h.table);
          const rackSet = new Set(h.rack);
          setHasPlayed((game.hands[me] ?? []).some((id) => !rackSet.has(id)));
          setBoardDirty(JSON.stringify(h.table) !== JSON.stringify(game.table));
        }}
      />

      {error && <p className="error game-error">{error}</p>}

      <footer className="action-bar">
        {game.status === "finished" ? (
          <span className="hint">Game over.</span>
        ) : myTurn ? (
          <>
            <button className="btn btn-action is-reset" disabled={busy || !boardDirty} onClick={onReset}>
              Reset
            </button>
            {hasPlayed ? (
              <button className="btn btn-action is-commit" disabled={busy} onClick={onCommit}>
                Commit play
              </button>
            ) : (
              <button className="btn btn-action is-draw" disabled={busy} onClick={onDraw}>
                Draw &amp; pass
              </button>
            )}
          </>
        ) : (
          <span className="hint">
            {game.players[activeId ?? ""]?.name ?? "…"}
            {liveDraft ? " is making their move…" : " is thinking…"}
          </span>
        )}
      </footer>
    </div>
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
