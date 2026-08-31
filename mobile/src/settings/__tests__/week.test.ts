import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfWeek } from '../week';

const at = (iso: string) => new Date(iso);
const show = (ms: number) => new Date(ms).toString().slice(0, 21);

test('a week starts on Monday at local midnight', () => {
  // Wednesday 2 September 2026, mid-afternoon.
  const start = new Date(startOfWeek(at('2026-09-02T15:30:00')));
  assert.equal(start.getDay(), 1, 'Monday');
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getDate(), 31, '31 August is that Monday');
});

test('Monday morning starts its own week, not the previous one', () => {
  // The case a rolling 168-hour window gets wrong: at 09:00 on Monday it would
  // reach back to 09:00 the previous Monday and count last week's sessions.
  const monday = at('2026-08-31T09:00:00');
  const start = startOfWeek(monday);
  assert.equal(new Date(start).getDate(), 31);
  assert.ok(start <= monday.getTime(), 'never in the future');
  assert.ok(monday.getTime() - start < 24 * 3600e3, 'less than a day back');
});

test('Sunday belongs to the week that began six days earlier', () => {
  const start = new Date(startOfWeek(at('2026-09-06T23:59:00'))); // a Sunday
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 31, 'still the 31 August week');
});

test('every day of one week resolves to the same boundary', () => {
  const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
                '2026-09-04', '2026-09-05', '2026-09-06'];
  const starts = new Set(days.map((d) => startOfWeek(at(`${d}T12:00:00`))));
  assert.equal(starts.size, 1, `expected one boundary, got ${[...starts].map(show)}`);
});

test('the boundary moves on when the week does', () => {
  const thisWeek = startOfWeek(at('2026-09-06T12:00:00')); // Sunday
  const nextWeek = startOfWeek(at('2026-09-07T12:00:00')); // Monday
  assert.ok(nextWeek > thisWeek);
  assert.equal((nextWeek - thisWeek) / 3600e3, 24 * 7, 'exactly seven days apart');
});
