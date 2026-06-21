// Verifies the live-draft path against the emulator: a member can publish &
// clear the ephemeral draft doc (rule uses get() on the parent game), and
// another player can read it.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

function player(name) {
  const app = initializeApp({ projectId: "demo-rummle", apiKey: "demo" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { auth, db };
}

const gameRef = (db, id) => doc(db, "games", id);
const draftRef = (db, id) => doc(db, "games", id, "draft", "current");

async function main() {
  const alice = player("alice");
  const bob = player("bob");
  const a = (await signInAnonymously(alice.auth)).user;
  const b = (await signInAnonymously(bob.auth)).user;
  const id = "DRAFT1";

  await setDoc(gameRef(alice.db, id), {
    id,
    status: "playing",
    hostId: a.uid,
    seed: 1,
    createdAt: Date.now(),
    updatedAt: serverTimestamp(),
    players: { [a.uid]: { uid: a.uid, name: "Alice", seat: 0, joinedAt: Date.now() } },
    turnOrder: [a.uid],
    currentTurn: 0,
    pool: [],
    table: [],
    hands: {},
    hasOpened: {},
    winnerId: null,
  });
  await runTransaction(bob.db, async (tx) => {
    const snap = await tx.get(gameRef(bob.db, id));
    const data = snap.data();
    data.players[b.uid] = { uid: b.uid, name: "Bob", seat: 1, joinedAt: Date.now() };
    tx.set(gameRef(bob.db, id), { ...data, updatedAt: serverTimestamp() });
  });

  // Alice (a member) publishes a draft.
  let memberWrite = true;
  try {
    await setDoc(draftRef(alice.db, id), {
      uid: a.uid,
      turn: 0,
      table: [{ tiles: ["red-10-a", "blue-10-a", "black-10-a"] }],
      updatedAt: serverTimestamp(),
    });
  } catch {
    memberWrite = false;
  }

  // Bob reads it.
  const seen = (await getDoc(draftRef(bob.db, id))).data();

  // A non-member must NOT be able to write the draft.
  const carol = player("carol");
  const c = (await signInAnonymously(carol.auth)).user;
  let nonMemberBlocked = false;
  try {
    await setDoc(draftRef(carol.db, id), { uid: c.uid, turn: 0, table: [], updatedAt: serverTimestamp() });
  } catch {
    nonMemberBlocked = true;
  }

  // Alice clears it.
  let cleared = true;
  try {
    await deleteDoc(draftRef(alice.db, id));
  } catch {
    cleared = false;
  }
  const afterClear = (await getDoc(draftRef(bob.db, id))).exists();

  const checks = [
    ["member can publish a draft", memberWrite],
    ["other player reads the draft", seen?.table?.[0]?.tiles?.join(",") === "red-10-a,blue-10-a,black-10-a"],
    ["non-member write blocked by rules", nonMemberBlocked],
    ["member can clear the draft", cleared && afterClear === false],
  ];
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✓" : "✗"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "\nDRAFT SMOKE PASS" : "\nDRAFT SMOKE FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("DRAFT SMOKE ERROR", e);
  process.exit(1);
});
