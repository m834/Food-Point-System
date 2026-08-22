import { getDb } from '../connection';
import { money, todayIso } from '../money';
import type {
  BestSeller,
  CancellationByStaff,
  CancellationRecord,
  CancellationsReport,
  DashboardSummary,
  RangeTotals,
  SalesByHour,
  SalesByType,
  VoidRecord,
} from '../../../shared/types';
import { CANCEL_REASON_LABELS, type CancelReasonCode } from '../../../shared/types';

/**
 * Reports read settled orders. There is no invoices table — a settled order is
 * the bill — and `orders.profit` was locked in from snapshots at settle time,
 * so nothing here recomputes money from the live menu.
 */

export function dashboard(date = todayIso()): DashboardSummary {
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0)  AS sales_total,
              COALESCE(SUM(profit), 0) AS profit_total,
              COUNT(*)                 AS order_count
         FROM orders
        WHERE status = 'settled' AND date(settled_at) = ?`,
    )
    .get(date) as { sales_total: number; profit_total: number; order_count: number };

  const open = db
    .prepare(
      `SELECT COUNT(*) AS open_order_count,
              COUNT(table_id) AS open_table_count
         FROM orders WHERE status = 'open'`,
    )
    .get() as { open_order_count: number; open_table_count: number };

  const bestSeller = db
    .prepare(
      `SELECT oi.item_name AS name, SUM(oi.qty) AS qty
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'settled' AND date(o.settled_at) = ?
          AND oi.kitchen_status != 'void'
        GROUP BY oi.item_name
        ORDER BY qty DESC
        LIMIT 1`,
    )
    .get(date) as { name: string; qty: number } | undefined;

  const busiestHour = db
    .prepare(
      `SELECT CAST(strftime('%H', settled_at) AS INTEGER) AS hour,
              COALESCE(SUM(total), 0) AS sales
         FROM orders
        WHERE status = 'settled' AND date(settled_at) = ?
        GROUP BY hour
        ORDER BY sales DESC
        LIMIT 1`,
    )
    .get(date) as { hour: number; sales: number } | undefined;

  const recent = db
    .prepare(
      `SELECT id, order_no, type, settled_at, total
         FROM orders
        WHERE status = 'settled' AND date(settled_at) = ?
        ORDER BY settled_at DESC
        LIMIT 8`,
    )
    .all(date) as DashboardSummary['recent'];

  return {
    date,
    sales_total: money(totals.sales_total),
    profit_total: money(totals.profit_total),
    order_count: totals.order_count,
    open_order_count: open.open_order_count,
    open_table_count: open.open_table_count,
    best_seller: bestSeller ?? null,
    busiest_hour: busiestHour ?? null,
    recent,
  };
}

export function range(from: string, to: string): RangeTotals {
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0)           AS sales_total,
              COALESCE(SUM(profit), 0)          AS profit_total,
              COALESCE(SUM(delivery_charge), 0) AS delivery_total,
              COUNT(*)                          AS order_count
         FROM orders
        WHERE status = 'settled' AND date(settled_at) BETWEEN ? AND ?`,
    )
    .get(from, to) as {
    sales_total: number;
    profit_total: number;
    delivery_total: number;
    order_count: number;
  };

  const days = db
    .prepare(
      `SELECT date(settled_at)         AS date,
              COALESCE(SUM(total), 0)  AS sales,
              COALESCE(SUM(profit), 0) AS profit,
              COUNT(*)                 AS orders
         FROM orders
        WHERE status = 'settled' AND date(settled_at) BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date`,
    )
    .all(from, to) as RangeTotals['days'];

  return {
    from,
    to,
    sales_total: money(totals.sales_total),
    profit_total: money(totals.profit_total),
    // Money taken for delivery, kept separate from what the kitchen sold —
    // it carries no food cost, so an owner reading margin needs it apart.
    delivery_total: money(totals.delivery_total),
    order_count: totals.order_count,
    days,
  };
}

/** Dine-in vs takeaway vs delivery — which side of the business is working. */
export function salesByType(from: string, to: string): SalesByType[] {
  return getDb()
    .prepare(
      `SELECT type,
              COUNT(*)                          AS order_count,
              COALESCE(SUM(total), 0)           AS sales,
              COALESCE(SUM(profit), 0)          AS profit,
              COALESCE(SUM(delivery_charge), 0) AS delivery_charge
         FROM orders
        WHERE status = 'settled' AND date(settled_at) BETWEEN ? AND ?
        GROUP BY type
        ORDER BY sales DESC`,
    )
    .all(from, to) as SalesByType[];
}

/** What to promote and what to drop. */
export function bestSellers(from: string, to: string, limit = 20): BestSeller[] {
  return getDb()
    .prepare(
      `SELECT oi.menu_item_id, oi.item_name,
              SUM(oi.qty)         AS qty,
              SUM(oi.line_total)  AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'settled' AND date(o.settled_at) BETWEEN ? AND ?
          AND oi.kitchen_status != 'void'
        GROUP BY oi.item_name
        ORDER BY qty DESC
        LIMIT ?`,
    )
    .all(from, to, limit) as BestSeller[];
}

/** The staffing view: when the rush actually is. */
export function salesByHour(from: string, to: string): SalesByHour[] {
  return getDb()
    .prepare(
      `SELECT CAST(strftime('%H', settled_at) AS INTEGER) AS hour,
              COUNT(*)                AS order_count,
              COALESCE(SUM(total), 0) AS sales
         FROM orders
        WHERE status = 'settled' AND date(settled_at) BETWEEN ? AND ?
        GROUP BY hour
        ORDER BY hour`,
    )
    .all(from, to) as SalesByHour[];
}

/**
 * Voided orders and voided lines in one list. Both carry their reason on the
 * row, which is the whole point of recording it.
 */
export function voids(from: string, to: string): VoidRecord[] {
  const db = getDb();

  const orderVoids = db
    .prepare(
      `SELECT 'order' AS kind, o.id AS order_id, o.order_no,
              NULL AS item_name, NULL AS qty,
              CASE WHEN o.voided_was_paid = 1 THEN o.total ELSE o.subtotal END AS amount,
              COALESCE(o.void_reason, '') AS reason,
              o.voided_at
         FROM orders o
        WHERE o.status = 'void' AND date(o.voided_at) BETWEEN ? AND ?`,
    )
    .all(from, to) as VoidRecord[];

  // Lines voided off an order that itself survived — the case worth watching.
  const itemVoids = db
    .prepare(
      `SELECT 'item' AS kind, o.id AS order_id, o.order_no,
              oi.item_name, oi.qty,
              oi.line_total AS amount,
              COALESCE(oi.void_reason, '') AS reason,
              oi.voided_at
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.kitchen_status = 'void' AND o.status != 'void'
          AND date(oi.voided_at) BETWEEN ? AND ?`,
    )
    .all(from, to) as VoidRecord[];

  return [...orderVoids, ...itemVoids].sort((a, b) => b.voided_at.localeCompare(a.voided_at));
}

/* ------------------------------------------------------------------ *
 * Cancellations — the owner's accountability view
 * ------------------------------------------------------------------ */

/**
 * Every cancelled order in a period, who did it, why, and how much was on it.
 *
 * Two things make this report worth having rather than decorative:
 *
 *  1. **Amount follows the money.** A cancelled order that had already been
 *     PAID is valued at `total` — what was actually taken from the customer.
 *     One cancelled while still open is valued at `subtotal`, because nothing
 *     was ever taken. Mixing the two would flatter or inflate the numbers the
 *     owner is trying to read.
 *  2. **The per-staff split is the point.** A single number for the shop tells
 *     an owner nothing; one person's name against six times everyone else's
 *     cancelled value is the signal. Paid cancellations are counted separately
 *     within that, because those are the ones where cash could have walked.
 *
 * Cancellations are never deleted, so this is a complete record by
 * construction — there is no "deleted" state for anything to hide in.
 */
const CANCELLED_AMOUNT = `CASE WHEN o.voided_was_paid = 1 THEN o.total ELSE o.subtotal END`;

export function cancellations(from: string, to: string): CancellationsReport {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT o.id AS order_id, o.order_no, o.type, t.name AS table_name,
              ${CANCELLED_AMOUNT} AS amount,
              o.voided_was_paid, o.void_reason_code, o.void_note,
              o.voided_by_staff_id, s.name AS staff_name,
              o.voided_at AS cancelled_at,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         LEFT JOIN staff s ON s.id = o.voided_by_staff_id
        WHERE o.status = 'void' AND date(o.voided_at) BETWEEN ? AND ?
        ORDER BY o.voided_at DESC`,
    )
    .all(from, to) as Array<{
    order_id: number;
    order_no: string;
    type: CancellationRecord['type'];
    table_name: string | null;
    amount: number;
    voided_was_paid: number;
    void_reason_code: CancelReasonCode | null;
    void_note: string | null;
    voided_by_staff_id: number | null;
    staff_name: string | null;
    cancelled_at: string;
    item_count: number;
  }>;

  // The items on each cancelled order, so the owner can see WHAT was cancelled
  // and not just a figure. Fetched in one pass rather than per row.
  const itemsByOrder = new Map<number, CancellationRecord['items']>();
  if (rows.length) {
    const lines = db
      .prepare(
        `SELECT order_id, item_name, qty, line_total
           FROM order_items
          WHERE order_id IN (${rows.map(() => '?').join(', ')})
          ORDER BY id`,
      )
      .all(...rows.map((r) => r.order_id)) as Array<{
      order_id: number;
      item_name: string;
      qty: number;
      line_total: number;
    }>;
    for (const line of lines) {
      const list = itemsByOrder.get(line.order_id) ?? [];
      list.push({ item_name: line.item_name, qty: line.qty, line_total: line.line_total });
      itemsByOrder.set(line.order_id, list);
    }
  }

  const records: CancellationRecord[] = rows.map((row) => ({
    order_id: row.order_id,
    order_no: row.order_no,
    type: row.type,
    table_name: row.table_name,
    amount: money(row.amount),
    was_paid: row.voided_was_paid === 1,
    reason_code: row.void_reason_code,
    reason_label: row.void_reason_code
      ? CANCEL_REASON_LABELS[row.void_reason_code]
      : 'Not recorded',
    note: row.void_note,
    staff_id: row.voided_by_staff_id,
    staff_name: row.staff_name,
    cancelled_at: row.cancelled_at,
    item_count: row.item_count,
    items: itemsByOrder.get(row.order_id) ?? [],
  }));

  const byStaff = db
    .prepare(
      `SELECT o.voided_by_staff_id AS staff_id,
              COALESCE(s.name, 'Not recorded') AS staff_name,
              COUNT(*) AS count,
              COALESCE(SUM(${CANCELLED_AMOUNT}), 0) AS total_value,
              COALESCE(SUM(CASE WHEN o.voided_was_paid = 1 THEN 1 ELSE 0 END), 0) AS paid_count,
              COALESCE(SUM(CASE WHEN o.voided_was_paid = 1 THEN o.total ELSE 0 END), 0) AS paid_value
         FROM orders o
         LEFT JOIN staff s ON s.id = o.voided_by_staff_id
        WHERE o.status = 'void' AND date(o.voided_at) BETWEEN ? AND ?
        GROUP BY o.voided_by_staff_id, staff_name
        ORDER BY total_value DESC`,
    )
    .all(from, to) as CancellationByStaff[];

  const byReason = db
    .prepare(
      `SELECT COALESCE(o.void_reason_code, 'unrecorded') AS reason_code,
              COUNT(*) AS count,
              COALESCE(SUM(${CANCELLED_AMOUNT}), 0) AS value
         FROM orders o
        WHERE o.status = 'void' AND date(o.voided_at) BETWEEN ? AND ?
        GROUP BY reason_code
        ORDER BY count DESC`,
    )
    .all(from, to) as Array<{ reason_code: string; count: number; value: number }>;

  return {
    from,
    to,
    records,
    total_count: records.length,
    total_value: money(records.reduce((sum, r) => sum + r.amount, 0)),
    paid_count: records.filter((r) => r.was_paid).length,
    paid_value: money(records.filter((r) => r.was_paid).reduce((sum, r) => sum + r.amount, 0)),
    by_staff: byStaff.map((row) => ({
      ...row,
      total_value: money(row.total_value),
      paid_value: money(row.paid_value),
    })),
    by_reason: byReason.map((row) => ({
      reason_code: row.reason_code,
      reason_label:
        row.reason_code === 'unrecorded'
          ? 'Not recorded'
          : CANCEL_REASON_LABELS[row.reason_code as CancelReasonCode] ?? row.reason_code,
      count: row.count,
      value: money(row.value),
    })),
  };
}
