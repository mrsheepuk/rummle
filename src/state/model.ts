import type { MeldIds } from "../game/rules";
import type { BaseGameState } from "../platform/model";

// Shared envelope types now live in the platform layer; re-exported here so the
// existing Rummle imports keep working unchanged.
export { MAX_PLAYERS, MIN_PLAYERS } from "../platform/model";
export type { GameStatus, PlayerInfo } from "../platform/model";

/**
 * The full Rummle game document as stored in Firestore (one doc per game),
 * extending the platform's shared envelope with Rummle's own payload.
 *
 * NOTE: `hands` currently holds every player's rack in the shared document, so
 * it is readable by all players (the accepted "cheat safety: don't care for
 * now" trade-off). The shape is intentionally a per-uid map so hands can later
 * be moved into a private, Cloud-Function-owned subcollection without touching
 * the rest of the model or the sync interface.
 */
export interface GameState extends BaseGameState {
  gameType: "rummle";

  /** Remaining tiles to draw ("the pouch"), as tile ids. */
  pool: string[];
  /** Melds currently on the table, each an ordered list of tile ids. */
  table: MeldIds[];
  /** Each player's rack (tile ids). */
  hands: Record<string, string[]>;
  /** Whether each player has made their 30-point opening play. */
  hasOpened: Record<string, boolean>;
}
