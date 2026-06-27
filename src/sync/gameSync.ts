// Rummle's sync layer: the Rummle-specific glue on top of the shared platform
// plumbing (`platform/firestoreSync`). It supplies a Codec (the meld-table
// reshaping Firestore needs) and the Rummle turn actions; transactions,
// subscriptions and the "your games" query are all reused from the platform.

import {
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { randomSeed } from "../game/rng";
import type { MeldIds } from "../game/rules";
import type { GameState, GameStatus } from "../state/model";
import {
  applyCommit,
  applyDraw,
  createGame,
  startGame,
} from "../state/engine";
import {
  COLLECTION,
  createGameDoc,
  ensureSignedIn,
  gameRef,
  mutateGame,
  subscribeGameDoc,
  toMillis,
  type Codec,
} from "../platform/firestoreSync";

// Re-exported so existing UI imports (useGame, MyGames, …) keep their source.
export { ensureSignedIn };
export {
  subscribeMyGames,
  type GameSummary,
} from "../platform/firestoreSync";

/**
 * Firestore disallows nested arrays, so a meld is stored as { tiles: [...] }.
 * That reshaping is the entirety of Rummle's storage codec.
 */
interface StoredGame extends Omit<GameState, "table"> {
  table: { tiles: string[] }[];
}

export const rummleCodec: Codec<GameState> = {
  toStored(state) {
    return { ...state, table: state.table.map((tiles) => ({ tiles })) };
  },
  fromStored(data) {
    const d = data as unknown as StoredGame;
    return { ...(d as object), table: (d.table ?? []).map((m) => m.tiles) } as GameState;
  },
};
const codec = rummleCodec;

export async function createNewGame(hostName: string): Promise<string> {
  const user = await ensureSignedIn();
  return createGameDoc(codec, (id) =>
    createGame({ id, hostId: user.uid, hostName, seed: randomSeed(), now: Date.now() }),
  );
}

export async function beginGame(id: string, opts: { allowSolo?: boolean } = {}): Promise<void> {
  await mutateGame(id, codec, (state) => startGame(state, Date.now(), opts));
}

// `asUid` lets `?test` mode act as whichever player is to move (the host still
// performs the write); it defaults to the signed-in user in normal play.
export async function drawTile(id: string, asUid?: string): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, codec, (state) => applyDraw(state, asUid ?? user.uid, Date.now()));
  await clearDraft(id);
}

export async function commitTurn(
  id: string,
  afterTable: MeldIds[],
  afterRack: string[],
  asUid?: string,
): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, codec, (state) =>
    applyCommit(state, asUid ?? user.uid, afterTable, afterRack, Date.now()),
  );
  await clearDraft(id);
}

export function subscribeGame(
  id: string,
  onChange: (state: GameState | null, fromCache: boolean) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeGameDoc(id, codec, onChange, onError);
}

/**
 * One-shot server-forced read, for diagnostics. Distinguishes "the listener
 * stalled but the network is fine" from "the device is genuinely offline".
 */
export async function probeGameFromServer(
  id: string,
): Promise<{ turn: number; status: GameStatus; updatedAtMs: number } | null> {
  const snap = await getDocFromServer(gameRef(id));
  if (!snap.exists()) return null;
  const data = snap.data() as { currentTurn: number; status: GameStatus; updatedAt: unknown };
  return { turn: data.currentTurn, status: data.status, updatedAtMs: toMillis(data.updatedAt) };
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

function draftRef(id: string) {
  return doc(db, COLLECTION, id, "draft", "current");
}
