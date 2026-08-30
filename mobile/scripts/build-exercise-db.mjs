/**
 * Builds src/data/exercises.json from free-exercise-db (Unlicense / public domain).
 *
 * Source gives each exercise two photographs: the start and end position of the
 * movement. We keep both — the app cross-fades between them, which reads as an
 * animated demonstration without shipping a single GIF. See ExerciseLoop.tsx.
 *
 * Run: node scripts/build-exercise-db.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const CDN = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises';

/** Movements people actually search for, ranked so they win the typeahead. */
const CANON = [
  'Barbell Squat', 'Barbell Bench Press - Medium Grip', 'Barbell Deadlift',
  'Barbell Full Squat', 'Standing Military Press', 'Pullups', 'Chin-Up',
  'Bent Over Barbell Row', 'Dumbbell Bench Press', 'Incline Dumbbell Press',
  'Romanian Deadlift', 'Front Barbell Squat', 'Dips - Triceps Version',
  'Barbell Curl', 'Leg Press', 'Wide-Grip Lat Pulldown', 'Seated Cable Rows',
  'Dumbbell Shoulder Press', 'Barbell Hip Thrust', 'Leg Extensions', 'Lying Leg Curls',
  'Pushups', 'Plank', 'Standing Calf Raises', 'Face Pull', 'Hammer Curls',
];

/** Equipment strings normalised to what a lifter would call them. */
const EQUIP = {
  'body only': 'bodyweight', 'e-z curl bar': 'ez-bar', 'exercise ball': 'stability-ball',
  'foam roll': 'foam-roller', 'medicine ball': 'med-ball', 'kettlebells': 'kettlebell',
  'bands': 'band', 'other': 'other', 'machine': 'machine', 'cable': 'cable',
  'barbell': 'barbell', 'dumbbell': 'dumbbell',
};

/**
 * How each movement is measured. This drives the logging UI: a set of squats
 * wants weight+reps, a plank wants duration, a run wants distance+duration.
 */
function trackingFor(ex) {
  const n = ex.name.toLowerCase();
  if (ex.category === 'cardio') return 'distance_duration';
  if (ex.category === 'stretching') return 'duration';
  if (/plank|hold|hang|plate pinch|plate wave|isometric/.test(n) || ex.force === 'static') return 'duration';
  if (ex.equipment === 'body only' && !/weighted/.test(n)) return 'reps';
  return 'weight_reps';
}

const res = await fetch(SRC);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const raw = await res.json();

const out = raw
  .filter((e) => e.images?.length > 0)
  .map((e) => ({
    id: e.id,
    name: e.name,
    // Alternate names people type instead of the canonical one.
    aka: aliasesFor(e.name),
    primary: e.primaryMuscles ?? [],
    secondary: e.secondaryMuscles ?? [],
    equipment: EQUIP[e.equipment] ?? e.equipment ?? 'other',
    category: e.category,
    mechanic: e.mechanic ?? null,
    force: e.force ?? null,
    level: e.level,
    tracking: trackingFor(e),
    instructions: e.instructions ?? [],
    frames: e.images.map((p) => `${CDN}/${p}`),
    rank: CANON.indexOf(e.name) === -1 ? 999 : CANON.indexOf(e.name),
  }))
  .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

function aliasesFor(name) {
  const a = [];
  const n = name.toLowerCase();
  if (n.includes('barbell bench press')) a.push('bench', 'bench press');
  if (n === 'barbell deadlift') a.push('deadlift', 'dl');
  if (n.includes('barbell squat') || n.includes('barbell full squat')) a.push('squat', 'back squat');
  if (n.includes('standing military press')) a.push('ohp', 'overhead press', 'strict press');
  if (n.includes('pullup') || n.includes('pull-up')) a.push('pull up');
  if (n.includes('romanian deadlift')) a.push('rdl');
  if (n.includes('front barbell squat')) a.push('front squat');
  if (n.includes('lat pulldown')) a.push('pulldown');
  return a;
}

mkdirSync(resolve(HERE, '../src/data'), { recursive: true });
writeFileSync(resolve(HERE, '../src/data/exercises.json'), JSON.stringify(out));

const by = (k) => out.reduce((m, e) => ((m[e[k]] = (m[e[k]] ?? 0) + 1), m), {});
console.log(`wrote ${out.length} exercises`);
console.log('tracking:', by('tracking'));
console.log('equipment:', Object.keys(by('equipment')).length, 'kinds');
