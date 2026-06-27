import { useEffect, useRef } from "react";
import type { PlayerInfo } from "../platform/model";
import { showTurnNotification } from "./notifications";

/**
 * Fire a "your turn" notification when the turn passes *to* this player while
 * they're not looking at the tab. Shared by both game views (Numbers + Words),
 * which already track an identical `prevTurn` ref for the turn chime.
 *
 * Only the turn *boundary* matters, so the effect keys on `currentTurn`; the
 * other values are read fresh from that render. We never fire on the first
 * render (the ref starts at the mounted turn), nor when the game tab is focused
 * — someone watching the board doesn't need pinging.
 */
export function useTurnNotification(opts: {
  /** status === "playing" && not driving every seat via ?test. */
  enabled: boolean;
  myTurn: boolean;
  currentTurn: number;
  turnOrder: string[];
  players: Record<string, PlayerInfo>;
  gameId: string;
  gameLabel: string;
}): void {
  const { enabled, myTurn, currentTurn, turnOrder, players, gameId, gameLabel } = opts;
  const prevTurn = useRef(currentTurn);

  useEffect(() => {
    const changed = currentTurn !== prevTurn.current;
    const justPlayed = turnOrder[prevTurn.current];
    prevTurn.current = currentTurn;

    if (!enabled || !changed || !myTurn) return;
    // Only when the player isn't already looking here (covers both another tab
    // and another window). Phase 2's service worker will apply the same gate for
    // closed-tab pushes.
    if (typeof document !== "undefined" && document.hasFocus()) return;

    const who = (justPlayed && players[justPlayed]?.name) || "Someone";
    showTurnNotification({ who, gameLabel, gameId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTurn]);
}
