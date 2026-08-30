# Architecture

## The one design constraint

Every decision here answers to a single number: **taps to log a set.**

A set that goes as planned costs one tap. That is only possible because the
sets already exist, pre-filled, before the user reaches the screen — see
`materializeWorkout` in `mobile/src/db/queries.ts`. Typing is the exception
path, not the flow.

Everything else follows from that. The screen never sleeps mid-session. The
rest timer starts itself. Feedback is haptic first, because a lifter between
sets is not looking at their phone.

## Local-first, always

The phone owns the data. SQLite is the source of truth, every screen reads from
it directly, and the app is completely usable in a basement gym with no signal.

The server is a merge point between a user's own devices — never a dependency.
No screen waits on a network call, and there is no loading spinner anywhere in
the logging path.

## Sync

One endpoint, `POST /sync`, does both directions in a single round trip: push
everything dirty, pull everything changed since a cursor.

Three decisions make this safe:

**Client-minted UUIDv7 primary keys.** Two phones offline at the same time
cannot collide, and ids sort by creation time, so rows interleave correctly
once they meet and index locality stays good.

**Server-assigned cursors.** The cursor is server time, never client time.
Phone clocks are wrong often enough that trusting them would silently drop rows
from a pull.

**Last-write-wins per row.** Appropriate because of what the data is: sets are
append-only in practice, so two devices almost never touch the same row. The
case it does cover — editing a program on two devices — is one where "most
recent edit wins" matches what a person expects.

Dirty flags clear only if the row's `updated_at` is unchanged since it was
read, so an edit made while a request is in flight is never lost.

### The two meanings of "sync"

The request to "sync across iPhone and Android" has two layers, and this
handles them separately:

1. **Cross-device sync of the user's own data** — the delta sync above, via the
   Node/MongoDB service. Platform-neutral, works iPhone→Android.
2. **Writing workouts into the phone's own health store** — Apple HealthKit on
   iOS, Health Connect on Android, so sessions appear in the native Health app.
   Built: `src/health/`.

### The health bridge

`src/health/index.ts` exposes one narrow, platform-neutral interface — write a
session, read bodyweight, write bodyweight — and dispatches to HealthKit or
Health Connect behind it. Callers never branch on platform.

Both platform modules are **lazily required inside a try/catch**. They do not
exist in Expo Go, and a top-level import would take the entire app down there
rather than disabling one feature. When the native side is missing, the bridge
resolves to `UNAVAILABLE` and every method is a no-op returning false. Writing
to the health store is a nicety layered on the app's own database — never a
step the user's data depends on.

Two deliberate limits:

- **We never estimate calories.** Energy is written only when it came from a
  real measurement. Inventing calorie data in someone's permanent health record
  is worse than writing none.
- **HealthKit cannot report read authorisation** — by design, since that would
  leak whether a user has data they chose not to share. We report write status,
  which is the one that matters for saving sessions.

## The exercise catalogue

873 exercises ship bundled as JSON (~1MB), read-only, with no network needed.
Source is [free-exercise-db](https://github.com/yuhonas/free-exercise-db),
public domain.

Because it is bundled rather than synced, growing the catalogue is an app
release, not a migration — and only the user's *own* additions
(`custom_exercise`) ever touch the database or the network.

### The "GIFs"

The requirement was an animated demonstration per exercise. The catalogue gives
two photographs per movement — the start and end position — and
`ExerciseLoop.tsx` cross-fades between them on a real lifting tempo: a slow
eccentric, a pause under load, a faster concentric.

The eye fills in the middle and it reads as a loop of the movement, while
staying two cached JPEGs that work offline and weigh almost nothing. It also
sidesteps sourcing GIFs of uncertain provenance. If true GIFs are wanted later,
`frames` in the catalogue is the only thing that has to change.

## Built-in programs

Six classic, freely-published community templates: novice linear progression,
GZCLP, PHUL, PPL, Upper/Lower, Madcow 5×5.

**A deliberate limit:** paid and coach-authored programs distributed inside
other apps are their authors' copyrighted work and are not reproduced here. The
program schema is general enough that a licensed program drops in as data with
no code change — `ProgramSpec` in `mobile/src/data/programs.ts`.

Thirteen plans ship, chosen to cover the frequencies people actually train at —
2, 3, 4, 5 and 6 days a week — because how many days you can train is the first
thing that rules a plan in or out. The Plans screen filters on exactly that, and
the filter is derived from the seeded programs so a chip can never return
nothing.

5/3/1 and nSuns are percentage-of-training-max programs, which is why the
`tm_percent` scheme exists: shipping an approximation of nSuns under its own
name would be worse than not shipping it.

### Wave programs

Most plans are a repeating weekly split and store `week IS NULL`. Wave programs
— 5/3/1 and its relatives — prescribe different percentages in weeks 1, 2 and 3
and store a week number per day. `daysForWeek()` hides the difference from
callers, and enrollment tracks which week the lifter is in.

### What does and does not get reproduced

Programs are only added when their full prescription is published free by their
author and can be verified against at least two independent sources. Nothing in
this file is invented: a plan we cannot source accurately is left out rather
than approximated, because a program that is subtly wrong under a real coach's
name is worse than an absent one.

Paid and coach-exclusive programs — the ones authors sell as books or license to
a platform — are deliberately not reproduced, regardless of how popular they
are. A personal subscription licenses a lifter to *train* on a program; it does
not license shipping a copy of it inside another app. Those reach the app
through import instead.

### Import

`src/data/importProgram.ts` parses a pasted program into the same shape the
built-ins use. It is pure and tested, and tolerant by design — people paste out
of spreadsheets and PDFs and the formatting is never clean.

Two decisions in there are load-bearing, and both exist because the failure they
prevent is silent:

- **An unmatched exercise becomes a visible warning, never a guess.** Search is
  strict, so "Zercher Yoke Carry" comes back unmatched rather than quietly
  resolving to a squat. A wrong exercise the lifter can see is recoverable; one
  they cannot is not.
- **A line with no sets or reps is a day heading.** The tempting alternative —
  asking whether the line names a known exercise — resolves the heading "Lower
  Power" to *Power Clean* and buries a whole day inside the previous one.

Search ranking had to be fixed for this to work at all: a plain text score sent
"bench press" to *Bench Press with Chains* and "squat" to *Squat Jerk*, because
those names begin with the query. Canonical lifts now dominate the ranking and
unrequested qualifier words cost score, which improves the exercise library
search as much as it does import.

Built-ins are seeded with `origin='builtin'` and re-seeded wholesale on version
change. A user's own plans and all logged history are never touched by that.

## Progressive overload

The app decides what weight to put in front of you, and always says why.

`src/progression/engine.ts` is a **pure function** — no database, no platform —
so the rules can be unit tested directly (`npm test`, 24 cases). That matters
more here than anywhere else in the codebase: a bug in this file tells someone
to lift a weight they cannot lift.

Two principles run through all of it:

1. **Never guess from nothing.** With no history the suggestion is `null` and
   the field stays empty for the lifter to fill in. An invented starting weight
   is worse than no weight at all.
2. **Always explain.** Every suggestion carries a one-line reason ("+5 kg — you
   hit every rep last time"), shown in the logger and stored with the session.
   The number is something to agree or disagree with, not an instruction.

### The schemes

Each is a real published method, not an approximation — someone running GZCLP
expects GZCLP's actual rules.

| Scheme | Rule | Used by |
|---|---|---|
| `linear` | Add a fixed increment on success; deload 10% after 3 straight misses | Novice LP, Madcow, heavy 5s |
| `double` | Climb the rep range, then add load and reset to the bottom | PHUL, PPL, Upper/Lower |
| `gzclp_t1` | 5×3 → 6×2 → 10×1; out of stages, reset to 90% | GZCLP tier 1 |
| `gzclp_t2` | 3×10 → 3×8 → 3×6; new cycle restarts *heavier* | GZCLP tier 2 |
| `gzclp_t3` | Add load once the AMRAP set clears 25 reps | GZCLP tier 3 |
| `rpe` | Correct load by ~4% per rep away from target RPE | Available; no built-in uses it yet |
| `tm_percent` | Load is a % of a training max; the AMRAP set moves the max | 5/3/1 BBB, nSuns |

Increments follow the universal convention: upper body moves one plate step
(2.5 kg / 5 lb), lower body two.

### Rounding

Every number the engine emits is snapped to a weight that exists in a gym —
suggesting 63.7 kg is useless. The one exception is *holding* a weight, which
passes through exactly what was lifted: rounding a held 42.5 kg up to a
"loadable" 95 lb would be telling someone to add weight they never lifted.

### Estimating 1RM

Brzycki below 6 reps, Epley above — each used where the literature puts it.
Both degrade past ~10 reps (±15–20%), so `estimateConfidence` marks those low
and the UI declines to make confident claims from them. RPE folds in by
treating a set of 5 at RPE 8 as equivalent to a set of 7 to failure.

### Where state lives

`progression_state`, keyed by program + exercise — the same lift can progress
differently in two plans, and dropping one plan must not erase the other.
State advances in exactly one place: `advanceProgression`, after a workout is
marked finished. Opening a screen never changes a lifter's progression.

## Units

Weight (kg/lb) and distance (km/mi) are user-selectable, defaulting from device
locale so the app is already right for most people before they open settings.

The rule the whole feature rests on: **the database is always canonical** —
kilograms, metres, seconds. Units are purely a display concern, applied on read
and reversed on write (`src/settings/units.ts`).

That means switching units re-renders numbers and never migrates a row. The
choice is free to change at any time, cannot corrupt history, and two devices
set to different units show the same data correctly. Round-trips are verified
exact across both units at real gym weights.

## Accounts

There is **no sign-in gate**. Every exercise, program and logged set works
without an account, because requiring a signup before someone can log their
first set would be the largest friction the app could possibly add. An account
buys exactly one thing: the same history on a second device — so sign-in lives
in Settings, framed as sync rather than as entry.

Apple on iOS, Google on Android. Both return a signed ID token which the server
verifies against the provider's public keys before minting its own session. No
password is ever typed or stored. The session token lives in the platform
keychain via `expo-secure-store`, never AsyncStorage.

Signing out deletes the token and nothing else. The user's training history is
theirs and stays on their phone.

## Visual system

Defined entirely in `mobile/src/design/tokens.ts`.

The app is a black sheet of glass. There are no cards, no borders and no
chrome — hierarchy comes from type weight, size and opacity alone. There is
exactly one accent colour, and it marks the single thing on screen you are
meant to touch. If a spacing value isn't on the 4pt grid in `space`, it's wrong.

Motion is spring-based throughout, because nothing in the physical world moves
on a bezier curve. Durations exist only for opacity.

## Materials

The app is a flat black sheet. The only things that sit *above* content are the
tab bar, the docked primary action and the rest timer, and those are the only
places a material belongs — everything else stays flat. `src/design/Surface.tsx`
is the single place that decides what that material is:

| Platform | Material |
|---|---|
| iOS 26+ | Liquid Glass via `expo-glass-effect` — a real `UIVisualEffectView` that refracts content scrolling beneath |
| Android | Material 3 tonal elevation — a surface lifts by getting *lighter*, not translucent. Not a fallback; it is what M3 actually specifies |
| | (this has to be a real tone step: painting chrome the same colour as the background, as the first cut did, removes the separation entirely) |
| Older iOS | The same tonal surface |

`liquidGlassAvailable()` gates this at runtime, and the module is lazily
required so the app still runs in Expo Go, where it does not exist.

Two things this deliberately is not: it is not a layout change (nothing moves,
nothing changes shape) and it is not applied to content. A glass card in a list
would be decoration; glass under a floating bar is the content showing through
something that is genuinely in front of it.

## Following a plan

One plan is active at a time, tracked by an `enrollment` row.

Stopping a plan sets `active = 0` and deletes nothing — not the enrollment, not
a set. The row survives specifically so that coming back to the plan resumes at
the same week and day rather than restarting, and so history keeps showing which
program each session belonged to. Stopping is a scheduling decision, never a
destructive one, and the confirmation says so.

Switching plans confirms first, naming what is being stopped.

## Known gaps

- Sync has not been run against a live MongoDB instance (awaiting credentials)
- Google sign-in needs OAuth client ids in `.env` before it appears
- Health and Google sign-in need a development build; both are correctly
  inert in Expo Go, but that means neither has been exercised end to end yet
- Warmup-set generation and plate maths (which plates to load)
- No built-in program uses the `rpe` scheme yet; it needs RPE capture in the logger
- nSuns' true per-set percentage ramp is simplified to one working percentage
  per slot; faithful ramps need per-set intensities in `program_slot`
- Progress charts beyond estimated 1RM
- Separate bodyweight unit (stone) — the units layer extends to it cleanly
