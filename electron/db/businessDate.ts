/**
 * The date a row's money belongs to — the TRADING day, not the calendar's.
 *
 * This shop opens at 10am and closes at 3am. Grouping its takings by
 * `date(settled_at)` cuts every night in half at midnight: the 11pm orders
 * file under one date and the 1am orders under the next, so no row in any
 * report describes the shift anyone actually worked, and the owner comparing
 * "yesterday" against "today" is comparing two half-nights.
 *
 * Every order already carries the session that was open when it was placed,
 * and a session knows when it was OPENED. So the honest date for an order is
 * the date its trading day began — which is exactly the boundary the owner set
 * by pressing Open Day and Close Day.
 *
 * Orders taken with no day open have no session to borrow a date from. Those
 * fall back to their own timestamp, which is the best that can be said about
 * them: the counter is allowed to serve without opening a day, and such an
 * order belongs to no trading day at all.
 *
 * Written as a correlated subquery rather than a join so it can be dropped
 * into any existing query without disturbing its grouping.
 *
 * @param alias  Table alias including the dot, e.g. `'o.'`, or `''` for none.
 * @param timestamp  The row's own timestamp expression, used when it belongs
 *                   to no session — e.g. `'o.settled_at'`, `'o.voided_at'`.
 */
export function businessDate(alias: string, timestamp: string): string {
  return (
    `COALESCE(` +
    `(SELECT date(ds.opened_at) FROM day_sessions ds WHERE ds.id = ${alias}session_id), ` +
    `date(${timestamp}))`
  );
}
