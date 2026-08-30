import { useSyncExternalStore } from 'react';
import { getDb, uuid, now } from '../db/client';

/**
 * The plan under construction.
 *
 * Kept in module state rather than a database draft: a half-built program is
 * not something the user should be able to accidentally start, and it should
 * not appear in their plan list until they say it is finished. Small enough
 * that useSyncExternalStore beats pulling in a state library.
 */

export interface DraftSlot { key: string; exerciseId: string; sets: number; reps: string; rest: number }
export interface DraftDay { key: string; name: string; slots: DraftSlot[] }
export interface Draft { name: string; days: DraftDay[] }

/**
 * Draft keys only need to be unique within this one editing session — they are
 * never written to the database, which mints its own ids on save. A counter
 * keeps module initialisation free of any native call, so importing this file
 * can never fail before the app has finished booting.
 */
let seq = 0;
const key = () => `d${++seq}`;

function emptyDraft(): Draft {
  return { name: '', days: [{ key: key(), name: 'Day 1', slots: [] }] };
}

let draft: Draft = emptyDraft();
const listeners = new Set<() => void>();

function emit() {
  draft = { ...draft, days: [...draft.days] };
  listeners.forEach((l) => l());
}

export function useDraft(): Draft {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => draft,
  );
}

export const draftActions = {
  reset() { draft = emptyDraft(); emit(); },

  setName(name: string) { draft.name = name; emit(); },

  addDay() {
    draft.days.push({ key: key(), name: `Day ${draft.days.length + 1}`, slots: [] });
    emit();
  },

  renameDay(dayKey: string, name: string) {
    const d = draft.days.find((x) => x.key === dayKey);
    if (d) { d.name = name; emit(); }
  },

  removeDay(dayKey: string) {
    draft.days = draft.days.filter((d) => d.key !== dayKey);
    if (draft.days.length === 0) draft.days.push({ key: key(), name: 'Day 1', slots: [] });
    emit();
  },

  addExercise(dayKey: string, exerciseId: string) {
    const d = draft.days.find((x) => x.key === dayKey);
    if (!d) return;
    d.slots.push({ key: key(), exerciseId, sets: 3, reps: '8-12', rest: 120 });
    emit();
  },

  updateSlot(dayKey: string, slotKey: string, patch: Partial<DraftSlot>) {
    const s = draft.days.find((x) => x.key === dayKey)?.slots.find((x) => x.key === slotKey);
    if (s) { Object.assign(s, patch); emit(); }
  },

  removeSlot(dayKey: string, slotKey: string) {
    const d = draft.days.find((x) => x.key === dayKey);
    if (!d) return;
    d.slots = d.slots.filter((s) => s.key !== slotKey);
    emit();
  },
};

/** Which day the exercise picker should add to when it returns. */
let pendingDayKey: string | null = null;
export const setPendingDay = (key: string | null) => { pendingDayKey = key; };
export const takePendingDay = () => { const k = pendingDayKey; pendingDayKey = null; return k; };

/** Writes the draft out as a real program the user can start. */
export async function saveDraft(): Promise<string> {
  const d = await getDb();
  const ts = now();
  const programId = uuid();
  const name = draft.name.trim() || 'My Plan';

  await d.withTransactionAsync(async () => {
    await d.runAsync(
      `INSERT INTO program (id, name, author, description, origin, goal, days_per_week, weeks, accent, updated_at, dirty)
       VALUES (?, ?, 'You', NULL, 'user', 'general', ?, NULL, ?, ?, 1)`,
      programId, name, draft.days.length, '#D6FF3F', ts,
    );

    for (const [di, day] of draft.days.entries()) {
      const dayId = uuid();
      await d.runAsync(
        `INSERT INTO program_day (id, program_id, week, day_index, name, updated_at, dirty)
         VALUES (?, ?, NULL, ?, ?, ?, 1)`,
        dayId, programId, di, day.name, ts,
      );
      for (const [si, slot] of day.slots.entries()) {
        await d.runAsync(
          `INSERT INTO program_slot
             (id, day_id, exercise_id, position, target_sets, target_reps, rest_seconds, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          uuid(), dayId, slot.exerciseId, si, slot.sets, slot.reps, slot.rest, ts,
        );
      }
    }
  });

  draftActions.reset();
  return programId;
}
