// Builds the 100-tile letter bag and resolves tile ids back to tiles. The bag
// is fully determined by the game seed (rebuilt on demand, never persisted),
// exactly like Rummle's deck.

import { shuffle, type Rng } from "../../game/rng";
import { BLANK_COUNT, LETTER_SET, type LetterTile } from "./types";

/** Builds the full, ordered (unshuffled) letter bag: 98 letters + 2 blanks. */
export function buildBag(): LetterTile[] {
  const tiles: LetterTile[] = [];
  for (const letter of Object.keys(LETTER_SET)) {
    const { count, value } = LETTER_SET[letter]!;
    for (let i = 0; i < count; i++) {
      tiles.push({ id: `${letter}-${i + 1}`, letter, value, isBlank: false });
    }
  }
  for (let b = 0; b < BLANK_COUNT; b++) {
    tiles.push({ id: `blank-${b + 1}`, letter: null, value: 0, isBlank: true });
  }
  return tiles;
}

export function shuffledBag(rng: Rng): LetterTile[] {
  return shuffle(buildBag(), rng);
}

/** Fast lookup table from tile id -> tile, for resolving ids stored in state. */
export function bagIndex(tiles: readonly LetterTile[]): Map<string, LetterTile> {
  const map = new Map<string, LetterTile>();
  for (const t of tiles) map.set(t.id, t);
  return map;
}

/** Stable sort key for displaying a rack: blanks last, then alphabetical. */
export function rackSortKey(tile: LetterTile): string {
  return tile.isBlank ? "~" : tile.letter ?? "~";
}
