// The word game's sync glue: a Codec plus its turn actions, on top of the shared
// platform plumbing. Note how trivial the codec is — because the board is stored
// as a flat list of placements (not a 2-D grid), there's no nested-array
// reshaping to do, unlike Rummle's meld table.

import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../sync/firebase";
import { randomSeed } from "../../game/rng";
import {
  COLLECTION,
  createGameDoc,
  ensureSignedIn,
  mutateGame,
  type Codec,
} from "../../platform/firestoreSync";
import {
  applyCommit,
  applyExchange,
  applyPass,
  createWordsGame,
  startWordsGame,
} from "./engine";
import type { Placement, WordsGameState } from "./model";

export const wordsCodec: Codec<WordsGameState> = {
  toStored(state) {
    return { ...state };
  },
  fromStored(data) {
    const d = data as unknown as WordsGameState;
    return {
      ...d,
      board: d.board ?? [],
      bag: d.bag ?? [],
      racks: d.racks ?? {},
      scores: d.scores ?? {},
    };
  },
};

export async function createWordsGameDoc(hostName: string): Promise<string> {
  const user = await ensureSignedIn();
  return createGameDoc(wordsCodec, (id) =>
    createWordsGame({ id, hostId: user.uid, hostName, seed: randomSeed(), now: Date.now() }),
  );
}

export async function beginWordsGame(id: string, opts: { allowSolo?: boolean } = {}): Promise<void> {
  await mutateGame(id, wordsCodec, (state) => startWordsGame(state, Date.now(), opts));
}

export async function commitWordsPlay(id: string, placements: Placement[]): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, wordsCodec, (state) =>
    applyCommit(state, { uid: user.uid, placements, now: Date.now() }),
  );
  await clearWordsDraft(id);
}

export async function exchangeWordsTiles(id: string, tileIds: string[]): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, wordsCodec, (state) => applyExchange(state, user.uid, tileIds, Date.now()));
  await clearWordsDraft(id);
}

export async function passWordsTurn(id: string): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, wordsCodec, (state) => applyPass(state, user.uid, Date.now()));
  await clearWordsDraft(id);
}

// --- live draft (in-progress turn preview) ---------------------------------
//
// Same idea as Rummle's draft: the active player publishes their working
// placements to an ephemeral `games/{id}/draft/current` doc so others can watch
// in quasi-real-time. Advisory only — the authoritative move is the validated
// commit. Stamped with `turn` so stale drafts are ignored once play moves on;
// cleared on commit/exchange/pass. The flat placement list is Firestore-safe as
// is, so (unlike Rummle) there's no reshaping. Reuses the member-only `draft`
// security rule.

export interface WordsDraft {
  uid: string;
  turn: number;
  placements: Placement[];
}

function draftRef(id: string) {
  return doc(db, COLLECTION, id, "draft", "current");
}

export async function publishWordsDraft(id: string, turn: number, placements: Placement[]): Promise<void> {
  const user = await ensureSignedIn();
  await setDoc(draftRef(id), { uid: user.uid, turn, placements, updatedAt: serverTimestamp() });
}

export async function clearWordsDraft(id: string): Promise<void> {
  try {
    await deleteDoc(draftRef(id));
  } catch {
    /* best-effort cleanup */
  }
}

export function subscribeWordsDraft(id: string, onChange: (draft: WordsDraft | null) => void): () => void {
  return onSnapshot(
    draftRef(id),
    (snap) => {
      if (!snap.exists()) return onChange(null);
      const d = snap.data() as WordsDraft;
      onChange({ uid: d.uid, turn: d.turn, placements: d.placements ?? [] });
    },
    () => onChange(null),
  );
}
