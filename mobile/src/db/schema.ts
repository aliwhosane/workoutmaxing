/**
 * Local SQLite schema.
 *
 * Every user-owned table carries the same three sync columns:
 *   updated_at  epoch ms, set on every write — the merge clock
 *   deleted_at  soft delete, so a deletion can propagate to other devices
 *   dirty       1 = has local changes not yet pushed to the server
 *
 * Primary keys are UUIDv7 generated on-device, so two phones offline at the
 * same time can never collide and rows sort by creation time for free.
 *
 * The exercise catalogue is NOT in here. It ships as a bundled JSON asset and
 * is read-only, so there is nothing to sync and no migration to run when it
 * grows. Only a user's own edits (custom exercises) hit the database.
 */

export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[][] = [
  // ---- v1 ----------------------------------------------------------------
  [
    /** A training plan. Built-ins ship with the app (origin='builtin'). */
    `CREATE TABLE IF NOT EXISTS program (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      author        TEXT,
      description   TEXT,
      origin        TEXT NOT NULL DEFAULT 'user',   -- builtin | user | shared
      goal          TEXT,                            -- strength | hypertrophy | ...
      days_per_week INTEGER,
      weeks         INTEGER,
      accent        TEXT,
      updated_at    INTEGER NOT NULL,
      deleted_at    INTEGER,
      dirty         INTEGER NOT NULL DEFAULT 1
    );`,

    /** One training day inside a program. week=NULL means a repeating weekly split. */
    `CREATE TABLE IF NOT EXISTS program_day (
      id          TEXT PRIMARY KEY,
      program_id  TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
      week        INTEGER,
      day_index   INTEGER NOT NULL,
      name        TEXT NOT NULL,
      notes       TEXT,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER,
      dirty       INTEGER NOT NULL DEFAULT 1
    );`,
    `CREATE INDEX IF NOT EXISTS idx_day_program ON program_day(program_id, week, day_index);`,

    /**
     * A prescribed exercise within a day.
     * target_reps is a string so it can hold "8", "8-12" or "AMRAP".
     * intensity_pct is % of 1RM when the program is percentage-based; rpe when not.
     */
    `CREATE TABLE IF NOT EXISTS program_slot (
      id             TEXT PRIMARY KEY,
      day_id         TEXT NOT NULL REFERENCES program_day(id) ON DELETE CASCADE,
      exercise_id    TEXT NOT NULL,
      position       INTEGER NOT NULL,
      superset_group TEXT,
      target_sets    INTEGER,
      target_reps    TEXT,
      intensity_pct  REAL,
      target_rpe     REAL,
      rest_seconds   INTEGER,
      notes          TEXT,
      updated_at     INTEGER NOT NULL,
      deleted_at     INTEGER,
      dirty          INTEGER NOT NULL DEFAULT 1
    );`,
    `CREATE INDEX IF NOT EXISTS idx_slot_day ON program_slot(day_id, position);`,

    /** The user's enrolment in a program — where they are in it right now. */
    `CREATE TABLE IF NOT EXISTS enrollment (
      id            TEXT PRIMARY KEY,
      program_id    TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      current_week  INTEGER NOT NULL DEFAULT 1,
      current_day   INTEGER NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1,
      updated_at    INTEGER NOT NULL,
      deleted_at    INTEGER,
      dirty         INTEGER NOT NULL DEFAULT 1
    );`,

    /** A logged session. finished_at NULL = in progress. */
    `CREATE TABLE IF NOT EXISTS workout (
      id           TEXT PRIMARY KEY,
      program_id   TEXT,
      day_id       TEXT,
      name         TEXT NOT NULL,
      started_at   INTEGER NOT NULL,
      finished_at  INTEGER,
      notes        TEXT,
      bodyweight   REAL,
      updated_at   INTEGER NOT NULL,
      deleted_at   INTEGER,
      dirty        INTEGER NOT NULL DEFAULT 1
    );`,
    `CREATE INDEX IF NOT EXISTS idx_workout_started ON workout(started_at DESC);`,

    /**
     * A single set. This is the highest-volume table in the app and the one
     * thing that must never be lost, so it is written synchronously the
     * instant the user taps, never batched.
     *
     * kind: working | warmup | drop | failure
     */
    `CREATE TABLE IF NOT EXISTS logged_set (
      id            TEXT PRIMARY KEY,
      workout_id    TEXT NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
      exercise_id   TEXT NOT NULL,
      slot_id       TEXT,
      position      INTEGER NOT NULL,
      set_index     INTEGER NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'working',
      weight_kg     REAL,
      reps          INTEGER,
      duration_s    INTEGER,
      distance_m    REAL,
      rpe           REAL,
      completed_at  INTEGER,
      updated_at    INTEGER NOT NULL,
      deleted_at    INTEGER,
      dirty         INTEGER NOT NULL DEFAULT 1
    );`,
    `CREATE INDEX IF NOT EXISTS idx_set_workout ON logged_set(workout_id, position, set_index);`,
    `CREATE INDEX IF NOT EXISTS idx_set_exercise ON logged_set(exercise_id, completed_at DESC);`,

    /** An exercise the user invented. Mirrors the bundled catalogue's shape. */
    `CREATE TABLE IF NOT EXISTS custom_exercise (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      primary_m    TEXT,
      equipment    TEXT,
      tracking     TEXT NOT NULL DEFAULT 'weight_reps',
      instructions TEXT,
      updated_at   INTEGER NOT NULL,
      deleted_at   INTEGER,
      dirty        INTEGER NOT NULL DEFAULT 1
    );`,

    /** Per-exercise memory: what the user did last, so we can pre-fill it. */
    `CREATE TABLE IF NOT EXISTS exercise_pref (
      exercise_id  TEXT PRIMARY KEY,
      last_weight  REAL,
      last_reps    INTEGER,
      est_1rm      REAL,
      rest_seconds INTEGER,
      updated_at   INTEGER NOT NULL,
      dirty        INTEGER NOT NULL DEFAULT 1
    );`,

    /** Bodyweight and any other scalar the user wants to trend. */
    `CREATE TABLE IF NOT EXISTS body_metric (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      value      REAL NOT NULL,
      recorded_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      dirty      INTEGER NOT NULL DEFAULT 1
    );`,

    /** Single-row key/value for sync cursors and device identity. */
    `CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT
    );`,
  ],
];

/** Tables the sync engine pushes and pulls, in dependency order. */
export const SYNCED_TABLES = [
  'program', 'program_day', 'program_slot', 'enrollment',
  'workout', 'logged_set', 'custom_exercise', 'exercise_pref', 'body_metric',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * The primary key column per synced table. Almost everything is keyed by a
 * client-minted `id`, but a user has exactly one preference row per exercise,
 * so `exercise_pref` is keyed by the exercise itself. The sync engine and the
 * server both read this map rather than assuming a column name.
 */
export const PRIMARY_KEY: Record<SyncedTable, string> = {
  program: 'id',
  program_day: 'id',
  program_slot: 'id',
  enrollment: 'id',
  workout: 'id',
  logged_set: 'id',
  custom_exercise: 'id',
  exercise_pref: 'exercise_id',
  body_metric: 'id',
};
