import raw from './exercises.json';

export type Tracking = 'weight_reps' | 'reps' | 'duration' | 'distance_duration';

export interface Exercise {
  id: string;
  name: string;
  aka: string[];
  primary: string[];
  secondary: string[];
  equipment: string;
  category: string;
  mechanic: string | null;
  force: string | null;
  level: string;
  tracking: Tracking;
  instructions: string[];
  /** Start and end position of the movement; the UI cross-fades between them. */
  frames: string[];
  rank: number;
}

export const EXERCISES = raw as Exercise[];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
export const getExercise = (id: string) => BY_ID.get(id);

/**
 * Search index, built once at module load (~873 entries, a few ms).
 * Each exercise collapses to a lowercase haystack of name + aliases + muscles
 * + equipment so a single pass can score everything.
 */
const INDEX = EXERCISES.map((e) => ({
  ex: e,
  name: e.name.toLowerCase(),
  hay: [e.name, ...e.aka, ...e.primary, ...e.secondary, e.equipment, e.category]
    .join(' ')
    .toLowerCase(),
}));

/**
 * Ranked substring search. Deliberately not fuzzy: a lifter typing "bench"
 * wants bench presses, not "Bent Over Row" scoring on shared letters. Every
 * query token must appear somewhere, and matches earlier in the name win.
 */
export function searchExercises(query: string, limit = 60): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return EXERCISES.slice(0, limit);

  const tokens = q.split(/\s+/);
  const hits: { ex: Exercise; score: number }[] = [];

  for (const entry of INDEX) {
    let score = 0;
    let matchedAll = true;

    for (const t of tokens) {
      if (entry.name.startsWith(t)) score += 100;
      else if (new RegExp(`\\b${escapeRe(t)}`).test(entry.name)) score += 60;
      else if (entry.name.includes(t)) score += 30;
      else if (entry.hay.includes(t)) score += 10;
      else { matchedAll = false; break; }
    }

    if (!matchedAll) continue;
    // Canonical lifts break ties, so "squat" leads with Barbell Squat.
    score += Math.max(0, 30 - entry.ex.rank);
    hits.push({ ex: entry.ex, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.ex.name.length - b.ex.name.length)
    .slice(0, limit)
    .map((h) => h.ex);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Filter facets, derived rather than hand-maintained so they can't drift. */
export const MUSCLES = [...new Set(EXERCISES.flatMap((e) => e.primary))].sort();
export const EQUIPMENT = [...new Set(EXERCISES.map((e) => e.equipment))].sort();

export function filterExercises(opts: {
  query?: string;
  muscle?: string | null;
  equipment?: string | null;
}): Exercise[] {
  let list = searchExercises(opts.query ?? '', 9999);
  if (opts.muscle) list = list.filter((e) => e.primary.includes(opts.muscle!));
  if (opts.equipment) list = list.filter((e) => e.equipment === opts.equipment);
  return list;
}

/** Human labels — the data's own strings are lowercase and inconsistent. */
export const LABEL: Record<string, string> = {
  bodyweight: 'Bodyweight', 'ez-bar': 'EZ Bar', 'stability-ball': 'Stability Ball',
  'foam-roller': 'Foam Roller', 'med-ball': 'Med Ball', kettlebell: 'Kettlebell',
  band: 'Bands', machine: 'Machine', cable: 'Cable', barbell: 'Barbell',
  dumbbell: 'Dumbbell', other: 'Other',
  abdominals: 'Abs', 'middle back': 'Mid Back', 'lower back': 'Lower Back',
};
export const label = (s: string) => LABEL[s] ?? s.replace(/\b\w/g, (c) => c.toUpperCase());
