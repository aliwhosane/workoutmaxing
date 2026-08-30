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
   iOS, Health Connect on Android, so sessions appear in the native Health app
   and rings close. *Not yet built.* It needs native modules and a development
   build (it cannot run in Expo Go), which is why it is staged after the core
   loop rather than before it.

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

Built-ins are seeded with `origin='builtin'` and re-seeded wholesale on version
change. A user's own plans and all logged history are never touched by that.

## Visual system

Defined entirely in `mobile/src/design/tokens.ts`.

The app is a black sheet of glass. There are no cards, no borders and no
chrome — hierarchy comes from type weight, size and opacity alone. There is
exactly one accent colour, and it marks the single thing on screen you are
meant to touch. If a spacing value isn't on the 4pt grid in `space`, it's wrong.

Motion is spring-based throughout, because nothing in the physical world moves
on a bezier curve. Durations exist only for opacity.

## Known gaps

- HealthKit / Health Connect integration (layer 2 above)
- Auth UI — the server verifies Apple/Google tokens, but no sign-in screen yet
- Sync has not been run against a live MongoDB instance
- Plate-math / warmup-set generation
- Progress charts beyond estimated 1RM
