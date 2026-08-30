import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../importProgram';

/** Stands in for the catalogue: echoes the query so matching is observable. */
const resolve = (q: string) =>
  /squat|bench|deadlift|press|row|curl|pulldown/i.test(q) ? `id:${q.toLowerCase()}` : null;

test('reads a plain day with sets and reps', () => {
  const p = parseProgram(`Day 1 — Lower
Squat 5x5
Deadlift 1x5`, resolve);

  assert.equal(p.days.length, 1);
  assert.equal(p.days[0].name, 'Lower');
  assert.equal(p.days[0].slots.length, 2);
  assert.equal(p.days[0].slots[0].sets, 5);
  assert.equal(p.days[0].slots[0].reps, '5');
});

test('picks up the program name and author from headers', () => {
  const p = parseProgram(`Name: Bullmastiff
Author: Alex Bromley
Day 1
Squat 5x5`, resolve);
  assert.equal(p.name, 'Bullmastiff');
  assert.equal(p.author, 'Alex Bromley');
});

test('reads percentages, RPE and rest', () => {
  const p = parseProgram(`Day 1
Squat 3x5 @75% rest 180
Bench 3x8 RPE 8 rest 2min`, resolve);

  const [squat, bench] = p.days[0].slots;
  assert.equal(squat.pct, 0.75);
  assert.equal(squat.restSeconds, 180);
  assert.equal(bench.rpe, 8);
  assert.equal(bench.restSeconds, 120, 'minutes convert to seconds');
});

test('handles the rep notations lifters actually write', () => {
  const p = parseProgram(`Day 1
Squat 3x8-12
Bench 1x5+
Row 3xAMRAP
Press 5 × 3`, resolve);

  const reps = p.days[0].slots.map((s) => s.reps);
  assert.deepEqual(reps, ['8-12', '5', 'AMRAP', '3']);
});

test('separates weeks', () => {
  const p = parseProgram(`Week 1
Day 1
Squat 5x5 @65%
Week 2
Day 1
Squat 5x3 @70%`, resolve);

  assert.equal(p.days.length, 2);
  assert.equal(p.days[0].week, 1);
  assert.equal(p.days[1].week, 2);
  assert.equal(p.days[1].slots[0].pct, 0.70);
});

test('strips list bullets and numbering from exercise names', () => {
  const p = parseProgram(`Day 1
1. Barbell Squat 5x5
- Bench Press 3x8
• Barbell Row 3x10`, resolve);

  const names = p.days[0].slots.map((s) => s.exerciseQuery);
  assert.deepEqual(names, ['Barbell Squat', 'Bench Press', 'Barbell Row']);
});

test('treats a trailing parenthetical as a coaching note', () => {
  const p = parseProgram(`Day 1
Squat 5x3 (last set AMRAP)`, resolve);
  assert.equal(p.days[0].slots[0].note, 'last set AMRAP');
  assert.equal(p.days[0].slots[0].exerciseQuery, 'Squat');
});

test('warns rather than silently dropping an unmatched exercise', () => {
  const p = parseProgram(`Day 1
Squat 5x5
Zercher Yoke Carry 3x20`, resolve);

  assert.equal(p.days[0].slots.length, 2, 'the slot is still kept');
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0].reason, /no exercise matches/);
  assert.equal(p.warnings[0].line, 3, 'warnings point at the original line');
});

test('a bare title with no Day prefix starts a day, anywhere in the paste', () => {
  const p = parseProgram(`Upper Power
Bench Press 4x5
Lower Power
Squat 4x5`, resolve);

  assert.equal(p.days.length, 2);
  assert.deepEqual(p.days.map((d) => d.name), ['Upper Power', 'Lower Power']);
});

test('a heading that happens to look like an exercise is still a heading', () => {
  // "Lower Power" resolves to Power Clean under a naive match, which would
  // bury the whole second day inside the first.
  const p = parseProgram(`Upper Power
Bench Press 4x5
Lower Power
Barbell Squat 4x5
Leg Press 3x12`, (q) => (/power clean|bench|squat|press/i.test(q) ? `id:${q}` : null));

  assert.equal(p.days.length, 2);
  assert.equal(p.days[1].name, 'Lower Power');
  assert.equal(p.days[1].slots.length, 2);
});

test('ignores blank lines and separator rules', () => {
  const p = parseProgram(`Day 1

-------
Squat 5x5

`, resolve);
  assert.equal(p.days.length, 1);
  assert.equal(p.days[0].slots.length, 1);
});

test('drops days that ended up with nothing in them', () => {
  const p = parseProgram(`Day 1
Squat 5x5
Day 2 (rest)`, resolve);
  assert.equal(p.days.length, 1);
});

test('survives a realistic messy paste', () => {
  const p = parseProgram(`Program: 5/3/1 for Beginners
Coach: Jim Wendler

Week 1
Day 1 — Squat & Bench
1. Squat 1x5 @65%
2. Squat 1x5 @75%
3. Squat 1x5+ @85%   (top set AMRAP)
4. Squat 5x5 @65%  rest 150
5. Bench Press 1x5 @65%

Day 2 — Deadlift & Press
Deadlift 1x5 @65%
Overhead Press 1x5 @65%`, resolve);

  assert.equal(p.name, '5/3/1 for Beginners');
  assert.equal(p.author, 'Jim Wendler');
  assert.equal(p.days.length, 2);
  assert.equal(p.days[0].slots.length, 5);
  assert.equal(p.days[0].slots[2].reps, '5');
  assert.equal(p.days[0].slots[2].note, 'top set AMRAP');
  assert.equal(p.days[0].slots[3].restSeconds, 150);
  assert.equal(p.days[0].week, 1);
});
