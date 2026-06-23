// Connection recovery. Firestore keeps its backend stream alive and reconnects
// on its own — but when a mobile tab is frozen (battery saver, long background)
// the SDK's reconnect/backoff timers are frozen too, so on resume it can sit on
// an escalated backoff before retrying, leaving listeners serving stale cached
// data (the "had to reload to see the move" symptom). Cycling the network drops
// and rebuilds the stream and resets that backoff, forcing an immediate resync.
// Re-registering listeners alone wouldn't reset the connection-level backoff.

import { disableNetwork, enableNetwork } from "firebase/firestore";
import { db } from "./firebase";
import { logConn } from "./connectionLog";

let resyncing = false;
let lastResyncAt = 0;

/**
 * Force Firestore to reconnect now by dropping and rebuilding the backend
 * stream. This is the only reliable recovery for a half-dead Listen stream
 * after a tab freeze: the SDK doesn't notice the stream died (no error, no
 * `fromCache` flip, no snapshot), so cycling the network is what makes it
 * re-establish and deliver the updates it missed.
 *
 * Best-effort, reentrancy-guarded, and rate-limited (`minIntervalMs`) so
 * overlapping triggers (e.g. `visibilitychange` and `online` firing together)
 * don't stack up redundant cycles.
 */
export async function forceResync(reason = "manual", minIntervalMs = 0): Promise<void> {
  if (resyncing) {
    logConn("resync", `skip (already running) reason=${reason}`);
    return;
  }
  if (minIntervalMs && Date.now() - lastResyncAt < minIntervalMs) {
    logConn("resync", `skip (rate-limited) reason=${reason}`);
    return;
  }
  resyncing = true;
  lastResyncAt = Date.now();
  logConn("resync", `start reason=${reason}`);
  try {
    await disableNetwork(db);
    await enableNetwork(db);
    logConn("resync", "done");
  } catch (e) {
    logConn("resync", `error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    resyncing = false;
  }
}
