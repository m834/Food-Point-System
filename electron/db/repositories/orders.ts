import { getDb } from '../connection';
import { money, nowIso, orderNoPrefix } from '../money';
import { getItem, getModifiersByIds } from './menu';
import { openOrderIdForTable } from './tables';
import { serviceChargePercent } from './settings';
import type {
  NewOrderLine,
  OpenOrderSummary,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderType,
  PaymentMethod,
} from '../../../shared/types';

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
         o.payment_method, o.void_reason, o.voided_at
  FROM orders o
  LEFT JOIN tables t ON t.id = o.table_id
`;

type OrderRow = Omit<Order, 'items'>;

function hydrate(row: OrderRow): Order {
  const db = getDb();

  const items = db
    .prepare(
      `SELECT id, order_id, menu_item_id, item_name, qty, cost_price, sale_price,
              line_total, notes, kitchen_status, fired_at, void_reason, voided_at
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

export function listSettledOrders(from: string, to: string): Order[] {
  const rows = getDb()
    .prepare(
      `${ORDER_SELECT} WHERE o.status = 'settled' AND date(o.settled_at) BETWEEN ? AND ?
        ORDER BY o.settled_at DESC`,
    )
    .all(from, to) as OrderRow[];
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
        `SELECT oi.order_id, oi.kitchen_status, oi.qty, oi.line_total, o.status AS order_status
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.id = ?`,
      )
      .get(orderItemId) as
      | { order_id: number; kitchen_status: string; qty: number; line_total: number; order_status: string }
      | undefined;

    if (!line) throw new Error('That line is no longer on the order.');
    if (line.order_status !== 'open') throw new Error('This order is already closed.');
    if (line.kitchen_status !== 'new') {
      throw new Error('This item has already gone to the kitchen — void it instead.');
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
export function voidItem(orderItemId: number, reason: string): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const line = db
      .prepare('SELECT order_id, kitchen_status FROM order_items WHERE id = ?')
      .get(orderItemId) as { order_id: number; kitchen_status: string } | undefined;
    if (!line) throw new Error('That line is no longer on the order.');
    if (line.kitchen_status === 'void') throw new Error('That line is already voided.');

    const order = getOrder(line.order_id);
    if (order?.status !== 'open') throw new Error('This order is already closed.');

    db.prepare(
      "UPDATE order_items SET kitchen_status = 'void', void_reason = ?, voided_at = ? WHERE id = ?",
    ).run(reason, nowIso(), orderItemId);

    recomputeSubtotal(line.order_id);
    return line.order_id;
  });

  return getOrder(run())!;
}

export function voidOrder(orderId: number, reason: string): Order {
  const db = getDb();

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new Error('That order no longer exists.');
    if (order.status === 'settled') throw new Error('A paid order cannot be voided.');
    if (order.status === 'void') throw new Error('This order is already voided.');

    const at = nowIso();
    db.prepare("UPDATE orders SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?").run(
      reason,
      at,
      orderId,
    );
    db.prepare(
      `UPDATE order_items SET kitchen_status = 'void', void_reason = ?, voided_at = ?
        WHERE order_id = ? AND kitchen_status != 'void'`,
    ).run(reason, at, orderId);

    return orderId;
  });

  return getOrder(run())!;
}
