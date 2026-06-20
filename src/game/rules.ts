import { analyzeMeld } from "./melds";
import {
  INITIAL_MELD_MIN_POINTS,
  JOKER_PENALTY,
  type Tile,
} from "./types";

/** A meld as stored in game state: an ordered list of tile ids. */
export type MeldIds = string[];

export interface CommitInput {
  beforeTable: MeldIds[];
  afterTable: MeldIds[];
  beforeRack: string[];
  afterRack: string[];
  /** Resolver from tile id to the tile itself. */
  index: Map<string, Tile>;
  hasMadeInitialMeld: boolean;
}

export interface CommitResult {
  ok: boolean;
  reason?: string;
  /** True when this commit constitutes the player's opening (30-point) play. */
  initialMeldJustMade?: boolean;
  /** True when the player emptied their rack with a fully valid table. */
  isWin?: boolean;
}

function resolve(index: Map<string, Tile>, ids: readonly string[]): Tile[] {
  return ids.map((id) => {
    const t = index.get(id);
    if (!t) throw new Error(`Unknown tile id: ${id}`);
    return t;
  });
}

const meldKey = (m: MeldIds): string => m.join(",");

/**
 * Validates a player's proposed new table arrangement at the moment they
 * commit their turn. Enforces the core Rummikub legality rules:
 *
 *  1. Tile conservation — no tiles invented or destroyed.
 *  2. Hands are one-way — a player may move tiles from rack to table, never
 *     pull table tiles into their hand.
 *  3. Every meld left on the table is a valid group or run.
 *  4. Opening play — until a player has laid down melds worth >= 30 points
 *     (from their own hand only, without touching existing table melds), they
 *     may not rearrange the shared table.
 */
export function validateCommit(input: CommitInput): CommitResult {
  const { beforeTable, afterTable, beforeRack, afterRack, index, hasMadeInitialMeld } = input;

  const beforeTableTiles = beforeTable.flat();
  const afterTableTiles = afterTable.flat();
  const beforeAll = new Set([...beforeTableTiles, ...beforeRack]);
  const afterAll = new Set([...afterTableTiles, ...afterRack]);

  // 1. Conservation: same set of tiles before and after, no duplicates.
  if (afterTableTiles.length + afterRack.length !== afterAll.size) {
    return { ok: false, reason: "Duplicate tiles detected" };
  }
  if (beforeAll.size !== afterAll.size) {
    return { ok: false, reason: "Tile count changed during the turn" };
  }
  for (const id of afterAll) {
    if (!beforeAll.has(id)) return { ok: false, reason: "Unknown tile appeared on the table" };
  }

  // 2. Hands are one-way: every after-rack tile was already in the before-rack.
  const beforeRackSet = new Set(beforeRack);
  for (const id of afterRack) {
    if (!beforeRackSet.has(id)) {
      return { ok: false, reason: "You can't take tiles from the table into your hand" };
    }
  }

  // 3. Every meld on the resulting table must be valid.
  for (const meld of afterTable) {
    const analysis = analyzeMeld(resolve(index, meld));
    if (!analysis.valid) {
      return { ok: false, reason: analysis.reason ?? "Invalid meld on the table" };
    }
  }

  // Tiles newly played from hand this turn.
  const afterRackSet = new Set(afterRack);
  const newlyPlayed = beforeRack.filter((id) => !afterRackSet.has(id));

  // A play must actually do something (place at least one tile). Drawing is a
  // separate action handled by the turn engine.
  if (newlyPlayed.length === 0) {
    return { ok: false, reason: "You must play at least one tile (or draw instead)" };
  }

  let initialMeldJustMade = false;
  if (!hasMadeInitialMeld) {
    const newSet = new Set(newlyPlayed);
    const beforeMeldKeys = new Set(beforeTable.map(meldKey));

    let newPoints = 0;
    for (const meld of afterTable) {
      if (beforeMeldKeys.has(meldKey(meld))) continue; // untouched existing meld
      // This is a new/changed meld — for an opening play it must be built
      // entirely from freshly played tiles.
      if (!meld.every((id) => newSet.has(id))) {
        return {
          ok: false,
          reason: "Lay down 30 points from your own tiles before rearranging the table",
        };
      }
      newPoints += analyzeMeld(resolve(index, meld)).points;
    }

    if (newPoints < INITIAL_MELD_MIN_POINTS) {
      return {
        ok: false,
        reason: `Your opening play must total at least ${INITIAL_MELD_MIN_POINTS} points (this one is ${newPoints})`,
      };
    }
    initialMeldJustMade = true;
  }

  const isWin = afterRack.length === 0;
  return { ok: true, initialMeldJustMade, isWin };
}

/**
 * End-of-game penalty for tiles left in a rack (negative score in classic
 * Rummikub). Number tiles cost their face value; jokers cost a flat penalty.
 */
export function rackPenalty(rack: readonly Tile[]): number {
  return rack.reduce((sum, t) => sum + (t.kind === "joker" ? JOKER_PENALTY : t.value), 0);
}
