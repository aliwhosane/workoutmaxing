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
- **Android drops touches that land outside a parent's bounds**; iOS delivers
  them. A control positioned with a negative offset therefore loses part of its
  tap target on Android only, and silently. Keep interactive elements inside
  their parent and grow them with `hitSlop`.
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

## Native builds

**The project path must not contain spaces.** React Native's and expo-constants'
Xcode script phases interpolate paths into shell commands without quoting them,
so a space splits the path and the build dies with `bash: /Users/…/Workout: No
such file or directory`. This repo was moved from "Workout Maxing" to
`workout_maxing` for exactly that reason — patching each unquoted script was a
losing game against upstream.

**CocoaPods needs a UTF-8 locale.** Without it `pod install` fails inside Ruby's
unicode normalisation. Either add `export LANG=en_US.UTF-8` to your profile or
prefix the command.

`npx expo run:ios --device <udid>` misidentifies a simulator UDID as a physical
device and demands code signing. Build the simulator target directly instead:

    cd ios && pod install
    xcodebuild -workspace WorkoutMaxing.xcworkspace -scheme WorkoutMaxing \
      -configuration Debug -sdk iphonesimulator \
      -destination "id=<simulator-udid>" -derivedDataPath ./build \
      CODE_SIGNING_ALLOWED=NO build
    xcrun simctl install <udid> ios/build/Build/Products/Debug-iphonesimulator/WorkoutMaxing.app

Liquid Glass needs a **dev build on iOS 26+** — it cannot appear in Expo Go,
where the tonal fallback is used instead.

### Android

`ANDROID_HOME` must be exported (`$HOME/Library/Android/sdk`); Gradle will not
find the SDK otherwise. `npx expo run:android --device <serial>` fails to match
a serial the same way the iOS one does — with a single device attached, omit it.

Three things bit us and are now fixed in `app.json`; don't undo them:

- **minSdk 26.** Health Connect's `connect-client` requires it. The
  `tools:overrideLibrary` escape hatch is documented to cause runtime failures.
  Set via `expo-build-properties`.
- **Health Connect permissions are the app's job.** `react-native-health-connect`
  installs the rationale activity but declares no `android.permission.health.*`
  entries, so `requestPermission()` silently grants nothing. They live in
  `android.permissions` and must mirror exactly what `healthConnect.ts` asks for.
- **`expo-splash-screen` needs an `image`.** Without one it still emits a
  reference to `drawable/splashscreen_logo` and resource linking fails.
  `edgeToEdgeEnabled` is also gone — Android 16 makes edge-to-edge mandatory.

**The logo is generated, not drawn.** `mobile/scripts/generate-logo.py` produces
every icon, the splash and the favicon from one definition. Edit that and re-run
it rather than hand-editing a PNG. Regenerating assets is not enough on its own —
`expo prebuild` has to run afterwards or the native projects keep the old icons,
which is silent and easy to miss.

## Commands

    cd mobile && npx expo start --ios     # run
    cd mobile && npm run typecheck        # typecheck
    cd mobile && npm test                 # progression engine tests
    cd mobile && node scripts/build-exercise-db.mjs   # regenerate catalogue
    cd mobile && python3 scripts/generate-logo.py     # regenerate icons/splash
