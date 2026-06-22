// Sync layer: the only module that talks to Firestore for game state. The UI
// depends on this interface, not on Firestore directly, so the storage backend
// could later be swapped (e.g. for a Cloud-Function-authoritative version that
// keeps hands private) without changing components.

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { signInAnonymously, type User } from "firebase/auth";
import { auth, db } from "./firebase";
import { newGameCode, normalizeCode } from "./codes";
import { randomSeed } from "../game/rng";
import type { MeldIds } from "../game/rules";
import type { GameState, GameStatus } from "../state/model";
import {
  addPlayer,
  applyCommit,
  applyDraw,
  createGame,
  startGame,
} from "../state/engine";

const COLLECTION = "games";

/**
 * Firestore disallows nested arrays, so a meld is stored as { tiles: [...] }.
 *
 * `memberUids` is a denormalised index of the `players` map's keys. Firestore
 * can't query map keys, so this array (maintained purely in `toStored`, never in
 * the pure engine) is what powers the "list my games" query via `array-contains`.
 * It's a derived projection — it can't drift from `players`.
 */
interface StoredGame extends Omit<GameState, "table"> {
  table: { tiles: string[] }[];
  memberUids: string[];
}

function toStored(state: GameState): StoredGame {
  return {
    ...state,
    table: state.table.map((tiles) => ({ tiles })),
    memberUids: Object.keys(state.players),
  };
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
  // Codes are never reclaimed, so the namespace fills monotonically. Generate
  // and claim inside a transaction so a collision retries with a fresh code
  // rather than silently clobbering an existing game.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newGameCode();
    const claimed = await runTransaction(db, async (tx) => {
      const ref = gameRef(id);
      if ((await tx.get(ref)).exists()) return false;
      const state = createGame({
        id,
        hostId: user.uid,
        hostName,
        seed: randomSeed(),
        now: Date.now(),
      });
      tx.set(ref, { ...toStored(state), updatedAt: serverTimestamp() });
      return true;
    });
    if (claimed) return id;
  }
  throw new Error("Could not allocate a unique game code; please try again");
}

export async function joinGame(code: string, name: string): Promise<string> {
  const user = await ensureSignedIn();
  const id = normalizeCode(code);
  await mutate(id, (state) => addPlayer(state, user.uid, name, Date.now()));
  return id;
}

export async function beginGame(id: string, opts: { allowSolo?: boolean } = {}): Promise<void> {
  await mutate(id, (state) => startGame(state, Date.now(), opts));
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

// --- "my games" list -------------------------------------------------------
//
// One live query, keyed by the anonymous uid, surfaces every game this player
// belongs to. Each game doc already carries enough state (status, turn order)
// to render badges like "your turn" without any extra reads, so the whole list
// — live status included — is driven by this single snapshot listener.
//
// Keyed by uid means it's per-browser today; because Firebase keeps the same
// uid when an anonymous account is later upgraded/linked, the same index works
// unchanged once portable (cross-device) identity is added.

/** A lightweight, list-friendly view of a game the player is in. */
export interface GameSummary {
  id: string;
  status: GameStatus;
  /** Last activity (any write), as epoch millis — drives sorting and the 24h fold. */
  updatedAtMs: number;
  /** The player's own display name in this game. */
  myName: string;
  /** All players, ordered by seat. */
  playerNames: string[];
  /** True when it's this player's move (status playing + active seat is theirs). */
  myTurn: boolean;
  /** Winner's name once finished, else null. */
  winnerName: string | null;
}

export function subscribeMyGames(
  uid: string,
  onChange: (games: GameSummary[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, COLLECTION),
    where("memberUids", "array-contains", uid),
    orderBy("updatedAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => toSummary(d.data() as StoredGame, uid))),
    (err) => onError?.(err),
  );
}

function toSummary(data: StoredGame, uid: string): GameSummary {
  const players = Object.values(data.players).sort((a, b) => a.seat - b.seat);
  const active = data.turnOrder[data.currentTurn];
  const winner = data.winnerId ? data.players[data.winnerId] : undefined;
  return {
    id: data.id,
    status: data.status,
    updatedAtMs: toMillis(data.updatedAt),
    myName: data.players[uid]?.name ?? "",
    playerNames: players.map((p) => p.name),
    myTurn: data.status === "playing" && active === uid,
    winnerName: winner?.name ?? null,
  };
}

/**
 * `updatedAt` is written as a server `Timestamp` (the model types it `number`
 * for the pure engine's benefit). A freshly-created doc reports `null` locally
 * until the server resolves it — treat that as "just now" so it doesn't briefly
 * sort to the bottom / fold away.
 */
function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return Date.now();
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
