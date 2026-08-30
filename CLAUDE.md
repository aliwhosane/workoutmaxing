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

**Units are display-only.** The database stores kilograms, metres and seconds,
always. Convert on read and reverse on write via `src/settings/units.ts` — never
store a value in the user's display unit.

**No sign-in gate.** The app must stay fully usable with no account. Sign-in
belongs in Settings, framed as sync.

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
- Native modules absent from Expo Go (HealthKit, Health Connect, Google
  sign-in) must be lazily `require`d inside a try/catch, or they take the whole
  app down there. Metro still bundles them, so the package must be installed
  either way — `@kingstinct/react-native-healthkit` also needs its
  `react-native-nitro-modules` peer.
- **Never edit a migration that has already run.** `user_version` has moved
  past it, so the new statement is silently skipped and those databases end up
  missing a column the code expects. Add a new version instead. This already
  bit us once: `coach_note` was appended to v2 after v2 had run, and the column
  simply never appeared.
- Soft deletes and terminal actions must not race. A workout could be discarded
  and then finished, leaving `deleted_at` set on a real session so history hid
  it. Dismissing a screen from an Alert callback is not instant — guard with a
  ref so no further writes land.
- A screen that navigates away and returns needs `useFocusEffect` to refetch.
  The exercise picker writes to SQLite and pops; without it the logger showed
  stale state and adding an exercise looked like it did nothing.
- `babel-preset-expo` already includes the Reanimated/worklets plugin. Adding it
  again in `babel.config.js` breaks worklet codegen.
- `.npmrc` sets `legacy-peer-deps=true`; expo-router pulls a react-dom ahead of
  Expo's pinned react. Install with `npx expo install`, not bare `npm install`.

**Progression rules are tested.** `src/progression/engine.ts` is pure by design.
Change it and run `npm test`. Never make it import from `db/` or React Native.

**Materials go through `src/design/Surface.tsx`.** Never import
`expo-glass-effect` in a screen. Glass belongs only on surfaces that float
above content (tab bar, docks, rest timer) — never on content itself.

## Commands

    cd mobile && npx expo start --ios     # run
    cd mobile && npm run typecheck        # typecheck
    cd mobile && npm test                 # progression engine tests
    cd mobile && node scripts/build-exercise-db.mjs   # regenerate catalogue
