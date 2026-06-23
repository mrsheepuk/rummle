import { APP_NAME } from "./constants";
import { useAuth } from "./ui/useAuth";
import { useGame } from "./ui/useGame";
import { useReconnectOnResume } from "./ui/useReconnectOnResume";
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
  const { game, loading: gameLoading, error: gameError, stale } = useGame(user ? gameId : null);
  // Only resync when we can see we're stale; healthy connections stay untouched.
  useReconnectOnResume(stale);

  // Auth is anonymous, so there's nothing for the player to do while it settles
  // — show a bare spinner rather than misleading "signing in" / "not signed in"
  // copy. Only a genuine failure gets a message.
  if (authError) return <Splash message={`Sign-in problem: ${authError}`} />;
  if (authLoading || !user) return <Splash spinner />;

  if (!gameId) {
    return <Home uid={user.uid} onEnterGame={goToGame} />;
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
  return <GameView game={game} me={user.uid} onLeave={goHome} stale={stale} />;
}

function Splash({
  message,
  spinner,
  children,
}: {
  message?: string;
  spinner?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="splash">
      <h1 className="logo">{APP_NAME}</h1>
      {spinner && <div className="spinner" role="status" aria-label="Loading" />}
      {message && <p>{message}</p>}
      {children}
    </div>
  );
}
