import { getDb, uuid, now } from './client';
import { searchExercises } from '../data/catalog';
import { parseProgram, type ParsedProgram } from '../data/importProgram';

/**
 * Resolves free text to a catalogue exercise.
 *
 * Deliberately strict — `searchExercises` requires every word of the query to
 * appear somewhere — so a name we are unsure about comes back null and becomes
 * a visible warning, rather than being quietly matched to the wrong movement.
 * Silently importing "Zercher Squat" as "Barbell Squat" would put the wrong
 * exercise in someone's program without them ever knowing.
 */
export function resolveExercise(query: string): string | null {
  const hits = searchExercises(query, 1);
  return hits[0]?.id ?? null;
}

export const parse = (text: string): ParsedProgram => parseProgram(text, resolveExercise);

/**
 * Writes an imported program in as the user's own.
 *
 * Marked `origin='user'`, so it is never touched by the built-in re-seed and
 * syncs to the lifter's other devices like anything else they created. Slots
 * whose exercise could not be matched are skipped — they were surfaced as
 * warnings before the user chose to import.
 */
export async function saveImportedProgram(parsed: ParsedProgram): Promise<string> {
  const db = await getDb();
  const ts = now();
  const programId = uuid();

  const weeks = new Set(parsed.days.map((d) => d.week).filter((w): w is number => w != null));
  // Days per week, so a wave program reports its real frequency rather than
  // its total day count.
  const perWeek = weeks.size > 0 ? Math.round(parsed.days.length / weeks.size) : parsed.days.length;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO program
         (id, name, author, description, origin, goal, days_per_week, weeks, accent, default_scheme, updated_at, dirty)
       VALUES (?, ?, ?, ?, 'user', 'general', ?, ?, ?, ?, ?, 1)`,
      programId, parsed.name, parsed.author, null,
      perWeek || null, weeks.size || null, '#D6FF3F',
      // Percentage-based imports drive off a training max; everything else
      // holds what was last lifted until the user picks a scheme.
      parsed.days.some((d) => d.slots.some((s) => s.pct != null)) ? 'tm_percent' : 'double',
      ts,
    );

    for (const [di, day] of parsed.days.entries()) {
      const dayId = uuid();
      await db.runAsync(
        `INSERT INTO program_day (id, program_id, week, day_index, name, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        dayId, programId, day.week,
        day.week != null ? di % Math.max(perWeek, 1) : di,
        day.name, ts,
      );

      let position = 0;
      for (const slot of day.slots) {
        if (!slot.exerciseId) continue;
        await db.runAsync(
          `INSERT INTO program_slot
             (id, day_id, exercise_id, position, target_sets, target_reps,
              intensity_pct, target_rpe, rest_seconds, notes, scheme, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          uuid(), dayId, slot.exerciseId, position++,
          slot.sets, slot.reps, slot.pct, slot.rpe, slot.restSeconds, slot.note,
          slot.pct != null ? 'tm_percent' : null, ts,
        );
      }
    }
  });

  return programId;
}
