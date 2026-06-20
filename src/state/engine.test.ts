import { describe, expect, it } from "vitest";
import {
  addPlayer,
  applyCommit,
  applyDraw,
  createGame,
  currentPlayerId,
  GameError,
  startGame,
} from "./engine";
import { STARTING_RACK_SIZE } from "../game/types";

function newTwoPlayerGame() {
  let g = createGame({ id: "ABCD", hostId: "host", hostName: "Alice", seed: 7, now: 1 });
  g = addPlayer(g, "guest", "Bob", 2);
  return startGame(g, 3);
}

describe("lobby", () => {
  it("creates a game with the host seated", () => {
    const g = createGame({ id: "ABCD", hostId: "host", hostName: "Alice", seed: 7, now: 1 });
    expect(g.status).toBe("lobby");
    expect(Object.keys(g.players)).toEqual(["host"]);
  });

  it("rejects a 5th player", () => {
    let g = createGame({ id: "ABCD", hostId: "h", hostName: "A", seed: 1, now: 1 });
    g = addPlayer(g, "p2", "B", 2);
    g = addPlayer(g, "p3", "C", 3);
    g = addPlayer(g, "p4", "D", 4);
    expect(() => addPlayer(g, "p5", "E", 5)).toThrow(GameError);
  });

  it("requires at least 2 players to start", () => {
    const g = createGame({ id: "ABCD", hostId: "h", hostName: "A", seed: 1, now: 1 });
    expect(() => startGame(g, 2)).toThrow(GameError);
  });
});

describe("dealing", () => {
  it("deals 14 tiles to each player and conserves the deck", () => {
    const g = newTwoPlayerGame();
    expect(g.status).toBe("playing");
    expect(g.hands["host"]).toHaveLength(STARTING_RACK_SIZE);
    expect(g.hands["guest"]).toHaveLength(STARTING_RACK_SIZE);
    const totalTiles =
      g.pool.length + g.hands["host"]!.length + g.hands["guest"]!.length;
    expect(totalTiles).toBe(106);
    // No tile dealt to two places.
    const all = [...g.pool, ...g.hands["host"]!, ...g.hands["guest"]!];
    expect(new Set(all).size).toBe(106);
  });
});

describe("turns", () => {
  it("draw advances to the next player and grows the rack", () => {
    const g = newTwoPlayerGame();
    expect(currentPlayerId(g)).toBe("host");
    const after = applyDraw(g, "host", 10);
    expect(after.hands["host"]).toHaveLength(STARTING_RACK_SIZE + 1);
    expect(currentPlayerId(after)).toBe("guest");
  });

  it("rejects acting out of turn", () => {
    const g = newTwoPlayerGame();
    expect(() => applyDraw(g, "guest", 10)).toThrow(/not your turn/i);
  });

  it("rejects an illegal commit", () => {
    const g = newTwoPlayerGame();
    // Claiming a meld of tiles not in hand should fail conservation/legality.
    expect(() =>
      applyCommit(g, "host", [["red-1-a", "red-2-a", "red-3-a"]], g.hands["host"]!, 10),
    ).toThrow(GameError);
  });

  it("accepts a valid opening commit and records it", () => {
    // Build a deterministic game whose host can play a 30-point meld by
    // constructing the hand directly.
    let g = createGame({ id: "ABCD", hostId: "host", hostName: "A", seed: 1, now: 1 });
    g = addPlayer(g, "guest", "B", 2);
    g = startGame(g, 3);

    // Force a known hand for the host so the test is robust to shuffles.
    const opening = ["red-10-a", "blue-10-a", "black-10-a"];
    g = {
      ...g,
      hands: { ...g.hands, host: [...opening, "orange-2-a"] },
    };

    const after = applyCommit(g, "host", [opening], ["orange-2-a"], 10);
    expect(after.hasOpened["host"]).toBe(true);
    expect(after.table).toEqual([opening]);
    expect(currentPlayerId(after)).toBe("guest");
  });

  it("declares a winner when a player empties their rack", () => {
    let g = createGame({ id: "ABCD", hostId: "host", hostName: "A", seed: 1, now: 1 });
    g = addPlayer(g, "guest", "B", 2);
    g = startGame(g, 3);
    const opening = ["red-10-a", "blue-10-a", "black-10-a"];
    g = { ...g, hands: { ...g.hands, host: [...opening] } };

    const after = applyCommit(g, "host", [opening], [], 10);
    expect(after.status).toBe("finished");
    expect(after.winnerId).toBe("host");
  });
});
