import { getDb } from '../connection';
import { nowIso } from '../money';
import type { Customer } from '../../../shared/types';

/**
 * Customers, remembered by phone number.
 *
 * A convenience layer, nothing more. Orders keep their own snapshot of name,
 * phone and address, so this table can be edited or emptied without touching
 * a single past bill — which is what makes "delete a customer" a safe action
 * rather than a destructive one.
 *
 * The phone column is indexed but NOT unique. A shared household number, a
 * digit corrected later, or a restored backup can all produce two rows for one
 * number, and a UNIQUE constraint would turn any of those into a failed order
 * at the counter. Duplicates are tolerated; the most recently used row wins.
 */

const SELECT = `
  SELECT id, phone, name, address, notes, created_at, last_order_at, order_count
  FROM customers
`;

/** Digits only, so 0300-1234567 and "0300 1234567" find the same person. */
export function normalisePhone(phone: string): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * The lookup the order screen runs as the counter types.
 *
 * Matches on digits alone, and when several rows share a number returns the
 * one used most recently — that is the address the customer most likely still
 * lives at.
 */
export function findByPhone(phone: string): Customer | null {
  const digits = normalisePhone(phone);
  // Below a sensible length every lookup would match half the table.
  if (digits.length < 4) return null;

  return (
    (getDb()
      .prepare(
        `${SELECT}
          WHERE REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') = ?
          ORDER BY last_order_at DESC, id DESC
          LIMIT 1`,
      )
      .get(digits) as Customer | undefined) ?? null
  );
}

export function getCustomer(id: number): Customer | null {
  return (getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as Customer | undefined) ?? null;
}

/** The admin list, with an optional search across name and phone. */
export function listCustomers(search?: string): Customer[] {
  const term = (search ?? '').trim();
  if (!term) {
    return getDb()
      .prepare(`${SELECT} ORDER BY last_order_at DESC, id DESC`)
      .all() as Customer[];
  }

  const digits = normalisePhone(term);
  return getDb()
    .prepare(
      `${SELECT}
        WHERE name LIKE ?
           OR phone LIKE ?
           OR (? != '' AND REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') LIKE ?)
        ORDER BY last_order_at DESC, id DESC`,
    )
    .all(`%${term}%`, `%${term}%`, digits, `%${digits}%`) as Customer[];
}

export interface CustomerInput {
  id?: number;
  phone: string;
  name?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** Create or edit a record from the admin screen. */
export function saveCustomer(input: CustomerInput): Customer {
  const db = getDb();
  const phone = (input.phone ?? '').trim();
  if (!phone) throw new Error('A customer needs a phone number.');

  if (input.id) {
    db.prepare(
      'UPDATE customers SET phone = ?, name = ?, address = ?, notes = ? WHERE id = ?',
    ).run(phone, input.name || null, input.address || null, input.notes || null, input.id);
    return getCustomer(input.id)!;
  }

  const info = db
    .prepare(
      `INSERT INTO customers (phone, name, address, notes, created_at, order_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(phone, input.name || null, input.address || null, input.notes || null, nowIso());
  return getCustomer(Number(info.lastInsertRowid))!;
}

/**
 * Deleting a customer removes the convenience record and nothing else.
 *
 * Past orders keep their own snapshot of who they were for, so history is
 * untouched — which is the property that makes this safe to offer at all.
 */
export function removeCustomer(id: number): void {
  getDb().prepare('DELETE FROM customers WHERE id = ?').run(id);
}

/**
 * Record a customer from a placed order.
 *
 * New number creates a record; a known one has its details refreshed, because
 * people move and the address they just gave is more current than the one on
 * file. Order count and last-ordered move either way.
 *
 * NEVER THROWS. This runs after an order is already placed, and a customer
 * table problem must not fail an order the kitchen is about to cook. A blank
 * phone is simply ignored rather than creating an unusable record.
 */
export function rememberFromOrder(input: {
  phone?: string | null;
  name?: string | null;
  address?: string | null;
}): Customer | null {
  try {
    const phone = (input.phone ?? '').trim();
    if (!phone) return null;

    const db = getDb();
    const existing = findByPhone(phone);
    const at = nowIso();

    if (existing) {
      db.prepare(
        `UPDATE customers
            SET name = COALESCE(NULLIF(?, ''), name),
                address = COALESCE(NULLIF(?, ''), address),
                last_order_at = ?,
                order_count = order_count + 1
          WHERE id = ?`,
      ).run(input.name ?? '', input.address ?? '', at, existing.id);
      return getCustomer(existing.id);
    }

    const info = db
      .prepare(
        `INSERT INTO customers (phone, name, address, notes, created_at, last_order_at, order_count)
         VALUES (?, ?, ?, NULL, ?, ?, 1)`,
      )
      .run(phone, input.name || null, input.address || null, at, at);
    return getCustomer(Number(info.lastInsertRowid));
  } catch {
    // Deliberately swallowed: the order is already placed and must stand.
    return null;
  }
}

/** The admin CSV export, built here so quoting is done once and correctly. */
export function customersCsv(): string {
  const rows = listCustomers();
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    // A comma, quote or newline inside an address would otherwise shift every
    // following column — the classic way an exported list becomes unusable.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = ['Name', 'Phone', 'Address', 'Notes', 'Orders', 'Last order', 'First seen'];
  const lines = [header.join(',')];

  for (const c of rows) {
    lines.push(
      [c.name, c.phone, c.address, c.notes, c.order_count, c.last_order_at, c.created_at]
        .map(escape)
        .join(','),
    );
  }

  return lines.join('\r\n');
}
