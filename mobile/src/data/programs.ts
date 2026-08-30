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

export interface DaySpec {
  name: string;
  slots: SlotSpec[];
  note?: string;
  /**
   * Which week of a wave this day belongs to. Omitted for the majority of
   * programs, which are a repeating weekly split with no wave at all.
   */
  week?: number;
}

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
const PLANK = 'Plank';

/**
 * 5/3/1's three-week wave, exactly as Wendler publishes it.
 *
 * Each main lift is three ascending singles-to-fives off the training max, the
 * last taken for as many reps as possible, followed by First Set Last: five
 * sets of five back at the opening weight.
 *
 * Written as data rather than by hand because the same twelve slots repeat for
 * six lift-slots across three weeks, and transcribing seventy-odd rows by hand
 * is how percentages get typed wrong.
 */
const WAVE_531 = [
  { week: 1, sets: [{ pct: 0.65, reps: '5' }, { pct: 0.75, reps: '5' }, { pct: 0.85, reps: '5' }], fsl: 0.65 },
  { week: 2, sets: [{ pct: 0.70, reps: '3' }, { pct: 0.80, reps: '3' }, { pct: 0.90, reps: '3' }], fsl: 0.70 },
  { week: 3, sets: [{ pct: 0.75, reps: '5' }, { pct: 0.85, reps: '3' }, { pct: 0.95, reps: '1' }], fsl: 0.75 },
];

/** The four slots one main lift occupies in a 5/3/1 session. */
function mainLift531(exercise: string, wave: (typeof WAVE_531)[number]): SlotSpec[] {
  return [
    ...wave.sets.map((set, i) => ({
      exercise,
      sets: 1,
      reps: set.reps,
      pct: set.pct,
      rest: 180,
      scheme: 'tm_percent' as const,
      note: i === wave.sets.length - 1
        ? `Top set — as many reps as possible`
        : `${Math.round(set.pct * 100)}% of training max`,
    })),
    {
      exercise, sets: 5, reps: '5', pct: wave.fsl, rest: 150,
      scheme: 'tm_percent' as const, note: 'First Set Last',
    },
  ];
}

/** Day 1 squat+bench, day 2 deadlift+press, day 3 bench+squat — across three weeks. */
function build531Beginners(): DaySpec[] {
  const pairs: [string, string, string][] = [
    [SQ, BP, 'Squat & Bench'],
    [DL, OHP, 'Deadlift & Press'],
    [BP, SQ, 'Bench & Squat'],
  ];
  const assistance: SlotSpec[] = [
    { exercise: PULL, sets: 5, reps: '10', rest: 60, note: 'Pull — 50-100 total reps' },
    { exercise: DIP,  sets: 5, reps: '10', rest: 60, note: 'Push — 50-100 total reps' },
  ];

  return WAVE_531.flatMap((wave) =>
    pairs.map(([first, second, name]) => ({
      week: wave.week,
      name,
      slots: [...mainLift531(first, wave), ...mainLift531(second, wave), ...assistance],
    })),
  );
}

export const BUILT_IN: ProgramSpec[] = [
  {
    id: 'builtin.531beginners',
    name: '5/3/1 for Beginners',
    author: 'Jim Wendler',
    scheme: 'tm_percent',
    goal: 'strength',
    daysPerWeek: 3,
    weeks: 3,
    accent: '#A3E635',
    description:
      'Wendler’s system condensed into three full-body days, so a beginner gets twice the practice on the big lifts. Everything runs off a training max at 90% of your real max, which means the weights are always makeable and the last set is where you find out what you have.',
    days: build531Beginners(),
  },
  {
    id: 'builtin.stronglifts',
    name: 'StrongLifts 5×5',
    author: 'Mehdi Hadim',
    scheme: 'linear',
    goal: 'strength',
    daysPerWeek: 3,
    weeks: null,
    accent: '#93C5FD',
    description:
      'Five sets of five, two alternating workouts, three days a week. The most-run beginner program in the world — the volume is what makes it work, and the simplicity is what makes people stick to it.',
    days: [
      { name: 'Workout A', slots: [
        { exercise: SQ,  sets: 5, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: BP,  sets: 5, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: ROW, sets: 5, reps: '5', rest: 180, scheme: 'linear' },
      ]},
      { name: 'Workout B', slots: [
        { exercise: SQ,  sets: 5, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: OHP, sets: 5, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: DL,  sets: 1, reps: '5', rest: 180, scheme: 'linear', note: 'One work set only' },
      ]},
      { name: 'Workout A', slots: [
        { exercise: SQ,  sets: 5, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: BP,  sets: 5, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: ROW, sets: 5, reps: '5', rest: 180, scheme: 'linear' },
      ]},
    ],
  },
  {
    id: 'builtin.greyskull',
    name: 'GreySkull LP',
    author: 'John Sheaffer',
    scheme: 'linear',
    goal: 'strength',
    daysPerWeek: 3,
    weeks: null,
    accent: '#C4B5FD',
    description:
      'Linear progression with the last set taken for as many reps as possible. The AMRAP set is the point: it tells you honestly whether the weight is still yours, so progress never depends on guessing.',
    days: [
      { name: 'Workout A', slots: [
        { exercise: OHP, sets: 3, reps: '5', rest: 150, scheme: 'linear', note: 'Last set AMRAP' },
        { exercise: SQ,  sets: 3, reps: '5', rest: 180, scheme: 'linear', note: 'Last set AMRAP' },
        { exercise: PULL, sets: 3, reps: 'AMRAP', rest: 120 },
      ]},
      { name: 'Workout B', slots: [
        { exercise: BP,  sets: 3, reps: '5', rest: 150, scheme: 'linear', note: 'Last set AMRAP' },
        { exercise: DL,  sets: 1, reps: '5', rest: 210, scheme: 'linear', note: 'One set, AMRAP' },
        { exercise: CROW, sets: 3, reps: '8-12', rest: 90 },
      ]},
      { name: 'Workout A', slots: [
        { exercise: OHP, sets: 3, reps: '5', rest: 150, scheme: 'linear', note: 'Last set AMRAP' },
        { exercise: SQ,  sets: 3, reps: '5', rest: 180, scheme: 'linear', note: 'Last set AMRAP' },
        { exercise: DIP, sets: 3, reps: 'AMRAP', rest: 120 },
      ]},
    ],
  },
  {
    id: 'builtin.531bbb',
    name: '5/3/1 Boring But Big',
    author: 'Jim Wendler',
    scheme: 'tm_percent',
    goal: 'powerbuilding',
    daysPerWeek: 4,
    weeks: 4,
    accent: '#FDE047',
    description:
      'One main lift a day at a percentage of your training max, then five sets of ten of the same movement. Wendler’s most popular variation — heavy enough to get strong, enough volume to get big, and it runs for years.',
    days: [
      { name: 'Press Day', slots: [
        { exercise: OHP, sets: 1, reps: '5', pct: 0.85, rest: 210, scheme: 'tm_percent', note: 'Top set — AMRAP' },
        { exercise: OHP, sets: 5, reps: '10', pct: 0.50, rest: 90, scheme: 'tm_percent', note: 'Boring But Big' },
        { exercise: LAT, sets: 5, reps: '10', rest: 90 },
      ]},
      { name: 'Deadlift Day', slots: [
        { exercise: DL, sets: 1, reps: '5', pct: 0.85, rest: 240, scheme: 'tm_percent', note: 'Top set — AMRAP' },
        { exercise: DL, sets: 5, reps: '10', pct: 0.50, rest: 120, scheme: 'tm_percent', note: 'Boring But Big' },
        { exercise: LEGC, sets: 5, reps: '10', rest: 90 },
      ]},
      { name: 'Bench Day', slots: [
        { exercise: BP, sets: 1, reps: '5', pct: 0.85, rest: 210, scheme: 'tm_percent', note: 'Top set — AMRAP' },
        { exercise: BP, sets: 5, reps: '10', pct: 0.50, rest: 90, scheme: 'tm_percent', note: 'Boring But Big' },
        { exercise: CROW, sets: 5, reps: '10', rest: 90 },
      ]},
      { name: 'Squat Day', slots: [
        { exercise: SQ, sets: 1, reps: '5', pct: 0.85, rest: 240, scheme: 'tm_percent', note: 'Top set — AMRAP' },
        { exercise: SQ, sets: 5, reps: '10', pct: 0.50, rest: 120, scheme: 'tm_percent', note: 'Boring But Big' },
        { exercise: LEGC, sets: 5, reps: '10', rest: 90 },
      ]},
    ],
  },
  {
    id: 'builtin.nsuns',
    name: 'nSuns 5/3/1 LP',
    author: 'r/fitness community',
    scheme: 'tm_percent',
    goal: 'strength',
    daysPerWeek: 5,
    weeks: null,
    accent: '#F97316',
    description:
      'A very high-volume take on 5/3/1 that progresses weekly instead of monthly. Nine sets of a main lift and eight of a secondary, every session. Brutal, and one of the most effective intermediate programs there is.',
    days: [
      { name: 'Bench / OHP', slots: [
        { exercise: BP,  sets: 8, reps: '5', pct: 0.85, rest: 180, scheme: 'tm_percent', note: 'T1 — set 3 is AMRAP' },
        { exercise: OHP, sets: 8, reps: '6', pct: 0.50, rest: 120, scheme: 'tm_percent', note: 'T2' },
        { exercise: FACE, sets: 3, reps: '15', rest: 60 },
      ]},
      { name: 'Squat / Sumo Deadlift', slots: [
        { exercise: SQ, sets: 8, reps: '5', pct: 0.85, rest: 210, scheme: 'tm_percent', note: 'T1 — set 3 is AMRAP' },
        { exercise: DL, sets: 8, reps: '5', pct: 0.50, rest: 150, scheme: 'tm_percent', note: 'T2' },
        { exercise: LEGC, sets: 3, reps: '12', rest: 60 },
      ]},
      { name: 'OHP / Incline', slots: [
        { exercise: OHP, sets: 8, reps: '5', pct: 0.85, rest: 180, scheme: 'tm_percent', note: 'T1 — set 3 is AMRAP' },
        { exercise: INC, sets: 8, reps: '6', pct: 0.50, rest: 120, scheme: 'tm_percent', note: 'T2' },
        { exercise: LATR, sets: 3, reps: '15', rest: 60 },
      ]},
      { name: 'Deadlift / Front Squat', slots: [
        { exercise: DL,  sets: 8, reps: '5', pct: 0.85, rest: 240, scheme: 'tm_percent', note: 'T1 — set 3 is AMRAP' },
        { exercise: FSQ, sets: 8, reps: '5', pct: 0.50, rest: 150, scheme: 'tm_percent', note: 'T2' },
        { exercise: CROW, sets: 3, reps: '12', rest: 60 },
      ]},
      { name: 'Bench / Close Grip', slots: [
        { exercise: BP,  sets: 8, reps: '5', pct: 0.80, rest: 180, scheme: 'tm_percent', note: 'T1 — set 3 is AMRAP' },
        { exercise: INC, sets: 8, reps: '6', pct: 0.50, rest: 120, scheme: 'tm_percent', note: 'T2' },
        { exercise: CURL, sets: 3, reps: '12', rest: 60 },
      ]},
    ],
  },
  {
    id: 'builtin.phat',
    name: 'PHAT',
    author: 'Dr. Layne Norton',
    scheme: 'double',
    goal: 'powerbuilding',
    daysPerWeek: 5,
    weeks: null,
    accent: '#F472B6',
    description:
      'Power Hypertrophy Adaptive Training. Two heavy power days and three high-volume hypertrophy days, so every muscle is trained twice a week — once for strength, once for size. The powerbuilding template most others copy.',
    days: [
      { name: 'Upper Power', slots: [
        { exercise: ROW, sets: 3, reps: '3-5', rest: 180, scheme: 'linear' },
        { exercise: LAT, sets: 2, reps: '6-10', rest: 120 },
        { exercise: BP,  sets: 3, reps: '3-5', rest: 180, scheme: 'linear' },
        { exercise: DBP, sets: 2, reps: '6-10', rest: 120 },
        { exercise: OHP, sets: 3, reps: '6-10', rest: 120 },
        { exercise: CURL, sets: 3, reps: '6-10', rest: 90 },
      ]},
      { name: 'Lower Power', slots: [
        { exercise: SQ,   sets: 3, reps: '3-5', rest: 210, scheme: 'linear' },
        { exercise: LEGP, sets: 2, reps: '6-10', rest: 120 },
        { exercise: LEGC, sets: 3, reps: '6-10', rest: 90 },
        { exercise: RDL,  sets: 3, reps: '5-8', rest: 150 },
        { exercise: CALF, sets: 4, reps: '6-10', rest: 60 },
      ]},
      { name: 'Back & Shoulders', slots: [
        { exercise: ROW,  sets: 6, reps: '3', rest: 60, note: 'Speed work — about 65% of power day' },
        { exercise: LAT,  sets: 3, reps: '8-12', rest: 90 },
        { exercise: CROW, sets: 3, reps: '8-12', rest: 90 },
        { exercise: LATR, sets: 4, reps: '12-15', rest: 60 },
        { exercise: FACE, sets: 3, reps: '15-20', rest: 60 },
      ]},
      { name: 'Chest & Arms', slots: [
        { exercise: BP,   sets: 6, reps: '3', rest: 60, note: 'Speed work — about 65% of power day' },
        { exercise: INC,  sets: 3, reps: '8-12', rest: 90 },
        { exercise: DBP,  sets: 3, reps: '12-15', rest: 60 },
        { exercise: CURL, sets: 3, reps: '8-12', rest: 60 },
        { exercise: DIP,  sets: 3, reps: '10-15', rest: 60 },
      ]},
      { name: 'Legs', slots: [
        { exercise: SQ,   sets: 6, reps: '3', rest: 60, note: 'Speed work — about 65% of power day' },
        { exercise: LEGP, sets: 3, reps: '10-15', rest: 90 },
        { exercise: LEGE, sets: 3, reps: '15-20', rest: 60 },
        { exercise: LEGC, sets: 3, reps: '10-15', rest: 60 },
        { exercise: CALF, sets: 4, reps: '12-15', rest: 45 },
      ]},
    ],
  },
  {
    id: 'builtin.texas',
    name: 'Texas Method',
    author: 'Mark Rippetoe & Glenn Pendlay',
    scheme: 'linear',
    goal: 'strength',
    daysPerWeek: 3,
    weeks: null,
    accent: '#FB7185',
    description:
      'The classic answer when adding weight every session stops working. Volume on Monday, recovery on Wednesday, a new personal record on Friday — progress moves to a weekly cycle instead of a daily one.',
    days: [
      { name: 'Monday — Volume', slots: [
        { exercise: SQ,  sets: 5, reps: '5', rest: 210, note: '5×5 across, same weight' },
        { exercise: BP,  sets: 5, reps: '5', rest: 180 },
        { exercise: DL,  sets: 1, reps: '5', rest: 240 },
      ]},
      { name: 'Wednesday — Light', slots: [
        { exercise: SQ,  sets: 2, reps: '5', rest: 150, note: 'About 80% of Monday' },
        { exercise: OHP, sets: 3, reps: '5', rest: 150 },
        { exercise: PULL, sets: 3, reps: 'AMRAP', rest: 120 },
      ]},
      { name: 'Friday — Intensity', slots: [
        { exercise: SQ,  sets: 1, reps: '5', rest: 240, scheme: 'linear', note: 'One heavy set — a new 5RM' },
        { exercise: BP,  sets: 1, reps: '5', rest: 240, scheme: 'linear', note: 'One heavy set' },
        { exercise: ROW, sets: 3, reps: '5', rest: 150 },
      ]},
    ],
  },
  {
    id: 'builtin.minimalist',
    name: 'Minimalist Full Body',
    author: 'Classic',
    scheme: 'linear',
    goal: 'general',
    daysPerWeek: 2,
    weeks: null,
    accent: '#5EEAD4',
    description:
      'Two days a week, four movements a session, in and out in forty minutes. Built for people whose lives will not allow more — and it beats the perfect program you never actually run.',
    days: [
      { name: 'Day 1', slots: [
        { exercise: SQ,   sets: 3, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: BP,   sets: 3, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: ROW,  sets: 3, reps: '8', rest: 120 },
        { exercise: PLANK, sets: 3, reps: '45', rest: 60 },
      ]},
      { name: 'Day 2', slots: [
        { exercise: DL,   sets: 3, reps: '5', rest: 210, scheme: 'linear' },
        { exercise: OHP,  sets: 3, reps: '5', rest: 180, scheme: 'linear' },
        { exercise: PULL, sets: 3, reps: 'AMRAP', rest: 120 },
        { exercise: LEGP, sets: 3, reps: '10', rest: 90 },
      ]},
    ],
  },
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
  const STAMP = String(BUILT_IN.length) + ':4';
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
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          dayId, p.id, day.week ?? null,
          // Wave programs restart their day index each week, so week 2 day 1
          // sorts first within week 2 rather than fourth overall.
          day.week != null ? di % (p.daysPerWeek || 1) : di,
          day.name, day.note ?? null, ts,
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
