import { describe, expect, it } from "vitest";
import { analyzeMeld } from "./melds";
import { buildDeck, tileIndex } from "./tiles";
import type { Tile } from "./types";

const index = tileIndex(buildDeck());
const t = (id: string): Tile => {
  const tile = index.get(id);
  if (!tile) throw new Error(`bad id ${id}`);
  return tile;
};
const meld = (...ids: string[]): Tile[] => ids.map(t);

describe("groups", () => {
  it("accepts a 3-tile group of same number, different colors", () => {
    const r = analyzeMeld(meld("red-7-a", "blue-7-a", "black-7-a"));
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("group");
    expect(r.points).toBe(21);
  });

  it("accepts a 4-tile group", () => {
    const r = analyzeMeld(meld("red-5-a", "blue-5-a", "black-5-a", "orange-5-a"));
    expect(r.valid).toBe(true);
    expect(r.points).toBe(20);
  });

  it("rejects a 5-tile group (only 4 colors exist)", () => {
    const r = analyzeMeld(meld("red-5-a", "blue-5-a", "black-5-a", "orange-5-a", "red-5-b"));
    expect(r.valid).toBe(false);
  });

  it("rejects a group with a duplicate color", () => {
    const r = analyzeMeld(meld("red-7-a", "red-7-b", "blue-7-a"));
    expect(r.valid).toBe(false);
  });

  it("rejects a group with mismatched numbers", () => {
    const r = analyzeMeld(meld("red-7-a", "blue-8-a", "black-7-a"));
    expect(r.valid).toBe(false);
  });
});

describe("runs", () => {
  it("accepts a 3-tile consecutive run of one color", () => {
    const r = analyzeMeld(meld("red-4-a", "red-5-a", "red-6-a"));
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("run");
    expect(r.points).toBe(15);
  });

  it("rejects a run with a gap", () => {
    const r = analyzeMeld(meld("red-4-a", "red-6-a", "red-7-a"));
    expect(r.valid).toBe(false);
  });

  it("rejects a run spanning two colors", () => {
    const r = analyzeMeld(meld("red-4-a", "blue-5-a", "red-6-a"));
    expect(r.valid).toBe(false);
  });

  it("rejects a run that wraps past 13", () => {
    const r = analyzeMeld(meld("red-12-a", "red-13-a", "red-1-a"));
    expect(r.valid).toBe(false);
  });

  it("rejects out-of-order tiles", () => {
    const r = analyzeMeld(meld("red-6-a", "red-5-a", "red-4-a"));
    expect(r.valid).toBe(false);
  });
});

describe("jokers", () => {
  it("completes a group and takes the group's value", () => {
    const r = analyzeMeld(meld("red-9-a", "blue-9-a", "joker-1"));
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("group");
    expect(r.points).toBe(27);
  });

  it("fills a gap in a run and takes the slot's value", () => {
    // red 5, [joker=6], red 7 -> points 5+6+7 = 18
    const r = analyzeMeld(meld("red-5-a", "joker-1", "red-7-a"));
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("run");
    expect(r.points).toBe(18);
  });

  it("extends a run at the end", () => {
    // red 11, red 12, [joker=13]
    const r = analyzeMeld(meld("red-11-a", "red-12-a", "joker-1"));
    expect(r.valid).toBe(true);
    expect(r.points).toBe(36);
  });

  it("rejects a joker run that would push past 13", () => {
    // red 12, red 13, [joker=14] -> invalid
    const r = analyzeMeld(meld("red-12-a", "red-13-a", "joker-1"));
    expect(r.valid).toBe(false);
  });
});

describe("general", () => {
  it("rejects fewer than 3 tiles", () => {
    expect(analyzeMeld(meld("red-7-a", "blue-7-a")).valid).toBe(false);
  });
});
