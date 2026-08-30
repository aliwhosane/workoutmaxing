import { getDb, uuid, now } from '../db/client';
import type { SchemeKind } from '../progression/types';

/**
 * Built-in program library.
 *
 * These are classic, freely-published community templates (GZCLP, nSuns LP,
 * PHUL, Madcow, novice linear progression, PPL). They are seeded on first
 * launch and marked origin='builtin' so they can be replaced by a newer app
 * build without touching anything the user wrote.
 *
 * Note on scope: paid or coach-authored programs distributed inside other apps
 * are their authors' copyrighted work and are deliberately not reproduced here.
 * The schema below is the same one those would use, so a licensed program drops
 * in as data with no code change.
 */

export interface SlotSpec {
  exercise: string;          // exercise id from the bundled catalogue
  /** Overrides the program's default progression. GZCLP needs this per tier. */
  scheme?: SchemeKind;
  sets?: number;
  reps?: string;             // "5", "8-12", "AMRAP"
  pct?: number;              // % of training max
  rpe?: number;
  rest?: number;             // seconds
  superset?: string;
  note?: string;
}

export interface DaySpec { name: string; slots: SlotSpec[]; note?: string }

export interface ProgramSpec {
  id: string;
  name: string;
  author: string;
  /** How this program advances load, unless a slot says otherwise. */
  scheme: SchemeKind;
  goal: 'strength' | 'hypertrophy' | 'general' | 'powerbuilding';
  daysPerWeek: number;
  weeks: number | null;      // null = runs indefinitely
  accent: string;
  description: string;
  days: DaySpec[];
}

// Catalogue ids used repeatedly, aliased for readability.
const SQ = 'Barbell_Squat';
const BP = 'Barbell_Bench_Press_-_Medium_Grip';
const DL = 'Barbell_Deadlift';
const OHP = 'Standing_Military_Press';
const ROW = 'Bent_Over_Barbell_Row';
const FSQ = 'Front_Barbell_Squat';
const RDL = 'Romanian_Deadlift';
const INC = 'Barbell_Incline_Bench_Press_-_Medium_Grip';
const PULL = 'Pullups';
const DIP = 'Dips_-_Triceps_Version';
const LAT = 'Wide-Grip_Lat_Pulldown';
const CROW = 'Seated_Cable_Rows';
const DBP = 'Dumbbell_Bench_Press';
const DBS = 'Dumbbell_Shoulder_Press';
const CURL = 'Barbell_Curl';
const HAM = 'Hammer_Curls';
const LEGP = 'Leg_Press';
const LEGE = 'Leg_Extensions';
const LEGC = 'Lying_Leg_Curls';
const CALF = 'Standing_Calf_Raises';
const LATR = 'Side_Lateral_Raise';
const FACE = 'Face_Pull';
const PUSH = 'Pushups';

export const BUILT_IN: ProgramSpec[] = [
  {
    id: 'builtin.nlp',
    name: 'Novice Linear Progression',
    author: 'Classic',
    scheme: 'linear',
    goal: 'strength',
    daysPerWeek: 3,
    weeks: null,
    accent: '#D6FF3F',
    description:
      'The fastest way for a new lifter to get strong. Three days a week, two alternating sessions, and you add weight to the bar every single time you train. Run it until it stops working — that usually takes months.',
    days: [
      { name: 'Workout A', slots: [
        { exercise: SQ, sets: 3, reps: '5', rest: 180 },
        { exercise: BP, sets: 3, reps: '5', rest: 180 },
        { exercise: DL, sets: 1, reps: '5', rest: 180, note: 'One heavy set. Reset each rep.' },
      ]},
      { name: 'Workout B', slots: [
        { exercise: SQ, sets: 3, reps: '5', rest: 180 },
        { exercise: OHP, sets: 3, reps: '5', rest: 180 },
        { exercise: ROW, sets: 3, reps: '5', rest: 180 },
      ]},
      { name: 'Workout A', slots: [
        { exercise: SQ, sets: 3, reps: '5', rest: 180 },
        { exercise: BP, sets: 3, reps: '5', rest: 180 },
        { exercise: DL, sets: 1, reps: '5', rest: 180 },
      ]},
    ],
  },
  {
    id: 'builtin.gzclp',
    name: 'GZCLP',
    author: 'Cody Lefever',
    scheme: 'gzclp_t3',
    goal: 'powerbuilding',
    daysPerWeek: 4,
    weeks: null,
    accent: '#7DD3FC',
    description:
      'Linear progression built on the GZCL tier system. T1 is one heavy main lift, T2 is a volume lift, T3 is accessory work taken close to failure. Progress each tier on its own schedule so one stall does not sink the whole program.',
    days: [
      { name: 'Day 1 — Squat / Bench', slots: [
        { exercise: SQ,  sets: 5, reps: '3', rest: 180, note: 'T1 — last set AMRAP', scheme: 'gzclp_t1' },
        { exercise: BP,  sets: 3, reps: '10', rest: 120, note: 'T2', scheme: 'gzclp_t2' },
        { exercise: LAT, sets: 3, reps: '15', rest: 90, note: 'T3 — last set AMRAP', scheme: 'gzclp_t3' },
      ]},
      { name: 'Day 2 — OHP / Deadlift', slots: [
        { exercise: OHP, sets: 5, reps: '3', rest: 180, note: 'T1 — last set AMRAP', scheme: 'gzclp_t1' },
        { exercise: DL,  sets: 3, reps: '10', rest: 120, note: 'T2', scheme: 'gzclp_t2' },
        { exercise: CROW, sets: 3, reps: '15', rest: 90, note: 'T3', scheme: 'gzclp_t3' },
      ]},
      { name: 'Day 3 — Bench / Squat', slots: [
        { exercise: BP, sets: 5, reps: '3', rest: 180, note: 'T1 — last set AMRAP', scheme: 'gzclp_t1' },
        { exercise: SQ, sets: 3, reps: '10', rest: 120, note: 'T2', scheme: 'gzclp_t2' },
        { exercise: PULL, sets: 3, reps: '15', rest: 90, note: 'T3', scheme: 'gzclp_t3' },
      ]},
      { name: 'Day 4 — Deadlift / OHP', slots: [
        { exercise: DL,  sets: 5, reps: '3', rest: 180, note: 'T1 — last set AMRAP', scheme: 'gzclp_t1' },
        { exercise: OHP, sets: 3, reps: '10', rest: 120, note: 'T2', scheme: 'gzclp_t2' },
        { exercise: DIP, sets: 3, reps: '15', rest: 90, note: 'T3', scheme: 'gzclp_t3' },
      ]},
    ],
  },
  {
    id: 'builtin.phul',
    name: 'PHUL',
    author: 'Brandon Campbell',
    scheme: 'double',
    goal: 'powerbuilding',
    daysPerWeek: 4,
    weeks: null,
    accent: '#F0ABFC',
    description:
      'Power Hypertrophy Upper Lower. Two heavy days train the movement, two lighter days train the muscle. The most reliable four-day split for people who want to be both strong and big.',
    days: [
      { name: 'Upper Power', slots: [
        { exercise: BP,  sets: 4, reps: '3-5', rest: 180 },
        { exercise: INC, sets: 4, reps: '6-10', rest: 120 },
        { exercise: ROW, sets: 4, reps: '3-5', rest: 180 },
        { exercise: LAT, sets: 4, reps: '6-10', rest: 120 },
        { exercise: OHP, sets: 3, reps: '5-8', rest: 120 },
        { exercise: CURL, sets: 3, reps: '6-10', rest: 90 },
      ]},
      { name: 'Lower Power', slots: [
        { exercise: SQ,  sets: 4, reps: '3-5', rest: 210 },
        { exercise: DL,  sets: 4, reps: '3-5', rest: 210 },
        { exercise: LEGP, sets: 4, reps: '10-15', rest: 120 },
        { exercise: LEGC, sets: 4, reps: '6-10', rest: 90 },
        { exercise: CALF, sets: 4, reps: '6-10', rest: 60 },
      ]},
      { name: 'Upper Hypertrophy', slots: [
        { exercise: INC, sets: 4, reps: '8-12', rest: 90 },
        { exercise: DBP, sets: 4, reps: '8-12', rest: 90 },
        { exercise: CROW, sets: 4, reps: '8-12', rest: 90 },
        { exercise: LAT, sets: 4, reps: '8-12', rest: 90 },
        { exercise: LATR, sets: 4, reps: '8-12', rest: 60 },
        { exercise: HAM, sets: 4, reps: '8-12', rest: 60 },
      ]},
      { name: 'Lower Hypertrophy', slots: [
        { exercise: FSQ, sets: 4, reps: '8-12', rest: 120 },
        { exercise: RDL, sets: 4, reps: '8-12', rest: 120 },
        { exercise: LEGE, sets: 4, reps: '10-15', rest: 60 },
        { exercise: LEGC, sets: 4, reps: '10-15', rest: 60 },
        { exercise: CALF, sets: 4, reps: '12-15', rest: 60 },
      ]},
    ],
  },
  {
    id: 'builtin.ppl',
    name: 'Push Pull Legs',
    author: 'Classic',
    scheme: 'double',
    goal: 'hypertrophy',
    daysPerWeek: 6,
    weeks: null,
    accent: '#FDBA74',
    description:
      'Six days, each muscle trained twice a week, nothing trained on a day it is still sore. The default answer for anyone who wants to be in the gym most days and still recover.',
    days: [
      { name: 'Push', slots: [
        { exercise: BP,   sets: 4, reps: '6-8', rest: 150 },
        { exercise: DBS,  sets: 3, reps: '8-12', rest: 90 },
        { exercise: INC,  sets: 3, reps: '8-12', rest: 90 },
        { exercise: LATR, sets: 3, reps: '12-15', rest: 60 },
        { exercise: DIP,  sets: 3, reps: '8-12', rest: 90 },
      ]},
      { name: 'Pull', slots: [
        { exercise: DL,   sets: 3, reps: '5', rest: 210, scheme: 'linear' },
        { exercise: PULL, sets: 4, reps: '6-10', rest: 120 },
        { exercise: CROW, sets: 3, reps: '8-12', rest: 90 },
        { exercise: FACE, sets: 3, reps: '15-20', rest: 60 },
        { exercise: CURL, sets: 3, reps: '8-12', rest: 60 },
      ]},
      { name: 'Legs', slots: [
        { exercise: SQ,   sets: 4, reps: '6-8', rest: 180 },
        { exercise: RDL,  sets: 3, reps: '8-12', rest: 120 },
        { exercise: LEGP, sets: 3, reps: '10-15', rest: 90 },
        { exercise: LEGC, sets: 3, reps: '10-15', rest: 60 },
        { exercise: CALF, sets: 4, reps: '12-15', rest: 45 },
      ]},
      { name: 'Push', slots: [
        { exercise: OHP,  sets: 4, reps: '6-8', rest: 150 },
        { exercise: DBP,  sets: 3, reps: '8-12', rest: 90 },
        { exercise: LATR, sets: 4, reps: '12-15', rest: 60 },
        { exercise: PUSH, sets: 3, reps: 'AMRAP', rest: 90 },
      ]},
      { name: 'Pull', slots: [
        { exercise: ROW,  sets: 4, reps: '6-8', rest: 150 },
        { exercise: LAT,  sets: 3, reps: '8-12', rest: 90 },
        { exercise: CROW, sets: 3, reps: '10-15', rest: 90 },
        { exercise: HAM,  sets: 3, reps: '10-12', rest: 60 },
      ]},
      { name: 'Legs', slots: [
        { exercise: FSQ,  sets: 4, reps: '6-8', rest: 180 },
        { exercise: LEGP, sets: 4, reps: '10-15', rest: 90 },
        { exercise: LEGE, sets: 3, reps: '12-15', rest: 60 },
        { exercise: CALF, sets: 4, reps: '15-20', rest: 45 },
      ]},
    ],
  },
  {
    id: 'builtin.upperlower',
    name: 'Upper / Lower',
    author: 'Classic',
    scheme: 'double',
    goal: 'general',
    daysPerWeek: 4,
    weeks: null,
    accent: '#86EFAC',
    description:
      'Four days, two upper, two lower. The best strength-per-hour ratio in lifting, and the easiest split to keep running when life gets in the way — miss a day and you just do it next time.',
    days: [
      { name: 'Upper A', slots: [
        { exercise: BP,   sets: 4, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: ROW,  sets: 4, reps: '6-8', rest: 120 },
        { exercise: DBS,  sets: 3, reps: '8-10', rest: 90 },
        { exercise: LAT,  sets: 3, reps: '10-12', rest: 90 },
        { exercise: CURL, sets: 3, reps: '10-12', rest: 60 },
      ]},
      { name: 'Lower A', slots: [
        { exercise: SQ,   sets: 4, reps: '5', rest: 210, scheme: 'linear' },
        { exercise: RDL,  sets: 3, reps: '8-10', rest: 120 },
        { exercise: LEGP, sets: 3, reps: '10-12', rest: 90 },
        { exercise: CALF, sets: 4, reps: '12-15', rest: 45 },
      ]},
      { name: 'Upper B', slots: [
        { exercise: OHP,  sets: 4, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: PULL, sets: 4, reps: 'AMRAP', rest: 120 },
        { exercise: INC,  sets: 3, reps: '8-10', rest: 90 },
        { exercise: CROW, sets: 3, reps: '10-12', rest: 90 },
        { exercise: FACE, sets: 3, reps: '15', rest: 60 },
      ]},
      { name: 'Lower B', slots: [
        { exercise: DL,   sets: 3, reps: '5', rest: 210, scheme: 'linear' },
        { exercise: FSQ,  sets: 3, reps: '8', rest: 150 },
        { exercise: LEGC, sets: 3, reps: '10-12', rest: 60 },
        { exercise: CALF, sets: 4, reps: '12-15', rest: 45 },
      ]},
    ],
  },
  {
    id: 'builtin.madcow',
    name: 'Madcow 5×5',
    author: 'Classic',
    scheme: 'linear',
    goal: 'strength',
    daysPerWeek: 3,
    weeks: 12,
    accent: '#FCA5A5',
    description:
      'The intermediate answer when adding weight every session stops working. Progression moves to a weekly cycle: a heavy day, a light day and a medium day, with a ramping five-set build to one top set each week.',
    days: [
      { name: 'Monday — Heavy', slots: [
        { exercise: SQ,  sets: 5, reps: '5', rest: 180, note: 'Ramp 50/62/75/87/100% of top set' },
        { exercise: BP,  sets: 5, reps: '5', rest: 180, note: 'Ramp to top set' },
        { exercise: ROW, sets: 5, reps: '5', rest: 180, note: 'Ramp to top set' },
      ]},
      { name: 'Wednesday — Light', slots: [
        { exercise: SQ,  sets: 4, reps: '5', rest: 150, note: 'Stop at 4th set — light day' },
        { exercise: OHP, sets: 4, reps: '5', rest: 150 },
        { exercise: DL,  sets: 4, reps: '5', rest: 180 },
      ]},
      { name: 'Friday — Medium', slots: [
        { exercise: SQ,  sets: 4, reps: '5', rest: 180, note: 'Then one back-off triple' },
        { exercise: BP,  sets: 4, reps: '5', rest: 180 },
        { exercise: ROW, sets: 4, reps: '5', rest: 180 },
      ]},
    ],
  },
];

/**
 * Seeds built-in programs on first launch and re-seeds them when the app ships
 * new versions. Deletes and rewrites rows with origin='builtin' only, so a
 * user's own programs and their logged history are never touched.
 */
export async function seedBuiltInPrograms(): Promise<void> {
  const d = await getDb();
  const ts = now();

  const seeded = await d.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM program WHERE origin = 'builtin'",
  );
  const version = await d.getFirstAsync<{ value: string }>(
    "SELECT value FROM kv WHERE key = 'builtin_programs_version'",
  );
  const STAMP = String(BUILT_IN.length) + ':2';
  if ((seeded?.n ?? 0) > 0 && version?.value === STAMP) return;

  await d.withTransactionAsync(async () => {
    await d.runAsync("DELETE FROM program WHERE origin = 'builtin'");

    for (const p of BUILT_IN) {
      await d.runAsync(
        `INSERT INTO program (id, name, author, description, origin, goal, days_per_week, weeks, accent, default_scheme, updated_at, dirty)
         VALUES (?, ?, ?, ?, 'builtin', ?, ?, ?, ?, ?, ?, 0)`,
        p.id, p.name, p.author, p.description, p.goal, p.daysPerWeek, p.weeks, p.accent, p.scheme, ts,
      );

      for (const [di, day] of p.days.entries()) {
        const dayId = `${p.id}.d${di}`;
        await d.runAsync(
          `INSERT INTO program_day (id, program_id, week, day_index, name, notes, updated_at, dirty)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 0)`,
          dayId, p.id, di, day.name, day.note ?? null, ts,
        );

        for (const [si, slot] of day.slots.entries()) {
          await d.runAsync(
            `INSERT INTO program_slot
               (id, day_id, exercise_id, position, superset_group, target_sets, target_reps,
                intensity_pct, target_rpe, rest_seconds, notes, scheme, updated_at, dirty)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            `${dayId}.s${si}`, dayId, slot.exercise, si, slot.superset ?? null,
            slot.sets ?? null, slot.reps ?? null, slot.pct ?? null, slot.rpe ?? null,
            slot.rest ?? null, slot.note ?? null, slot.scheme ?? null, ts,
          );
        }
      }
    }

    await d.runAsync(
      "INSERT INTO kv (key, value) VALUES ('builtin_programs_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      STAMP,
    );
  });
}
