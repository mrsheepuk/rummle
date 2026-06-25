// The one place that knows about every game type. The platform stays
// game-agnostic and each game module stays self-contained; this thin registry
// composes them for the two operations a caller does before it knows (or cares)
// which game it's dealing with: subscribing to a game doc by code, and joining
// one. Everything type-specific (creating, turn actions, rendering) is dispatched
// by the caller on `state.gameType`.

import { normalizeCode } from "../sync/codes";
import {
  joinGameDoc,
  ensureSignedIn,
  subscribeGameDoc,
  type Codec,
} from "../platform/firestoreSync";
import type { GameState } from "../state/model";
import { rummleCodec } from "../sync/gameSync";
import type { WordsGameState } from "./words/model";
import { wordsCodec } from "./words/sync";

/** Any game the platform can host. Discriminated by `gameType`. */
export type AnyGameState = GameState | WordsGameState;

/** A codec that round-trips either game by dispatching on the stored gameType. */
const anyCodec: Codec<AnyGameState> = {
  toStored(state) {
    return state.gameType === "words"
      ? wordsCodec.toStored(state)
      : rummleCodec.toStored(state);
  },
  fromStored(data) {
    // Pre-gameType documents are Rummle by definition.
    const type = (data as { gameType?: string }).gameType ?? "rummle";
    return type === "words"
      ? (wordsCodec.fromStored(data) as AnyGameState)
      : (rummleCodec.fromStored(data) as AnyGameState);
  },
};

/** Subscribe to any game by code, without knowing its type up front. */
export function subscribeAnyGame(
  id: string,
  onChange: (state: AnyGameState | null, fromCache: boolean) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeGameDoc<AnyGameState>(id, anyCodec, onChange, onError);
}

/** Join any game by code (touches only the shared player roster). */
export async function joinAnyGame(code: string, name: string): Promise<string> {
  const user = await ensureSignedIn();
  const id = normalizeCode(code);
  await joinGameDoc(id, user.uid, name, Date.now());
  return id;
}
