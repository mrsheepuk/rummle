import { useEffect, useRef } from "react";
import type { PlayerInfo } from "../platform/model";
import { logConn } from "../sync/connectionLog";
import { notificationPermission, showTurnNotification } from "./notifications";

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
    const from = prevTurn.current;
    const changed = currentTurn !== from;
    const justPlayed = turnOrder[from];
    prevTurn.current = currentTurn;

    if (!changed) return; // first render, or a non-turn re-render

    // Walk the gates in order, recording why we did or didn't fire so `?debug=1`
    // can show exactly where it stopped. The tab-focus gate suppresses pings for
    // someone already watching the board (covers another tab and another
    // window); phase 2's service worker applies the same gate for closed-tab
    // pushes.
    const focused = typeof document !== "undefined" && document.hasFocus();
    let outcome: string;
    if (!enabled) outcome = "skip:game-inactive-or-test";
    else if (!myTurn) outcome = "skip:not-my-turn";
    else if (focused) outcome = "skip:tab-focused";
    else {
      const who = (justPlayed && players[justPlayed]?.name) || "Someone";
      const res = showTurnNotification({ who, gameLabel, gameId });
      outcome = res.ok ? "fired" : `skip:${res.reason}`;
    }

    logConn("notify", `turn ${from}→${currentTurn} mine=${myTurn} focus=${focused} ${notificationPermission()} ${outcome}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTurn]);
}
