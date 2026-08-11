import { getDb } from '../connection';
import { money, todayIso } from '../money';
import type {
  BestSeller,
  DashboardSummary,
  RangeTotals,
  SalesByHour,
  SalesByType,
  VoidRecord,
} from '../../../shared/types';

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
      `SELECT COALESCE(SUM(total), 0)  AS sales_total,
              COALESCE(SUM(profit), 0) AS profit_total,
              COUNT(*)                 AS order_count
         FROM orders
        WHERE status = 'settled' AND date(settled_at) BETWEEN ? AND ?`,
    )
    .get(from, to) as { sales_total: number; profit_total: number; order_count: number };

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
    order_count: totals.order_count,
    days,
  };
}

/** Dine-in vs takeaway vs delivery — which side of the business is working. */
export function salesByType(from: string, to: string): SalesByType[] {
  return getDb()
    .prepare(
      `SELECT type,
              COUNT(*)                 AS order_count,
              COALESCE(SUM(total), 0)  AS sales,
              COALESCE(SUM(profit), 0) AS profit
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
              o.subtotal AS amount,
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
