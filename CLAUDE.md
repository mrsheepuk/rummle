# CLAUDE.md

Orientation for working on **Rummle** — a web-based, real-time multiplayer
Rummikub-like game. Read this first; it captures decisions and gotchas that
aren't obvious from the code.

## What this is

- Stack: **React 18 + TypeScript + Vite**, **@dnd-kit** for drag & drop,
  **Firebase** (Anonymous Auth + Firestore) for realtime sync, **Vitest** tests.
- Real-time, 2–4 players, anonymous join via a 4-letter share code.
- "Rummle" is a **working title** — defined once in `src/constants.ts`. Rename
  there only; it's not a trademark-safe final name yet.

## Architecture (important)

Game logic is deliberately split from anything framework/Firebase-specific so it
stays unit-tested and could move server-side later:

- `src/game/` — **pure rules engine**, no React/Firebase imports.
  - `types.ts` deck constants/tile types · `rng.ts` seedable PRNG ·
    `tiles.ts` 106-tile deck + shuffle · `melds.ts` group/run validation incl.
    jokers · `rules.ts` `validateCommit` (conservation, one-way hands, opening
    30, win).
- `src/state/` — **turn engine** over an immutable `GameState`.
  - `model.ts` the Firestore document shape · `engine.ts` pure
    create/addPlayer/start/draw/commit functions (each takes `now`, returns new
    state).
- `src/sync/` — **the only Firebase-aware code**.
  - `firebase.ts` init + emulator wiring · `gameSync.ts` create/join/start/draw/
    commit via Firestore **transactions** + `subscribeGame` (onSnapshot) ·
    `codes.ts` join-code generator.
- `src/ui/` — React. `App.tsx` routes via `useHashRoute` (`#/g/CODE`).
  `Home` → `Lobby` → `GameView`; `Board.tsx` is the dnd-kit play surface.

Data flow: UI calls `sync/gameSync` → runs a `state/engine` pure function inside
a Firestore transaction → `onSnapshot` pushes new state back to all clients.

## Gotchas / decisions

- **Firestore has no nested arrays.** `GameState.table` is `string[][]` in app
  code but stored as `{ tiles: string[] }[]`. Conversion lives in
  `gameSync.ts` (`toStored`/`fromStored`). Don't store raw `string[][]`.
- **Deck is rebuilt from `seed`** (`buildIndex` in `engine.ts`) to resolve tile
  ids → tiles; the deck itself isn't persisted. Same seed ⇒ same deck.
- **Cheat safety is intentionally weak for now.** All hands live in the shared
  game doc (readable by all players). Accepted trade-off; the per-uid `hands`
  map is shaped to later move into a Cloud-Function-owned private subcollection
  without changing the UI/sync interface.
- **Board mid-turn edits are optimistic.** You can drag committed table tiles
  around locally; illegality (e.g. taking a table tile into hand before opening)
  is rejected on **Commit** by `validateCommit`, surfaced as an error. A
  stricter live UI is a known follow-up.
- **Emulator-first dev.** `.env` has `VITE_USE_EMULATOR=true`; `firebase.ts`
  connects to the local Auth/Firestore emulators on 127.0.0.1.

## Commands

```bash
npm run dev:all     # emulators + Vite together (main dev loop)
npm test            # Vitest (engine + state); 38 tests
npm run typecheck   # tsc -b, must stay clean
npm run build       # production build
node scripts/smoke.mjs   # end-to-end sync test (needs emulators running)
```

Always run `npm test` and `npm run typecheck` before committing engine/state
changes.

## CI/CD

`.github/workflows/`: `ci.yml` (typecheck+test+build, no secrets) runs on every
PR; `firebase-hosting-pull-request.yml` deploys a preview channel per PR;
`firebase-hosting-merge.yml` deploys live on push to `main`. The two Firebase
workflows need repo secrets (`FIREBASE_SERVICE_ACCOUNT`, `VITE_FIREBASE_*`) and
var `FIREBASE_PROJECT_ID` — see README "Deployment (CI/CD)".

## Conventions

- TS strict, incl. `noUncheckedIndexedAccess` — array access is `T | undefined`;
  handle it (you'll see `!` / guards where indices are known-safe).
- Keep game rules in `src/game` pure. New rules ⇒ add Vitest cases alongside.
- Comments explain *why*, not *what*; match the existing terse style.
