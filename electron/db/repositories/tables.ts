import { getDb } from '../connection';
import type { DiningTable } from '../../../shared/types';

/**
 * Dine-in tables.
 *
 * There is no stored free/occupied column, on purpose. Occupancy is a fact
 * about orders — a table is occupied exactly when an open order points at it —
 * so it is derived on every read. A stored flag is a second source of truth,
 * and the moment the app dies between settling an order and clearing the flag,
 * the table is stranded as "occupied" with no way back except editing the
 * database at a counter mid-service. A floor is a few dozen rows; the join
 * costs nothing and cannot go stale.
 */

const SELECT_SQL = `
  SELECT t.id, t.name, t.area, t.seats,
         o.id AS open_order_id,
         COALESCE(o.subtotal, 0) AS running_total
  FROM tables t
  LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
`;

const ORDER_BY = ' ORDER BY t.area IS NULL, t.area, t.name';

export function listTables(): DiningTable[] {
  return getDb().prepare(SELECT_SQL + ORDER_BY).all() as DiningTable[];
}

export function getTable(id: number): DiningTable | null {
  return (
    (getDb().prepare(`${SELECT_SQL} WHERE t.id = ?`).get(id) as DiningTable | undefined) ?? null
  );
}

/** The open order sitting on a table, if any. Used to refuse a double-open. */
export function openOrderIdForTable(tableId: number): number | null {
  const row = getDb()
    .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open' LIMIT 1")
    .get(tableId) as { id: number } | undefined;
  return row?.id ?? null;
}

export function saveTable(input: {
  id?: number;
  name: string;
  area: string | null;
  seats: number | null;
}): DiningTable {
  const db = getDb();
  if (input.id) {
    db.prepare('UPDATE tables SET name = ?, area = ?, seats = ? WHERE id = ?').run(
      input.name,
      input.area,
      input.seats,
      input.id,
    );
    return getTable(input.id)!;
  }
  const info = db
    .prepare('INSERT INTO tables (name, area, seats) VALUES (?, ?, ?)')
    .run(input.name, input.area, input.seats);
  return getTable(Number(info.lastInsertRowid))!;
}

export function removeTable(id: number): void {
  if (openOrderIdForTable(id)) {
    throw new Error('This table has an open order. Settle or void it first.');
  }
  getDb().prepare('DELETE FROM tables WHERE id = ?').run(id);
}
