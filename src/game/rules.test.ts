import { describe, expect, it } from "vitest";
import { rackPenalty, validateCommit, type MeldIds } from "./rules";
import { buildDeck, tileIndex } from "./tiles";

const index = tileIndex(buildDeck());

function commit(args: {
  beforeTable?: MeldIds[];
  afterTable: MeldIds[];
  beforeRack: string[];
  afterRack: string[];
  hasMadeInitialMeld?: boolean;
}) {
  return validateCommit({
    beforeTable: args.beforeTable ?? [],
    afterTable: args.afterTable,
    beforeRack: args.beforeRack,
    afterRack: args.afterRack,
    index,
    hasMadeInitialMeld: args.hasMadeInitialMeld ?? false,
  });
}

describe("opening play (initial meld)", () => {
  it("accepts a fresh meld worth >= 30", () => {
    // 10+10+10 = 30
    const r = commit({
      afterTable: [["red-10-a", "blue-10-a", "black-10-a"]],
      beforeRack: ["red-10-a", "blue-10-a", "black-10-a", "red-2-a"],
      afterRack: ["red-2-a"],
    });
    expect(r.ok).toBe(true);
    expect(r.initialMeldJustMade).toBe(true);
  });

  it("rejects an opening play worth less than 30", () => {
    const r = commit({
      afterTable: [["red-3-a", "blue-3-a", "black-3-a"]], // 9
      beforeRack: ["red-3-a", "blue-3-a", "black-3-a", "red-2-a"],
      afterRack: ["red-2-a"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/30 points/);
  });

  it("forbids rearranging the table before the opening play", () => {
    const r = commit({
      beforeTable: [["red-4-a", "red-5-a", "red-6-a"]],
      afterTable: [["red-4-a", "red-5-a", "red-6-a", "red-7-a"]], // touched existing meld
      beforeRack: ["red-7-a", "blue-1-a"],
      afterRack: ["blue-1-a"],
      hasMadeInitialMeld: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/before rearranging/);
  });
});

describe("conservation & legality", () => {
  it("rejects taking a table tile into the hand", () => {
    const r = commit({
      beforeTable: [["red-4-a", "red-5-a", "red-6-a"]],
      afterTable: [],
      beforeRack: ["blue-1-a"],
      afterRack: ["blue-1-a", "red-4-a", "red-5-a", "red-6-a"],
      hasMadeInitialMeld: true,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a commit that plays nothing", () => {
    const r = commit({
      afterTable: [],
      beforeRack: ["blue-1-a"],
      afterRack: ["blue-1-a"],
      hasMadeInitialMeld: true,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects leaving an invalid meld on the table", () => {
    const r = commit({
      afterTable: [["red-1-a", "blue-2-a", "black-9-a"]],
      beforeRack: ["red-1-a", "blue-2-a", "black-9-a"],
      afterRack: [],
      hasMadeInitialMeld: true,
    });
    expect(r.ok).toBe(false);
  });
});

describe("after the opening play", () => {
  it("allows rearranging the table once opened", () => {
    // Add red-7 to an existing run; allowed because player has opened.
    const r = commit({
      beforeTable: [["red-4-a", "red-5-a", "red-6-a"]],
      afterTable: [["red-4-a", "red-5-a", "red-6-a", "red-7-a"]],
      beforeRack: ["red-7-a", "blue-1-a"],
      afterRack: ["blue-1-a"],
      hasMadeInitialMeld: true,
    });
    expect(r.ok).toBe(true);
  });

  it("detects a win when the rack is emptied", () => {
    const r = commit({
      afterTable: [["red-10-a", "blue-10-a", "black-10-a"]],
      beforeRack: ["red-10-a", "blue-10-a", "black-10-a"],
      afterRack: [],
      hasMadeInitialMeld: true,
    });
    expect(r.ok).toBe(true);
    expect(r.isWin).toBe(true);
  });
});

describe("rackPenalty", () => {
  it("sums face values and penalises jokers", () => {
    const tiles = ["red-5-a", "blue-9-a", "joker-1"].map((id) => index.get(id)!);
    expect(rackPenalty(tiles)).toBe(5 + 9 + 30);
  });
});
