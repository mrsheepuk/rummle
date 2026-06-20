import { useEffect, useState } from "react";

/**
 * Minimal hash router. We only have two "routes": the home screen and a game
 * identified by its join code (`#/g/ABCD`). Using the hash keeps game links
 * shareable without any server-side routing config.
 */
export function useHashRoute(): { gameId: string | null; goToGame: (id: string) => void; goHome: () => void } {
  const [gameId, setGameId] = useState<string | null>(parseGameId());

  useEffect(() => {
    const onChange = () => setGameId(parseGameId());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return {
    gameId,
    goToGame: (id: string) => {
      window.location.hash = `#/g/${id}`;
    },
    goHome: () => {
      window.location.hash = "";
    },
  };
}

function parseGameId(): string | null {
  const match = window.location.hash.match(/^#\/g\/([A-Za-z0-9]+)/);
  return match ? match[1]!.toUpperCase() : null;
}
