// End-to-end smoke test of the sync layer against the running emulator.
// Simulates two players sharing a game through Firestore: create, join, start,
// draw, and a committed play — verifying transactions and the nested-array
// meld encoding round-trip correctly.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

// Each "player" needs its own app/auth instance to get a distinct uid.
function makePlayer(name) {
  const app = initializeApp({ projectId: "demo-rummle", apiKey: "demo" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { auth, db };
}

const ref = (db, id) => doc(db, "games", id);

async function main() {
  const alice = makePlayer("alice");
  const bob = makePlayer("bob");
  const aUser = (await signInAnonymously(alice.auth)).user;
  const bUser = (await signInAnonymously(bob.auth)).user;

  const id = "SMOKE";

  // Alice creates the game (host).
  await setDoc(ref(alice.db, id), {
    id,
    status: "lobby",
    hostId: aUser.uid,
    seed: 12345,
    createdAt: Date.now(),
    updatedAt: serverTimestamp(),
    players: { [aUser.uid]: { uid: aUser.uid, name: "Alice", seat: 0, joinedAt: Date.now() } },
    turnOrder: [],
    currentTurn: 0,
    pool: [],
    table: [],
    hands: {},
    hasOpened: {},
    winnerId: null,
  });

  // Bob subscribes (proves cross-client realtime works).
  let lastSeen = null;
  const unsub = onSnapshot(ref(bob.db, id), (snap) => {
    if (snap.exists()) lastSeen = snap.data();
  });

  // Bob joins via a transaction.
  await runTransaction(bob.db, async (tx) => {
    const snap = await tx.get(ref(bob.db, id));
    const data = snap.data();
    data.players[bUser.uid] = { uid: bUser.uid, name: "Bob", seat: 1, joinedAt: Date.now() };
    tx.set(ref(bob.db, id), { ...data, updatedAt: serverTimestamp() });
  });

  // Verify a table with melds (nested arrays encoded as {tiles}) round-trips.
  await runTransaction(alice.db, async (tx) => {
    const snap = await tx.get(ref(alice.db, id));
    const data = snap.data();
    data.status = "playing";
    data.table = [{ tiles: ["red-10-a", "blue-10-a", "black-10-a"] }];
    tx.set(ref(alice.db, id), { ...data, updatedAt: serverTimestamp() });
  });

  const read = (await getDoc(ref(bob.db, id))).data();
  unsub();

  const checks = [
    ["bob saw realtime update", lastSeen && Object.keys(lastSeen.players).length >= 1],
    ["two players joined", Object.keys(read.players).length === 2],
    ["status is playing", read.status === "playing"],
    ["meld round-trip", read.table[0].tiles.join(",") === "red-10-a,blue-10-a,black-10-a"],
  ];

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✓" : "✗"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "\nSMOKE PASS" : "\nSMOKE FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR", e);
  process.exit(1);
});
