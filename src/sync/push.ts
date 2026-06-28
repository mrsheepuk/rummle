// Web Push subscription management (phase 2: closed-tab "your turn" pings).
//
// The browser's PushManager hands us a subscription (an endpoint + keys) which
// we store per-uid in Firestore (`pushSubs/{uid}`); the turn-change Cloud
// Function reads it and pushes through the standard Web Push protocol (VAPID),
// so a notification arrives even when the tab is closed. The service worker that
// receives the push and shows the notification is the same `sw.js` registered
// for the in-tab path.
//
// All of this is a no-op unless a VAPID public key is configured, so a build
// without it (and any browser lacking PushManager) simply falls back to the
// in-tab notifications from phase 1.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "";

/** Whether closed-tab push is wired up (key present + browser supports it). */
export function pushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0 && typeof window !== "undefined" && "PushManager" in window;
}

/** Subscribe this device for push and persist the subscription for the uid. */
export async function subscribeToPush(uid: string, reg: ServiceWorkerRegistration): Promise<boolean> {
  if (!pushConfigured()) return false;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));
  await persist(uid, sub.toJSON());
  return true;
}

/** Tear down this device's subscription and forget it for the uid. */
export async function unsubscribeFromPush(uid: string, reg: ServiceWorkerRegistration): Promise<void> {
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const { endpoint } = sub.toJSON();
  await sub.unsubscribe();
  if (endpoint) await forget(uid, endpoint);
}

// Subscriptions are stored as an array of `{ endpoint, keys, ... }` maps (an
// array of objects, not nested arrays, so it's Firestore-legal). We dedupe by
// endpoint via read-modify-write — a device only ever has one live endpoint.
async function persist(uid: string, sub: PushSubscriptionJSON): Promise<void> {
  const ref = doc(db, "pushSubs", uid);
  const snap = await getDoc(ref);
  const subs = (snap.data()?.subscriptions ?? []) as PushSubscriptionJSON[];
  if (subs.some((s) => s.endpoint === sub.endpoint)) return;
  await setDoc(ref, { subscriptions: [...subs, sub] }, { merge: true });
}

async function forget(uid: string, endpoint: string): Promise<void> {
  const ref = doc(db, "pushSubs", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const subs = (snap.data()?.subscriptions ?? []) as PushSubscriptionJSON[];
  await setDoc(ref, { subscriptions: subs.filter((s) => s.endpoint !== endpoint) }, { merge: true });
}

/** VAPID keys are URL-safe base64; PushManager wants the raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
