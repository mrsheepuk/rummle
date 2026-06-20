import {
  MAX_VALUE,
  MIN_VALUE,
  type MeldAnalysis,
  type Tile,
} from "./types";

/**
 * Analyses an *ordered* list of tiles to decide whether it forms a valid
 * group or run, and computes its point value.
 *
 * Order matters: the tiles are taken in the sequence given (which mirrors the
 * left-to-right order the player arranges them on the table). This makes joker
 * placement unambiguous — a joker simply occupies its slot.
 *
 *  - Group: 3 or 4 tiles, all the same number, all different colors.
 *  - Run:   3+ tiles, same color, consecutive ascending numbers (no wrap).
 *  - Jokers substitute for any single tile.
 */
export function analyzeMeld(tiles: readonly Tile[]): MeldAnalysis {
  if (tiles.length < 3) {
    return { valid: false, points: 0, reason: "A meld needs at least 3 tiles" };
  }

  const asGroup = analyzeGroup(tiles);
  if (asGroup.valid) return asGroup;

  const asRun = analyzeRun(tiles);
  if (asRun.valid) return asRun;

  // Prefer the most informative reason.
  return {
    valid: false,
    points: 0,
    reason: asRun.reason ?? asGroup.reason ?? "Not a valid group or run",
  };
}

function analyzeGroup(tiles: readonly Tile[]): MeldAnalysis {
  if (tiles.length < 3 || tiles.length > 4) {
    return { valid: false, points: 0, reason: "A group must be 3 or 4 tiles" };
  }

  const numbers = tiles.filter((t): t is Extract<Tile, { kind: "number" }> => t.kind === "number");
  const jokerCount = tiles.length - numbers.length;

  if (numbers.length === 0) {
    return { valid: false, points: 0, reason: "A group needs at least one numbered tile" };
  }

  const value = numbers[0]!.value;
  if (!numbers.every((t) => t.value === value)) {
    return { valid: false, points: 0, reason: "Group tiles must share the same number" };
  }

  const colors = new Set(numbers.map((t) => t.color));
  if (colors.size !== numbers.length) {
    return { valid: false, points: 0, reason: "Group tiles must all be different colors" };
  }

  // With only 4 colors, distinct colors + jokers can always be coloured in
  // when the total is <= 4, which the size check above already guarantees.
  const points = value * tiles.length; // jokers in a group take the group value
  return { valid: true, kind: "group", points };
}

function analyzeRun(tiles: readonly Tile[]): MeldAnalysis {
  const numbers = tiles
    .map((t, index) => ({ tile: t, index }))
    .filter((e) => e.tile.kind === "number") as {
    tile: Extract<Tile, { kind: "number" }>;
    index: number;
  }[];

  if (numbers.length === 0) {
    return { valid: false, points: 0, reason: "A run needs at least one numbered tile" };
  }

  const color = numbers[0]!.tile.color;
  if (!numbers.every((e) => e.tile.color === color)) {
    return { valid: false, points: 0, reason: "Run tiles must all be the same color" };
  }

  // Position i should hold value (start + i). Derive `start` from each
  // numbered tile and require agreement.
  const start = numbers[0]!.tile.value - numbers[0]!.index;
  for (const e of numbers) {
    if (e.tile.value - e.index !== start) {
      return { valid: false, points: 0, reason: "Run numbers must be consecutive" };
    }
  }

  const end = start + tiles.length - 1;
  if (start < MIN_VALUE || end > MAX_VALUE) {
    return { valid: false, points: 0, reason: `A run must stay within ${MIN_VALUE}–${MAX_VALUE}` };
  }

  // Each slot's value is start + position; jokers take their slot's value.
  let points = 0;
  for (let i = 0; i < tiles.length; i++) points += start + i;
  return { valid: true, kind: "run", points };
}

/** True when an ordered tile list is a valid group or run. */
export function isValidMeld(tiles: readonly Tile[]): boolean {
  return analyzeMeld(tiles).valid;
}
