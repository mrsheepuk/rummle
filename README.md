# Rummle

A free, open-source, web-based, real-time **multiplayer Rummy-based tile game**. Make your runs and groups, lay down your opening 30, empty your rack, win.

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
5. _(Optional)_ For visitor stats, create a free **Cloudflare Web Analytics**
   site (cookieless — no consent banner needed) and add its token as the
   `VITE_CF_ANALYTICS_TOKEN` repository secret. The beacon then loads on the
   live channel only; leave the secret unset to disable it.

Until the secrets exist the two Firebase workflows fail (expected); the
`ci.yml` check passes regardless. If you rename the project, update the
hardcoded `rummle-prod` / secret name in the two `firebase-hosting-*.yml`
workflows.

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
