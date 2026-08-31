/**
 * Unit conversion and formatting.
 *
 * The single rule this file exists to enforce: **the database is always
 * canonical** — kilograms, metres, seconds — and units are purely a display
 * concern. Switching from kg to lb re-renders numbers; it never migrates a row.
 * That means the choice is free to change at any time, cannot corrupt history,
 * and two devices with different unit settings show the same data correctly.
 */

export type WeightUnit = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi';

const LB_PER_KG = 2.2046226218487757;
const KG_PER_LB = 0.45359237;
const MI_PER_KM = 0.621371192237334;

/* ------------------------------------------------------------------ weight */

export const kgToDisplay = (kg: number, unit: WeightUnit) =>
  unit === 'kg' ? kg : kg * LB_PER_KG;

export const displayToKg = (value: number, unit: WeightUnit) =>
  unit === 'kg' ? value : value * KG_PER_LB;

/**
 * The smallest change a user can actually make on the gym floor: 2.5 kg is a
 * pair of 1.25 kg plates, 5 lb is a pair of 2.5s. Steppers and plate maths use
 * this so incrementing never produces a weight nobody can load.
 */
export const smallestIncrement = (unit: WeightUnit) => (unit === 'kg' ? 2.5 : 5);

/**
 * Weight for display. Trailing zeros are dropped because "100" reads faster
 * than "100.0" mid-set, but halves are kept because 102.5 is a real weight.
 */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null) return '—';
  return trim(kgToDisplay(kg, unit), 2);
}

/**
 * Same number without the unit suffix, for editable fields.
 *
 * One decimal, not two. A weight entered in the unit being displayed round
 * trips exactly and shows no decimals at all; the fractions only appear when
 * the stored value came from the *other* unit, and 220.5 lb communicates that
 * far better than 220.46 does.
 *
 * Callers must not write this value back unless the user actually edited it —
 * see the note on `weightUnchanged`.
 */
export const weightFieldValue = (kg: number | null | undefined, unit: WeightUnit) =>
  kg == null ? '' : trim(kgToDisplay(kg, unit), 1);

/**
 * Whether a field still holds the value it was rendered with.
 *
 * Editable weights are shown rounded, so committing an untouched field would
 * write the rounded number back and quietly move the stored weight. Any screen
 * that saves an edited set has to leave untouched fields alone rather than
 * round-tripping them through the display.
 */
export const weightUnchanged = (
  text: string, original: number | null | undefined, unit: WeightUnit,
) => text === weightFieldValue(original, unit);

/* ---------------------------------------------------------------- distance */

export const metresToDisplay = (m: number, unit: DistanceUnit) =>
  unit === 'km' ? m / 1000 : (m / 1000) * MI_PER_KM;

export const displayToMetres = (value: number, unit: DistanceUnit) =>
  unit === 'km' ? value * 1000 : (value / MI_PER_KM) * 1000;

export const formatDistance = (m: number | null | undefined, unit: DistanceUnit) =>
  m == null ? '—' : trim(metresToDisplay(m, unit), 2);

/* -------------------------------------------------------------------- time */

/** Durations are always seconds in the database; only the display differs. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ volume */

/**
 * Total load moved. Big numbers, so they compact — "12.5k" is legible at a
 * glance in a way "12,480" is not.
 */
export function formatVolume(kg: number, unit: WeightUnit): string {
  const v = kgToDisplay(kg, unit);
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

/* ------------------------------------------------------------------ helper */

/**
 * Rounds to at most `places` decimals and drops trailing zeros.
 * Also absorbs float drift from unit round-trips: 225 lb → kg → lb comes back
 * as 225.00000000000003, and must read as "225".
 */
function trim(value: number, places: number): string {
  const rounded = Number(value.toFixed(places));
  return String(rounded);
}
