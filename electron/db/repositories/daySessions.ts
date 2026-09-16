import { getDb } from '../connection';
import { money, nowIso } from '../money';
import { partialPaymentsEnabled } from './settings';
import type { DayReport, DaySession, OrderType } from '../../../shared/types';

/**
 * The business day — Open Day to Close Day, not midnight to midnight.
 *
 * This shop trades past midnight, which is the whole reason the concept
 * exists. A calendar date splits one night's trading across two reports: the
 * orders taken at 11pm file under one day and the ones at 1am under the next,
 * so neither report describes the shift anyone actually worked. Stamping each
 * order with the session that was open when it was placed fixes that, and the
 * report reads the stamp rather than the clock.
 *
 * Only one session may be open at a time. That is what makes "the currently
 * open session" a well-defined thing for an order to attach to.
 */

const SELECT = `
  SELECT id, opened_at, closed_at, opening_float, opened_by, closed_by, notes
  FROM day_sessions
`;

/** The day currently open, or null when the shop is closed. */
export function currentSession(): DaySession | null {
  return (
    (getDb()
      .prepare(`${SELECT} WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`)
      .get() as DaySession | undefined) ?? null
  );
}

export function getSession(id: number): DaySession | null {
  return (getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as DaySession | undefined) ?? null;
}

/** Recent days, for the history list on the screen. */
export function listSessions(limit = 30): DaySession[] {
  return getDb()
    .prepare(`${SELECT} ORDER BY id DESC LIMIT ?`)
    .all(limit) as DaySession[];
}

export function openDay(input: { opening_float?: number; opened_by?: number | null }): DaySession {
  const db = getDb();

  const run = db.transaction(() => {
    // Two open days would make "which session does this order belong to?"
    // ambiguous, and every figure on both reports wrong.
    if (currentSession()) {
      throw new Error('A day is already open. Close it before opening another.');
    }

    const info = db
      .prepare('INSERT INTO day_sessions (opened_at, opening_float, opened_by) VALUES (?, ?, ?)')
      .run(nowIso(), money(Math.max(input.opening_float ?? 0, 0)), input.opened_by ?? null);

    return Number(info.lastInsertRowid);
  });

  return getSession(run())!;
}

/**
 * Unpaid orders still sitting on the open day.
 *
 * Read BEFORE closing so the owner can be warned. Closing over unpaid orders
 * is allowed — a customer may genuinely have walked out and the owner has to
 * be able to end the day — but it must never happen silently, because those
 * orders are money the report will not contain.
 */
export function unpaidOnSession(sessionId: number): { count: number; total: number } {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal), 0) AS total
         FROM orders WHERE session_id = ? AND status = 'open'`,
    )
    .get(sessionId) as { count: number; total: number };
  return { count: row.count, total: money(row.total) };
}

export function closeDay(input: { closed_by?: number | null } = {}): DaySession {
  const db = getDb();

  const run = db.transaction(() => {
    const session = currentSession();
    if (!session) throw new Error('No day is open.');

    db.prepare('UPDATE day_sessions SET closed_at = ?, closed_by = ? WHERE id = ?').run(
      nowIso(),
      input.closed_by ?? null,
      session.id,
    );

    return session.id;
  });

  return getSession(run())!;
}

/**
 * Attach an order to whichever day is open.
 *
 * Returns null when the shop has not opened a day, which is not an error: the
 * counter must be able to take an order regardless, and an unattached order
 * simply appears in no day report rather than blocking service.
 */
export function currentSessionId(): number | null {
  return currentSession()?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * The end-of-day report
 * ------------------------------------------------------------------ */

export function dayReport(sessionId: number): DayReport {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session) throw new Error('That day no longer exists.');

  const settled = "status = 'settled' AND session_id = ?";

  const totals = db
    .prepare(
      `SELECT COUNT(*)                          AS order_count,
              COALESCE(SUM(total), 0)           AS sales_total,
              COALESCE(SUM(service_charge), 0)  AS service_charges,
              COALESCE(SUM(delivery_charge), 0) AS delivery_charges,
              COALESCE(SUM(extras_total), 0)    AS extras_total,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_sales,
              COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_sales
         FROM orders WHERE ${settled}`,
    )
    .get(sessionId) as Record<string, number>;

  /**
   * Cash/card actually collected THIS session, for the drawer reconciliation
   * below — kept apart from `sales_total` above, which stays revenue at the
   * full settled amount regardless of what has actually been collected.
   *
   * Off by default, and this whole block only runs when partial payments are
   * on, so a shop that has never used the feature keeps the exact query it
   * always had (`totals.cash_sales` / `totals.card_sales`, i.e. `orders.total`
   * by `payment_method`).
   *
   * On, an order that has a row in `order_payments` is counted from THAT
   * ledger instead of from `orders.total` — its own row(s) already state
   * exactly what moved, and in which session, whether that was the advance
   * taken today or a balance collected on a later day than the order itself
   * belongs to. An order with no such row (every order settled before this
   * feature ever existed, or settled in full while the toggle was off) is
   * counted from `orders.total` exactly as before — it was paid in full at
   * settle time, so that figure already is what moved.
   */
  const partial = partialPaymentsEnabled();
  let cashSales = money(totals.cash_sales);
  let cardSales = money(totals.card_sales);
  let partialCount = 0;
  let partialBalanceTotal = 0;

  if (partial) {
    const untracked = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash,
                COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card
           FROM orders o
          WHERE ${settled}
            AND NOT EXISTS (SELECT 1 FROM order_payments p WHERE p.order_id = o.id)`,
      )
      .get(sessionId) as { cash: number; card: number };

    const collected = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0) AS cash,
                COALESCE(SUM(CASE WHEN method = 'card' THEN amount ELSE 0 END), 0) AS card
           FROM order_payments WHERE session_id = ?`,
      )
      .get(sessionId) as { cash: number; card: number };

    cashSales = money(untracked.cash + collected.cash);
    cardSales = money(untracked.card + collected.card);

    const bal = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(balance_due), 0) AS total
           FROM orders WHERE ${settled} AND balance_due > 0`,
      )
      .get(sessionId) as { count: number; total: number };
    partialCount = bal.count;
    partialBalanceTotal = money(bal.total);
  }

  const byType = db
    .prepare(
      `SELECT type, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS sales
         FROM orders WHERE ${settled}
        GROUP BY type ORDER BY sales DESC`,
    )
    .all(sessionId) as Array<{ type: OrderType; order_count: number; sales: number }>;

  // Only takeaway orders ever carry a waiter, so this needs no extra type
  // filter — every other order type leaves waiter_name null. Empty on a shop
  // that has never turned the feature on. Grouped by waiter_name, the
  // snapshot, not waiter_id — see the matching note in reports.ts, since
  // deleting a waiter nulls waiter_id (ON DELETE SET NULL) but never the name.
  const byWaiter = db
    .prepare(
      `SELECT waiter_id, waiter_name, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS sales
         FROM orders WHERE ${settled} AND waiter_name IS NOT NULL
        GROUP BY waiter_name ORDER BY sales DESC`,
    )
    .all(sessionId) as Array<{
    waiter_id: number | null;
    waiter_name: string;
    order_count: number;
    sales: number;
  }>;

  /**
   * Gross profit — sales MINUS ITEM COST, at the item level only.
   *
   * Deliberately not the stored `orders.profit`, which also folds in the
   * service charge, the delivery fee and packaging. None of those are food
   * margin, and including them under a label that says "item cost" would
   * overstate what the kitchen actually earned. Void lines are excluded, as
   * are void orders.
   */
  const margin = db
    .prepare(
      `SELECT COALESCE(SUM(oi.line_total), 0)          AS revenue,
              COALESCE(SUM(oi.qty * oi.cost_price), 0) AS cost
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'settled' AND o.session_id = ?
          AND oi.kitchen_status != 'void'`,
    )
    .get(sessionId) as { revenue: number; cost: number };

  const cancelled = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN voided_was_paid = 1 THEN total ELSE subtotal END), 0) AS value
         FROM orders WHERE status = 'void' AND session_id = ?`,
    )
    .get(sessionId) as { count: number; value: number };

  const topItems = db
    .prepare(
      `SELECT oi.item_name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'settled' AND o.session_id = ?
          AND oi.kitchen_status != 'void'
        GROUP BY oi.item_name
        ORDER BY qty DESC
        LIMIT 5`,
    )
    .all(sessionId) as Array<{ item_name: string; qty: number; revenue: number }>;

  const unpaid = unpaidOnSession(sessionId);

  return {
    session,
    order_count: totals.order_count,
    by_type: byType.map((row) => ({ ...row, sales: money(row.sales) })),
    by_waiter: byWaiter.map((row) => ({ ...row, sales: money(row.sales) })),
    sales_total: money(totals.sales_total),
    gross_profit: money(margin.revenue - margin.cost),
    service_charges: money(totals.service_charges),
    delivery_charges: money(totals.delivery_charges),
    extras_total: money(totals.extras_total),
    cancelled_count: cancelled.count,
    cancelled_value: money(cancelled.value),
    top_items: topItems.map((row) => ({ ...row, revenue: money(row.revenue) })),
    cash_sales: cashSales,
    card_sales: cardSales,
    // Only stated when a float was actually entered — "expected cash: 0" on a
    // day nobody counted a float for is a number that invites a false alarm.
    expected_cash: session.opening_float > 0 ? money(session.opening_float + cashSales) : null,
    unpaid_count: unpaid.count,
    unpaid_total: unpaid.total,
    partial_count: partialCount,
    partial_balance_total: partialBalanceTotal,
    // Expenses and waiter wages are overlaid by reportFor() in electron/ipc/day.ts,
    // which composes this repository with expenses.ts — kept apart so the two
    // stay free of a circular import. These are the correct defaults for a
    // session that has never recorded either.
    expenses: [],
    expenses_total: 0,
    net_cash_position: null,
    waiter_wages: [],
    waiter_wages_total: 0,
  };
}
