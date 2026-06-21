import { APP_NAME } from "./constants";
import { useAuth } from "./ui/useAuth";
import { useGame } from "./ui/useGame";
import { useRoute } from "./ui/useRoute";
import { Home } from "./ui/Home";
import { Lobby } from "./ui/Lobby";
import { JoinPrompt } from "./ui/JoinPrompt";
import { GameView } from "./ui/GameView";

export function App() {
  const { gameId, goToGame, goHome } = useRoute();
  const { user, loading: authLoading, error: authError } = useAuth();
  // Only subscribe once signed in: opening the listener before the anonymous
  // auth token exists gets a terminal permission-denied (the read rule requires
  // request.auth), which is what broke arriving via a share link.
  const { game, loading: gameLoading, error: gameError } = useGame(user ? gameId : null);

  if (authLoading) return <Splash message="Signing you in…" />;
  if (authError) return <Splash message={`Sign-in problem: ${authError}`} />;
  if (!user) return <Splash message="Not signed in." />;

  if (!gameId) {
    return <Home onEnterGame={goToGame} />;
  }

  if (gameLoading) return <Splash message={`Loading game ${gameId}…`} />;
  if (gameError || !game) {
    return (
      <Splash message={gameError ?? "Game not found"}>
        <button className="btn" onClick={goHome}>
          Back home
        </button>
      </Splash>
    );
  }

  // Arrived via a link without being in the game yet: prompt to join an open
  // lobby, or explain that an in-progress game can't be joined.
  if (!game.players[user.uid]) {
    if (game.status === "lobby") {
      return <JoinPrompt game={game} onLeave={goHome} />;
    }
    return (
      <Splash message="This game has already started — you can't join now.">
        <button className="btn" onClick={goHome}>
          Back home
        </button>
      </Splash>
    );
  }

  if (game.status === "lobby") {
    return <Lobby game={game} me={user.uid} onLeave={goHome} />;
  }
  return <GameView game={game} me={user.uid} onLeave={goHome} />;
}

function Splash({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="splash">
      <h1 className="logo">{APP_NAME}</h1>
      <p>{message}</p>
      {children}
    </div>
  );
}
