/**
 * Program import.
 *
 * Lets a lifter put a program they already have into the app by pasting it,
 * rather than the app shipping a copy of someone else's paid work. The numbers
 * then come from the real source instead of from anyone's reconstruction of it,
 * which is the only way to be certain a program is accurate.
 *
 * The parser is deliberately tolerant: people paste from spreadsheets, PDFs and
 * screenshots-turned-text, and the formatting is never clean. Anything it
 * cannot interpret is reported as a warning against its line rather than
 * silently dropped — a missing exercise the user can see is recoverable, one
 * they cannot is not.
 *
 * Pure by design (no database, no React Native) so it can be tested directly.
 */

export interface ParsedSlot {
  /** The text as written, kept so the UI can show what it matched against. */
  raw: string;
  exerciseQuery: string;
  exerciseId: string | null;
  sets: number | null;
  reps: string | null;
  /** Percentage of training max, as a fraction. "@75%" → 0.75 */
  pct: number | null;
  rpe: number | null;
  restSeconds: number | null;
  note: string | null;
}

export interface ParsedDay {
  name: string;
  week: number | null;
  slots: ParsedSlot[];
}

export interface ParsedProgram {
  name: string;
  author: string | null;
  days: ParsedDay[];
  warnings: { line: number; text: string; reason: string }[];
}

/** Resolves free text to a catalogue exercise. Injected so the parser stays pure. */
export type ExerciseResolver = (query: string) => string | null;

const WEEK_RE = /^\s*week\s+(\d+)\b/i;
const DAY_RE = /^\s*(?:day\s*(\d+)?\s*[—\-–:]?\s*)?(.*)$/i;
const DAY_HEADER_RE = /^\s*day\b/i;
const HEADER_RE = /^\s*(name|title|program|author|coach)\s*[:\-]\s*(.+)$/i;

/**
 * `5x5`, `5 x 5`, `5×5`, `3x8-12`, `1x5+`, `5xAMRAP`.
 * The `+` suffix is lifting shorthand for "and as many more as you can".
 */
const SETS_REPS_RE = /(\d+)\s*[x×]\s*(amrap|\d+\s*[-–]\s*\d+|\d+\+?)/i;
const PCT_RE = /@\s*(\d+(?:\.\d+)?)\s*%/;
const RPE_RE = /\brpe\s*(\d+(?:\.\d+)?)/i;
const REST_RE = /\brest\s*(\d+)\s*(s|sec|m|min)?\b/i;

export function parseProgram(text: string, resolve: ExerciseResolver): ParsedProgram {
  const warnings: ParsedProgram['warnings'] = [];
  const days: ParsedDay[] = [];

  let name = '';
  let author: string | null = null;
  let currentWeek: number | null = null;
  let current: ParsedDay | null = null;

  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || /^[-=_*]{3,}$/.test(line)) return;

    const header = line.match(HEADER_RE);
    if (header) {
      const key = header[1].toLowerCase();
      if (key === 'author' || key === 'coach') author = header[2].trim();
      else name = header[2].trim();
      return;
    }

    const week = line.match(WEEK_RE);
    if (week) {
      currentWeek = Number(week[1]);
      // "Week 2" on its own only changes the week; a day header follows.
      if (line.replace(WEEK_RE, '').trim().length === 0) return;
    }

    /**
     * A line without any set/rep information is a day heading.
     *
     * This looks blunt, and it is deliberate. The obvious alternative — asking
     * whether the line names a known exercise — is worse, because search will
     * happily resolve a heading like "Lower Power" to *Power Clean* and bury a
     * whole day's worth of exercises inside the previous day. Programs
     * essentially always write sets against their exercises, so "no sets means
     * heading" is both the safer guess and the more predictable one, and the
     * preview shows the user exactly how their paste was read.
     */
    const hasSetsReps = SETS_REPS_RE.test(line);
    const isDayHeader = DAY_HEADER_RE.test(line) || !hasSetsReps;

    if (isDayHeader && !hasSetsReps) {
      const m = line.replace(WEEK_RE, '').trim().match(DAY_RE);
      const label = (m?.[2] || m?.[1] || line).trim();
      current = { name: label || `Day ${days.length + 1}`, week: currentWeek, slots: [] };
      days.push(current);
      return;
    }

    if (!current) {
      current = { name: 'Day 1', week: currentWeek, slots: [] };
      days.push(current);
    }

    const slot = parseSlot(line, resolve);
    if (!slot) {
      warnings.push({ line: index + 1, text: line, reason: 'could not read this line' });
      return;
    }
    if (!slot.exerciseId) {
      warnings.push({
        line: index + 1, text: line,
        reason: `no exercise matches “${slot.exerciseQuery}”`,
      });
    }
    current.slots.push(slot);
  });

  return {
    name: name || 'Imported plan',
    author,
    days: days.filter((d) => d.slots.length > 0),
    warnings,
  };
}

/**
 * Strips set/rep counts, annotations, bullets and trailing notes, leaving what
 * should be the exercise name. Shared so the day-header test and the slot
 * parser always agree on what a line is naming.
 */
export function cleanExerciseName(line: string): string {
  return line
    .replace(SETS_REPS_RE, ' ')
    .replace(PCT_RE, ' ')
    .replace(RPE_RE, ' ')
    .replace(REST_RE, ' ')
    .replace(/\(([^)]+)\)\s*$/, ' ')
    .replace(/^[\s\d.)\-–—•*]+/, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .trim();
}

function parseSlot(line: string, resolve: ExerciseResolver): ParsedSlot | null {
  const setsReps = line.match(SETS_REPS_RE);

  const pctMatch = line.match(PCT_RE);
  const rpeMatch = line.match(RPE_RE);
  const restMatch = line.match(REST_RE);

  // A trailing parenthetical is a coaching note, not part of the name.
  const withoutAnnotations = line
    .replace(SETS_REPS_RE, ' ')
    .replace(PCT_RE, ' ')
    .replace(RPE_RE, ' ')
    .replace(REST_RE, ' ');
  const noteMatch = withoutAnnotations.match(/\(([^)]+)\)\s*$/);
  const note = noteMatch ? noteMatch[1].trim() : null;

  const query = cleanExerciseName(line);

  if (!query) return null;

  const rest = restMatch
    ? /^m/i.test(restMatch[2] ?? '') ? Number(restMatch[1]) * 60 : Number(restMatch[1])
    : null;

  return {
    raw: line,
    exerciseQuery: query,
    exerciseId: resolve(query),
    sets: setsReps ? Number(setsReps[1]) : null,
    reps: setsReps ? normaliseReps(setsReps[2]) : null,
    pct: pctMatch ? Number(pctMatch[1]) / 100 : null,
    rpe: rpeMatch ? Number(rpeMatch[1]) : null,
    restSeconds: rest,
    note,
  };
}

/** "8 - 12" → "8-12"; "5+" → "5"; "amrap" → "AMRAP". */
function normaliseReps(raw: string): string {
  const value = raw.trim();
  if (/amrap/i.test(value)) return 'AMRAP';
  return value.replace(/\s*[-–]\s*/, '-').replace(/\+$/, '');
}
