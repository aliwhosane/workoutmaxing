# Workout Maxing — working notes

A React Native workout tracker. `mobile/` is the app, `server/` is the sync
service. Read `docs/ARCHITECTURE.md` before making structural changes.

## Non-negotiables

**Taps to log a set is the product metric.** A set that goes as planned costs
one tap. Any change that adds a tap to the logging path needs to justify itself.

**Design tokens are the whole visual system.** Never hardcode a colour, size or
spacing value in a component — use `src/design/tokens.ts`. Spacing comes off the
4pt grid in `space`. There is one accent (`palette.live`) and it marks only the
primary action.

**Local-first.** SQLite is the source of truth. No screen may block on the
network. The app must stay fully usable with the server down.

## Conventions

- Every user-owned table carries `updated_at` / `deleted_at` / `dirty`. Stamp
  them on every write or sync silently breaks.
- Ids are client-minted UUIDv7 via `uuid()` in `src/db/client.ts`.
- Database access goes through `await getDb()`, which opens on demand — never
  reintroduce a handle that has to be initialised first.
- Deletes are soft (`deleted_at`), so deletions propagate between devices.

## Gotchas already hit

- Hermes has no global `crypto`. Use `expo-crypto`.
- `PRAGMA journal_mode = WAL` cannot run inside a transaction — connection
  pragmas belong in `openInternal()`, not in a migration.
- Never call native modules at module load time; it crashes before the app boots.
- `babel-preset-expo` already includes the Reanimated/worklets plugin. Adding it
  again in `babel.config.js` breaks worklet codegen.
- `.npmrc` sets `legacy-peer-deps=true`; expo-router pulls a react-dom ahead of
  Expo's pinned react. Install with `npx expo install`, not bare `npm install`.

## Commands

    cd mobile && npx expo start --ios     # run
    cd mobile && npx tsc --noEmit         # typecheck
    cd mobile && node scripts/build-exercise-db.mjs   # regenerate catalogue
