// "Your turn" browser notifications, phase 1: in-tab only.
//
// This module owns the Notification permission + the player's on/off preference,
// and knows how to show a turn notification. It deliberately holds *no* React
// state — like `sounds.ts`, it's a thin wrapper over a browser API + localStorage
// so it can be called from anywhere and stays node-safe (every entry point guards
// for a missing `window`/`Notification`, since the test env is plain node and iOS
// Safari tabs expose no `Notification` at all).
//
// Phase 2 (service worker + FCM + a Cloud Function) will let these fire when the
// tab is fully closed; the permission gate, the preference, and the priming
// dialog built here are all reused unchanged — push is purely additive.

const PREF_KEY = "rummle:notify"; // the player's intent: "1" on, "0"/absent off
const PRIMED_KEY = "rummle:notify-primed"; // "1" once they've answered the prompt

export type NotifyPermission = NotificationPermission | "unsupported";

/** Whether this browser exposes the Notifications API at all. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Current browser permission, or "unsupported" where the API is absent. */
export function notificationPermission(): NotifyPermission {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** The player wants notifications *and* the browser will allow them. */
export function notifyEnabled(): boolean {
  return notificationsSupported() && Notification.permission === "granted" && readPref();
}

/**
 * Turn the preference on or off. Turning it on while permission is still
 * "default" prompts the browser first and only sticks if the user allows; an
 * already-granted permission just flips the stored intent. Returns the resulting
 * enabled state so callers can re-render.
 */
export async function setNotifyEnabled(on: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (!on) {
    writePref(false);
    return false;
  }
  if (Notification.permission === "default") {
    const result = await requestPermission();
    if (result !== "granted") return false;
  }
  if (Notification.permission !== "granted") return false;
  writePref(true);
  return true;
}

/** Fire the browser permission prompt. Marks the priming flag either way. */
export async function requestPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return "unsupported";
  setPrimed();
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Should we show our own priming dialog? Only when the API exists, the player
 * hasn't been asked yet, and the browser hasn't already settled the permission
 * (so we never shadow an Allow/Block the user already made).
 */
export function shouldPrime(): boolean {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "default") return false;
  try {
    return localStorage.getItem(PRIMED_KEY) !== "1";
  } catch {
    return false;
  }
}

export function setPrimed(): void {
  try {
    localStorage.setItem(PRIMED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Outcome of an attempt to show a notification, for debug logging. */
export type NotifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Show a "your turn" notification. No-ops unless enabled. Tagged per game so a
 * fresh turn replaces any stale notification rather than stacking; clicking it
 * focuses the game tab. Returns what happened so callers can surface it in the
 * debug log.
 */
export function showTurnNotification(opts: { who: string; gameLabel: string; gameId: string }): NotifyResult {
  if (!notificationsSupported()) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: `perm=${Notification.permission}` };
  if (!readPref()) return { ok: false, reason: "pref-off" };
  try {
    const n = new Notification("Your turn!", {
      body: `${opts.who} just played — it's your turn in ${opts.gameLabel}`,
      tag: `rummle-turn-${opts.gameId}`,
      icon: "/favicon.svg",
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      n.close();
    };
    return { ok: true };
  } catch (e) {
    // e.g. permission revoked between the gate and here, or a platform that
    // throws on the constructor (some iOS/Android-tab cases).
    return { ok: false, reason: `error:${e instanceof Error ? e.name : "unknown"}` };
  }
}

/** A terse "perm/pref" snapshot for the debug overlay (e.g. "granted/on"). */
export function notifyDebugState(): string {
  if (!notificationsSupported()) return "unsupported";
  return `${Notification.permission}/${readPref() ? "on" : "off"}`;
}
