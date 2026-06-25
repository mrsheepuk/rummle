// Game-agnostic state shared by every game the platform hosts.
//
// This is the "envelope" half of a game document: identity, lobby/turn
// bookkeeping, and the player roster — everything the sync layer, lobby and
// "your games" list need without knowing whether the game is Rummle, a word
// game, or anything added later. Each game extends `BaseGameState` with its own
// payload (Rummle's pool/table/hands, Words' bag/board/racks, …) discriminated
// by `gameType`.
//
// Like the per-game state, this module is intentionally free of any
// React/Firebase dependency so it can be unit-tested and reused server-side.

/** Every game the platform knows how to host. The discriminant on state. */
export type GameType = "rummle" | "words";

export type GameStatus = "lobby" | "playing" | "finished";

export interface PlayerInfo {
  uid: string;
  name: string;
  seat: number;
  joinedAt: number;
}

/**
 * The shared shell of a game document. The fields here are the ones the
 * platform (sync, lobby, my-games) reads generically; everything game-specific
 * lives on the extending interface.
 */
export interface BaseGameState {
  id: string;
  gameType: GameType;
  status: GameStatus;
  hostId: string;
  /** Seed the per-game deck/bag is rebuilt from (decks themselves aren't stored). */
  seed: number;
  createdAt: number;
  updatedAt: number;

  players: Record<string, PlayerInfo>;
  /** Seating order (uids). Drives whose turn it is. */
  turnOrder: string[];
  /** Index into turnOrder of the player to move. */
  currentTurn: number;

  winnerId: string | null;
}

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

/** Display label for a game type (lobby, my-games badges, headers). */
export const GAME_LABELS: Record<GameType, string> = {
  rummle: "Numbers",
  words: "Words",
};

export class GameError extends Error {}

// --- generic lobby helpers, shared by every game's engine -------------------

/** The active player's uid, or undefined outside of play. */
export function currentPlayerId(state: BaseGameState): string | undefined {
  return state.turnOrder[state.currentTurn];
}

/** Index of the next seat to move (wraps). */
export function nextTurn(state: BaseGameState): number {
  return (state.currentTurn + 1) % state.turnOrder.length;
}

/**
 * Adds a player to a lobby, or refreshes an existing player's name (letting them
 * rejoin after a refresh/reconnect, even mid-game). New players can only join
 * while the game is still in the lobby. Returns the new players map + whether a
 * genuinely new seat was taken, so a caller can stamp `updatedAt` appropriately.
 */
export function seatPlayer(
  state: BaseGameState,
  uid: string,
  name: string,
  now: number,
): { players: Record<string, PlayerInfo>; added: boolean } {
  const existing = state.players[uid];
  if (existing) {
    return { players: { ...state.players, [uid]: { ...existing, name } }, added: false };
  }
  if (state.status !== "lobby") throw new GameError("This game has already started");
  const seats = Object.keys(state.players).length;
  if (seats >= MAX_PLAYERS) throw new GameError("Game is full");
  const player: PlayerInfo = { uid, name, seat: seats, joinedAt: now };
  return { players: { ...state.players, [uid]: player }, added: true };
}
