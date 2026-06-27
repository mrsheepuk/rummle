import { describe, expect, it } from "vitest";
import {
  GameError,
  addPlayer,
  applyChallenge,
  applyCommit,
  applyExchange,
  applyPass,
  createWordsGame,
  currentPlayerId,
  respondToChallenge,
  scorePlay,
  startWordsGame,
} from "./engine";
import { bagIndex, buildBag } from "./tiles";
import { BLANK_COUNT, CENTER, RACK_SIZE } from "./types";
import type { Placement, WordsGameState } from "./model";

const index = bagIndex(buildBag());

/** A horizontal play starting at (r, c0). */
function row(r: number, c0: number, word: string, idOf = (l: string) => `${l}-1`): Placement[] {
  return [...word].map((letter, i) => ({ r, c: c0 + i, tileId: idOf(letter), letter }));
}

describe("bag", () => {
  it("builds the standard 100-tile bag", () => {
    const bag = buildBag();
    expect(bag).toHaveLength(100);
    expect(bag.filter((t) => t.isBlank)).toHaveLength(BLANK_COUNT);
    expect(bag.find((t) => t.id === "Q-1")!.value).toBe(10);
  });
});

describe("lobby + start", () => {
  it("seats the host and deals racks on start", () => {
    let g = createWordsGame({ id: "WRDS", hostId: "h", hostName: "A", seed: 5, now: 1 });
    g = addPlayer(g, "g", "B", 2);
    g = startWordsGame(g, 3);
    expect(g.status).toBe("playing");
    expect(g.racks["h"]).toHaveLength(RACK_SIZE);
    expect(g.racks["g"]).toHaveLength(RACK_SIZE);
    expect(g.bag).toHaveLength(100 - 2 * RACK_SIZE);
    expect(currentPlayerId(g)).toBe("h");
  });

  it("needs two players unless solo is allowed", () => {
    const g = createWordsGame({ id: "WRDS", hostId: "h", hostName: "A", seed: 5, now: 1 });
    expect(() => startWordsGame(g, 2)).toThrow(GameError);
    expect(() => startWordsGame(g, 2, { allowSolo: true })).not.toThrow();
  });
});

describe("scorePlay geometry", () => {
  it("requires the opening play to cross the centre", () => {
    expect(() => scorePlay([], row(0, 0, "AT"), index)).toThrow(/centre/i);
  });

  it("scores a first word, doubling on the centre star", () => {
    // C(3) A(1) T(1); centre (7,7) under A is a double-word square -> ×2 = 10.
    const score = scorePlay([], row(CENTER, 6, "CAT"), index);
    expect(score).toBe(10);
  });

  it("awards the 50-point bingo for playing all seven tiles", () => {
    // Seven A's across the centre: (1×7) ×2 (centre DW) + 50 = 64.
    const play = row(CENTER, 4, "AAAAAAA", (l) => `${l}-${1 + Math.random()}`).map((p, i) => ({
      ...p,
      tileId: `A-${i + 1}`,
    }));
    expect(scorePlay([], play, index)).toBe(64);
  });

  it("rejects gaps and diagonals", () => {
    const gapped: Placement[] = [
      { r: CENTER, c: 7, tileId: "C-1", letter: "C" },
      { r: CENTER, c: 9, tileId: "T-1", letter: "T" },
    ];
    expect(() => scorePlay([], gapped, index)).toThrow(/gap/i);
    const diagonal: Placement[] = [
      { r: CENTER, c: CENTER, tileId: "A-1", letter: "A" },
      { r: CENTER + 1, c: CENTER + 1, tileId: "T-1", letter: "T" },
    ];
    expect(() => scorePlay([], diagonal, index)).toThrow(/row or column/i);
  });

  it("requires later plays to connect to existing tiles", () => {
    const board: Placement[] = row(CENTER, 6, "CAT");
    // Floating word elsewhere — legal geometry, but disconnected.
    expect(() => scorePlay(board, row(0, 0, "AT"), index)).toThrow(/connect/i);
    // Hanging "S" off the end of CAT makes CATS and connects — the whole word
    // scores: C(3)+A(1)+T(1)+S(1) = 6 (existing tiles re-score, premiums don't).
    const cats: Placement[] = [{ r: CENTER, c: 9, tileId: "S-1", letter: "S" }];
    expect(scorePlay(board, cats, index)).toBe(6);
  });

  it("scores a crossing word formed by the new tile", () => {
    // CAT on the board; play an "S" below the A to make "AS" downward.
    const board: Placement[] = row(CENTER, 6, "CAT");
    const play: Placement[] = [{ r: CENTER + 1, c: 7, tileId: "S-1", letter: "S" }];
    // "AS": A already down (1) + S new (1) = 2. (7,7) is the existing A, not re-scored.
    expect(scorePlay(board, play, index)).toBe(2);
  });
});

// A hand-built playing state with controlled racks and bag, for turn tests.
function playing(over: Partial<WordsGameState> = {}): WordsGameState {
  return {
    id: "WRDS",
    gameType: "words",
    status: "playing",
    hostId: "h",
    seed: 1,
    createdAt: 0,
    updatedAt: 0,
    players: {
      h: { uid: "h", name: "A", seat: 0, joinedAt: 0 },
      g: { uid: "g", name: "B", seat: 1, joinedAt: 0 },
    },
    turnOrder: ["h", "g"],
    currentTurn: 0,
    bag: ["E-2", "S-2", "R-2", "T-2"],
    board: [],
    racks: { h: ["C-1", "A-1", "T-1"], g: ["E-1", "O-1"] },
    scores: { h: 0, g: 0 },
    scorelessTurns: 0,
    winnerId: null,
    lastPlay: null,
    challenge: null,
    ...over,
  };
}

describe("applyCommit", () => {
  it("rejects a tile not on the player's rack and out-of-turn plays", () => {
    const g = playing();
    expect(() => applyCommit(g, { uid: "h", placements: row(CENTER, 6, "DOG"), now: 1 })).toThrow(/rack/i);
    expect(() => applyCommit(g, { uid: "g", placements: row(CENTER, 6, "CAT"), now: 1 })).toThrow(/your turn/i);
  });

  it("commits a word, scores it, refills the rack, and passes the turn", () => {
    const g = applyCommit(playing(), { uid: "h", placements: row(CENTER, 6, "CAT"), now: 5 });
    expect(g.scores["h"]).toBe(10);
    expect(g.board).toHaveLength(3);
    // Rack emptied (played all 3), then refilled toward 7 — draws all 4 in the bag.
    expect(g.racks["h"]).toEqual(["E-2", "S-2", "R-2", "T-2"]);
    expect(g.bag).toEqual([]);
    expect(currentPlayerId(g)).toBe("g");
    expect(g.scorelessTurns).toBe(0);
  });

  it("ends the game when a player goes out with an empty bag", () => {
    const g = applyCommit(playing({ bag: [] }), { uid: "h", placements: row(CENTER, 6, "CAT"), now: 5 });
    expect(g.status).toBe("finished");
    // h emptied their rack (+10), g loses E(1)+O(1)=2 and h gains it: 10+2=12.
    expect(g.scores["h"]).toBe(12);
    expect(g.scores["g"]).toBe(-2);
    expect(g.winnerId).toBe("h");
  });

  it("validates blank assignments", () => {
    const g = playing({ racks: { h: ["blank-1", "A-1"], g: ["E-1"] } });
    const ok = applyCommit(g, {
      uid: "h",
      placements: [
        { r: CENTER, c: 7, tileId: "blank-1", letter: "C" },
        { r: CENTER, c: 8, tileId: "A-1", letter: "A" },
      ],
      now: 1,
    });
    // Blank scores 0, A scores 1, centre DW ×2 = 2.
    expect(ok.scores["h"]).toBe(2);
  });
});

describe("exchange + pass", () => {
  it("exchanges tiles back into the bag and draws fresh ones", () => {
    const g = applyExchange(playing(), "h", ["C-1"], 5);
    expect(g.racks["h"]).toEqual(["A-1", "T-1", "E-2"]); // drew front of bag
    expect(g.bag).toEqual(["S-2", "R-2", "T-2", "C-1"]); // exchanged tile to the back
    expect(currentPlayerId(g)).toBe("g");
    expect(g.scorelessTurns).toBe(1);
  });

  it("ends the game once every player passes twice", () => {
    let g = playing({ scorelessTurns: 3 });
    g = applyPass(g, "h", 1); // 4th scoreless turn = 2 × 2 players
    expect(g.status).toBe("finished");
  });
});

describe("challenge", () => {
  // h commits CAT, leaving g to move with a challengeable lastPlay.
  const committed = () => applyCommit(playing(), { uid: "h", placements: row(CENTER, 6, "CAT"), now: 5 });

  it("records the previous play so it can be challenged", () => {
    const g = committed();
    expect(g.lastPlay).toMatchObject({ uid: "h", score: 10 });
    expect(g.lastPlay!.placements).toHaveLength(3);
  });

  it("forgets the play once a non-scoring action accepts it", () => {
    const g = applyPass(committed(), "g", 6);
    expect(g.lastPlay).toBeNull();
    expect(() => applyChallenge(g, "h", 7)).toThrow(/no play to challenge/i);
  });

  it("only the active player may challenge, and not their own play", () => {
    const g = committed(); // g to move
    expect(() => applyChallenge(g, "h", 6)).toThrow(/your turn/i);
    const own = playing({ board: row(CENTER, 6, "CAT"), lastPlay: { uid: "h", placements: [], drawn: [], score: 0, prevScorelessTurns: 0 } });
    expect(() => applyChallenge(own, "h", 6)).toThrow(/your own play/i);
  });

  it("freezes other actions until the challenge is answered", () => {
    const g = applyChallenge(committed(), "g", 6);
    expect(g.challenge).toEqual({ by: "g", against: "h" });
    expect(() => applyPass(g, "g", 7)).toThrow(/challenge first/i);
    expect(() => applyChallenge(g, "g", 7)).toThrow(/challenge first/i);
  });

  it("only the challenged player may respond", () => {
    const g = applyChallenge(committed(), "g", 6);
    expect(() => respondToChallenge(g, "g", false, 7)).toThrow(/challenged player/i);
  });

  it("standing by the word keeps the play, with no penalty, and resumes the challenger", () => {
    const g = respondToChallenge(applyChallenge(committed(), "g", 6), "h", true, 7);
    expect(g.scores["h"]).toBe(10);
    expect(g.board).toHaveLength(3);
    expect(currentPlayerId(g)).toBe("g"); // challenger plays on
    expect(g.challenge).toBeNull();
    expect(g.lastPlay).toBeNull(); // no longer challengeable
  });

  it("withdrawing the word reverts it exactly and hands the turn back", () => {
    const before = playing();
    const g = respondToChallenge(applyChallenge(committed(), "g", 6), "h", false, 7);
    expect(g.board).toEqual([]);
    expect(g.scores["h"]).toBe(0);
    expect(g.racks["h"]!.sort()).toEqual([...before.racks["h"]!].sort());
    expect(g.bag.sort()).toEqual([...before.bag].sort());
    expect(currentPlayerId(g)).toBe("h"); // back to the author to replay
    expect(g.challenge).toBeNull();
    expect(g.lastPlay).toBeNull();
  });
});
