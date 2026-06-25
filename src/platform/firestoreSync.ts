// Game-agnostic Firestore plumbing. This is the heart of the platform split:
// the transaction/subscription machinery that every game reuses, with the only
// game-specific bit — how a state object reshapes into a storable document —
// injected as a `Codec`. Rummle and the word game each supply their own codec
// and their own engine; everything here is shared.
//
// (Firestore disallows nested arrays, so each game's codec is where 2-D data
// like a meld table or a board grid gets flattened into a storable shape.)

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type Transaction,
} from "firebase/firestore";
import { signInAnonymously, type User } from "firebase/auth";
import { auth, db } from "../sync/firebase";
import { logConn } from "../sync/connectionLog";
import { newGameCode } from "../sync/codes";
import {
  GAME_LABELS,
  seatPlayer,
  type BaseGameState,
  type GameStatus,
  type GameType,
} from "./model";

export const COLLECTION = "games";

export function gameRef(id: string) {
  return doc(db, COLLECTION, id);
}

export async function ensureSignedIn(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/**
 * Translates a game's in-memory state to/from its Firestore document shape.
 * `memberUids` and `updatedAt` are added by the platform, not the codec — the
 * codec only owns the game-specific reshaping.
 */
export interface Codec<S extends BaseGameState> {
  toStored(state: S): Record<string, unknown>;
  fromStored(data: Record<string, unknown>): S;
}

function persist<S extends BaseGameState>(
  tx: Transaction,
  ref: ReturnType<typeof gameRef>,
  codec: Codec<S>,
  state: S,
): void {
  tx.set(ref, {
    ...codec.toStored(state),
    // Firestore can't query a map's keys, so denormalise the player uids into an
    // array that powers the array-contains "your games" query. Derived purely
    // here, it can't drift from `players`.
    memberUids: Object.keys(state.players),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Allocates a unique join code and creates the game document for it. The code is
 * generated and claimed inside a transaction so a collision retries with a fresh
 * code rather than clobbering an existing game.
 */
export async function createGameDoc<S extends BaseGameState>(
  codec: Codec<S>,
  build: (id: string) => S,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newGameCode();
    const claimed = await runTransaction(db, async (tx) => {
      const ref = gameRef(id);
      if ((await tx.get(ref)).exists()) return false;
      persist(tx, ref, codec, build(id));
      return true;
    });
    if (claimed) return id;
  }
  throw new Error("Could not allocate a unique game code; please try again");
}

/**
 * Adds (or re-seats) a player without knowing the game type. Joining only
 * touches the shared envelope's player roster, so this works for any game from
 * just its join code — no game-specific codec needed.
 */
export async function joinGameDoc(id: string, uid: string, name: string, now: number): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = gameRef(id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Game ${id} not found`);
    const { players, added } = seatPlayer(snap.data() as BaseGameState, uid, name, now);
    tx.update(ref, {
      players,
      memberUids: Object.keys(players),
      ...(added ? { updatedAt: serverTimestamp() } : {}),
    });
  });
}

/** Reads, transforms with a pure engine function, and writes atomically. */
export async function mutateGame<S extends BaseGameState>(
  id: string,
  codec: Codec<S>,
  transform: (state: S) => S,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = gameRef(id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Game ${id} not found`);
    const next = transform(codec.fromStored(snap.data() as Record<string, unknown>));
    persist(tx, ref, codec, next);
  });
}

/**
 * Live-subscribes to one game document. `fromCache` reports whether we're
 * serving local (possibly stale) data, driving the offline indicator —
 * `includeMetadataChanges` makes a pure online↔offline transition fire too.
 */
export function subscribeGameDoc<S extends BaseGameState>(
  id: string,
  codec: Codec<S>,
  onChange: (state: S | null, fromCache: boolean) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    gameRef(id),
    { includeMetadataChanges: true },
    (snap) => {
      const fromCache = snap.metadata.fromCache;
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      logConn(
        "snapshot",
        `fromCache=${fromCache} pending=${snap.metadata.hasPendingWrites}` +
          (data ? ` turn=${data.currentTurn} status=${data.status}` : " (deleted)"),
      );
      onChange(data ? codec.fromStored(data) : null, fromCache);
    },
    (err) => {
      logConn("note", `snapshot error: ${err.message}`);
      onError?.(err);
    },
  );
}

// --- "your games" list -----------------------------------------------------
//
// One live query, keyed by the anonymous uid, surfaces every game a player is
// in — across all game types, since every field it reads lives on the shared
// envelope. Keyed by uid it's per-browser today; Firebase preserves the uid
// through anonymous→linked upgrades, so the same index works once cross-device
// identity lands. Needs the composite index in firestore.indexes.json in prod.

export interface GameSummary {
  id: string;
  gameType: GameType;
  /** Human label for the game type (e.g. "Rummle"). */
  gameLabel: string;
  status: GameStatus;
  /** Last activity (any write), epoch millis — drives sorting + the 24h fold. */
  updatedAtMs: number;
  myName: string;
  /** All players, ordered by seat. */
  playerNames: string[];
  /** True when it's this player's move. */
  myTurn: boolean;
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
    (snap) => onChange(snap.docs.map((d) => toSummary(d.data() as StoredEnvelope, uid))),
    (err) => onError?.(err),
  );
}

/** The subset of any stored game the my-games list needs. */
interface StoredEnvelope {
  id: string;
  gameType?: GameType;
  status: GameStatus;
  players: Record<string, { name: string; seat: number }>;
  turnOrder: string[];
  currentTurn: number;
  winnerId: string | null;
  updatedAt: unknown;
}

function toSummary(data: StoredEnvelope, uid: string): GameSummary {
  const players = Object.values(data.players).sort((a, b) => a.seat - b.seat);
  const active = data.turnOrder[data.currentTurn];
  const winner = data.winnerId ? data.players[data.winnerId] : undefined;
  // Pre-gameType documents are Rummle by definition.
  const gameType: GameType = data.gameType ?? "rummle";
  return {
    id: data.id,
    gameType,
    gameLabel: GAME_LABELS[gameType],
    status: data.status,
    updatedAtMs: toMillis(data.updatedAt),
    myName: data.players[uid]?.name ?? "",
    playerNames: players.map((p) => p.name),
    myTurn: data.status === "playing" && active === uid,
    winnerName: winner?.name ?? null,
  };
}

/**
 * `updatedAt` is written as a server `Timestamp`. A freshly-created doc reports
 * `null` locally until the server resolves it — treat that as "just now" so it
 * doesn't briefly sort to the bottom / fold away.
 */
export function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return Date.now();
}
