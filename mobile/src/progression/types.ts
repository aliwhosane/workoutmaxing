import type { WeightUnit } from '../settings/units';

/**
 * How a program advances load over time.
 *
 * Each scheme is a real, published method rather than something invented here,
 * because a lifter following GZCLP expects GZCLP's actual rules — not an
 * approximation of them.
 */
export type SchemeKind =
  /** Add a fixed increment every session the prescription is met. Novice LP, Madcow. */
  | 'linear'
  /** Climb the rep range first, then add load and reset to the bottom. PHUL, PPL, U/L. */
  | 'double'
  /** GZCLP's tiered stage progression: fail a stage, drop to the next rep scheme. */
  | 'gzclp_t1' | 'gzclp_t2' | 'gzclp_t3'
  /** Autoregulated: hold a target RPE, correcting load by how far off the last set landed. */
  | 'rpe'
  /** Hold whatever was done last time. The honest default when nothing else applies. */
  | 'hold';

export interface ProgressionState {
  exerciseId: string;
  programId: string | null;
  scheme: SchemeKind;
  /** Stage index within a staged scheme (GZCLP). 0 is the first stage. */
  stage: number;
  /** Consecutive sessions where the prescription was missed. Drives deloads. */
  failures: number;
  /** The load the scheme is currently working from, in kilograms. */
  workingKg: number | null;
  /** For percentage-based schemes. Not yet used by any built-in program. */
  trainingMaxKg: number | null;
}

/** One set as actually performed, paired with what was asked for. */
export interface PerformedSet {
  weightKg: number | null;
  reps: number | null;
  /** What the program prescribed for this set, so we can judge success. */
  targetReps: number | null;
  /** User-reported RPE, when the scheme asks for it. */
  rpe?: number | null;
  completed: boolean;
}

export interface LastSession {
  performedAt: number;
  sets: PerformedSet[];
}

export interface SuggestInput {
  scheme: SchemeKind;
  /** Only used to pick a sensible plate jump — never to store anything. */
  unit: WeightUnit;
  /** Lower-body lifts take double the jump of upper-body ones. */
  isLowerBody: boolean;
  targetSets: number;
  /** The prescription as written: "5", "8-12", "AMRAP". */
  targetReps: string | null;
  targetRpe?: number | null;
  state: ProgressionState | null;
  lastSession: LastSession | null;
}

export interface Suggestion {
  /** null means "we genuinely don't know yet" — the field is left empty. */
  weightKg: number | null;
  reps: number | null;
  targetSets: number;
  /**
   * A short plain-language reason, shown next to the exercise. The user should
   * always be able to see why a number was suggested, and disagree with it.
   */
  note: string | null;
  nextState: ProgressionState;
}
