# Rummle

A free, open-source, web-based, real-time **multiplayer Rummikub-like** tile
game. Make your runs and groups, lay down your opening 30, empty your rack, win.

> **Name:** "Rummle" is a working title (defined once in `src/constants.ts`) so
> we can rename to a final, trademark-safe brand with a one-line change.

## Stack

- **React 18 + TypeScript + Vite**
- **Drag & drop** via [`@dnd-kit`](https://dndkit.com/) (mouse + touch)
- **Firebase**: Anonymous Auth + Firestore for realtime sync
- **Vitest** for the rules engine unit tests

Everything game-logic related lives in a **pure, framework-free engine**
(`src/game`, `src/state`) so it is fully unit-tested and could later run on a
server (e.g. an authoritative Cloud Function) without changes.

## Project layout

```
src/
  game/        Pure rules engine (no React/Firebase)
    tiles.ts     106-tile deck, seedable shuffle
    melds.ts     group/run validation incl. jokers
    rules.ts     turn-commit validation (conservation, opening 30, win)
    rng.ts       seedable PRNG
  state/       Game state model + turn engine (deal/draw/commit)
  sync/        Firestore wiring (the only Firebase-aware module)
  ui/          React components + hooks (Home, Lobby, GameView, Board)
```

## Getting started

```bash
npm install
cp .env.example .env        # defaults already target the local emulator
npm run dev:all             # starts the Firebase emulators + Vite together
```

Then open http://localhost:5173. Create a game, copy the share link, and open
it in a second browser/tab to play as another anonymous player.

Useful scripts:

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Vite dev server only                          |
| `npm run emulators`| Firebase Auth + Firestore emulators           |
| `npm run dev:all`  | Both of the above together                    |
| `npm test`         | Run the engine unit tests                     |
| `npm run typecheck`| Type-check the whole project                  |
| `npm run build`    | Production build                              |
| `node scripts/smoke.mjs` | End-to-end sync smoke test (emulator must be running) |

## How a game flows

1. **Home** — pick a display name, then create a game or join with a 4-letter code.
2. **Lobby** — share the code/link; the host starts once 2–4 players are in.
3. **Play** — on your turn, drag tiles from your rack onto the table to form
   valid runs/groups, then **Commit**, or **Draw & pass**. Your first play must
   total at least 30 points. Empty your rack to win.

## Rules implemented

- 4 colors × 1–13 × 2 copies + 2 jokers = **106 tiles**
- **Groups** (same number, distinct colors, 3–4 tiles) and **runs**
  (consecutive, same color, 3+), with **joker** substitution
- **Opening meld** must be worth ≥ 30 points from your own tiles, and you can't
  rearrange the shared table until you've opened
- Tile **conservation** and one-way hands enforced on every commit
- **Win** detection when a rack is emptied with a valid table

## Connecting a real Firebase project

The app talks to the local emulator by default (`VITE_USE_EMULATOR=true`). To
use a real project, fill the `VITE_FIREBASE_*` values in `.env` (from the
Firebase console), set `VITE_USE_EMULATOR=false`, enable **Anonymous** auth, and
deploy `firestore.rules`.

## Cheat safety (current trade-off)

For now the full game state — including every player's rack — lives in one
Firestore document readable by all players, so a determined player could read
opponents' tiles from the database. This is an accepted trade-off for casual
play. The data is modelled (per-uid `hands` map) so hands can later move into a
private, Cloud-Function-owned subcollection **without changing the UI or the
sync interface**.

## Roadmap ideas

- Move hidden hands server-side (authoritative Cloud Function) for real cheat safety
- Reconnect/spectator handling, turn timers
- Sound, animations, themes; PWA install
- Game history / stats (would pair well with optional Google sign-in)
