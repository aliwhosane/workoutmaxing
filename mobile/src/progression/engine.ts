import {
  estimate1RM, estimate1RMFromRpe, loadForReps, parseRepRange,
  roundToLoadable, sessionIncrement,
} from './math';
import type {
  LastSession, PerformedSet, ProgressionState, SchemeKind, SuggestInput, Suggestion,
} from './types';

/**
 * Progressive overload.
 *
 * Given what a lifter did last time, decide what to put in front of them now.
 * Every function here is pure — no database, no platform — so the rules can be
 * tested directly, which matters because getting these wrong means telling
 * someone to lift a weight they cannot lift.
 *
 * Two principles run through all of it:
 *
 *   1. **Never guess from nothing.** With no history the suggestion is null and
 *      the field stays empty for the user to fill. A made-up starting weight is
 *      worse than no weight at all.
 *   2. **Always explain.** Every suggestion carries a one-line reason, so the
 *      number is something the lifter can agree or disagree with rather than an
 *      instruction from a black box.
 */

/* ------------------------------------------------------------- judging a set */

const hitTarget = (s: PerformedSet): boolean =>
  s.completed && s.reps != null && s.targetReps != null && s.reps >= s.targetReps;

/** A session succeeds only if every working set met its prescription. */
const allSetsHit = (session: LastSession): boolean =>
  session.sets.length > 0 && session.sets.every(hitTarget);

const topSetOf = (session: LastSession): PerformedSet | null => {
  const done = session.sets.filter((s) => s.completed && s.weightKg != null);
  if (done.length === 0) return null;
  return done.reduce((best, s) => ((s.weightKg ?? 0) > (best.weightKg ?? 0) ? s : best));
};

const workingWeightOf = (session: LastSession): number | null =>
  topSetOf(session)?.weightKg ?? null;

/* ---------------------------------------------------------------- the entry */

export function suggest(input: SuggestInput): Suggestion {
  const state: ProgressionState = input.state ?? {
    exerciseId: '',
    programId: null,
    scheme: input.scheme,
    stage: 0,
    failures: 0,
    workingKg: null,
    trainingMaxKg: null,
  };

  // Nothing to go on. Leave it blank rather than inventing a number.
  if (!input.lastSession || input.lastSession.sets.length === 0) {
    const range = parseRepRange(input.targetReps);
    return {
      weightKg: state.workingKg,
      reps: range?.min ?? null,
      targetSets: input.targetSets,
      note: state.workingKg ? null : 'First time — log what you lift and we’ll take it from here',
      nextState: state,
    };
  }

  switch (input.scheme) {
    case 'linear':   return linear(input, state);
    case 'double':   return doubleProgression(input, state);
    case 'gzclp_t1': return gzclpT1(input, state);
    case 'gzclp_t2': return gzclpT2(input, state);
    case 'gzclp_t3': return gzclpT3(input, state);
    case 'rpe':      return rpe(input, state);
    case 'tm_percent': return trainingMaxPercent(input, state);
    default:         return hold(input, state);
  }
}

/* ------------------------------------------------------------------ linear */

/**
 * Add a fixed increment every time the prescription is met.
 *
 * After three consecutive misses the weight has stopped being real, so we cut
 * 10% — the standard reset. Deloading on the first miss would punish a bad
 * night's sleep; waiting longer than three just accumulates failed sessions.
 */
const LINEAR_DELOAD_AFTER = 3;
const DELOAD_FACTOR = 0.9;

function linear(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const last = workingWeightOf(session);
  const range = parseRepRange(input.targetReps);
  const step = sessionIncrement(input.unit, input.isLowerBody);

  if (last == null) return hold(input, state);

  if (allSetsHit(session)) {
    const next = roundToLoadable(last + step, input.unit);
    return {
      weightKg: next,
      reps: range?.min ?? null,
      targetSets: input.targetSets,
      note: `+${fmtStep(step, input.unit)} — you hit every rep last time`,
      nextState: { ...state, failures: 0, workingKg: next },
    };
  }

  const failures = state.failures + 1;
  if (failures >= LINEAR_DELOAD_AFTER) {
    const deloaded = roundToLoadable(last * DELOAD_FACTOR, input.unit);
    return {
      weightKg: deloaded,
      reps: range?.min ?? null,
      targetSets: input.targetSets,
      note: `Back off 10% — three misses in a row. Build up again from here`,
      nextState: { ...state, failures: 0, workingKg: deloaded },
    };
  }

  return {
    weightKg: last,
    reps: range?.min ?? null,
    targetSets: input.targetSets,
    note: `Same weight — go again for all ${range?.min ?? ''} reps`.trim(),
    nextState: { ...state, failures, workingKg: last },
  };
}

/* --------------------------------------------------------- double progression */

/**
 * Climb the rep range at a fixed load; once the top of the range is reached on
 * every set, add weight and drop back to the bottom.
 *
 * This is the right default for hypertrophy work, because it accumulates volume
 * before it adds load rather than forcing a jump the lifter hasn't earned.
 */
function doubleProgression(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const last = workingWeightOf(session);
  const range = parseRepRange(input.targetReps);
  if (last == null || !range) return hold(input, state);

  const everySetAtTop = session.sets.length > 0
    && session.sets.every((s) => s.completed && (s.reps ?? 0) >= range.max);

  if (everySetAtTop) {
    const step = sessionIncrement(input.unit, input.isLowerBody);
    const next = roundToLoadable(last + step, input.unit);
    return {
      weightKg: next,
      reps: range.min,
      targetSets: input.targetSets,
      note: `+${fmtStep(step, input.unit)} — you topped the range. Back to ${range.min} reps`,
      nextState: { ...state, failures: 0, workingKg: next },
    };
  }

  // Still climbing: aim for one more rep than the worst set managed.
  const lowest = Math.min(...session.sets.map((s) => s.reps ?? 0));
  const target = Math.min(range.max, Math.max(range.min, lowest + 1));
  return {
    weightKg: last,
    reps: target,
    targetSets: input.targetSets,
    note: `Same weight — chase ${target} reps, then add load at ${range.max}`,
    nextState: { ...state, workingKg: last },
  };
}

/* ------------------------------------------------------------------- GZCLP */

/**
 * GZCLP's tier system. Each tier keeps its own stage; failing a stage drops you
 * to the next, denser rep scheme at the same weight rather than deloading.
 *
 * T1: 5×3 → 6×2 → 10×1, then reset at 90%.
 * T2: 3×10 → 3×8 → 3×6, then restart at stage 1 with more weight than before.
 * T3: 3×15, add load once the last set clears 25 reps.
 */
export const GZCLP_T1_STAGES = [
  { sets: 5, reps: 3 },
  { sets: 6, reps: 2 },
  { sets: 10, reps: 1 },
];
export const GZCLP_T2_STAGES = [
  { sets: 3, reps: 10 },
  { sets: 3, reps: 8 },
  { sets: 3, reps: 6 },
];

function gzclpT1(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const last = workingWeightOf(session);
  if (last == null) return hold(input, state);

  const step = sessionIncrement(input.unit, input.isLowerBody);

  if (allSetsHit(session)) {
    const next = roundToLoadable(last + step, input.unit);
    const stage = GZCLP_T1_STAGES[state.stage] ?? GZCLP_T1_STAGES[0];
    return {
      weightKg: next,
      reps: stage.reps,
      targetSets: stage.sets,
      note: `+${fmtStep(step, input.unit)} — ${stage.sets}×${stage.reps}, last set AMRAP`,
      nextState: { ...state, failures: 0, workingKg: next },
    };
  }

  const nextStage = state.stage + 1;

  if (nextStage < GZCLP_T1_STAGES.length) {
    const stage = GZCLP_T1_STAGES[nextStage];
    return {
      weightKg: last,
      reps: stage.reps,
      targetSets: stage.sets,
      note: `Same weight, ${stage.sets}×${stage.reps} — more sets, fewer reps`,
      nextState: { ...state, stage: nextStage, failures: 0, workingKg: last },
    };
  }

  // Out of stages: reset to 90% and start the ladder again.
  const reset = roundToLoadable(last * DELOAD_FACTOR, input.unit);
  const stage = GZCLP_T1_STAGES[0];
  return {
    weightKg: reset,
    reps: stage.reps,
    targetSets: stage.sets,
    note: `Reset to 90% and back to ${stage.sets}×${stage.reps} — you've run this weight out`,
    nextState: { ...state, stage: 0, failures: 0, workingKg: reset },
  };
}

function gzclpT2(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const last = workingWeightOf(session);
  if (last == null) return hold(input, state);

  const step = sessionIncrement(input.unit, input.isLowerBody);

  if (allSetsHit(session)) {
    const next = roundToLoadable(last + step, input.unit);
    const stage = GZCLP_T2_STAGES[state.stage] ?? GZCLP_T2_STAGES[0];
    return {
      weightKg: next,
      reps: stage.reps,
      targetSets: stage.sets,
      note: `+${fmtStep(step, input.unit)} — ${stage.sets}×${stage.reps}`,
      nextState: { ...state, failures: 0, workingKg: next },
    };
  }

  const nextStage = state.stage + 1;
  if (nextStage < GZCLP_T2_STAGES.length) {
    const stage = GZCLP_T2_STAGES[nextStage];
    return {
      weightKg: last,
      reps: stage.reps,
      targetSets: stage.sets,
      note: `Same weight, ${stage.sets}×${stage.reps}`,
      nextState: { ...state, stage: nextStage, failures: 0, workingKg: last },
    };
  }

  /**
   * T2 restarts *above* where it began, not below: the lifter has proven the
   * weight for sixes, so stage 1 resumes with more than last cycle's tens.
   */
  const restart = roundToLoadable(last + step * 2, input.unit);
  const stage = GZCLP_T2_STAGES[0];
  return {
    weightKg: restart,
    reps: stage.reps,
    targetSets: stage.sets,
    note: `New cycle — back to ${stage.sets}×${stage.reps}, heavier than last time`,
    nextState: { ...state, stage: 0, failures: 0, workingKg: restart },
  };
}

/** T3 is accessory volume: the last set is AMRAP, and 25+ reps earns more load. */
const T3_REP_THRESHOLD = 25;

function gzclpT3(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const last = workingWeightOf(session);
  if (last == null) return hold(input, state);

  const finalSet = session.sets[session.sets.length - 1];
  const amrapReps = finalSet?.reps ?? 0;

  if (amrapReps >= T3_REP_THRESHOLD) {
    const step = sessionIncrement(input.unit, false); // accessories always move small
    const next = roundToLoadable(last + step, input.unit);
    return {
      weightKg: next,
      reps: 15,
      targetSets: input.targetSets,
      note: `+${fmtStep(step, input.unit)} — you cleared ${amrapReps} on the last set`,
      nextState: { ...state, workingKg: next },
    };
  }

  return {
    weightKg: last,
    reps: 15,
    targetSets: input.targetSets,
    note: `Same weight — ${T3_REP_THRESHOLD}+ on the last set earns more`,
    nextState: { ...state, workingKg: last },
  };
}

/* --------------------------------------------------------------------- RPE */

/**
 * Autoregulation. Rather than a fixed jump, we read how hard the last session
 * actually was and correct toward the target effort.
 *
 * The correction is the widely-used rule of thumb of about 4% of load per rep
 * away from target — enough to matter, small enough that a misjudged RPE
 * doesn't derail the next session.
 */
const PCT_PER_REP = 0.04;

function rpe(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const top = topSetOf(session);
  const range = parseRepRange(input.targetReps);
  const targetRpe = input.targetRpe ?? 8;

  if (!top || top.weightKg == null || top.reps == null) return hold(input, state);

  // No RPE reported: fall back to the estimate from the set itself.
  if (top.rpe == null) {
    const e1rm = estimate1RM(top.weightKg, top.reps);
    const targetReps = range?.min ?? top.reps;
    const rirTarget = Math.max(0, 10 - targetRpe);
    const load = roundToLoadable(loadForReps(e1rm, targetReps + rirTarget), input.unit);
    return {
      weightKg: load,
      reps: targetReps,
      targetSets: input.targetSets,
      note: `Sized from your last set — aiming for RPE ${targetRpe}`,
      nextState: { ...state, workingKg: load, trainingMaxKg: e1rm },
    };
  }

  const offBy = targetRpe - top.rpe;          // positive = last set was too easy
  const adjusted = top.weightKg * (1 + offBy * PCT_PER_REP);
  const next = roundToLoadable(adjusted, input.unit);
  const e1rm = estimate1RMFromRpe(top.weightKg, top.reps, top.rpe);

  return {
    weightKg: next,
    reps: range?.min ?? top.reps,
    targetSets: input.targetSets,
    note:
      Math.abs(offBy) < 0.25
        ? `Same weight — last session landed right on RPE ${targetRpe}`
        : offBy > 0
          ? `+${fmtStep(next - top.weightKg, input.unit)} — last session came in under RPE ${targetRpe}`
          : `${fmtStep(next - top.weightKg, input.unit)} — last session went past RPE ${targetRpe}`,
    nextState: { ...state, workingKg: next, trainingMaxKg: e1rm },
  };
}

/* -------------------------------------------------- percentage of training max */

/**
 * 5/3/1 and its descendants (nSuns, BBB).
 *
 * Load is a fixed percentage of a *training max* — deliberately 90% of a true
 * 1RM, so the prescribed weights are always achievable even on a bad day and
 * the AMRAP set has room to be meaningful.
 *
 * The training max, not the session weight, is what progresses. How far it
 * moves is decided by the AMRAP set: a top set that produced six reps has
 * earned more than one that produced two. These thresholds are nSuns' and are
 * expressed in plate steps so they read correctly in either unit.
 */
const TM_FACTOR = 0.9;

function trainingMaxPercent(input: SuggestInput, state: ProgressionState): Suggestion {
  const session = input.lastSession!;
  const top = topSetOf(session);
  const pct = input.intensityPct ?? 1;
  const step = plateStepFor(input);

  // Establish a training max the first time, from the best set on record.
  let tm = state.trainingMaxKg;
  if (tm == null) {
    const basis = top && top.weightKg != null && top.reps != null
      ? estimate1RM(top.weightKg, top.reps)
      : input.seedOneRepMaxKg ?? null;
    if (basis == null) return hold(input, state);
    tm = basis * TM_FACTOR;
  }

  /**
   * The AMRAP set is the last set of the heaviest work, and its rep count is
   * the whole signal. Fewer than the prescribed minimum means the training max
   * has drifted above what is real, and it comes back down.
   */
  const amrap = session.sets[session.sets.length - 1];
  const reps = amrap?.reps ?? 0;
  const prescribed = parseRepRange(input.targetReps)?.min ?? 1;

  let delta = 0;
  let why: string;
  if (reps >= prescribed + 5)      { delta = step * 3; why = `${reps} reps on the top set`; }
  else if (reps >= prescribed + 3) { delta = step * 2; why = `${reps} reps on the top set`; }
  else if (reps >= prescribed + 1) { delta = step;     why = `${reps} reps on the top set`; }
  else if (reps >= prescribed)     { delta = 0;        why = `holding — you met the minimum`; }
  else                             { delta = -step * 2; why = `easing off — the top set fell short`; }

  const nextTm = Math.max(step, tm + delta);
  const weight = roundToLoadable(nextTm * pct, input.unit);

  return {
    weightKg: weight,
    reps: prescribed,
    targetSets: input.targetSets,
    note: `${Math.round(pct * 100)}% of a ${fmtWeight(nextTm, input.unit)} training max — ${why}`,
    nextState: { ...state, trainingMaxKg: nextTm, workingKg: weight, failures: 0 },
  };
}

/** The plate step in kilograms for whichever unit the lifter is using. */
const plateStepFor = (input: SuggestInput) => sessionIncrement(input.unit, false);

function fmtWeight(kg: number, unit: 'kg' | 'lb'): string {
  const v = unit === 'kg' ? kg : kg * 2.2046226218487757;
  return `${Math.round(v)} ${unit}`;
}

/* -------------------------------------------------------------------- hold */

function hold(input: SuggestInput, state: ProgressionState): Suggestion {
  const last = input.lastSession ? workingWeightOf(input.lastSession) : null;
  const range = parseRepRange(input.targetReps);
  return {
    weightKg: last ?? state.workingKg,
    reps: range?.min ?? null,
    targetSets: input.targetSets,
    note: null,
    nextState: { ...state, workingKg: last ?? state.workingKg },
  };
}

/* ------------------------------------------------------------------ helper */

/** Formats a kilogram delta in the user's unit, e.g. "2.5 kg" or "5 lb". */
function fmtStep(kg: number, unit: 'kg' | 'lb'): string {
  const value = unit === 'kg' ? kg : kg * 2.2046226218487757;
  const rounded = Number(value.toFixed(1));
  return `${rounded} ${unit}`;
}
