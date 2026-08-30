import type { WeightUnit } from '../settings/units';

/**
 * Estimated one-rep max.
 *
 * Two formulas, each used where it is actually accurate. Brzycki is more
 * precise at 1–5 reps; Epley is the better general estimator and holds up
 * further into the mid ranges. Both degrade badly past ~10 reps, where
 * endurance rather than strength starts limiting the set — hence `confidence`.
 */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg;
  return reps <= 5
    ? weightKg * (36 / (37 - reps))   // Brzycki
    : weightKg * (1 + reps / 30);     // Epley
}

/**
 * How much to trust an estimate. Above ten reps the published error widens to
 * roughly ±15–20%, so we mark it low and the UI declines to make confident
 * claims off the back of it.
 */
export const estimateConfidence = (reps: number): 'high' | 'medium' | 'low' =>
  reps <= 5 ? 'high' : reps <= 10 ? 'medium' : 'low';

/** Load at a given rep count, inverted from the same curves. */
export function loadForReps(oneRepMaxKg: number, reps: number): number {
  if (reps <= 1) return oneRepMaxKg;
  return reps <= 5
    ? oneRepMaxKg * ((37 - reps) / 36)
    : oneRepMaxKg / (1 + reps / 30);
}

/**
 * RPE to reps-in-reserve. RPE 10 is a set with nothing left; every half point
 * below that is half a rep in reserve.
 */
export const rirFromRpe = (rpe: number): number => Math.max(0, 10 - rpe);

/**
 * e1RM from a set taken short of failure: a set of 5 at RPE 8 tells us as much
 * as a set of 7 to failure would, so we estimate from the equivalent.
 */
export const estimate1RMFromRpe = (weightKg: number, reps: number, rpe: number): number =>
  estimate1RM(weightKg, reps + rirFromRpe(rpe));

/* --------------------------------------------------------------- rounding */

/**
 * The smallest real jump on a barbell: a pair of 1.25 kg plates, or a pair of
 * 2.5 lb plates. Suggesting 63.7 kg is useless — nobody can load it — so every
 * number this engine produces is rounded to something that exists in a gym.
 */
export const plateStep = (unit: WeightUnit): number =>
  unit === 'kg' ? 2.5 : 5 * 0.45359237;

/** Rounds a kilogram value to the nearest loadable weight in the user's unit. */
export function roundToLoadable(kg: number, unit: WeightUnit): number {
  const step = plateStep(unit);
  return Math.round(kg / step) * step;
}

/**
 * The standard session-to-session jump. Lower-body lifts move in bigger steps
 * than upper-body ones because they are stronger and recover a bigger absolute
 * increase — this is the 5/10 lb (2.5/5 kg) convention every linear program uses.
 */
export const sessionIncrement = (unit: WeightUnit, isLowerBody: boolean): number =>
  plateStep(unit) * (isLowerBody ? 2 : 1);

/* ------------------------------------------------------------ prescription */

/** "8" → {min:8,max:8}; "8-12" → {min:8,max:12}; "AMRAP" → null. */
export function parseRepRange(spec: string | null): { min: number; max: number } | null {
  if (!spec) return null;
  const range = spec.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = spec.match(/\d+/);
  return single ? { min: Number(single[0]), max: Number(single[0]) } : null;
}
