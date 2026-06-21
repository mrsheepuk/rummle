import {
  COLORS,
  COPIES_PER_TILE,
  JOKER_COUNT,
  MAX_VALUE,
  MIN_VALUE,
  type Tile,
} from "./types";
import { shuffle, type Rng } from "./rng";

const COPY_SUFFIX = ["a", "b", "c", "d"];

/**
 * Builds a full, ordered (unshuffled) Rummikub-style deck:
 * 4 colors x 13 values x 2 copies = 104 numbered tiles, plus 2 jokers = 106.
 */
export function buildDeck(): Tile[] {
  const tiles: Tile[] = [];
  for (const color of COLORS) {
    for (let value = MIN_VALUE; value <= MAX_VALUE; value++) {
      for (let copy = 0; copy < COPIES_PER_TILE; copy++) {
        tiles.push({
          kind: "number",
          id: `${color}-${value}-${COPY_SUFFIX[copy]}`,
          color,
          value,
        });
      }
    }
  }
  for (let j = 0; j < JOKER_COUNT; j++) {
    tiles.push({ kind: "joker", id: `joker-${j + 1}` });
  }
  return tiles;
}

export function shuffledDeck(rng: Rng): Tile[] {
  return shuffle(buildDeck(), rng);
}

/** Fast lookup table from tile id -> tile, for resolving ids stored in state. */
export function tileIndex(tiles: readonly Tile[]): Map<string, Tile> {
  const map = new Map<string, Tile>();
  for (const t of tiles) map.set(t.id, t);
  return map;
}

/** Stable sort key for displaying a rack: by color, then value; jokers last. */
export function rackSortKey(tile: Tile): number {
  if (tile.kind === "joker") return 9999;
  const colorRank = COLORS.indexOf(tile.color);
  return colorRank * 100 + tile.value;
}

export function isJoker(tile: Tile): boolean {
  return tile.kind === "joker";
}
