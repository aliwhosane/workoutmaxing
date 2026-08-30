import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../engine';
import { estimate1RM, roundToLoadable, plateStep, parseRepRange } from '../math';
import type { LastSession, SuggestInput } from '../types';

/** A session where every set hit its target. */
const hit = (weightKg: number, reps: number, sets = 3, targetReps = reps): LastSession => ({
  performedAt: Date.now(),
  sets: Array.from({ length: sets }, () => ({
    weightKg, reps, targetReps, completed: true,
  })),
});

/** A session where the last set fell short. */
const missed = (weightKg: number, reps: number, targetReps: number, sets = 3): LastSession => ({
  performedAt: Date.now(),
  sets: Array.from({ length: sets }, (_, i) => ({
    weightKg,
    reps: i === sets - 1 ? reps - 1 : reps,
    targetReps,
    completed: true,
  })),
});

const base = (over: Partial<SuggestInput>): SuggestInput => ({
  scheme: 'linear',
  unit: 'kg',
  isLowerBody: false,
  targetSets: 3,
  targetReps: '5',
  state: null,
  lastSession: null,
  ...over,
});

/* ------------------------------------------------------------ no history */

test('with no history it suggests nothing rather than inventing a weight', () => {
  const s = suggest(base({ lastSession: null }));
  assert.equal(s.weightKg, null);
  assert.match(s.note ?? '', /First time/);
});

/* ---------------------------------------------------------------- linear */

test('linear adds the upper-body increment after a clean session', () => {
  const s = suggest(base({ lastSession: hit(60, 5), isLowerBody: false }));
  assert.equal(s.weightKg, 62.5);
  assert.equal(s.reps, 5);
});

test('linear adds double the increment for lower-body lifts', () => {
  const s = suggest(base({ lastSession: hit(100, 5), isLowerBody: true }));
  assert.equal(s.weightKg, 105);
});

test('linear holds the weight after a single miss', () => {
  const s = suggest(base({ lastSession: missed(60, 5, 5) }));
  assert.equal(s.weightKg, 60);
  assert.equal(s.nextState.failures, 1);
});

test('linear deloads 10% on the third consecutive miss', () => {
  let state = suggest(base({ lastSession: missed(100, 5, 5) })).nextState;
  state = suggest(base({ lastSession: missed(100, 5, 5), state })).nextState;
  const third = suggest(base({ lastSession: missed(100, 5, 5), state }));

  assert.equal(third.weightKg, 90);
  assert.equal(third.nextState.failures, 0, 'failure count resets after a deload');
  assert.match(third.note ?? '', /10%/);
});

test('a successful session clears accumulated failures', () => {
  const state = suggest(base({ lastSession: missed(60, 5, 5) })).nextState;
  const s = suggest(base({ lastSession: hit(60, 5), state }));
  assert.equal(s.nextState.failures, 0);
});

/* ------------------------------------------------------ double progression */

test('double progression adds load only once every set tops the range', () => {
  const s = suggest(base({
    scheme: 'double', targetReps: '8-12', lastSession: hit(40, 12, 3, 12),
  }));
  assert.equal(s.weightKg, 42.5);
  assert.equal(s.reps, 8, 'reps reset to the bottom of the range');
});

test('double progression holds load and chases one more rep mid-range', () => {
  const s = suggest(base({
    scheme: 'double', targetReps: '8-12', lastSession: hit(40, 9, 3, 12),
  }));
  assert.equal(s.weightKg, 40);
  assert.equal(s.reps, 10);
});

test('double progression does not add load when only some sets topped out', () => {
  const session: LastSession = {
    performedAt: Date.now(),
    sets: [
      { weightKg: 40, reps: 12, targetReps: 12, completed: true },
      { weightKg: 40, reps: 12, targetReps: 12, completed: true },
      { weightKg: 40, reps: 9,  targetReps: 12, completed: true },
    ],
  };
  const s = suggest(base({ scheme: 'double', targetReps: '8-12', lastSession: session }));
  assert.equal(s.weightKg, 40, 'the weakest set governs');
});

/* ----------------------------------------------------------------- GZCLP */

test('GZCLP T1 advances the weight while the stage holds', () => {
  const s = suggest(base({
    scheme: 'gzclp_t1', targetSets: 5, targetReps: '3',
    lastSession: hit(100, 3, 5), isLowerBody: true,
  }));
  assert.equal(s.weightKg, 105);
  assert.equal(s.targetSets, 5);
  assert.equal(s.reps, 3);
});

test('GZCLP T1 drops to the next stage on failure, keeping the weight', () => {
  const s = suggest(base({
    scheme: 'gzclp_t1', targetSets: 5, targetReps: '3',
    lastSession: missed(100, 3, 3, 5),
  }));
  assert.equal(s.weightKg, 100);
  assert.equal(s.nextState.stage, 1);
  assert.equal(s.targetSets, 6);
  assert.equal(s.reps, 2, 'stage two is 6x2');
});

test('GZCLP T1 resets to 90% after the final stage fails', () => {
  const state = { ...suggest(base({ scheme: 'gzclp_t1' })).nextState, stage: 2 };
  const s = suggest(base({
    scheme: 'gzclp_t1', targetSets: 10, targetReps: '1',
    lastSession: missed(100, 1, 1, 10), state,
  }));
  assert.equal(s.weightKg, 90);
  assert.equal(s.nextState.stage, 0);
  assert.equal(s.targetSets, 5, 'back to the first stage');
});

test('GZCLP T2 restarts heavier than the cycle it just finished', () => {
  const state = { ...suggest(base({ scheme: 'gzclp_t2' })).nextState, stage: 2 };
  const s = suggest(base({
    scheme: 'gzclp_t2', targetSets: 3, targetReps: '6',
    lastSession: missed(80, 6, 6, 3), state,
  }));
  assert.ok(s.weightKg! > 80, 'a finished T2 cycle resumes above where it ended');
  assert.equal(s.reps, 10);
});

test('GZCLP T3 adds load once the AMRAP set clears 25', () => {
  const session: LastSession = {
    performedAt: Date.now(),
    sets: [
      { weightKg: 30, reps: 15, targetReps: 15, completed: true },
      { weightKg: 30, reps: 15, targetReps: 15, completed: true },
      { weightKg: 30, reps: 27, targetReps: 15, completed: true },
    ],
  };
  const s = suggest(base({ scheme: 'gzclp_t3', targetReps: '15', lastSession: session }));
  assert.equal(s.weightKg, 32.5);
});

test('GZCLP T3 holds below the 25-rep threshold', () => {
  const session: LastSession = {
    performedAt: Date.now(),
    sets: [
      { weightKg: 30, reps: 15, targetReps: 15, completed: true },
      { weightKg: 30, reps: 18, targetReps: 15, completed: true },
    ],
  };
  const s = suggest(base({ scheme: 'gzclp_t3', targetReps: '15', lastSession: session }));
  assert.equal(s.weightKg, 30);
});

/* ------------------------------------------------------------------- RPE */

test('RPE raises the load when the last session came in easy', () => {
  const session: LastSession = {
    performedAt: Date.now(),
    sets: [{ weightKg: 100, reps: 5, targetReps: 5, rpe: 6, completed: true }],
  };
  const s = suggest(base({ scheme: 'rpe', targetRpe: 8, lastSession: session }));
  assert.ok(s.weightKg! > 100, `expected an increase, got ${s.weightKg}`);
});

test('RPE cuts the load when the last session went past target', () => {
  const session: LastSession = {
    performedAt: Date.now(),
    sets: [{ weightKg: 100, reps: 5, targetReps: 5, rpe: 10, completed: true }],
  };
  const s = suggest(base({ scheme: 'rpe', targetRpe: 8, lastSession: session }));
  assert.ok(s.weightKg! < 100, `expected a decrease, got ${s.weightKg}`);
});

test('RPE holds when the last session landed on target', () => {
  const session: LastSession = {
    performedAt: Date.now(),
    sets: [{ weightKg: 100, reps: 5, targetReps: 5, rpe: 8, completed: true }],
  };
  const s = suggest(base({ scheme: 'rpe', targetRpe: 8, lastSession: session }));
  assert.equal(s.weightKg, 100);
});

/* -------------------------------------------------- invariants across all */

test('any weight the engine changes lands on something loadable', () => {
  const schemes = ['linear', 'double', 'gzclp_t1', 'gzclp_t2', 'gzclp_t3', 'rpe'] as const;
  for (const unit of ['kg', 'lb'] as const) {
    const step = plateStep(unit);
    for (const scheme of schemes) {
      for (const w of [42.5, 60, 77.5, 100, 142.5]) {
        for (const session of [hit(w, 5, 3), missed(w, 5, 5, 3)]) {
          const s = suggest(base({ scheme, unit, lastSession: session, targetReps: '5-8' }));
          if (s.weightKg == null || s.weightKg === w) continue; // holds are exempt, see below
          const remainder = Math.abs(s.weightKg / step - Math.round(s.weightKg / step));
          assert.ok(
            remainder < 1e-9,
            `${scheme}/${unit}: ${s.weightKg} is not a multiple of ${step}`,
          );
        }
      }
    }
  }
});

test('holding a weight reproduces exactly what was lifted, off-grid or not', () => {
  // A lifter who logged 42.5 kg and then switched their display to pounds is
  // holding 93.7 lb. Snapping that to a "loadable" 95 lb would be telling them
  // to add weight they never lifted, so a hold passes the real number through.
  const s = suggest(base({ unit: 'lb', lastSession: missed(42.5, 5, 5) }));
  assert.equal(s.weightKg, 42.5);
});

test('a suggestion never silently jumps more than 20% in one session', () => {
  const schemes = ['linear', 'double', 'gzclp_t1', 'gzclp_t2', 'gzclp_t3', 'rpe'] as const;
  for (const scheme of schemes) {
    for (const session of [hit(100, 5, 3), missed(100, 5, 5, 3)]) {
      const s = suggest(base({ scheme, lastSession: session, targetReps: '5-8' }));
      if (s.weightKg == null) continue;
      const change = Math.abs(s.weightKg - 100) / 100;
      assert.ok(change <= 0.2, `${scheme} moved ${(change * 100).toFixed(1)}% in one step`);
    }
  }
});

/* ------------------------------------------------------------------ math */

test('1RM estimates match the published formulas', () => {
  // Brzycki at 5 reps: 100 * 36/32 = 112.5
  assert.equal(Math.round(estimate1RM(100, 5) * 10) / 10, 112.5);
  // Epley at 10 reps: 100 * (1 + 10/30) = 133.3
  assert.equal(Math.round(estimate1RM(100, 10) * 10) / 10, 133.3);
  // A single is its own max under both.
  assert.equal(estimate1RM(140, 1), 140);
});

test('rep prescriptions parse into ranges', () => {
  assert.deepEqual(parseRepRange('5'), { min: 5, max: 5 });
  assert.deepEqual(parseRepRange('8-12'), { min: 8, max: 12 });
  assert.equal(parseRepRange('AMRAP'), null);
  assert.equal(parseRepRange(null), null);
});

test('rounding snaps to the plate step in both units', () => {
  assert.equal(roundToLoadable(63.7, 'kg'), 62.5);
  assert.equal(roundToLoadable(64, 'kg'), 65);
  const lb = roundToLoadable(100, 'lb') / 0.45359237;
  assert.ok(Math.abs(lb - Math.round(lb / 5) * 5) < 1e-9, 'lb results land on 5 lb steps');
});
