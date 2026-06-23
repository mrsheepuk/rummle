import { useEffect, useRef } from "react";
import { forceResync } from "../sync/connection";
import { logConn } from "../sync/connectionLog";

// A tab backgrounded longer than this may have been frozen by the OS (battery
// saver, screen off), which silently kills the Firestore Listen stream without
// the SDK noticing — so on resume we reconnect rather than trust the (dead)
// stream. Shorter than this is a quick glance: the tab almost never freezes, so
// we leave a healthy connection alone and avoid needless reconnect churn.
const RESYNC_AFTER_HIDDEN_MS = 15_000;

// Don't stack reconnects if visibility + online fire close together.
const MIN_RESYNC_INTERVAL_MS = 3_000;

/**
 * Reconnect Firestore after the tab returns from a long background, or when the
 * network comes back. We trigger on the *duration the tab was hidden* rather
 * than on observed staleness, because a frozen tab's stream dies invisibly:
 * `fromCache` never flips, so there's no staleness to observe — but the hidden
 * duration is still measured correctly across the freeze.
 */
export function useReconnectOnResume(): void {
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt.current = Date.now();
        logConn("hidden");
        return;
      }
      const hiddenMs = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      logConn("visible", `hiddenMs=${hiddenMs}`);
      if (hiddenMs >= RESYNC_AFTER_HIDDEN_MS) {
        void forceResync("resume", MIN_RESYNC_INTERVAL_MS);
      }
    };

    // Regained network: we were offline, so reconnect unconditionally.
    const onOnline = () => {
      logConn("online");
      void forceResync("online", MIN_RESYNC_INTERVAL_MS);
    };
    const onOffline = () => logConn("offline");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
}
