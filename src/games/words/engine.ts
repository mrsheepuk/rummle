// Turn engine for the word game: pure functions that advance an immutable
// WordsGameState. Mirrors Rummle's engine — each function takes `now` and
// returns a new state; the sync layer persists the result inside a transaction.
// Nothing here imports Firebase or React.
//
// SELF-POLICING (POC): there is deliberately no dictionary. The engine enforces
// geometry and conservation — tiles come from your rack, land in one straight
// line, connect to what's there, and the first play covers the centre — but it
// does NOT check that the words formed are real. Players police that themselves,
// exactly like the loose mid-turn rules in Rummle. A dictionary (client DAWG or
// a Cloud-Function validator) is the obvious follow-up.

import { mulberry32 } from "../../game/rng";
import {
  GameError,
  currentPlayerId as baseCurrentPlayerId,
  nextTurn,
  seatPlayer,
  type PlayerInfo,
} from "../../platform/model";
import {
  BINGO_BONUS,
  BOARD_SIZE,
  CENTER,
  RACK_SIZE,
  premiumAt,
  type LetterTile,
} from "./types";
import { bagIndex, shuffledBag } from "./tiles";
import type { Placement, WordsGameState } from "./model";

export { GameError };

export const currentPlayerId = baseCurrentPlayerId;

export function createWordsGame(args: {
  id: string;
  hostId: string;
  hostName: string;
  seed: number;
  now: number;
}): WordsGameState {
  const host: PlayerInfo = { uid: args.hostId, name: args.hostName, seat: 0, joinedAt: args.now };
  return {
    id: args.id,
    gameType: "words",
    status: "lobby",
    hostId: args.hostId,
    seed: args.seed,
    createdAt: args.now,
    updatedAt: args.now,
    players: { [args.hostId]: host },
    turnOrder: [],
    currentTurn: 0,
    bag: [],
    board: [],
    racks: {},
    scores: {},
    scorelessTurns: 0,
    winnerId: null,
    lastPlay: null,
    challenge: null,
  };
}

export function addPlayer(state: WordsGameState, uid: string, name: string, now: number): WordsGameState {
  const { players, added } = seatPlayer(state, uid, name, now);
  return { ...state, players, updatedAt: added ? now : state.updatedAt };
}

/** Deals starting racks from a freshly shuffled, seed-derived bag. */
export function startWordsGame(
  state: WordsGameState,
  now: number,
  opts: { allowSolo?: boolean } = {},
): WordsGameState {
  if (state.status !== "lobby") throw new GameError("Game already started");
  const players = Object.values(state.players).sort((a, b) => a.seat - b.seat);
  const min = opts.allowSolo ? 1 : 2;
  if (players.length < min) throw new GameError(`Need at least ${min} player${min > 1 ? "s" : ""}`);

  const bag = shuffledBag(mulberry32(state.seed)).map((t) => t.id);
  const racks: Record<string, string[]> = {};
  const scores: Record<string, number> = {};
  let cursor = 0;
  for (const p of players) {
    racks[p.uid] = bag.slice(cursor, cursor + RACK_SIZE);
    scores[p.uid] = 0;
    cursor += RACK_SIZE;
  }
  return {
    ...state,
    status: "playing",
    updatedAt: now,
    turnOrder: players.map((p) => p.uid),
    currentTurn: 0,
    bag: bag.slice(cursor),
    board: [],
    racks,
    scores,
    scorelessTurns: 0,
    winnerId: null,
    lastPlay: null,
    challenge: null,
  };
}

/** Resolves every tile id the game references into its LetterTile. */
export function buildIndex(state: WordsGameState): Map<string, LetterTile> {
  return bagIndex(shuffledBag(mulberry32(state.seed)));
}

function assertActive(state: WordsGameState, uid: string): void {
  if (state.status !== "playing") throw new GameError("Game is not in progress");
  if (state.challenge) throw new GameError("Resolve the challenge first");
  if (currentPlayerId(state) !== uid) throw new GameError("It is not your turn");
}

const key = (r: number, c: number): string => `${r},${c}`;

interface Cell {
  letter: string;
  tileId: string;
  isNew: boolean;
}

/** A board cell together with its coordinates — what words are made of. */
interface PositionedCell extends Cell {
  r: number;
  c: number;
}

/**
 * Validates the geometry of a play and returns its score. Throws GameError on
 * any illegal placement. Does NOT consult a dictionary (self-policing POC).
 */
export function scorePlay(
  board: Placement[],
  placements: Placement[],
  index: Map<string, LetterTile>,
): number {
  if (placements.length === 0) throw new GameError("Place at least one tile");

  const occ = new Map<string, Cell>();
  for (const p of board) occ.set(key(p.r, p.c), { letter: p.letter, tileId: p.tileId, isNew: false });
  for (const p of placements) {
    if (p.r < 0 || p.r >= BOARD_SIZE || p.c < 0 || p.c >= BOARD_SIZE) {
      throw new GameError("A tile is off the board");
    }
    if (occ.has(key(p.r, p.c))) throw new GameError("Two tiles on the same square");
    occ.set(key(p.r, p.c), { letter: p.letter, tileId: p.tileId, isNew: true });
  }

  const firstMove = board.length === 0;

  // 1. All new tiles share a single row or column.
  const rows = new Set(placements.map((p) => p.r));
  const cols = new Set(placements.map((p) => p.c));
  const horizontal = rows.size === 1;
  const vertical = cols.size === 1;
  if (!horizontal && !vertical) throw new GameError("Tiles must line up in a single row or column");

  // 2. The opening play must cover the centre square.
  if (firstMove && !placements.some((p) => p.r === CENTER && p.c === CENTER)) {
    throw new GameError("The first word must cross the centre star");
  }

  // 3. The played line must be gap-free (existing tiles may fill the gaps).
  if (horizontal && placements.length > 1) {
    const r = placements[0]!.r;
    const cs = placements.map((p) => p.c);
    for (let c = Math.min(...cs); c <= Math.max(...cs); c++) {
      if (!occ.has(key(r, c))) throw new GameError("The word has a gap");
    }
  }
  if (vertical && placements.length > 1) {
    const c = placements[0]!.c;
    const rs = placements.map((p) => p.r);
    for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
      if (!occ.has(key(r, c))) throw new GameError("The word has a gap");
    }
  }

  // 4. Collect every word (length >= 2, containing a new tile) the play forms:
  // the run through each new tile along, and perpendicular to, the play axis.
  const words = collectWords(occ, placements);
  if (words.length === 0) throw new GameError("A play must form a word of two or more letters");

  // 5. Connectivity: a non-opening play must touch existing tiles — i.e. some
  // word it forms must include a tile that was already on the board.
  if (!firstMove && !words.some((w) => w.some((cell) => !cell.isNew))) {
    throw new GameError("New tiles must connect to the existing words");
  }

  // 6. Score: per word, sum letter values (with letter premiums on new tiles)
  // times the product of word premiums on new tiles; plus the bingo bonus.
  let total = 0;
  for (const word of words) total += scoreWord(word, index);
  if (placements.length === RACK_SIZE) total += BINGO_BONUS;
  return total;
}

/** All distinct words (>= 2 cells, with >= 1 new tile) formed by the play. */
function collectWords(occ: Map<string, Cell>, placements: Placement[]): PositionedCell[][] {
  const seen = new Set<string>();
  const words: PositionedCell[][] = [];
  const consider = (cells: PositionedCell[]) => {
    if (cells.length < 2) return;
    if (!cells.some((cell) => cell.isNew)) return;
    const sig = cells.map((x) => key(x.r, x.c)).join("|");
    if (seen.has(sig)) return;
    seen.add(sig);
    words.push(cells);
  };
  for (const p of placements) {
    consider(runThrough(occ, p.r, p.c, 0, 1)); // horizontal
    consider(runThrough(occ, p.r, p.c, 1, 0)); // vertical
  }
  return words;
}

/** Walks the contiguous occupied run through (r,c) in direction (dr,dc). */
function runThrough(
  occ: Map<string, Cell>,
  r: number,
  c: number,
  dr: number,
  dc: number,
): PositionedCell[] {
  let sr = r, sc = c;
  while (occ.has(key(sr - dr, sc - dc))) { sr -= dr; sc -= dc; }
  const cells: PositionedCell[] = [];
  let cr = sr, cc = sc;
  while (occ.has(key(cr, cc))) {
    cells.push({ r: cr, c: cc, ...occ.get(key(cr, cc))! });
    cr += dr; cc += dc;
  }
  return cells;
}

function scoreWord(word: PositionedCell[], index: Map<string, LetterTile>): number {
  let sum = 0;
  let wordMult = 1;
  for (const cell of word) {
    const tile = index.get(cell.tileId);
    let value = tile?.isBlank ? 0 : tile?.value ?? 0;
    if (cell.isNew) {
      // Premium squares only count the turn a tile lands on them.
      const premium = premiumAt(cell.r, cell.c);
      if (premium === "DL") value *= 2;
      else if (premium === "TL") value *= 3;
      else if (premium === "DW") wordMult *= 2;
      else if (premium === "TW") wordMult *= 3;
    }
    sum += value;
  }
  return sum * wordMult;
}

export interface CommitInput {
  uid: string;
  placements: Placement[];
  now: number;
}

/**
 * The active player commits a set of placements. Validates, scores, refills the
 * rack from the bag, and either ends the game (rack emptied with an empty bag)
 * or advances the turn.
 */
export function applyCommit(state: WordsGameState, input: CommitInput): WordsGameState {
  const { uid, placements, now } = input;
  assertActive(state, uid);

  const index = buildIndex(state);
  const rack = state.racks[uid] ?? [];
  const rackSet = new Set(rack);
  const used = new Set<string>();
  for (const p of placements) {
    if (!rackSet.has(p.tileId)) throw new GameError("You can only play tiles from your rack");
    if (used.has(p.tileId)) throw new GameError("A tile was placed twice");
    used.add(p.tileId);
    const tile = index.get(p.tileId);
    if (!tile) throw new GameError("Unknown tile");
    if (!/^[A-Z]$/.test(p.letter)) throw new GameError("A blank needs a letter A–Z");
    if (!tile.isBlank && tile.letter !== p.letter) throw new GameError("A tile can't change its letter");
  }

  const score = scorePlay(state.board, placements, index);

  const board = [...state.board, ...placements];
  const newRack = rack.filter((id) => !used.has(id));
  const bag = state.bag.slice();
  const drawn: string[] = [];
  while (newRack.length < RACK_SIZE && bag.length > 0) {
    const id = bag.shift()!;
    drawn.push(id);
    newRack.push(id);
  }
  const scores = { ...state.scores, [uid]: (state.scores[uid] ?? 0) + score };
  const racks = { ...state.racks, [uid]: newRack };

  // Going out (rack emptied with an empty bag) ends the game. A finished play
  // can't be challenged, so no lastPlay is recorded.
  if (newRack.length === 0 && bag.length === 0) {
    return finalize({ ...state, updatedAt: now, board, bag, racks, scores }, index, uid);
  }
  return {
    ...state,
    updatedAt: now,
    board,
    bag,
    racks,
    scores,
    scorelessTurns: 0,
    currentTurn: nextTurn(state),
    // Record the play so the next player can challenge it.
    lastPlay: { uid, placements, drawn, score, prevScorelessTurns: state.scorelessTurns },
  };
}

/** Returns chosen rack tiles to the bag and draws the same number of fresh ones. */
export function applyExchange(state: WordsGameState, uid: string, tileIds: string[], now: number): WordsGameState {
  assertActive(state, uid);
  if (tileIds.length === 0) throw new GameError("Pick tiles to exchange");
  const rack = state.racks[uid] ?? [];
  const rackSet = new Set(rack);
  for (const id of tileIds) if (!rackSet.has(id)) throw new GameError("You can only exchange tiles from your rack");
  if (state.bag.length < tileIds.length) throw new GameError("Not enough tiles left in the bag to exchange");

  const swap = new Set(tileIds);
  const bag = state.bag.slice();
  const drawn = bag.splice(0, tileIds.length); // draw from the front…
  bag.push(...tileIds); // …and return the exchanged tiles to the back.
  const newRack = [...rack.filter((id) => !swap.has(id)), ...drawn];

  return endOrAdvance({ ...state, updatedAt: now, bag, racks: { ...state.racks, [uid]: newRack } });
}

export function applyPass(state: WordsGameState, uid: string, now: number): WordsGameState {
  assertActive(state, uid);
  return endOrAdvance({ ...state, updatedAt: now });
}

/** Bumps the scoreless counter and either ends the game or passes the turn. */
function endOrAdvance(state: WordsGameState): WordsGameState {
  const scorelessTurns = state.scorelessTurns + 1;
  // Stalemate: every player has had two scoreless turns in a row.
  if (scorelessTurns >= state.turnOrder.length * 2) {
    return finalize({ ...state, scorelessTurns }, buildIndex(state), null);
  }
  // A pass/exchange accepts the prior play — it's no longer challengeable.
  return { ...state, scorelessTurns, currentTurn: nextTurn(state), lastPlay: null };
}

/**
 * The active player challenges the immediately-preceding play. There's no
 * dictionary, so this doesn't adjudicate — it pauses play and hands the decision
 * to the player who made the play (see {@link respondToChallenge}). Only that
 * one play is challengeable, and only until the next play is committed.
 */
export function applyChallenge(state: WordsGameState, uid: string, now: number): WordsGameState {
  assertActive(state, uid); // also rejects a second, overlapping challenge
  const last = state.lastPlay;
  if (!last) throw new GameError("There's no play to challenge");
  if (last.uid === uid) throw new GameError("You can't challenge your own play");
  return { ...state, updatedAt: now, challenge: { by: uid, against: last.uid } };
}

/**
 * The challenged player responds. `stand` keeps the word (no penalty to either
 * side — play resumes with the challenger). Otherwise the play is withdrawn:
 * its tiles come off the board and back to the rack, the drawn tiles return to
 * the bag, the score is undone, and the turn returns to the challenged player to
 * replay. Either way the play is no longer challengeable.
 */
export function respondToChallenge(
  state: WordsGameState,
  uid: string,
  stand: boolean,
  now: number,
): WordsGameState {
  const challenge = state.challenge;
  if (!challenge) throw new GameError("There's no challenge to answer");
  if (challenge.against !== uid) throw new GameError("Only the challenged player can respond");
  const last = state.lastPlay;
  if (!last) throw new GameError("The challenged play is gone");

  if (stand) {
    // Word stands: clear the challenge, the challenger resumes their turn.
    return { ...state, updatedAt: now, challenge: null, lastPlay: null };
  }

  // Withdrawn: undo the play exactly and hand the turn back to its author.
  const placedIds = new Set(last.placements.map((p) => p.tileId));
  const drawnSet = new Set(last.drawn);
  const board = state.board.filter((p) => !placedIds.has(p.tileId));
  const rack = (state.racks[uid] ?? []).filter((id) => !drawnSet.has(id));
  const newRack = [...rack, ...last.placements.map((p) => p.tileId)];
  const bag = [...last.drawn, ...state.bag]; // drawn tiles were shifted off the front
  const scores = { ...state.scores, [uid]: (state.scores[uid] ?? 0) - last.score };
  return {
    ...state,
    updatedAt: now,
    board,
    bag,
    racks: { ...state.racks, [uid]: newRack },
    scores,
    scorelessTurns: last.prevScorelessTurns,
    currentTurn: state.turnOrder.indexOf(uid),
    challenge: null,
    lastPlay: null,
  };
}

/**
 * Applies end-of-game scoring and names a winner. Each player loses the value of
 * the tiles left on their rack; if someone went out, they gain the sum of
 * everyone else's leftovers (the classic Scrabble end bonus).
 */
function finalize(state: WordsGameState, index: Map<string, LetterTile>, wentOut: string | null): WordsGameState {
  const scores = { ...state.scores };
  let leftoverTotal = 0;
  for (const uid of state.turnOrder) {
    const rackValue = (state.racks[uid] ?? []).reduce((s, id) => s + (index.get(id)?.value ?? 0), 0);
    scores[uid] = (scores[uid] ?? 0) - rackValue;
    leftoverTotal += rackValue;
  }
  if (wentOut) scores[wentOut] = (scores[wentOut] ?? 0) + leftoverTotal;

  let winnerId: string | null = null;
  let best = -Infinity;
  for (const uid of state.turnOrder) {
    if ((scores[uid] ?? 0) > best) { best = scores[uid] ?? 0; winnerId = uid; }
  }
  return { ...state, status: "finished", scores, winnerId };
}
