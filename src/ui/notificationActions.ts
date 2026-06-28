// Orchestrates turning "your turn" notifications on/off for a specific player:
// the browser permission + preference (notifications.ts) plus the Web Push
// subscription (sync/push.ts). Kept in one place so the menu toggle and the
// priming dialog share identical behaviour.
//
// Push is best-effort and additive: where it isn't configured or the browser
// lacks PushManager, enabling still succeeds and the player gets phase-1 in-tab
// notifications. The uid must be the real authenticated uid (not a ?test seat),
// since a push subscription is tied to the signed-in account.

import { ensureServiceWorker, notifyEnabled, setNotifyEnabled } from "./notifications";
import { subscribeToPush, unsubscribeFromPush } from "../sync/push";

/** Returns whether notifications ended up enabled (permission granted). */
export async function enableTurnNotifications(uid: string): Promise<boolean> {
  const on = await setNotifyEnabled(true);
  if (!on) return false;
  const reg = await ensureServiceWorker();
  if (reg) {
    try {
      await subscribeToPush(uid, reg);
    } catch {
      /* push is optional; in-tab notifications still work */
    }
  }
  return true;
}

/**
 * Self-heal on app load: if the player has notifications enabled, make sure a
 * current push subscription exists for this device. Covers the cases where an
 * earlier subscribe never landed (rules not yet deployed, a build without the
 * VAPID key) or the endpoint has since expired/rotated — `subscribeToPush`
 * reuses an existing subscription, so this is idempotent and cheap.
 */
export async function resubscribeIfEnabled(uid: string): Promise<void> {
  if (!notifyEnabled()) return;
  const reg = await ensureServiceWorker();
  if (!reg) return;
  try {
    await subscribeToPush(uid, reg);
  } catch {
    /* push is optional; in-tab notifications still work */
  }
}

export async function disableTurnNotifications(uid: string): Promise<void> {
  await setNotifyEnabled(false);
  const reg = await ensureServiceWorker();
  if (reg) {
    try {
      await unsubscribeFromPush(uid, reg);
    } catch {
      /* nothing to undo */
    }
  }
}
