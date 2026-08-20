import { getDb } from '../connection';
import { money, nowIso, orderNoPrefix } from '../money';
import { getItem, getModifiersByIds } from './menu';
import { buildDealLines } from './deals';
import { openOrderIdForTable } from './tables';
import { serviceChargePercent } from './settings';
import type {
  CancelReasonCode,
  NewOrderLine,
  OpenOrderSummary,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderType,
  PaymentMethod,
} from '../../../shared/types';
import { CANCEL_REASON_LABELS } from '../../../shared/types';

/**
 * Orders — the one idea the whole food app is built around.
 *
 * A shop completes a sale in one shot. A food point does not: an order is
 * opened, items are added and fired to the kitchen over time, several orders
 * run at once across tables and the counter, and only at the end is it
 * settled. A settled order IS the bill; there is no separate invoices table.
 *
 * Three operations are deliberately distinct and must stay that way:
 * adding an item is not firing it, and firing is not settling.
 */

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const ORDER_SELECT = `
  SELECT o.id, o.order_no, o.type, o.table_id, t.name AS table_name, o.status,
         o.opened_at, o.settled_at, o.customer_name, o.customer_phone,
         o.subtotal, o.discount, o.service_charge, o.total, o.profit,
         o.payment_method, o.void_reason, o.voided_at,
         o.void_reason_code, o.void_note, o.voided_by_staff_id,
         o.voided_was_paid, s.name AS voided_by_staff_name
  FROM orders o
  LEFT JOIN tables t ON t.id = o.table_id
  LEFT JOIN staff s ON s.id = o.voided_by_staff_id
`;

type OrderRow = Omit<Order, 'items'>;

function hydrate(row: OrderRow): Order {
  const db = getDb();

  const items = db
    .prepare(
      `SELECT id, order_id, menu_item_id, item_name, qty, cost_price, sale_price,
              line_total, notes, kitchen_status, fired_at, void_reason, voided_at,
              void_reason_code, void_note, voided_by_staff_id,
              deal_id, deal_group, deal_name
         FROM order_items WHERE order_id = ? ORDER BY id`,
    )
    .all(row.id) as Array<Omit<OrderItem, 'modifiers'>>;

  const mods = items.length
    ? (db
        .prepare(
          `SELECT id, order_item_id, name, price_delta
             FROM order_item_modifiers
            WHERE order_item_id IN (${items.map(() => '?').join(', ')})
            ORDER BY id`,
        )
        .all(...items.map((i) => i.id)) as OrderItemModifier[])
    : [];

  return {
    ...row,
    items: items.map((item) => ({
      ...item,
      modifiers: mods.filter((m) => m.order_item_id === item.id),
    })),
  };
}

export function getOrder(id: number): Order | null {
  const row = getDb().prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as OrderRow | undefined;
  return row ? hydrate(row) : null;
}

/**
 * Every open order, for the "which orders are running" strip. Many orders open
 * at once is the normal case here, not an edge case.
 */
export function listOpenOrders(): OpenOrderSummary[] {
  return getDb()
    .prepare(
      `SELECT o.id, o.order_no, o.type, o.table_id, t.name AS table_name,
              o.opened_at, o.subtotal,
              (SELECT COUNT(*) FROM order_items oi
                WHERE oi.order_id = o.id AND oi.kitchen_status != 'void') AS item_count,
              (SELECT COUNT(*) FROM order_items oi
                WHERE oi.order_id = o.id AND oi.kitchen_status = 'new') AS has_unfired
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.status = 'open'
        ORDER BY o.opened_at`,
    )
    .all() as OpenOrderSummary[];
}

/**
 * The order history — what the counter reaches for when a customer comes back
 * asking for their bill again.
 *
 * Dated by when the order CLOSED, not when it opened, so an order that ran
 * past midnight files under the day it was actually paid — the same day it
 * counts towards in every report.
 */
export function listOrders(
  from: string,
  to: string,
  status?: 'settled' | 'void' | 'open',
): Order[] {
  const where = ["date(COALESCE(o.settled_at, o.voided_at, o.opened_at)) BETWEEN ? AND ?"];
  const params: unknown[] = [from, to];

  if (status) {
    where.push('o.status = ?');
    params.push(status);
  } else {
    // Open orders live on the order screen, not in the history.
    where.push("o.status != 'open'");
  }

  const rows = getDb()
    .prepare(
      `${ORDER_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(o.settled_at, o.voided_at, o.opened_at) DESC`,
    )
    .all(...params) as OrderRow[];

  return rows.map(hydrate);
}

/* ------------------------------------------------------------------ *
 * Order numbering
 * ------------------------------------------------------------------ */

/**
 * YYYYMMDD-NNN, restarting at 001 each business day.
 *
 * Called only from inside the open transaction. It reads the largest suffix
 * already issued today and adds one — deliberately not COUNT(*), which reissues
 * a number the moment an order is voided, and deliberately not computed in the
 * UI, where two cashiers tapping "new order" a second apart would collide.
 * The UNIQUE constraint on the column is the backstop.
 */
function nextOrderNo(): string {
  const prefix = orderNoPrefix();
  const row = getDb()
    .prepare('SELECT MAX(order_no) AS last FROM orders WHERE order_no LIKE ?')
    .get(`${prefix}-%`) as { last: string | null };

  const lastSeq = row.last ? Number(row.last.slice(prefix.length + 1)) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export interface OpenOrderInput {
  type: OrderType;
  table_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
}

export function openOrder(input: OpenOrderInput): Order {
  const db = getDb();

  const run = db.transaction(() => {
    if (input.type === 'dine_in' && input.table_id) {
      const existing = openOrderIdForTable(input.table_id);
      if (existing) {
        // Resuming is what the cashier actually wants; say so rather than
        // silently opening a second bill for the same table.
        throw new Error('This table already has an open order — resume it instead.');
      }
    }

    const info = db
      .prepare(
        `INSERT INTO orders (order_no, type, table_id, status, opened_at,
                             customer_name, customer_phone)
         VALUES (?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
        nextOrderNo(),
        input.type,
        input.type === 'dine_in' ? input.table_id ?? null : null,
        nowIso(),
        input.customer_name || null,
        input.customer_phone || null,
      );

    return Number(info.lastInsertRowid);
  });

  return getOrder(run())!;
}

/**
 * Append lines to an open order. Snapshots price, cost and every chosen
 * modifier onto the row, because tomorrow's menu edit must not rewrite today's
 * bill. Does NOT print — firing is a separate step.
 */
export function addItems(orderId: number, lines: NewOrderLine[]): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new Error('That order no longer exists.');
    if (order.status !== 'open') throw new Error('This order is already closed.');

    const insertItem = db.prepare(
      `INSERT INTO order_items
         (order_id, menu_item_id, item_name, qty, cost_price, sale_price,
          line_total, notes, kitchen_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    );
    const insertMod = db.prepare(
      'INSERT INTO order_item_modifiers (order_item_id, name, price_delta) VALUES (?, ?, ?)',
    );

    for (const line of lines) {
      const item = getItem(line.menu_item_id);
      if (!item) throw new Error('That menu item no longer exists.');

      // Availability is enforced here as well as in the UI. A greyed-out card
      // is a courtesy; this is the rule.
      if (!item.is_available) {
        throw new Error(`${item.name} is marked sold out.`);
      }
      if (!(line.qty > 0)) throw new Error(`Quantity for ${item.name} must be more than zero.`);

      const chosen = getModifiersByIds(line.modifier_ids ?? []);
      const delta = chosen.reduce((sum, mod) => sum + mod.price_delta, 0);
      const lineTotal = money(line.qty * (item.sale_price + delta));

      const info = insertItem.run(
        orderId,
        item.id,
        item.name,
        line.qty,
        money(item.cost_price),
        money(item.sale_price),
        lineTotal,
        line.notes || null,
      );

      const lineId = Number(info.lastInsertRowid);
      for (const mod of chosen) insertMod.run(lineId, mod.name, money(mod.price_delta));
    }

    recomputeSubtotal(orderId);
    return orderId;
  });

  return getOrder(run())!;
}

/**
 * Add a whole deal in one action.
 *
 * The cashier taps once; the order gains one line per component item, all
 * stamped with the same `deal_group`. The bill collapses that group back into
 * a single line at the combo price, but the kitchen ticket, the best-seller
 * report and the profit calculation all keep seeing real food with real costs.
 *
 * `deal_group` is the id of the group's first row, which is unique, already
 * indexed, and needs no counter of its own. Adding the same deal twice
 * therefore produces two independent groups.
 */
export function addDeal(orderId: number, dealId: number, quantity: number): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new Error('That order no longer exists.');
    if (order.status !== 'open') throw new Error('This order is already closed.');

    // Throws with a cashier-readable reason when the deal is off, empty, or
    // has a sold-out component.
    const lines = buildDealLines(dealId, quantity);

    const insert = db.prepare(
      `INSERT INTO order_items
         (order_id, menu_item_id, item_name, qty, cost_price, sale_price,
          line_total, kitchen_status, deal_id, deal_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    );

    const ids: number[] = [];
    for (const line of lines) {
      const info = insert.run(
        orderId,
        line.menu_item_id,
        line.item_name,
        line.qty,
        line.cost_price,
        line.sale_price,
        line.line_total,
        line.deal_id,
        line.deal_name,
      );
      ids.push(Number(info.lastInsertRowid));
    }

    const group = ids[0];
    const stamp = db.prepare('UPDATE order_items SET deal_group = ? WHERE id = ?');
    for (const id of ids) stamp.run(group, id);

    recomputeSubtotal(orderId);
    return orderId;
  });

  return getOrder(run())!;
}

/**
 * Change the quantity of a line that has NOT gone to the kitchen yet.
 *
 * Only `new` lines can move. Once a line is fired the kitchen is already
 * cooking it, so silently editing the quantity would put the bill and the pass
 * out of step — at that point the honest action is a void with a reason.
 * Setting the quantity to zero removes the line, which is what tapping the
 * minus stepper down to nothing means.
 */
export function setItemQty(orderItemId: number, qty: number): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const line = db
      .prepare(
        `SELECT oi.order_id, oi.kitchen_status, oi.qty, oi.line_total, oi.deal_group,
                o.status AS order_status
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.id = ?`,
      )
      .get(orderItemId) as
      | {
          order_id: number;
          kitchen_status: string;
          qty: number;
          line_total: number;
          order_status: string;
          deal_group: number | null;
        }
      | undefined;

    if (!line) throw new Error('That line is no longer on the order.');
    if (line.order_status !== 'open') throw new Error('This order is already closed.');
    if (line.kitchen_status !== 'new') {
      throw new Error('This item has already gone to the kitchen — void it instead.');
    }
    // A deal is sold as a bundle at one price. Letting a single component's
    // quantity move would leave the parts no longer adding up to the combo
    // price the customer was quoted. Remove the whole deal and re-add it.
    if (line.deal_group) {
      throw new Error('This item is part of a deal — void the deal instead.');
    }

    if (qty <= 0) {
      db.prepare('DELETE FROM order_items WHERE id = ?').run(orderItemId);
    } else {
      // line_total already carries the modifier deltas, so scale it by the
      // ratio rather than recomputing from a menu price that may have moved.
      const unit = line.line_total / line.qty;
      db.prepare('UPDATE order_items SET qty = ?, line_total = ? WHERE id = ?').run(
        qty,
        money(unit * qty),
        orderItemId,
      );
    }

    recomputeSubtotal(line.order_id);
    return line.order_id;
  });

  return getOrder(run())!;
}

/** Running subtotal of an open order. Void lines do not count. */
export function recomputeSubtotal(orderId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(line_total), 0) AS subtotal
         FROM order_items WHERE order_id = ? AND kitchen_status != 'void'`,
    )
    .get(orderId) as { subtotal: number };

  const subtotal = money(row.subtotal);
  db.prepare('UPDATE orders SET subtotal = ? WHERE id = ?').run(subtotal, orderId);
  return subtotal;
}

/**
 * The KOT step: mark the not-yet-fired lines as fired and hand them back so
 * the caller can print a ticket of exactly those items.
 *
 * Firing again later prints a second ticket with only the newly added lines —
 * already-fired items are never reprinted, or the kitchen cooks them twice.
 */
export function fireToKitchen(orderId: number): { order: Order; fired: OrderItem[] } {
  const db = getDb();

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new Error('That order no longer exists.');
    if (order.status !== 'open') throw new Error('This order is already closed.');

    const pending = order.items.filter((item) => item.kitchen_status === 'new');
    if (!pending.length) throw new Error('Everything on this order has already gone to the kitchen.');

    const firedAt = nowIso();
    const mark = db.prepare(
      "UPDATE order_items SET kitchen_status = 'fired', fired_at = ? WHERE id = ?",
    );
    for (const item of pending) mark.run(firedAt, item.id);

    return pending.map((item) => item.id);
  });

  const firedIds = new Set(run());
  const order = getOrder(orderId)!;
  return { order, fired: order.items.filter((item) => firedIds.has(item.id)) };
}

export interface SettleInput {
  discount?: number;
  payment_method: PaymentMethod;
}

/**
 * The money step. Profit is locked in here, from the snapshots on the lines —
 * never from live menu prices, so repricing the menu tomorrow cannot rewrite
 * what today earned.
 *
 * Profit is `total - cogs`, not the sum of per-line margins. Per-line margin is
 * wrong in two directions that happen every day: a paid modifier lands in
 * line_total and so in the subtotal but belongs to no line's sale_price, and a
 * discount reduces what the customer actually handed over while touching no
 * line at all. Deriving from the total keeps the recorded number equal to money
 * in minus food cost.
 */
export function settleOrder(orderId: number, input: SettleInput): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new Error('That order no longer exists.');
    if (order.status === 'settled') throw new Error('This order has already been paid.');
    if (order.status === 'void') throw new Error('This order was voided.');

    const live = order.items.filter((item) => item.kitchen_status !== 'void');
    if (!live.length) throw new Error('There is nothing on this order to charge for.');

    let subtotal = 0;
    let cogs = 0;
    for (const item of live) {
      subtotal += item.line_total;
      cogs += item.qty * item.cost_price;
    }
    subtotal = money(subtotal);
    cogs = money(cogs);

    const discount = money(Math.min(Math.max(input.discount ?? 0, 0), subtotal));
    // Read from settings in the main process — never taken from the renderer.
    const serviceCharge = money((subtotal * serviceChargePercent()) / 100);
    const total = money(subtotal - discount + serviceCharge);
    const profit = money(total - cogs);

    db.prepare(
      `UPDATE orders
          SET subtotal = ?, discount = ?, service_charge = ?, total = ?, profit = ?,
              payment_method = ?, status = 'settled', settled_at = ?
        WHERE id = ?`,
    ).run(subtotal, discount, serviceCharge, total, profit, input.payment_method, nowIso(), orderId);

    // The table frees itself: occupancy is derived from open orders, and this
    // order is no longer open.
    return orderId;
  });

  return getOrder(run())!;
}

/* ------------------------------------------------------------------ *
 * Voids
 * ------------------------------------------------------------------ */

/**
 * The reason is required and written onto the row. The voids report reads
 * exactly these columns — without them a void is invisible, which is the one
 * thing an owner most wants to see.
 *
 * The manager-PIN check happens in the IPC layer before either of these is
 * called, in the main process.
 */
export interface CancelInput {
  reason_code: CancelReasonCode;
  /** The typed detail behind "Other"; optional for the fixed reasons. */
  note?: string | null;
  /** Resolved in the main process from the signed-in session, never the UI. */
  staff_id: number | null;
}

/** The human-readable line stored alongside the code, for the printed record. */
function reasonText(input: CancelInput): string {
  const label = CANCEL_REASON_LABELS[input.reason_code];
  const note = (input.note ?? '').trim();
  return note ? `${label} — ${note}` : label;
}

/**
 * Cancel one line off an open order.
 *
 * Only reachable while the order is still open, so no money has been taken and
 * no manager PIN is involved — that gate belongs on paid orders (see
 * `voidOrder`). The reason, the time and the staff member are still recorded,
 * because a counter hand quietly removing items from a running bill before it
 * is settled is its own way of skimming.
 */
export function voidItem(orderItemId: number, input: CancelInput): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const line = db
      .prepare('SELECT order_id, kitchen_status, deal_group FROM order_items WHERE id = ?')
      .get(orderItemId) as
      | { order_id: number; kitchen_status: string; deal_group: number | null }
      | undefined;
    if (!line) throw new Error('That line is no longer on the order.');
    if (line.kitchen_status === 'void') throw new Error('That line is already cancelled.');

    const order = getOrder(line.order_id);
    if (order?.status !== 'open') throw new Error('This order is already closed.');

    const at = nowIso();
    const text = reasonText(input);

    // Cancelling one component of a deal would leave a partial combo on the
    // bill whose lines no longer sum to the price quoted. A deal goes as a unit.
    const where = line.deal_group ? 'deal_group = ?' : 'id = ?';
    const target = line.deal_group ?? orderItemId;

    db.prepare(
      `UPDATE order_items
          SET kitchen_status = 'void', void_reason = ?, voided_at = ?,
              void_reason_code = ?, void_note = ?, voided_by_staff_id = ?
        WHERE ${where} AND kitchen_status != 'void'`,
    ).run(text, at, input.reason_code, input.note || null, input.staff_id, target);

    recomputeSubtotal(line.order_id);
    return line.order_id;
  });

  return getOrder(run())!;
}

/**
 * Cancel a whole order — the action this app is most careful about.
 *
 * A cancellation is NEVER a delete. The order row stays exactly where it is,
 * with its items, its amount and its timestamps intact, and gains the answers
 * to who, when, why, and whether the money had already been taken. Nothing
 * about this is reversible from the counter and nothing about it is hidden.
 *
 * Two paths, deliberately different:
 *
 *  - **Open order** — nothing has been taken yet. A reason and a name; no
 *    manager needed. This is the honest everyday case (wrong order, customer
 *    walked out), and demanding a manager for every mis-tap would only teach
 *    the counter to work around the app.
 *
 *  - **Settled order** — the money is already in the till. This is the exact
 *    move a dishonest counter hand makes to pocket cash, so it requires the
 *    manager PIN, checked in the main process before this function is reached.
 *    Cancelling it drops the order out of `status = 'settled'`, so the day's
 *    takings fall by that amount — which is precisely what makes the theft
 *    visible instead of invisible.
 */
export function voidOrder(orderId: number, input: CancelInput): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new Error('That order no longer exists.');
    if (order.status === 'void') throw new Error('This order is already cancelled.');

    const wasPaid = order.status === 'settled';
    const at = nowIso();
    const text = reasonText(input);

    db.prepare(
      `UPDATE orders
          SET status = 'void', void_reason = ?, voided_at = ?,
              void_reason_code = ?, void_note = ?, voided_by_staff_id = ?,
              voided_was_paid = ?
        WHERE id = ?`,
    ).run(text, at, input.reason_code, input.note || null, input.staff_id, wasPaid ? 1 : 0, orderId);

    // settled_at, total and profit are deliberately left untouched. The order
    // has dropped out of every 'settled' report already, and those columns are
    // the record of what was actually taken before it was cancelled.
    db.prepare(
      `UPDATE order_items
          SET kitchen_status = 'void', void_reason = ?, voided_at = ?,
              void_reason_code = ?, void_note = ?, voided_by_staff_id = ?
        WHERE order_id = ? AND kitchen_status != 'void'`,
    ).run(text, at, input.reason_code, input.note || null, input.staff_id, orderId);

    return orderId;
  });

  return getOrder(run())!;
}

