import { getDb } from '../connection';
import { money } from '../money';
import type { ExtraCharge, OrderExtra } from '../../../shared/types';

/**
 * Extras — packaging and disposables charged per order.
 *
 * Plates, glasses, a carry bag. They are money the shop takes that is not
 * food, and the whole reason they are not menu items is that distinction: a
 * menu item is something the kitchen makes, counts towards best-sellers and
 * belongs in food margin. Packaging is none of those. Blending them would
 * leave an owner unable to answer "how much of last month was actually food?"
 *
 * They apply to EVERY order type. A dine-in table can want disposable glasses
 * exactly as a delivery can, so nothing here looks at `orders.type`.
 */

/* ------------------------------------------------------------------ *
 * The list the shop maintains
 * ------------------------------------------------------------------ */

const SELECT = `
  SELECT id, name, price, cost_price, is_active, sort_order
  FROM extra_charges
`;

export function listExtras(activeOnly = false): ExtraCharge[] {
  return getDb()
    .prepare(`${SELECT}${activeOnly ? ' WHERE is_active = 1' : ''} ORDER BY sort_order, name`)
    .all() as ExtraCharge[];
}

export function getExtra(id: number): ExtraCharge | null {
  return (getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as ExtraCharge | undefined) ?? null;
}

export interface ExtraInput {
  id?: number;
  name: string;
  price: number;
  cost_price: number;
  is_active: boolean;
  sort_order: number;
}

export function saveExtra(input: ExtraInput): ExtraCharge {
  const db = getDb();

  if (input.id) {
    db.prepare(
      `UPDATE extra_charges
          SET name = ?, price = ?, cost_price = ?, is_active = ?, sort_order = ?
        WHERE id = ?`,
    ).run(
      input.name,
      money(input.price),
      money(input.cost_price),
      input.is_active ? 1 : 0,
      input.sort_order,
      input.id,
    );
    return getExtra(input.id)!;
  }

  const info = db
    .prepare(
      `INSERT INTO extra_charges (name, price, cost_price, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      money(input.price),
      money(input.cost_price),
      input.is_active ? 1 : 0,
      input.sort_order,
    );
  return getExtra(Number(info.lastInsertRowid))!;
}

export function removeExtra(id: number): void {
  // Past orders keep their snapshot name and price, so deleting an extra the
  // shop no longer offers cannot rewrite what an old bill said
  // (order_extras.extra_id is ON DELETE SET NULL).
  getDb().prepare('DELETE FROM extra_charges WHERE id = ?').run(id);
}

export function setExtraActive(id: number, active: boolean): ExtraCharge | null {
  getDb().prepare('UPDATE extra_charges SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return getExtra(id);
}

/* ------------------------------------------------------------------ *
 * Extras on an order
 * ------------------------------------------------------------------ */

export function listOrderExtras(orderId: number): OrderExtra[] {
  return getDb()
    .prepare(
      `SELECT id, order_id, extra_id, name, price, cost_price, qty, line_total
         FROM order_extras WHERE order_id = ? ORDER BY id`,
    )
    .all(orderId) as OrderExtra[];
}

/**
 * Set the quantity of one extra on an order.
 *
 * Idempotent by extra: setting a quantity replaces whatever was there, and
 * zero removes the row. That matches how the picker behaves — a stepper the
 * counter nudges up and down — rather than making them delete and re-add.
 */
export function setOrderExtra(orderId: number, extraId: number, qty: number): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM order_extras WHERE order_id = ? AND extra_id = ?')
    .get(orderId, extraId) as { id: number } | undefined;

  if (qty <= 0) {
    if (existing) db.prepare('DELETE FROM order_extras WHERE id = ?').run(existing.id);
    return;
  }

  const extra = getExtra(extraId);
  if (!extra) throw new Error('That extra is no longer on the list.');
  if (!extra.is_active) throw new Error(`${extra.name} is not currently offered.`);

  const lineTotal = money(qty * extra.price);

  if (existing) {
    db.prepare(
      'UPDATE order_extras SET qty = ?, price = ?, cost_price = ?, line_total = ? WHERE id = ?',
    ).run(qty, money(extra.price), money(extra.cost_price), lineTotal, existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO order_extras (order_id, extra_id, name, price, cost_price, qty, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(orderId, extra.id, extra.name, money(extra.price), money(extra.cost_price), qty, lineTotal);
}

/**
 * Recompute the cached total on the order.
 *
 * Stored rather than summed on every read because reports total it across
 * thousands of orders, and because it is one of the numbers `settleOrder`
 * locks in — the same reason `subtotal` is cached.
 */
export function recomputeExtrasTotal(orderId: number): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COALESCE(SUM(line_total), 0) AS total FROM order_extras WHERE order_id = ?')
    .get(orderId) as { total: number };

  const total = money(row.total);
  db.prepare('UPDATE orders SET extras_total = ? WHERE id = ?').run(total, orderId);
  return total;
}

/** What the extras on an order cost the shop — folded into COGS at settle. */
export function extrasCost(orderId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(qty * cost_price), 0) AS cost FROM order_extras WHERE order_id = ?')
    .get(orderId) as { cost: number };
  return money(row.cost);
}
