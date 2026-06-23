import { useEffect, useRef } from "react";
import { forceResync } from "../sync/connection";

// How long to let the SDK settle after the tab is foregrounded before deciding
// it's stuck. On resume from a frozen tab the SDK needs a moment to notice the
// dead stream and flip its listeners to cached (stale); waiting briefly lets a
// connection that recovers on its own do so, so we only kick when it doesn't.
const SETTLE_MS = 1500;

/**
 * Reconnect Firestore when the tab is brought back to the foreground (or the
 * network returns) *and* we're observably stale — i.e. serving cached data
 * because the SDK hasn't resynced. A still-connected listener reports fresh
 * server data (`stale === false`), so it's left untouched: no disconnect churn
 * on quick tab switches, only a one-shot resync for a genuinely stuck stream.
 */
export function useReconnectOnResume(stale: boolean): void {
  // Read the latest `stale` from the event handlers without re-binding them.
  const staleRef = useRef(stale);
  staleRef.current = stale;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onVisibility = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (staleRef.current) void forceResync();
      }, SETTLE_MS);
    };

    // A regained network connection is an unambiguous, rare signal — kick at
    // once if we're stale rather than waiting out the SDK's own backoff.
    const onOnline = () => {
      if (staleRef.current) void forceResync();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);
}
