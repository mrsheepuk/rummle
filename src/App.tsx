import { APP_NAME } from "./constants";
import { useAuth } from "./ui/useAuth";
import { useGame } from "./ui/useGame";
import { useHashRoute } from "./ui/useHashRoute";
import { Home } from "./ui/Home";
import { Lobby } from "./ui/Lobby";
import { GameView } from "./ui/GameView";

export function App() {
  const { gameId, goToGame, goHome } = useHashRoute();
  const { user, loading: authLoading, error: authError } = useAuth();
  const { game, loading: gameLoading, error: gameError } = useGame(gameId);

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
