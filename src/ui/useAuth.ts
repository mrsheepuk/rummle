import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../sync/firebase";
import { ensureSignedIn } from "../sync/gameSync";

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

/** Signs the player in anonymously and tracks the resulting user. */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(!auth.currentUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    ensureSignedIn().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading, error };
}
