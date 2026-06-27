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

/**
 * The most recent committed play, kept so the next player can challenge it
 * (self-policing — there's no dictionary). Holds everything needed to revert
 * the play exactly: the tiles placed, the ids drawn to refill the rack, the
 * points awarded, and the scoreless counter from before the play. Replaced on
 * every commit and cleared by any non-scoring action (pass/exchange) — so only
 * the immediately-preceding play is ever challengeable.
 */
export interface LastPlay {
  /** Who committed the play. */
  uid: string;
  /** The tiles they placed on the board. */
  placements: Placement[];
  /** Tile ids drawn from the bag to refill their rack afterwards. */
  drawn: string[];
  /** Points the play scored (subtracted on a withdrawal). */
  score: number;
  /** scorelessTurns as it was before the play, restored on a withdrawal. */
  prevScorelessTurns: number;
}

/**
 * An open challenge against {@link LastPlay}. The challenger (the active player)
 * raises it; the challenged player decides — stand by the word (play stands, no
 * penalty for either side) or withdraw it (the play is reverted and they replay
 * the turn). Play is paused until they respond.
 */
export interface PendingChallenge {
  /** The active player who raised the challenge. */
  by: string;
  /** The player whose last play is being challenged (== lastPlay.uid). */
  against: string;
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
  /** The previous play, while it's still challengeable; null otherwise. */
  lastPlay: LastPlay | null;
  /** An unresolved challenge against {@link lastPlay}, or null. */
  challenge: PendingChallenge | null;
}
