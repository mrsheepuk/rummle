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
- `src/ui/` — React. `App.tsx` routes via `useRoute` (history paths, `/g/CODE`;
  needs the host to serve index.html for any path — see `firebase.json`
  rewrites. Old `#/g/CODE` links are auto-migrated).
  `Home` → `Lobby` → `GameView`; `Board.tsx` is the dnd-kit play surface.
  `TileView.tsx` renders tiles · `sounds.ts` Web-Audio SFX · `useAuth`/`useGame`
  hooks subscribe to auth + the game doc.

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
- **The rack is a free-form slot grid, not a list.** `Board.tsx` keeps the rack
  as `(string | null)[]` slots (gaps allowed; drop-on-occupied swaps) and the
  table as ordered meld lists. On every game update it **reconciles** (adds
  drawn tiles, drops played ones) rather than resetting, so a player's sorting
  persists; layout is saved to `localStorage` (`rummle:rack:{gameId}:{uid}`).
  Rack rearranging is allowed any time; table edits only on your turn. Uses
  pointer-first collision detection (`pointerWithin` → `rectIntersection` →
  `closestCorners`) — plain `closestCorners` mis-targets large/wrapped zones.
- **Live draft = quasi-real-time spectating.** The active player publishes their
  working table to an ephemeral `games/{id}/draft/current` doc on each table
  change (throttled, table-only, deduped); others mirror it read-only when it's
  not their turn. Purely advisory — the authoritative move is still
  `commitTurn`. Stamped with `turn` so stale drafts are ignored once play moves
  on; cleared on commit/draw. Backed by the `draft` Firestore rule (member-only
  write). Spectators FLIP-animate the table as snapshots arrive (`useTileFlip.ts`,
  keyed by tile `data-tile-id`, gated to `!myTurn` + `prefers-reduced-motion`);
  it tweens between published keyframes, not the opponent's live cursor. Exit
  animations for tiles pulled back to the rack are a known follow-up.
- **Rejoin works per-browser.** `addPlayer` lets an existing uid rejoin even
  after start (only new players are blocked); the anonymous uid persists in the
  browser, so reopening `/g/CODE` resumes you. Cross-device rejoin would need a
  portable player token (not done).
- **Tiles must not rely on colour alone** (a player is colour-blind). Each suit
  has a distinct shape pip (● blue ▲ red ◆ orange ■ black) plus a
  contrast-tuned digit; keep that redundancy in `TileView.tsx` / palette.
- **Sounds are synthesised, no asset files.** `sounds.ts` uses the Web Audio
  API; the context resumes on first user gesture. Mute persists in
  `localStorage`.
- **Emulator-first dev.** `.env` has `VITE_USE_EMULATOR=true`; `firebase.ts`
  connects to the local Auth/Firestore emulators on 127.0.0.1.

## Commands

```bash
npm run dev:all     # emulators + Vite together (main dev loop)
npm test            # Vitest (engine + state); 40 tests
npm run typecheck   # tsc -b, must stay clean
npm run build       # production build
node scripts/smoke.mjs   # end-to-end sync test (needs emulators running)
```

Always run `npm test` and `npm run typecheck` before committing engine/state
changes.

## CI/CD

`.github/workflows/`: `ci.yml` (typecheck+test+build, no secrets) runs on every
PR; `firebase-hosting-pull-request.yml` deploys a preview channel per PR;
`firebase-hosting-merge.yml` deploys live on push to `main`.

- Deploys target the **`rummle-prod`** project (hardcoded in the workflows;
  kept as the `prod` alias in `.firebaserc`, while `default` stays
  `demo-rummle` for offline dev). Project id + auth domain are non-secret and
  hardcoded.
- Required repo **secrets**: `FIREBASE_SERVICE_ACCOUNT_RUMMLE_PROD` (service
  account JSON, created by `firebase init hosting:github`), plus
  `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_APP_ID` (the only project-specific
  build values). Note the Firebase web API key is **not** secret — it ships in
  the client bundle.
- Build runs on Node 22; actions are `actions/checkout@v7`,
  `actions/setup-node@v6`, `FirebaseExtended/action-hosting-deploy@v0` (the
  deploy step still warns about Node 20 — upstream, unavoidable for now).
- See README "Deployment (CI/CD)" for the one-time setup steps.

## Conventions

- TS strict, incl. `noUncheckedIndexedAccess` — array access is `T | undefined`;
  handle it (you'll see `!` / guards where indices are known-safe).
- Keep game rules in `src/game` pure. New rules ⇒ add Vitest cases alongside.
- Comments explain *why*, not *what*; match the existing terse style.
