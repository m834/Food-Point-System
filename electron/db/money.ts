/**
 * Money and clock helpers.
 *
 * Prices are stored as REAL, which means 0.1 + 0.2 problems creep into totals
 * unless every arithmetic result is rounded at the point it is produced. Every
 * money value written to the database goes through `money()` first.
 */

/** Round to 2 decimals, killing float drift. */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Local date as YYYY-MM-DD — the business's day, not UTC's. */
export function todayIso(when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Local timestamp as YYYY-MM-DD HH:MM:SS.
 *
 * Deliberately not `toISOString()`: that converts to UTC, which in Pakistan
 * would file a 2 a.m. order under the previous day and quietly split a night
 * shift's takings across two daily reports.
 */
export function nowIso(when: Date = new Date()): string {
  const time = [when.getHours(), when.getMinutes(), when.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return `${todayIso(when)} ${time}`;
}

/** The YYYYMMDD prefix that order numbers are grouped under. */
export function orderNoPrefix(when: Date = new Date()): string {
  return todayIso(when).replace(/-/g, '');
}

/** Extract the date half of a stored timestamp. */
export function dateOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}
