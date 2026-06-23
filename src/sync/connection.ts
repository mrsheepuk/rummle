// Connection recovery. Firestore keeps its backend stream alive and reconnects
// on its own — but when a mobile tab is frozen (battery saver, long background)
// the SDK's reconnect/backoff timers are frozen too, so on resume it can sit on
// an escalated backoff before retrying, leaving listeners serving stale cached
// data (the "had to reload to see the move" symptom). Cycling the network drops
// and rebuilds the stream and resets that backoff, forcing an immediate resync.
// Re-registering listeners alone wouldn't reset the connection-level backoff.

import { disableNetwork, enableNetwork } from "firebase/firestore";
import { db } from "./firebase";

let resyncing = false;

/**
 * Force Firestore to reconnect now. Best-effort and reentrancy-guarded so
 * overlapping triggers (e.g. `visibilitychange` and `online` firing together)
 * don't interleave the disable/enable pair. Callers gate this on observed
 * staleness so a healthy connection is never cycled.
 */
export async function forceResync(): Promise<void> {
  if (resyncing) return;
  resyncing = true;
  try {
    await disableNetwork(db);
    await enableNetwork(db);
  } catch {
    /* best-effort: on failure the SDK is left to recover on its own */
  } finally {
    resyncing = false;
  }
}
