# Rummle

A free, open-source, web-based, real-time **multiplayer tile-game platform**.
It hosts two games that share the same lobby, identity and realtime sync:

- **Numbers** — a Rummikub-like game. Make your runs and groups, lay down your
  opening 30, empty your rack, win.
- **Words** — a Scrabble-like game. Build words on a 15×15 board, score with
  premium squares and the 50-point bingo. _Self-policing: no dictionary check
  (yet) — the engine enforces geometry and tile conservation, players police the
  words, and a **Challenge** lets the next player contest a dodgy play._

> The platform is named **Rummle**; the two games are surfaced to players as
> **Numbers** and **Words**. Internally the number game keeps the `gameType`
> id `"rummle"`.

## Stack

- **React 18 + TypeScript + Vite**
- **Drag & drop** via [`@dnd-kit`](https://dndkit.com/) (mouse + touch)
- **Firebase**: Anonymous Auth + Firestore for realtime sync
- **Vitest** for the rules-engine unit tests (58 tests)

Each game's logic lives in a **pure, framework-free engine** (no React/Firebase
imports) so it is fully unit-tested and could later run on a server (e.g. an
authoritative Cloud Function) without changes.

## Architecture

The game-agnostic machinery (Firestore transactions/subscriptions, the
lobby/identity envelope, the "your games" query) lives in a thin **platform**
layer that both games ride. Each game is a self-contained module that supplies
its own rules engine and a tiny `Codec` (how its state reshapes into a stored
document).

```
src/
  platform/      Game-neutral shared layer
    model.ts       BaseGameState envelope + gameType + generic lobby helpers
    firestoreSync.ts  transactions/subscriptions/join, parameterised by a Codec
  games/
    registry.ts    The one place that knows every game type
                   (subscribeAnyGame / joinAnyGame — dispatch by gameType)
    words/         The Words game, self-contained
      types.ts       letter set, premium squares
      tiles.ts       100-tile bag (2 blanks), seedable shuffle
      model.ts       WordsGameState
      engine.ts      pure rules (placement geometry, scoring, exchange/pass)
      sync.ts        codec + turn actions
      ui/            WordsGameView, WordsBoard, LetterTile

  # Numbers (the original game) — left in place rather than relocated under
  # games/numbers/ to keep the platform-extraction diff reviewable:
  game/          Pure rules engine (tiles, melds, opening-30/win validation, rng)
  state/         GameState model + turn engine (deal/draw/commit)
  sync/          gameSync.ts — Numbers' codec + actions + live-draft

  ui/            Shared React shell + Numbers UI: App/router, Home, Lobby,
                 JoinPrompt, MyGames, GameView, Board, rackSlots, useScrollEdges…
```

Data flow (both games): UI → a game's `sync` module runs a pure engine function
inside a Firestore **transaction** → `onSnapshot` pushes the new state back to
every client. Joining and subscribing-by-code happen through `games/registry.ts`
before the game type is known (joining only touches the shared player roster, so
it needs no game-specific codec).

## Getting started

```bash
npm install
cp .env.example .env        # defaults already target the local emulator
npm run dev:all             # starts the Firebase emulators + Vite together
```

Then open http://localhost:5173. Create a **Numbers** or **Words** game, copy the
share link, and open it in a second browser/tab to play as another anonymous
player.

### Testing multiplayer on your own (`?test`)

Append `?test` to a game URL (e.g. `/g/CODE?test`) to unlock local-testing
affordances without juggling multiple browsers:

- **Start solo** — the host can start with a single player.
- **Add fake players** — an _Add fake player_ button in the lobby seats up to
  four. They're synthetic (they never sign in); the host performs all their
  writes.
- **Take every turn** — in play you act as whoever is to move, so each
  commit / draw / pass hands you straight to the next seat. Handy for exercising
  the multi-player turn bar and the full turn flow end to end.

Everything here is gated behind `?test`; normal play is unaffected.

Useful scripts:

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Vite dev server only                          |
| `npm run emulators`| Firebase Auth + Firestore emulators           |
| `npm run dev:all`  | Both of the above together                    |
| `npm test`         | Run the engine unit tests (58)                |
| `npm run typecheck`| Type-check the whole project                  |
| `npm run build`    | Production build                              |
| `node scripts/smoke.mjs` | End-to-end sync smoke test (emulator must be running) |

## How a game flows

1. **Home** — pick a display name, then start a **Numbers** or **Words** game, or
   join either with a 5-letter code. "Your games" lists everything you're in
   (across both games), with a turn badge.
2. **Lobby** — share the code/link; the host starts once 2–4 players are in.
3. **Play** — take your turn (details per game below).

### Numbers (Rummikub-like)

- 4 colours × 1–13 × 2 copies + 2 jokers = **106 tiles**
- **Groups** (same number, distinct colours, 3–4) and **runs** (consecutive,
  same colour, 3+), with **joker** substitution
- **Opening meld** must total ≥ 30 points from your own tiles; you can't
  rearrange the shared table until you've opened
- Tile **conservation** and one-way hands enforced on every commit; **win** when
  your rack is emptied with a valid table
- Drag tiles from your rack to the table, then **Commit**, or **Draw & pass**.
  Opponents' in-progress turns stream in via a quasi-real-time live draft.

### Words (Scrabble-like)

- Standard English distribution: **100 tiles** (incl. **2 blanks** = the joker
  analog), rack of 7, 15×15 board with standard premium squares
- Drag tiles onto the board; the first play must cross the centre star. Scoring
  applies letter/word premiums (new tiles only) plus the **50-point bingo** for
  using all seven; blanks score 0
- **Exchange** (drag tiles to the exchange tray) or **Pass**; classic
  end-of-game rack-value adjustment
- **Self-policing — no dictionary.** The engine enforces geometry (single line,
  gap-free, connected, centre-opening) and tile conservation, but does **not**
  check that words are real. A dictionary (client DAWG or a Cloud-Function
  validator) is the obvious next step.
- **Challenge** (the human stand-in for a dictionary): on your turn, the game-bar
  menu (☰) offers **Challenge last play**. The player who made it then decides —
  *stand by* their word (it stands, no penalty) or *withdraw* it (the play is
  reverted and they replay the turn). Only the immediately-preceding play can be
  challenged.
- Board view has a **Fit / Zoom** toggle (🔍 / ⛶): fit the whole board, or zoom
  into a square slippy viewport you pan around. The **☰ menu** holds Challenge
  and Home.

## Connecting a real Firebase project

The app talks to the local emulator by default (`VITE_USE_EMULATOR=true`). To
use a real project, fill the `VITE_FIREBASE_*` values in `.env` (from the
Firebase console), set `VITE_USE_EMULATOR=false`, enable **Anonymous** auth, and
deploy `firestore.rules`.

## Deployment (CI/CD)

Three GitHub Actions workflows are included:

| Workflow | Trigger | What it does |
| -------- | ------- | ------------ |
| `ci.yml` | every PR / push to main | typecheck, test, build (no secrets needed) |
| `firebase-hosting-pull-request.yml` | every PR | deploys a **preview channel** and comments the URL |
| `firebase-hosting-merge.yml` | push to `main` | deploys to the **live** channel |

The deploy workflows target the **`rummle-prod`** project (kept as the `prod`
alias in `.firebaserc`; `default` stays `demo-rummle` so local dev stays
offline). The project id and auth domain are non-secret and hardcoded in the
workflows, so only two repository secrets are needed.

### One-time setup (do this once in the Firebase console + GitHub)

1. Create the Firebase project and enable **Hosting** and **Anonymous Auth**.
2. Wire the service account + secret automatically:
   ```bash
   firebase login
   firebase use --add                 # add the real project as the `prod` alias
   firebase init hosting:github --project prod
   ```
   Decline when it offers to overwrite the workflow files (keep the ones here);
   you just want the service-account secret it uploads — created here as
   **`FIREBASE_SERVICE_ACCOUNT_RUMMLE_PROD`**.
3. Add repository **secrets** for the web config used at build time (from the
   console: Project settings → Your apps → SDK config):
   `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_APP_ID`.
4. Deploy the security rules once: `firebase deploy --only firestore:rules --project prod`.
5. **Turn-notification push** (needs the **Blaze** plan — Cloud Functions). Generate a
   VAPID keypair and wire both halves up:
   ```bash
   npx web-push generate-vapid-keys          # prints a public + private key
   firebase functions:secrets:set VAPID_PRIVATE_KEY --project prod   # paste the private key
   ```
   - Add the **public** key as the repo secret **`VITE_VAPID_PUBLIC_KEY`** (it's
     not actually secret — it ships in the client bundle — but kept as a secret
     to match the others). It's consumed by both the client build and the
     function's `VAPID_PUBLIC_KEY` param.
   - The function's `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` params are read from a
     **dotenv file** at deploy (not shell env vars), so create `functions/.env`:
     ```
     VAPID_PUBLIC_KEY=<your public key>
     VAPID_SUBJECT=mailto:you@example.com
     ```
     (It's gitignored. CI writes the same file from the repo secret.)
   - Do the first functions deploy locally to enable the APIs and bind the
     secret: `firebase deploy --only functions --project prod`. After that the
     merge workflow's `deploy_functions` job handles it.

Until the secrets exist the two Firebase workflows fail (expected); the
`ci.yml` check passes regardless. If you rename the project, update the
hardcoded `rummle-prod` / secret name in the two `firebase-hosting-*.yml`
workflows.

## "Your turn" notifications

Players can opt in (a one-time prompt on entering a game, or the game menu) to be
notified when the turn passes to them. Two layers cover it:

- **In-tab** — fires from the running page (via the service worker, since mobile
  browsers forbid the `new Notification()` constructor) whenever the tab is alive
  but unfocused: another tab, another window, a backgrounded phone. No backend.
- **Web Push** — a Firestore-triggered Cloud Function (`functions/`) watches every
  game and pushes to the player whose turn it became, so it lands **even with the
  tab closed**. Standard Web Push (VAPID), keyed off the shared envelope fields,
  so one function serves both games. Subscriptions live in `pushSubs/{uid}`.

Both paths only ping when you're not already looking, and share a notification
`tag` so they never double up. **iOS** only delivers either kind to a PWA added
to the home screen (16.4+) — hence the web-app manifest. Everything degrades
gracefully: no VAPID key → in-tab only; an unsupported browser → silent.

## Cheat safety (current trade-off)

For now the full game state — including every player's rack — lives in one
Firestore document readable by all players, so a determined player could read
opponents' tiles from the database. This is an accepted trade-off for casual
play. The data is modelled (per-uid `hands`/`racks` map) so hands can later move
into a private, Cloud-Function-owned subcollection **without changing the UI or
the sync interface** (and the same move would let a server-side dictionary
validate Words moves authoritatively).

## Roadmap ideas

- A **dictionary** for Words (client DAWG, or a Cloud-Function validator that
  also fixes cheat-safety)
- Relocate Numbers under `src/games/numbers/` to match the platform structure
- Move hidden hands server-side (authoritative Cloud Function) for real cheat safety
- Reconnect/spectator handling, turn timers
- Game history / stats (would pair well with optional Google sign-in)
