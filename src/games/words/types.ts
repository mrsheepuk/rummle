// Core domain types + constants for the word-tile game. Like Rummle's
// `game/types.ts`, this is pure (no React/Firebase) so the rules engine can be
// unit-tested in isolation and could move server-side later.

export const BOARD_SIZE = 15;
export const RACK_SIZE = 7;
/** Centre row/column (0-indexed) the opening play must cover. */
export const CENTER = 7;
/** Bonus for placing all seven rack tiles in one turn (a "bingo"). */
export const BINGO_BONUS = 50;

export interface LetterTile {
  /** Stable unique id, e.g. "E-3" (3rd E) or "blank-1". */
  id: string;
  /** The printed letter, or null for an unassigned blank. */
  letter: string | null;
  /** Point value; blanks are 0. */
  value: number;
  isBlank: boolean;
}

/** Standard English letter distribution: [count, point value]. */
export const LETTER_SET: Record<string, { count: number; value: number }> = {
  A: { count: 9, value: 1 }, B: { count: 2, value: 3 }, C: { count: 2, value: 3 },
  D: { count: 4, value: 2 }, E: { count: 12, value: 1 }, F: { count: 2, value: 4 },
  G: { count: 3, value: 2 }, H: { count: 2, value: 4 }, I: { count: 9, value: 1 },
  J: { count: 1, value: 8 }, K: { count: 1, value: 5 }, L: { count: 4, value: 1 },
  M: { count: 2, value: 3 }, N: { count: 6, value: 1 }, O: { count: 8, value: 1 },
  P: { count: 2, value: 3 }, Q: { count: 1, value: 10 }, R: { count: 6, value: 1 },
  S: { count: 4, value: 1 }, T: { count: 6, value: 1 }, U: { count: 4, value: 1 },
  V: { count: 2, value: 4 }, W: { count: 2, value: 4 }, X: { count: 1, value: 8 },
  Y: { count: 2, value: 4 }, Z: { count: 1, value: 10 },
};

/** Number of blank (wild) tiles — the word game's equivalent of jokers. */
export const BLANK_COUNT = 2;

export type Premium = "DL" | "TL" | "DW" | "TW";

// Standard Scrabble premium squares, given as one representative per symmetry
// and mirrored across both axes at build time (see `buildPremiums`).
const TW = [[0, 0], [0, 7], [7, 0]];
const DW = [[1, 1], [2, 2], [3, 3], [4, 4]]; // plus the centre star, added below
const TL = [[1, 5], [5, 1], [5, 5]];
const DL = [[0, 3], [2, 6], [3, 7], [6, 6]];

/** Builds the full premium map keyed by "r,c", mirroring the seed squares. */
function buildPremiums(): Map<string, Premium> {
  const map = new Map<string, Premium>();
  const last = BOARD_SIZE - 1;
  const mirror = (r: number, c: number): [number, number][] => [
    [r, c], [r, last - c], [last - r, c], [last - r, last - c],
    [c, r], [c, last - r], [last - c, r], [last - c, last - r],
  ];
  const add = (seeds: number[][], kind: Premium) => {
    for (const [r, c] of seeds) for (const [mr, mc] of mirror(r!, c!)) map.set(`${mr},${mc}`, kind);
  };
  // Order matters where squares overlap under mirroring: word bonuses win.
  add(DL, "DL");
  add(TL, "TL");
  add(DW, "DW");
  add(TW, "TW");
  map.set(`${CENTER},${CENTER}`, "DW");
  return map;
}

const PREMIUMS = buildPremiums();

export function premiumAt(r: number, c: number): Premium | null {
  return PREMIUMS.get(`${r},${c}`) ?? null;
}
