// Core domain types for Rummle. This module is intentionally free of any
// Firebase / React / DOM dependency so the rules engine can be unit-tested in
// isolation and reused on a server (e.g. a future authoritative Cloud Function).

export const COLORS = ["red", "blue", "black", "orange"] as const;
export type Color = (typeof COLORS)[number];

/** Smallest and largest number printed on a numbered tile. */
export const MIN_VALUE = 1;
export const MAX_VALUE = 13;

/** Each numbered tile exists in this many identical copies in the deck. */
export const COPIES_PER_TILE = 2;

/** Number of jokers (wild tiles) in the deck. */
export const JOKER_COUNT = 2;

/** Tiles drawn into a player's starting rack. */
export const STARTING_RACK_SIZE = 14;

/** Minimum total point value required for a player's opening play. */
export const INITIAL_MELD_MIN_POINTS = 30;

/** Penalty value used for a joker still held in hand at game end. */
export const JOKER_PENALTY = 30;

export interface NumberTile {
  kind: "number";
  /** Stable unique id, e.g. "red-5-a". Two copies share value but not id. */
  id: string;
  color: Color;
  value: number;
}

export interface JokerTile {
  kind: "joker";
  id: string; // "joker-1" / "joker-2"
}

export type Tile = NumberTile | JokerTile;

/** A meld is an ordered list of tile ids placed on the table. */
export type MeldKind = "group" | "run";

export interface MeldAnalysis {
  valid: boolean;
  kind?: MeldKind;
  /** Total point value of the meld (jokers count as what they represent). */
  points: number;
  /** Human-readable reason when invalid. */
  reason?: string;
}
