import { describe, expect, it } from "vitest";
import { buildDeck, rackSortByNumberKey, rackSortKey } from "./tiles";
import { mulberry32, shuffle } from "./rng";
import type { Color, Tile } from "./types";

const num = (color: Color, value: number): Tile => ({
  kind: "number",
  id: `${color}-${value}-a`,
  color,
  value,
});
const joker: Tile = { kind: "joker", id: "joker-1" };

function sortedIds(tiles: Tile[], key: (t: Tile) => number): string[] {
  return [...tiles].sort((a, b) => key(a) - key(b)).map((t) => t.id);
}

describe("deck", () => {
  it("has 106 tiles: 104 numbered + 2 jokers", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(106);
    expect(deck.filter((t) => t.kind === "joker")).toHaveLength(2);
    expect(deck.filter((t) => t.kind === "number")).toHaveLength(104);
  });

  it("has unique ids", () => {
    const deck = buildDeck();
    expect(new Set(deck.map((t) => t.id)).size).toBe(deck.length);
  });

  it("has two copies of every numbered tile", () => {
    const deck = buildDeck();
    const counts = new Map<string, number>();
    for (const t of deck) {
      if (t.kind !== "number") continue;
      const key = `${t.color}-${t.value}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
    expect(counts.size).toBe(52); // 4 colors x 13 values
  });
});

describe("rack sort keys", () => {
  // COLORS order is red, blue, black, orange.
  it("sorts by colour then value, jokers last", () => {
    const tiles = [num("blue", 2), joker, num("red", 5), num("red", 1), num("blue", 1)];
    expect(sortedIds(tiles, rackSortKey)).toEqual([
      "red-1-a",
      "red-5-a",
      "blue-1-a",
      "blue-2-a",
      "joker-1",
    ]);
  });

  it("sorts by value then colour, jokers last", () => {
    const tiles = [num("blue", 2), joker, num("red", 5), num("red", 1), num("blue", 1)];
    expect(sortedIds(tiles, rackSortByNumberKey)).toEqual([
      "red-1-a",
      "blue-1-a",
      "blue-2-a",
      "red-5-a",
      "joker-1",
    ]);
  });
});

describe("shuffle", () => {
  it("is deterministic for a fixed seed and preserves all tiles", () => {
    const deck = buildDeck();
    const a = shuffle(deck, mulberry32(42));
    const b = shuffle(deck, mulberry32(42));
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(new Set(a.map((t) => t.id))).toEqual(new Set(deck.map((t) => t.id)));
  });

  it("produces a different order for a different seed", () => {
    const deck = buildDeck();
    const a = shuffle(deck, mulberry32(1));
    const b = shuffle(deck, mulberry32(2));
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
  });
});
