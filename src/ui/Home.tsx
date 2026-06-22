import { useState } from "react";
import { APP_NAME, APP_TAGLINE, NAME_KEY } from "../constants";
import { createNewGame, joinGame } from "../sync/gameSync";
import { CODE_LENGTH, normalizeCode } from "../sync/codes";
import { MyGames } from "./MyGames";

export function Home({ uid, onEnterGame }: { uid: string; onEnterGame: (id: string) => void }) {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rememberName = () => localStorage.setItem(NAME_KEY, name.trim());

  async function handleCreate() {
    if (!name.trim()) return setError("Enter a display name first");
    setBusy(true);
    setError(null);
    try {
      rememberName();
      const id = await createNewGame(name.trim());
      onEnterGame(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create game");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!name.trim()) return setError("Enter a display name first");
    if (!code.trim()) return setError("Enter a game code");
    setBusy(true);
    setError(null);
    try {
      rememberName();
      const id = await joinGame(code, name.trim());
      onEnterGame(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <header className="home-hero">
        <h1 className="logo">{APP_NAME}</h1>
        <p className="tagline">{APP_TAGLINE}</p>
      </header>

      <div className="card">
        <label className="field">
          <span>Display name</span>
          <input
            value={name}
            maxLength={20}
            placeholder="e.g. Alex"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <button className="btn btn-primary" disabled={busy} onClick={handleCreate}>
          Create a new game
        </button>

        <div className="divider">or join with a code</div>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            placeholder={"ABCDEFGHIJ".slice(0, CODE_LENGTH)}
            maxLength={CODE_LENGTH}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button className="btn" disabled={busy} onClick={handleJoin}>
            Join
          </button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>

      <MyGames uid={uid} currentId={null} onOpen={onEnterGame} />

      <footer className="home-footer">
        <p>Anonymous play — just pick a name and share the code.</p>
      </footer>
    </div>
  );
}
