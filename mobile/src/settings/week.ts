/**
 * The start of the current training week.
 *
 * "This week" has to mean a calendar week, not the last 168 hours. A rolling
 * window makes Monday morning report most of last week's sessions as though
 * they were this week's, which is precisely when a lifter looks at the number
 * to decide whether they are behind.
 *
 * Weeks begin on Monday, which is how training programs are written, and are
 * computed in the device's own timezone so the boundary falls at the user's
 * midnight rather than UTC's.
 */
export function startOfWeek(now: Date = new Date()): number {
  const d = new Date(now);
  // getDay() is 0 for Sunday; shift so Monday is 0 and Sunday is 6.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
