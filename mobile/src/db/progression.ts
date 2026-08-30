import { getDb, uuid, now } from './client';
import { getExercise } from '../data/catalog';
import { suggest } from '../progression/engine';
import type {
  LastSession, ProgressionState, SchemeKind, Suggestion,
} from '../progression/types';
import type { WeightUnit } from '../settings/units';
import { getSettings } from '../settings/store';

/**
 * The bridge between the database and the pure progression engine.
 *
 * The engine knows nothing about SQLite; this module loads what it needs,
 * calls it, and writes the resulting state back.
 */

/** Muscles that mark a lift as lower-body, which doubles its session increment. */
const LOWER_BODY = new Set([
  'quadriceps', 'hamstrings', 'glutes', 'calves', 'lower back', 'adductors', 'abductors',
]);

export const isLowerBody = (exerciseId: string): boolean => {
  const ex = getExercise(exerciseId);
  return !!ex && ex.primary.some((m) => LOWER_BODY.has(m));
};

/* --------------------------------------------------------------- history */

/**
 * The most recent completed session for a lift, paired with what was asked of
 * it. The prescription lives on the slot rather than the set, so it is joined
 * back in here — without it we could see the reps performed but not whether
 * they were a success.
 */
export async function lastSessionFor(
  exerciseId: string,
  programId: string | null,
): Promise<LastSession | null> {
  const db = await getDb();

  const recent = await db.getFirstAsync<{ workout_id: string; started_at: number }>(
    `SELECT s.workout_id, w.started_at
     FROM logged_set s
     JOIN workout w ON w.id = s.workout_id
     WHERE s.exercise_id = ?
       AND s.completed_at IS NOT NULL
       AND s.deleted_at IS NULL
       AND w.finished_at IS NOT NULL
       AND w.deleted_at IS NULL
       ${programId ? 'AND w.program_id = ?' : ''}
     ORDER BY w.started_at DESC
     LIMIT 1`,
    ...(programId ? [exerciseId, programId] : [exerciseId]),
  );
  if (!recent) return null;

  const rows = await db.getAllAsync<{
    weight_kg: number | null; reps: number | null; rpe: number | null;
    completed_at: number | null; target_reps: string | null;
  }>(
    `SELECT s.weight_kg, s.reps, s.rpe, s.completed_at, sl.target_reps
     FROM logged_set s
     LEFT JOIN program_slot sl ON sl.id = s.slot_id
     WHERE s.workout_id = ? AND s.exercise_id = ? AND s.deleted_at IS NULL
     ORDER BY s.set_index`,
    recent.workout_id, exerciseId,
  );

  return {
    performedAt: recent.started_at,
    sets: rows.map((r) => ({
      weightKg: r.weight_kg,
      reps: r.reps,
      // "8-12" prescribes a range; the bottom of it is what counts as a hit.
      targetReps: r.target_reps ? Number(r.target_reps.match(/\d+/)?.[0] ?? 0) || null : null,
      rpe: r.rpe,
      completed: r.completed_at != null,
    })),
  };
}

/* ----------------------------------------------------------------- state */

const stateId = (programId: string | null, exerciseId: string) =>
  `${programId ?? 'free'}:${exerciseId}`;

export async function loadState(
  programId: string | null, exerciseId: string,
): Promise<ProgressionState | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    scheme: string; stage: number; failures: number;
    working_kg: number | null; training_max_kg: number | null;
  }>(
    'SELECT * FROM progression_state WHERE id = ? AND deleted_at IS NULL',
    stateId(programId, exerciseId),
  );
  if (!row) return null;
  return {
    exerciseId,
    programId,
    scheme: row.scheme as SchemeKind,
    stage: row.stage,
    failures: row.failures,
    workingKg: row.working_kg,
    trainingMaxKg: row.training_max_kg,
  };
}

export async function saveState(state: ProgressionState): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO progression_state
       (id, program_id, exercise_id, scheme, stage, failures, working_kg, training_max_kg, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       scheme = excluded.scheme, stage = excluded.stage, failures = excluded.failures,
       working_kg = excluded.working_kg, training_max_kg = excluded.training_max_kg,
       updated_at = excluded.updated_at, dirty = 1`,
    stateId(state.programId, state.exerciseId), state.programId, state.exerciseId,
    state.scheme, state.stage, state.failures, state.workingKg, state.trainingMaxKg, now(),
  );
}

/* ------------------------------------------------------------- suggesting */

export interface SlotForSuggestion {
  exerciseId: string;
  targetSets: number | null;
  targetReps: string | null;
  targetRpe: number | null;
  intensityPct: number | null;
  scheme: string | null;
}

/**
 * What to put in front of the lifter for one slot, and why.
 *
 * Returns the engine's suggestion plus the state to persist once the session
 * is actually created — we do not advance a lifter's progression just because
 * they looked at a screen.
 */
export async function suggestForSlot(
  slot: SlotForSuggestion,
  programId: string | null,
  programDefaultScheme: string | null,
  unit: WeightUnit,
): Promise<Suggestion> {
  const scheme = (slot.scheme ?? programDefaultScheme ?? 'hold') as SchemeKind;
  const [state, lastSession] = await Promise.all([
    loadState(programId, slot.exerciseId),
    lastSessionFor(slot.exerciseId, programId),
  ]);

  return suggest({
    scheme,
    unit,
    isLowerBody: isLowerBody(slot.exerciseId),
    targetSets: slot.targetSets ?? 3,
    targetReps: slot.targetReps,
    targetRpe: slot.targetRpe,
    intensityPct: slot.intensityPct,
    state: state ?? { 
      exerciseId: slot.exerciseId, programId, scheme,
      stage: 0, failures: 0, workingKg: null, trainingMaxKg: null,
    },
    lastSession,
  });
}

/* -------------------------------------------------------------- advancing */

/**
 * Advances every lift in a finished session to its next state.
 *
 * Called once, after the workout is marked finished, so the session it just
 * completed is the history the engine reads. This is the only place a lifter's
 * progression actually moves — opening a screen never changes it.
 *
 * Failures here are swallowed deliberately: a progression state that didn't
 * update is a mildly stale suggestion next session, which is not worth failing
 * a completed workout over.
 */
export async function advanceProgression(workoutId: string): Promise<void> {
  try {
    const db = await getDb();

    const workout = await db.getFirstAsync<{ program_id: string | null; day_id: string | null }>(
      'SELECT program_id, day_id FROM workout WHERE id = ?', workoutId,
    );
    if (!workout) return;

    const programId = workout.program_id;
    const program = programId
      ? await db.getFirstAsync<{ default_scheme: string | null }>(
          'SELECT default_scheme FROM program WHERE id = ?', programId,
        )
      : null;

    // The distinct lifts trained, with the prescription each was given.
    const lifts = await db.getAllAsync<{
      exercise_id: string; target_sets: number | null; target_reps: string | null;
      target_rpe: number | null; intensity_pct: number | null; scheme: string | null;
    }>(
      `SELECT DISTINCT s.exercise_id, sl.target_sets, sl.target_reps, sl.target_rpe,
              sl.intensity_pct, sl.scheme
       FROM logged_set s
       LEFT JOIN program_slot sl ON sl.id = s.slot_id
       WHERE s.workout_id = ? AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL`,
      workoutId,
    );

    const unit = getSettings().weightUnit;

    for (const lift of lifts) {
      const scheme = (lift.scheme ?? program?.default_scheme ?? 'hold') as SchemeKind;
      const [state, lastSession] = await Promise.all([
        loadState(programId, lift.exercise_id),
        lastSessionFor(lift.exercise_id, programId),
      ]);
      if (!lastSession) continue;

      const result = suggest({
        scheme,
        unit,
        isLowerBody: isLowerBody(lift.exercise_id),
        targetSets: lift.target_sets ?? 3,
        targetReps: lift.target_reps,
        targetRpe: lift.target_rpe,
        intensityPct: lift.intensity_pct,
        state: state ?? {
          exerciseId: lift.exercise_id, programId, scheme,
          stage: 0, failures: 0, workingKg: null, trainingMaxKg: null,
        },
        lastSession,
      });

      await saveState({
        ...result.nextState,
        exerciseId: lift.exercise_id,
        programId,
        scheme,
      });
    }
  } catch (err) {
    console.warn('[progression] advance failed', err);
  }
}
