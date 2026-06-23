import { useEffect, useState } from "react";
import { subscribeAnyGame, type AnyGameState } from "../games/registry";

export interface GameSubscription {
  game: AnyGameState | null;
  loading: boolean;
  error: string | null;
  /** True when we're serving cached (possibly out-of-date) data, i.e. offline. */
  stale: boolean;
}

/** Live-subscribes to a game document and re-renders on every change. */
export function useGame(gameId: string | null): GameSubscription {
  const [game, setGame] = useState<AnyGameState | null>(null);
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
    const unsub = subscribeAnyGame(
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
