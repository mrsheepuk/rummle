import type { MeldIds } from "../game/rules";

export type GameStatus = "lobby" | "playing" | "finished";

export interface PlayerInfo {
  uid: string;
  name: string;
  seat: number;
  joinedAt: number;
}

/**
 * The full game document as stored in Firestore (one doc per game).
 *
 * NOTE: `hands` currently holds every player's rack in the shared document, so
 * it is readable by all players (the accepted "cheat safety: don't care for
 * now" trade-off). The shape is intentionally a per-uid map so hands can later
 * be moved into a private, Cloud-Function-owned subcollection without touching
 * the rest of the model or the sync interface.
 */
export interface GameState {
  id: string;
  status: GameStatus;
  hostId: string;
  seed: number;
  createdAt: number;
  updatedAt: number;

  players: Record<string, PlayerInfo>;
  /** Seating order (uids). Drives whose turn it is. */
  turnOrder: string[];
  /** Index into turnOrder of the player to move. */
  currentTurn: number;

  /** Remaining tiles to draw ("the pouch"), as tile ids. */
  pool: string[];
  /** Melds currently on the table, each an ordered list of tile ids. */
  table: MeldIds[];
  /** Each player's rack (tile ids). */
  hands: Record<string, string[]>;
  /** Whether each player has made their 30-point opening play. */
  hasOpened: Record<string, boolean>;

  winnerId: string | null;
}

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
