// Sync layer: the only module that talks to Firestore for game state. The UI
// depends on this interface, not on Firestore directly, so the storage backend
// could later be swapped (e.g. for a Cloud-Function-authoritative version that
// keeps hands private) without changing components.

import {
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { signInAnonymously, type User } from "firebase/auth";
import { auth, db } from "./firebase";
import { newGameCode, normalizeCode } from "./codes";
import { randomSeed } from "../game/rng";
import type { MeldIds } from "../game/rules";
import type { GameState } from "../state/model";
import {
  addPlayer,
  applyCommit,
  applyDraw,
  createGame,
  startGame,
} from "../state/engine";

const COLLECTION = "games";

/** Firestore disallows nested arrays, so a meld is stored as { tiles: [...] }. */
interface StoredGame extends Omit<GameState, "table"> {
  table: { tiles: string[] }[];
}

function toStored(state: GameState): StoredGame {
  return { ...state, table: state.table.map((tiles) => ({ tiles })) };
}

function fromStored(data: StoredGame): GameState {
  return { ...data, table: (data.table ?? []).map((m) => m.tiles) };
}

export async function ensureSignedIn(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function createNewGame(hostName: string): Promise<string> {
  const user = await ensureSignedIn();
  const id = newGameCode();
  const state = createGame({
    id,
    hostId: user.uid,
    hostName,
    seed: randomSeed(),
    now: Date.now(),
  });
  await setDoc(gameRef(id), { ...toStored(state), updatedAt: serverTimestamp() });
  return id;
}

export async function joinGame(code: string, name: string): Promise<string> {
  const user = await ensureSignedIn();
  const id = normalizeCode(code);
  await mutate(id, (state) => addPlayer(state, user.uid, name, Date.now()));
  return id;
}

export async function beginGame(id: string): Promise<void> {
  await mutate(id, (state) => startGame(state, Date.now()));
}

export async function drawTile(id: string): Promise<void> {
  const user = await ensureSignedIn();
  await mutate(id, (state) => applyDraw(state, user.uid, Date.now()));
  await clearDraft(id);
}

export async function commitTurn(
  id: string,
  afterTable: MeldIds[],
  afterRack: string[],
): Promise<void> {
  const user = await ensureSignedIn();
  await mutate(id, (state) => applyCommit(state, user.uid, afterTable, afterRack, Date.now()));
  await clearDraft(id);
}

export function subscribeGame(
  id: string,
  onChange: (state: GameState | null) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    gameRef(id),
    (snap) => {
      if (!snap.exists()) return onChange(null);
      onChange(fromStored(snap.data() as StoredGame));
    },
    (err) => onError?.(err),
  );
}

// --- live draft (in-progress turn preview) ---------------------------------
//
// While the active player rearranges the table, they publish their working
// table to an ephemeral draft doc so the others can watch in quasi-real-time.
// It's purely advisory: the authoritative move is still the validated
// `commitTurn` transaction. Stamped with the turn so stale drafts (e.g. after a
// disconnect) are ignored once play moves on; cleared on commit/draw.

interface StoredDraft {
  uid: string;
  turn: number;
  table: { tiles: string[] }[];
}

export interface Draft {
  uid: string;
  turn: number;
  table: MeldIds[];
}

export async function publishDraft(id: string, turn: number, table: MeldIds[]): Promise<void> {
  const user = await ensureSignedIn();
  await setDoc(draftRef(id), {
    uid: user.uid,
    turn,
    table: table.map((tiles) => ({ tiles })),
    updatedAt: serverTimestamp(),
  });
}

export async function clearDraft(id: string): Promise<void> {
  try {
    await deleteDoc(draftRef(id));
  } catch {
    /* best-effort cleanup */
  }
}

export function subscribeDraft(id: string, onChange: (draft: Draft | null) => void): () => void {
  return onSnapshot(
    draftRef(id),
    (snap) => {
      if (!snap.exists()) return onChange(null);
      const d = snap.data() as StoredDraft;
      onChange({ uid: d.uid, turn: d.turn, table: (d.table ?? []).map((m) => m.tiles) });
    },
    () => onChange(null),
  );
}

// --- internals -------------------------------------------------------------

function gameRef(id: string) {
  return doc(db, COLLECTION, id);
}

function draftRef(id: string) {
  return doc(db, COLLECTION, id, "draft", "current");
}

/** Reads, transforms with a pure engine function, and writes atomically. */
async function mutate(id: string, transform: (state: GameState) => GameState): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = gameRef(id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Game ${id} not found`);
    const current = fromStored(snap.data() as StoredGame);
    const next = transform(current);
    tx.set(ref, { ...toStored(next), updatedAt: serverTimestamp() });
  });
}
