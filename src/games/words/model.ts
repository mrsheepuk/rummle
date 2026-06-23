// The word game's Firestore document shape, extending the platform's shared
// envelope with this game's own payload. Pure (no React/Firebase).

import type { BaseGameState } from "../../platform/model";

/**
 * A single committed tile on the board. The board is stored as a flat list of
 * these (sparse), which sidesteps Firestore's no-nested-arrays rule that a 2-D
 * grid would otherwise hit — and is denser than a 15×15 array anyway.
 */
export interface Placement {
  r: number;
  c: number;
  tileId: string;
  /** Effective letter occupying the cell — a blank carries its assigned letter. */
  letter: string;
}

export interface WordsGameState extends BaseGameState {
  gameType: "words";

  /** Remaining tiles to draw, as tile ids (front of the array is drawn first). */
  bag: string[];
  /** Committed tiles on the board. */
  board: Placement[];
  /** Each player's rack (tile ids). */
  racks: Record<string, string[]>;
  /** Running score per player. */
  scores: Record<string, number>;
  /**
   * Consecutive scoreless turns (passes/exchanges). The game ends once every
   * player has had two in a row, the standard stalemate cut-off.
   */
  scorelessTurns: number;
}
