import { getDb, uuid, now } from './client';
import { getExercise, type Tracking } from '../data/catalog';
import { getSettings } from '../settings/store';
import { suggestForSlot, advanceProgression } from './progression';

/* ------------------------------------------------------------- row types */

export interface ProgramRow {
  id: string; name: string; author: string | null; description: string | null;
  origin: string; goal: string | null; days_per_week: number | null;
  weeks: number | null; accent: string | null; default_scheme: string | null;
}

export interface DayRow {
  id: string; program_id: string; week: number | null;
  day_index: number; name: string; notes: string | null;
}

export interface SlotRow {
  id: string; day_id: string; exercise_id: string; position: number;
  target_sets: number | null; target_reps: string | null;
  intensity_pct: number | null; target_rpe: number | null;
  rest_seconds: number | null; notes: string | null; scheme: string | null;
}

export interface WorkoutRow {
  id: string; program_id: string | null; day_id: string | null; name: string;
  started_at: number; finished_at: number | null; notes: string | null;
}

export interface SetRow {
  id: string; workout_id: string; exercise_id: string; slot_id: string | null;
  position: number; set_index: number; kind: string;
  weight_kg: number | null; reps: number | null; duration_s: number | null;
  distance_m: number | null; rpe: number | null; completed_at: number | null;
  coach_note: string | null;
}

/* -------------------------------------------------------------- programs */

export const listPrograms = async () =>
(await getDb()).getAllAsync<ProgramRow>(
    'SELECT * FROM program WHERE deleted_at IS NULL ORDER BY origin DESC, name',
  );

export const getProgram = async (id: string) =>
(await getDb()).getFirstAsync<ProgramRow>('SELECT * FROM program WHERE id = ? AND deleted_at IS NULL', id);

/**
 * Days of a program.
 *
 * Two shapes exist. Most programs are a repeating weekly split and store
 * `week IS NULL` — the same days run forever. Wave programs (5/3/1 and its
 * relatives) prescribe different percentages in week 1, 2 and 3, and store a
 * week number on each day.
 *
 * Passing `week` returns that week's days for a wave program, and is simply
 * ignored by a repeating one — so callers never have to know which kind they
 * are looking at.
 */
export async function daysForWeek(programId: string, week: number): Promise<DayRow[]> {
  const db = await getDb();

  const waved = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM program_day WHERE program_id = ? AND week IS NOT NULL AND deleted_at IS NULL',
    programId,
  );
  if ((waved?.n ?? 0) === 0) return listDays(programId);

  // Programs repeat once their last week is done, so week 4 of a 3-week wave
  // is week 1 again.
  const weeks = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(DISTINCT week) AS n FROM program_day WHERE program_id = ? AND week IS NOT NULL AND deleted_at IS NULL',
    programId,
  );
  const total = Math.max(1, weeks?.n ?? 1);
  const effective = ((week - 1) % total) + 1;

  return db.getAllAsync<DayRow>(
    `SELECT * FROM program_day
     WHERE program_id = ? AND week = ? AND deleted_at IS NULL
     ORDER BY day_index`,
    programId, effective,
  );
}

/** Every day of a program, ignoring weeks. Used for editing and previewing. */
export const listDays = async (programId: string) =>
(await getDb()).getAllAsync<DayRow>(
    'SELECT * FROM program_day WHERE program_id = ? AND deleted_at IS NULL ORDER BY week, day_index',
    programId,
  );

export const listSlots = async (dayId: string) =>
(await getDb()).getAllAsync<SlotRow>(
    'SELECT * FROM program_slot WHERE day_id = ? AND deleted_at IS NULL ORDER BY position',
    dayId,
  );

/* ------------------------------------------------------------ enrollment */

export interface ActiveEnrollment {
  id: string; program_id: string; current_week: number; current_day: number; started_at: number;
}

export const getActiveEnrollment = async () =>
(await getDb()).getFirstAsync<ActiveEnrollment>(
    'SELECT * FROM enrollment WHERE active = 1 AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );

/**
 * Starts a program, retiring any other — you follow one plan at a time.
 *
 * Coming back to a plan you stopped resumes it where you left off rather than
 * restarting at week one: the enrollment row is kept when a plan is stopped
 * precisely so that position survives.
 */
export async function enroll(programId: string): Promise<string> {
  const d = await getDb();
  const ts = now();

  const previous = await d.getFirstAsync<{ id: string }>(
    `SELECT id FROM enrollment
     WHERE program_id = ? AND deleted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    programId,
  );

  const id = previous?.id ?? uuid();

  await d.withTransactionAsync(async () => {
    await d.runAsync('UPDATE enrollment SET active = 0, updated_at = ?, dirty = 1 WHERE active = 1', ts);

    if (previous) {
      await d.runAsync(
        'UPDATE enrollment SET active = 1, updated_at = ?, dirty = 1 WHERE id = ?',
        ts, previous.id,
      );
    } else {
      await d.runAsync(
        `INSERT INTO enrollment (id, program_id, started_at, current_week, current_day, active, updated_at, dirty)
         VALUES (?, ?, ?, 1, 0, 1, ?, 1)`,
        id, programId, ts, ts,
      );
    }
  });
  return id;
}

/**
 * Stops following a plan.
 *
 * Nothing is deleted — not the enrollment, not a single logged set. The row
 * stays so that starting the plan again picks up at the same week and day, and
 * so history keeps showing which program each session belonged to. Stopping a
 * plan is a scheduling decision, not a destructive one.
 */
export async function stopFollowingProgram(): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    'UPDATE enrollment SET active = 0, updated_at = ?, dirty = 1 WHERE active = 1',
    now(),
  );
}

/** Where a plan was left off, whether or not it is the one being followed now. */
export const getEnrollmentFor = (programId: string) =>
  getDb().then((d) => d.getFirstAsync<ActiveEnrollment & { active: number }>(
    `SELECT * FROM enrollment WHERE program_id = ? AND deleted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    programId,
  ));

/**
 * Called when a session finishes — rolls the plan to the next day, and to the
 * next week once the week's days are used up.
 *
 * `dayCount` is the days in the *current week*, not the whole program, so a
 * three-week wave advances a week every three sessions rather than every nine.
 */
export async function advanceEnrollment(enrollmentId: string, dayCount: number): Promise<void> {
  const d = await getDb();
  const e = await d.getFirstAsync<ActiveEnrollment>('SELECT * FROM enrollment WHERE id = ?', enrollmentId);
  if (!e || dayCount <= 0) return;

  const next = e.current_day + 1;
  const wrapped = next >= dayCount;
  await d.runAsync(
    'UPDATE enrollment SET current_day = ?, current_week = ?, updated_at = ?, dirty = 1 WHERE id = ?',
    wrapped ? 0 : next, wrapped ? e.current_week + 1 : e.current_week, now(), enrollmentId,
  );
}

/* --------------------------------------------------------------- workouts */

export const getOpenWorkout = async () =>
(await getDb()).getFirstAsync<WorkoutRow>(
    'SELECT * FROM workout WHERE finished_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );

export async function startWorkout(opts: {
  name: string; programId?: string | null; dayId?: string | null;
}): Promise<string> {
  const id = uuid();
  const ts = now();
  await (await getDb()).runAsync(
    `INSERT INTO workout (id, program_id, day_id, name, started_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    id, opts.programId ?? null, opts.dayId ?? null, opts.name, ts, ts,
  );
  return id;
}

export async function finishWorkout(workoutId: string): Promise<void> {
  const ts = now();
  const d = await getDb();
  await d.withTransactionAsync(async () => {
    // Sets that were never completed are noise in history, not data.
    await d.runAsync(
      'DELETE FROM logged_set WHERE workout_id = ? AND completed_at IS NULL',
      workoutId,
    );
    /**
     * Clearing `deleted_at` is not redundant. A session could previously be
     * discarded and then finished — the discard prompt and the finish path both
     * wrote to the same row — which left a fully logged workout invisible to
     * history. Finishing is the later and more deliberate act, so it wins.
     */
    await d.runAsync(
      'UPDATE workout SET finished_at = ?, deleted_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?',
      ts, ts, workoutId,
    );
  });

  // After the commit, so the session just finished is the history the engine
  // reads when working out what to suggest next time.
  await advanceProgression(workoutId);
}

/**
 * Removes a session — abandoning one mid-flight, or deleting a finished one
 * from history.
 *
 * A soft delete, so the removal reaches the user's other devices instead of the
 * session reappearing on the next sync. The sets stay in the table; they are
 * unreachable through the workout and go with it when the account is deleted.
 */
export const deleteWorkout = async (workoutId: string) =>
(await getDb()).runAsync(
    'UPDATE workout SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
    now(), now(), workoutId,
  );

/** The same operation, named for what the logger is doing when it calls it. */
export const discardWorkout = deleteWorkout;

export const getWorkout = async (workoutId: string) =>
(await getDb()).getFirstAsync<WorkoutRow>(
    'SELECT * FROM workout WHERE id = ? AND deleted_at IS NULL',
    workoutId,
  );

/**
 * Corrects the numbers on a set that is already recorded.
 *
 * Deliberately does not touch `completed_at`: fixing a typo in last Tuesday's
 * squat should not move it to today, which is what reusing `completeSet` would
 * do — and would quietly corrupt both history and the progression engine's idea
 * of when the lift was last trained.
 */
export async function updateSetValues(
  setId: string,
  values: { weightKg?: number | null; reps?: number | null; durationS?: number | null },
): Promise<void> {
  await (await getDb()).runAsync(
    `UPDATE logged_set
        SET weight_kg = ?, reps = ?, duration_s = ?, updated_at = ?, dirty = 1
      WHERE id = ?`,
    values.weightKg ?? null, values.reps ?? null, values.durationS ?? null, now(), setId,
  );
}

export const listSets = async (workoutId: string) =>
(await getDb()).getAllAsync<SetRow>(
    'SELECT * FROM logged_set WHERE workout_id = ? AND deleted_at IS NULL ORDER BY position, set_index',
    workoutId,
  );

/* ------------------------------------------------------------------ sets */

export async function insertSet(s: {
  workoutId: string; exerciseId: string; slotId?: string | null;
  position: number; setIndex: number; kind?: string;
  weightKg?: number | null; reps?: number | null; durationS?: number | null;
}): Promise<string> {
  const id = uuid();
  const ts = now();
  await (await getDb()).runAsync(
    `INSERT INTO logged_set
       (id, workout_id, exercise_id, slot_id, position, set_index, kind,
        weight_kg, reps, duration_s, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id, s.workoutId, s.exerciseId, s.slotId ?? null, s.position, s.setIndex,
    s.kind ?? 'working', s.weightKg ?? null, s.reps ?? null, s.durationS ?? null, ts,
  );
  return id;
}

/**
 * Marks a set done and records what was actually lifted. Also updates the
 * per-exercise memory, so the next time this movement appears anywhere in the
 * app its fields arrive pre-filled with what the user last did.
 */
export async function completeSet(
  setId: string,
  values: { weightKg?: number | null; reps?: number | null; durationS?: number | null },
): Promise<void> {
  const d = await getDb();
  const ts = now();

  await d.runAsync(
    `UPDATE logged_set SET weight_kg = ?, reps = ?, duration_s = ?, completed_at = ?, updated_at = ?, dirty = 1
     WHERE id = ?`,
    values.weightKg ?? null, values.reps ?? null, values.durationS ?? null, ts, ts, setId,
  );

  const row = await d.getFirstAsync<{ exercise_id: string }>(
    'SELECT exercise_id FROM logged_set WHERE id = ?', setId,
  );
  if (!row) return;

  const est = values.weightKg && values.reps ? epley(values.weightKg, values.reps) : null;
  await d.runAsync(
    `INSERT INTO exercise_pref (exercise_id, last_weight, last_reps, est_1rm, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(exercise_id) DO UPDATE SET
       last_weight = excluded.last_weight,
       last_reps   = excluded.last_reps,
       -- keep the best estimate ever achieved, not merely the most recent
       est_1rm     = MAX(COALESCE(exercise_pref.est_1rm, 0), COALESCE(excluded.est_1rm, 0)),
       updated_at  = excluded.updated_at,
       dirty       = 1`,
    row.exercise_id, values.weightKg ?? null, values.reps ?? null, est, ts,
  );
}

export const uncompleteSet = async (setId: string) =>
(await getDb()).runAsync(
    'UPDATE logged_set SET completed_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?',
    now(), setId,
  );

export const deleteSet = async (setId: string) =>
(await getDb()).runAsync(
    'UPDATE logged_set SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
    now(), now(), setId,
  );

/** Epley: the standard 1RM estimate, and the one every lifter's spreadsheet uses. */
export const epley = (weight: number, reps: number) =>
  reps <= 1 ? weight : weight * (1 + reps / 30);

/* ------------------------------------------------------------ pre-filling */

export interface Pref { exercise_id: string; last_weight: number | null; last_reps: number | null; est_1rm: number | null }

export async function getPrefs(exerciseIds: string[]): Promise<Pref[]> {
  if (exerciseIds.length === 0) return [];
  return (await getDb()).getAllAsync<Pref>(
    `SELECT exercise_id, last_weight, last_reps, est_1rm FROM exercise_pref
     WHERE exercise_id IN (${exerciseIds.map(() => '?').join(',')})`,
    ...exerciseIds,
  );
}

/** The last time this exercise was trained, for the "last time you did…" line. */
export const lastPerformance = async (exerciseId: string) =>
(await getDb()).getAllAsync<SetRow>(
    `SELECT * FROM logged_set
     WHERE exercise_id = ? AND completed_at IS NOT NULL AND deleted_at IS NULL
     ORDER BY completed_at DESC LIMIT 8`,
    exerciseId,
  );

/* ---------------------------------------------------------------- history */

export interface HistoryEntry extends WorkoutRow {
  set_count: number; volume_kg: number;
}

/**
 * Volume is load moved: weight times reps, summed.
 *
 * Warm-up sets are excluded. They are real work but not the work the number is
 * meant to describe — counting them lets someone inflate their volume by
 * warming up more thoroughly, which is exactly backwards. Drop sets and sets
 * taken to failure do count, because those are working sets.
 *
 * Sets with no weight — bodyweight movements, planks — contribute nothing,
 * since `NULL * reps` is NULL and SUM skips it. That is deliberate: without
 * knowing what the lifter weighs, any number we invented for a pull-up would
 * be a guess dressed up as data.
 */
const VOLUME_SQL = `SUM(CASE WHEN s.kind = 'warmup' THEN 0 ELSE s.weight_kg * s.reps END)`;

const COMPLETED_SET_JOIN = `
     LEFT JOIN logged_set s
       ON s.workout_id = w.id AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL`;

const FINISHED_WORKOUT = `w.finished_at IS NOT NULL AND w.deleted_at IS NULL`;

/** A page of finished sessions, newest first. */
export const listHistory = async (limit = 60) =>
(await getDb()).getAllAsync<HistoryEntry>(
    `SELECT w.*,
            COUNT(s.id) AS set_count,
            COALESCE(${VOLUME_SQL}, 0) AS volume_kg
     FROM workout w${COMPLETED_SET_JOIN}
     WHERE ${FINISHED_WORKOUT}
     GROUP BY w.id
     ORDER BY w.started_at DESC
     LIMIT ?`,
    limit,
  );

export interface HistoryTotals {
  sessions: number;
  volume_kg: number;
  sessions_this_week: number;
}

/**
 * Lifetime totals, counted in the database rather than summed from a page.
 *
 * The screen used to add up whatever `listHistory` had returned, which is the
 * most recent sixty sessions — so both the session count and the total volume
 * silently stopped growing after about fifteen weeks of training, while still
 * being labelled as though they covered everything.
 */
export async function historyTotals(weekStart: number): Promise<HistoryTotals> {
  const db = await getDb();
  const row = await db.getFirstAsync<HistoryTotals>(
    `SELECT COUNT(DISTINCT w.id) AS sessions,
            COALESCE(${VOLUME_SQL}, 0) AS volume_kg,
            COUNT(DISTINCT CASE WHEN w.started_at >= ? THEN w.id END) AS sessions_this_week
     FROM workout w${COMPLETED_SET_JOIN}
     WHERE ${FINISHED_WORKOUT}`,
    weekStart,
  );
  return row ?? { sessions: 0, volume_kg: 0, sessions_this_week: 0 };
}

export const trackingFor = (exerciseId: string): Tracking =>
  getExercise(exerciseId)?.tracking ?? 'weight_reps';

/* ----------------------------------------------------- session assembly */

/**
 * Turns a program day into the actual set rows the user will tick off, and
 * pre-fills each one with what they lifted last time.
 *
 * Doing this once, up front, is what makes logging a single tap: by the time
 * the user sees the screen every set already exists with plausible numbers in
 * it, so the common case — "same as last week" — needs no typing at all.
 *
 * Idempotent: if the workout already has sets (the user backgrounded the app
 * mid-session and came back) it does nothing.
 */
export async function materializeWorkout(workoutId: string, dayId: string | null): Promise<void> {
  const db = await getDb();

  const existing = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM logged_set WHERE workout_id = ? AND deleted_at IS NULL',
    workoutId,
  );
  if ((existing?.n ?? 0) > 0 || !dayId) return;

  const slots = await listSlots(dayId);
  if (slots.length === 0) return;

  const workout = await db.getFirstAsync<{ program_id: string | null }>(
    'SELECT program_id FROM workout WHERE id = ?', workoutId,
  );
  const programId = workout?.program_id ?? null;
  const program = programId ? await getProgram(programId) : null;
  const unit = getSettings().weightUnit;

  /**
   * Ask the progression engine what to put in front of the lifter for each
   * slot. Suggestions are computed before the transaction opens because they
   * read history, and we do not want a long read holding a write lock.
   */
  const planned = await Promise.all(
    slots.map(async (slot) => ({
      slot,
      suggestion: await suggestForSlot(
        {
          exerciseId: slot.exercise_id,
          targetSets: slot.target_sets,
          targetReps: slot.target_reps,
          targetRpe: slot.target_rpe,
          intensityPct: slot.intensity_pct,
          scheme: slot.scheme,
        },
        programId,
        program?.default_scheme ?? null,
        unit,
      ),
    })),
  );

  await db.withTransactionAsync(async () => {
    for (const { slot, suggestion } of planned) {
      const tracking = trackingFor(slot.exercise_id);
      const sets = suggestion.targetSets || slot.target_sets || 3;

      for (let i = 0; i < sets; i++) {
        await db.runAsync(
          `INSERT INTO logged_set
             (id, workout_id, exercise_id, slot_id, position, set_index, kind,
              weight_kg, reps, duration_s, coach_note, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, 1)`,
          uuid(), workoutId, slot.exercise_id, slot.id, slot.position, i,
          tracking === 'weight_reps' ? suggestion.weightKg : null,
          tracking === 'duration' ? null : suggestion.reps,
          tracking === 'duration' ? 60 : null,
          // Only the first set of an exercise carries the reason, so the UI has
          // one place to show it rather than repeating it down the block.
          i === 0 ? suggestion.note : null,
          now(),
        );
      }
    }
  });
}

/** "8" → 8, "8-12" → 8, "AMRAP" → null (there is no number to pre-fill). */
export function parseReps(spec: string | null): number | null {
  if (!spec) return null;
  const m = spec.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Adds an exercise to a session that is already underway. */
export async function addExerciseToWorkout(
  workoutId: string, exerciseId: string, sets = 3,
): Promise<void> {
  const d = await getDb();
  const max = await d.getFirstAsync<{ p: number | null }>(
    'SELECT MAX(position) AS p FROM logged_set WHERE workout_id = ?', workoutId,
  );
  const position = (max?.p ?? -1) + 1;
  const [pref] = await getPrefs([exerciseId]);
  const tracking = trackingFor(exerciseId);

  await d.withTransactionAsync(async () => {
    for (let i = 0; i < sets; i++) {
      await d.runAsync(
        `INSERT INTO logged_set
           (id, workout_id, exercise_id, position, set_index, kind, weight_kg, reps, duration_s, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, 1)`,
        uuid(), workoutId, exerciseId, position, i,
        tracking === 'weight_reps' ? pref?.last_weight ?? null : null,
        tracking === 'duration' ? null : pref?.last_reps ?? null,
        tracking === 'duration' ? 60 : null,
        now(),
      );
    }
  });
}

/** Appends one more set to an exercise already in the session, copying the last. */
export async function addSetToExercise(workoutId: string, exerciseId: string): Promise<void> {
  const d = await getDb();
  const last = await d.getFirstAsync<SetRow>(
    `SELECT * FROM logged_set WHERE workout_id = ? AND exercise_id = ? AND deleted_at IS NULL
     ORDER BY set_index DESC LIMIT 1`,
    workoutId, exerciseId,
  );
  if (!last) return;
  await d.runAsync(
    `INSERT INTO logged_set
       (id, workout_id, exercise_id, slot_id, position, set_index, kind, weight_kg, reps, duration_s, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    uuid(), workoutId, exerciseId, last.slot_id, last.position, last.set_index + 1,
    last.kind, last.weight_kg, last.reps, last.duration_s, now(),
  );
}
