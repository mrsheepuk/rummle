// Turn engine: pure functions that advance an immutable GameState. The sync
// layer is responsible for persisting the returned state (e.g. inside a
// Firestore transaction). Nothing here imports Firebase.

import { validateCommit, type MeldIds } from "../game/rules";
import { shuffledDeck, tileIndex } from "../game/tiles";
import { mulberry32 } from "../game/rng";
import type { Tile } from "../game/types";
import { STARTING_RACK_SIZE } from "../game/types";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type GameState,
  type PlayerInfo,
} from "./model";

export class GameError extends Error {}

export function createGame(args: {
  id: string;
  hostId: string;
  hostName: string;
  seed: number;
  now: number;
}): GameState {
  const host: PlayerInfo = {
    uid: args.hostId,
    name: args.hostName,
    seat: 0,
    joinedAt: args.now,
  };
  return {
    id: args.id,
    gameType: "rummle",
    status: "lobby",
    hostId: args.hostId,
    seed: args.seed,
    createdAt: args.now,
    updatedAt: args.now,
    players: { [args.hostId]: host },
    turnOrder: [],
    currentTurn: 0,
    pool: [],
    table: [],
    hands: {},
    hasOpened: {},
    winnerId: null,
  };
}

export function addPlayer(state: GameState, uid: string, name: string, now: number): GameState {
  if (state.players[uid]) {
    // Existing players can always rejoin (refresh, reconnect, navigate back) —
    // even after the game has started; we just refresh their display name.
    return { ...state, players: { ...state.players, [uid]: { ...state.players[uid]!, name } } };
  }
  // New players can only join while the game is still in the lobby.
  if (state.status !== "lobby") throw new GameError("This game has already started");
  const seats = Object.keys(state.players).length;
  if (seats >= MAX_PLAYERS) throw new GameError("Game is full");
  const player: PlayerInfo = { uid, name, seat: seats, joinedAt: now };
  return {
    ...state,
    updatedAt: now,
    players: { ...state.players, [uid]: player },
  };
}

/**
 * Deals starting racks from a freshly shuffled, seed-derived deck.
 *
 * `allowSolo` drops the 2-player minimum so a single host can start a game on
 * their own. It's a test affordance (hidden behind a query param in the UI):
 * with one seat, `nextTurn` loops straight back to you, so draw/commit/open/win
 * all exercise normally without an opponent.
 */
export function startGame(
  state: GameState,
  now: number,
  opts: { allowSolo?: boolean } = {},
): GameState {
  if (state.status !== "lobby") throw new GameError("Game already started");
  const players = Object.values(state.players).sort((a, b) => a.seat - b.seat);
  const min = opts.allowSolo ? 1 : MIN_PLAYERS;
  if (players.length < min) throw new GameError(`Need at least ${min} player${min > 1 ? "s" : ""}`);

  const deck = shuffledDeck(mulberry32(state.seed));
  const hands: Record<string, string[]> = {};
  const hasOpened: Record<string, boolean> = {};
  let cursor = 0;
  for (const p of players) {
    hands[p.uid] = deck.slice(cursor, cursor + STARTING_RACK_SIZE).map((t) => t.id);
    hasOpened[p.uid] = false;
    cursor += STARTING_RACK_SIZE;
  }
  const pool = deck.slice(cursor).map((t) => t.id);

  return {
    ...state,
    status: "playing",
    updatedAt: now,
    turnOrder: players.map((p) => p.uid),
    currentTurn: 0,
    pool,
    table: [],
    hands,
    hasOpened,
    winnerId: null,
  };
}

export function currentPlayerId(state: GameState): string | undefined {
  return state.turnOrder[state.currentTurn];
}

function assertActive(state: GameState, uid: string): void {
  if (state.status !== "playing") throw new GameError("Game is not in progress");
  if (currentPlayerId(state) !== uid) throw new GameError("It is not your turn");
}

function nextTurn(state: GameState): number {
  return (state.currentTurn + 1) % state.turnOrder.length;
}

/** The active player draws a tile from the pool and ends their turn. */
export function applyDraw(state: GameState, uid: string, now: number): GameState {
  assertActive(state, uid);
  if (state.pool.length === 0) {
    // Nothing to draw — the turn simply passes.
    return { ...state, updatedAt: now, currentTurn: nextTurn(state) };
  }
  const pool = state.pool.slice();
  const drawn = pool.shift()!;
  const hands = { ...state.hands, [uid]: [...(state.hands[uid] ?? []), drawn] };
  return { ...state, updatedAt: now, pool, hands, currentTurn: nextTurn(state) };
}

/**
 * The active player commits a new table arrangement plus their resulting rack.
 * Validates the move with the rules engine, records the opening meld, checks
 * for a win, and advances the turn.
 */
export function applyCommit(
  state: GameState,
  uid: string,
  afterTable: MeldIds[],
  afterRack: string[],
  now: number,
): GameState {
  assertActive(state, uid);

  const index = buildIndex(state);
  const result = validateCommit({
    beforeTable: state.table,
    afterTable,
    beforeRack: state.hands[uid] ?? [],
    afterRack,
    index,
    hasMadeInitialMeld: state.hasOpened[uid] ?? false,
  });
  if (!result.ok) throw new GameError(result.reason ?? "Illegal move");

  const hands = { ...state.hands, [uid]: afterRack };
  const hasOpened = result.initialMeldJustMade
    ? { ...state.hasOpened, [uid]: true }
    : state.hasOpened;

  if (result.isWin) {
    return {
      ...state,
      updatedAt: now,
      table: afterTable,
      hands,
      hasOpened,
      status: "finished",
      winnerId: uid,
    };
  }

  return {
    ...state,
    updatedAt: now,
    table: afterTable,
    hands,
    hasOpened,
    currentTurn: nextTurn(state),
  };
}

/** Resolves every tile id referenced by the game into a Tile. */
export function buildIndex(state: GameState): Map<string, Tile> {
  // The deck is fully determined by the seed, so rebuild it for id resolution.
  return tileIndex(shuffledDeck(mulberry32(state.seed)));
}
