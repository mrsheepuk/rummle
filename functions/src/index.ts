// Turn-change push notifications.
//
// A single Firestore-triggered function watches every game document and, when
// the turn passes to a new player, sends that player a Web Push "your turn"
// notification — so it reaches them even with the tab closed (the in-tab path
// in the client covers the open-but-backgrounded case).
//
// It is deliberately game-agnostic: it reads only the shared envelope fields
// (`status`, `currentTurn`, `turnOrder`, `players`, `gameType`) that every game
// type stores, so it serves both Numbers and Words with no per-game code.
//
// Delivery uses the standard Web Push protocol (VAPID), not FCM — the client
// subscribes via the browser's PushManager and we send straight to the push
// endpoint. The keypair: public half in the client bundle + here (not secret),
// private half in Secret Manager.

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import webpush, { type PushSubscription } from "web-push";

admin.initializeApp();
const db = admin.firestore();

// VAPID keypair. The public key is not secret (it ships in the client too);
// the private key lives in Secret Manager. `VAPID_SUBJECT` is the contact mailto
// the push services require.
const VAPID_PUBLIC_KEY = defineString("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = defineString("VAPID_SUBJECT", { default: "mailto:notifications@rummle.app" });

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const GAME_LABELS: Record<string, string> = { rummle: "Numbers", words: "Words" };

/** Shape of what `pushSubs/{uid}` stores: a player's active subscriptions. */
interface StoredSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const onTurnChange = onDocumentUpdated(
  { document: "games/{gameId}", secrets: [VAPID_PRIVATE_KEY] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only an in-play turn handoff. (A lobby→playing start, or a finish, isn't a
    // "your turn" moment — mirrors the client, which doesn't ping on game start.)
    if (before.status !== "playing" || after.status !== "playing") return;
    if (before.currentTurn === after.currentTurn) return;

    const turnOrder: string[] = Array.isArray(after.turnOrder) ? after.turnOrder : [];
    const activeUid = turnOrder[after.currentTurn];
    if (!activeUid) return;

    const players = (after.players ?? {}) as Record<string, { name?: string }>;
    const justPlayedUid = turnOrder[before.currentTurn];
    const who = players[justPlayedUid]?.name ?? "Someone";
    const label = GAME_LABELS[after.gameType] ?? "Rummle";
    const gameId = event.params.gameId;

    const subDoc = await db.collection("pushSubs").doc(activeUid).get();
    const subs = (subDoc.data()?.subscriptions ?? []) as StoredSub[];

    // One readable line per handoff so a quiet log is diagnosable: did the
    // trigger fire, who's up, and do they have any device subscribed?
    logger.info(`turn ${before.currentTurn}→${after.currentTurn} game=${gameId} active=${activeUid} subs=${subs.length}`);
    if (subs.length === 0) return;

    webpush.setVapidDetails(VAPID_SUBJECT.value(), VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());

    const payload = JSON.stringify({
      title: "Your turn!",
      body: `${who} just played — it's your turn in ${label}`,
      tag: `rummle-turn-${gameId}`,
      url: `/g/${gameId}`,
    });

    // Send to every device, pruning any the push service reports as gone (404/
    // 410) so a stale endpoint doesn't accumulate forever.
    const dead: string[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(sub as unknown as PushSubscription, payload);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(sub.endpoint);
          else logger.warn(`push to ${activeUid} failed`, { status, endpoint: sub.endpoint });
        }
      }),
    );

    logger.info(`sent ${subs.length - dead.length}/${subs.length} push(es) to ${activeUid}`);

    if (dead.length > 0) {
      const remaining = subs.filter((s) => !dead.includes(s.endpoint));
      await subDoc.ref.set({ subscriptions: remaining }, { merge: true });
      logger.info(`pruned ${dead.length} dead subscription(s) for ${activeUid}`);
    }
  },
);
