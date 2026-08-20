import { getDb } from '../connection';
import { money } from '../money';
import type { Deal, DealComponent, DealLineSpec } from '../../../shared/types';

/**
 * Deals — a named bundle of menu items sold at one fixed combo price.
 *
 * The whole design turns on one decision: **a deal is stored as its component
 * items, not as a single opaque product.** The customer sees one line at the
 * combo price; the database sees the real burger, the real fries and the real
 * drink, each carrying its own snapshot `cost_price`.
 *
 * That matters because this app has no stock table (spec §2 — a food point
 * cooks to order, recipe costing is deferred). "Deduct the underlying items"
 * therefore means: every place that consumes an order line must still see the
 * real food. Storing components rather than a blob is what keeps
 *
 *   - profit honest      — COGS sums the true per-item food cost,
 *   - best-sellers true  — a deal's burgers count as burgers sold,
 *   - the kitchen right  — the KOT lists what to actually cook.
 *
 * The combo price is then spread ACROSS those component lines so that their
 * `line_total`s add up to exactly the deal price. Nothing downstream needs to
 * know a deal was involved: `recomputeSubtotal`, `settleOrder` and every report
 * keep summing `line_total` the way they already did.
 */

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const DEAL_SELECT = `
  SELECT id, name, price, is_active, sort_order, notes, image_file
  FROM deals
`;

function hydrate(rows: Array<Omit<Deal, 'components'>>): Deal[] {
  if (!rows.length) return [];
  const db = getDb();

  const components = db
    .prepare(
      `SELECT d.id, d.deal_id, d.menu_item_id, d.qty,
              m.name         AS item_name,
              m.sale_price   AS sale_price,
              m.cost_price   AS cost_price,
              m.is_available AS is_available
         FROM deal_items d
         JOIN menu_items m ON m.id = d.menu_item_id
        WHERE d.deal_id IN (${rows.map(() => '?').join(', ')})
        ORDER BY d.id`,
    )
    .all(...rows.map((r) => r.id)) as DealComponent[];

  return rows.map((deal) => {
    const mine = components.filter((c) => c.deal_id === deal.id);
    return {
      ...deal,
      components: mine,
      // What the parts would cost bought separately — the owner needs to see
      // the saving they are offering, and the order screen shows it too.
      menu_value: money(mine.reduce((sum, c) => sum + c.qty * c.sale_price, 0)),
      // Any sold-out component takes the whole deal off the order screen:
      // half a combo is not the combo the customer was promised.
      is_sellable: mine.length > 0 && mine.every((c) => c.is_available === 1),
    };
  });
}

export function listDeals(activeOnly = false): Deal[] {
  const rows = getDb()
    .prepare(`${DEAL_SELECT}${activeOnly ? ' WHERE is_active = 1' : ''} ORDER BY sort_order, name`)
    .all() as Array<Omit<Deal, 'components'>>;
  return hydrate(rows);
}

export function getDeal(id: number): Deal | null {
  const row = getDb().prepare(`${DEAL_SELECT} WHERE id = ?`).get(id) as
    | Omit<Deal, 'components'>
    | undefined;
  return row ? hydrate([row])[0] : null;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface DealInput {
  id?: number;
  name: string;
  price: number;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
  image_file?: string | null;
  components: Array<{ menu_item_id: number; qty: number }>;
}

export function saveDeal(input: DealInput): Deal {
  const db = getDb();

  const run = db.transaction(() => {
    if (!input.components.length) {
      throw new Error('A deal needs at least one item in it.');
    }

    let id = input.id ?? 0;

    if (id) {
      db.prepare(
        `UPDATE deals SET name = ?, price = ?, is_active = ?, sort_order = ?, notes = ?,
                          image_file = ?
          WHERE id = ?`,
      ).run(
        input.name,
        money(input.price),
        input.is_active ? 1 : 0,
        input.sort_order,
        input.notes || null,
        input.image_file ?? null,
        id,
      );
    } else {
      const info = db
        .prepare(
          `INSERT INTO deals (name, price, is_active, sort_order, notes, image_file)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          money(input.price),
          input.is_active ? 1 : 0,
          input.sort_order,
          input.notes || null,
          input.image_file ?? null,
        );
      id = Number(info.lastInsertRowid);
    }

    // Replace the contents wholesale. Orders already taken are untouched —
    // they snapshotted their own component rows at the time of sale.
    db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(id);
    const link = db.prepare(
      'INSERT INTO deal_items (deal_id, menu_item_id, qty) VALUES (?, ?, ?)',
    );
    for (const part of input.components) {
      if (!(part.qty > 0)) throw new Error('Every item in a deal needs a quantity above zero.');
      link.run(id, part.menu_item_id, part.qty);
    }

    return id;
  });

  return getDeal(run())!;
}

export function removeDeal(id: number): void {
  // Past order lines keep their snapshot deal_name, so history survives the
  // deal being deleted (order_items.deal_id SET NULL).
  getDb().prepare('DELETE FROM deals WHERE id = ?').run(id);
}

export function setDealActive(id: number, active: boolean): Deal | null {
  getDb().prepare('UPDATE deals SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return getDeal(id);
}

/* ------------------------------------------------------------------ *
 * Selling a deal — spreading one price over several lines
 * ------------------------------------------------------------------ */

/**
 * Turn "one Family Deal at Rs 550" into the component lines that get written
 * to `order_items`.
 *
 * The combo price is split across the components **in proportion to what each
 * is worth on the menu**, rather than evenly, so the cheap drink does not
 * absorb the same discount as the expensive burger. Two properties matter:
 *
 *  1. The shares must add up to EXACTLY the deal price. Rounding each share
 *     independently would drift by a paisa or two and leave the bill printing
 *     a total that its own lines do not sum to. So every share but the last is
 *     rounded, and the last one takes the remainder — the classic largest-
 *     remainder fix, applied to money.
 *  2. `cost_price` is never touched. It stays the real food cost of the real
 *     item, because that is the number profit is computed from at settle time.
 *     A discount reduces revenue; it does not make the food cheaper to cook.
 */
export function buildDealLines(dealId: number, quantity: number): DealLineSpec[] {
  const deal = getDeal(dealId);
  if (!deal) throw new Error('That deal no longer exists.');
  if (!deal.is_active) throw new Error(`${deal.name} is not currently on offer.`);
  if (!deal.components.length) throw new Error(`${deal.name} has no items in it yet.`);
  if (!(quantity > 0)) throw new Error('Quantity must be more than zero.');

  const soldOut = deal.components.find((c) => c.is_available !== 1);
  if (soldOut) {
    throw new Error(`${deal.name} is unavailable — ${soldOut.item_name} is marked sold out.`);
  }

  const dealTotal = money(deal.price * quantity);

  // Weight by menu value. When every component is priced at zero there is no
  // meaningful proportion, so fall back to an even split.
  const weights = deal.components.map((c) => c.qty * c.sale_price);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const even = totalWeight <= 0;

  const lines: DealLineSpec[] = [];
  let assigned = 0;

  deal.components.forEach((component, index) => {
    const isLast = index === deal.components.length - 1;
    const share = isLast
      ? money(dealTotal - assigned)
      : money(dealTotal * (even ? 1 / deal.components.length : weights[index] / totalWeight));

    assigned = money(assigned + share);

    const lineQty = component.qty * quantity;
    lines.push({
      menu_item_id: component.menu_item_id,
      item_name: component.item_name,
      qty: lineQty,
      // The real food cost, untouched by the combo discount.
      cost_price: money(component.cost_price),
      // The effective unit price inside this deal. line_total stays the
      // authority — this is the snapshot that explains it.
      sale_price: lineQty > 0 ? money(share / lineQty) : 0,
      line_total: share,
      deal_id: deal.id,
      deal_name: deal.name,
    });
  });

  return lines;
}
