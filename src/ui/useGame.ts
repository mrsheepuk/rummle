import { useEffect, useState } from "react";
import { subscribeGame } from "../sync/gameSync";
import type { GameState } from "../state/model";

export interface GameSubscription {
  game: GameState | null;
  loading: boolean;
  error: string | null;
  /** True when we're serving cached (possibly out-of-date) data, i.e. offline. */
  stale: boolean;
}

/** Live-subscribes to a game document and re-renders on every change. */
export function useGame(gameId: string | null): GameSubscription {
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState<boolean>(!!gameId);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!gameId) {
      setGame(null);
      setLoading(false);
      setStale(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeGame(
      gameId,
      (state, fromCache) => {
        setGame(state);
        setLoading(false);
        setStale(fromCache);
        if (!state) setError("Game not found");
        else setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [gameId]);

  return { game, loading, error, stale };
}
