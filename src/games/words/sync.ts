// The word game's sync glue: a Codec plus its turn actions, on top of the shared
// platform plumbing. Note how trivial the codec is — because the board is stored
// as a flat list of placements (not a 2-D grid), there's no nested-array
// reshaping to do, unlike Rummle's meld table.

import { randomSeed } from "../../game/rng";
import {
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
}

export async function exchangeWordsTiles(id: string, tileIds: string[]): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, wordsCodec, (state) => applyExchange(state, user.uid, tileIds, Date.now()));
}

export async function passWordsTurn(id: string): Promise<void> {
  const user = await ensureSignedIn();
  await mutateGame(id, wordsCodec, (state) => applyPass(state, user.uid, Date.now()));
}
