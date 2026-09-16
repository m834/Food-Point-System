import { getDb } from '../connection';
import { money, nowIso } from '../money';
import type { Waiter, WaiterPayType } from '../../../shared/types';

/**
 * The waiter roster — optional, and only ever consulted for takeaway orders.
 *
 * Unlike staff, a waiter can be deleted outright at any time, even with
 * history against them: `orders.waiter_name` is snapshotted at order-open
 * time exactly like `customer_name`, so no report or reprint ever depends on
 * this table still holding the row. Deactivating is still preferred day to
 * day — it is what drops someone off the order-screen dropdown without
 * losing them from the admin list — but deleting is never blocked.
 */

const SELECT = `SELECT id, name, code, is_active, created_at, pay_type, payday, wage_rate FROM waiters`;

export function listWaiters(activeOnly = false): Waiter[] {
  return getDb()
    .prepare(`${SELECT}${activeOnly ? ' WHERE is_active = 1' : ''} ORDER BY is_active DESC, name`)
    .all() as Waiter[];
}

export function getWaiter(id: number): Waiter | null {
  return (getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as Waiter | undefined) ?? null;
}

export interface WaiterInput {
  id?: number;
  name: string;
  code?: string | null;
  is_active: boolean;
  /**
   * Pay fields, only consulted when "Enable waiter wages" is on. Undefined
   * on an edit leaves the existing values untouched — the code/active
   * toggles on the waiter list save the whole row without ever mentioning
   * pay, and must not silently reset it. Passing `pay_type` is what moves
   * all three together: `payday` is cleared to null for 'daily' regardless
   * of what is passed, and kept/normalised otherwise. See saveWaiter().
   */
  pay_type?: WaiterPayType;
  payday?: number | null;
  wage_rate?: number;
}

export function saveWaiter(input: WaiterInput): Waiter {
  const db = getDb();

  const run = db.transaction(() => {
    const existing = input.id ? getWaiter(input.id) : null;
    if (input.id && !existing) throw new Error('That waiter no longer exists.');

    const payType: WaiterPayType = input.pay_type ?? existing?.pay_type ?? 'daily';
    // Payday only moves when pay_type itself was part of this call — the one
    // wage-edit screen always sends both together. 'daily' never carries one.
    const payday =
      input.pay_type !== undefined
        ? payType === 'daily'
          ? null
          : (input.payday ?? null)
        : (existing?.payday ?? null);
    const wageRate =
      input.wage_rate === undefined ? (existing?.wage_rate ?? 0) : money(Math.max(input.wage_rate, 0));

    if (input.id) {
      db.prepare(
        `UPDATE waiters
            SET name = ?, code = ?, is_active = ?, pay_type = ?, payday = ?, wage_rate = ?
          WHERE id = ?`,
      ).run(input.name, input.code || null, input.is_active ? 1 : 0, payType, payday, wageRate, input.id);
      return input.id;
    }

    const info = db
      .prepare(
        `INSERT INTO waiters (name, code, is_active, created_at, pay_type, payday, wage_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.name, input.code || null, input.is_active ? 1 : 0, nowIso(), payType, payday, wageRate);
    return Number(info.lastInsertRowid);
  });

  return getWaiter(run())!;
}

/**
 * Always a real delete. Past orders keep their own `waiter_name` snapshot, so
 * removing a waiter here can never alter or blank out a bill or report that
 * already printed — see the schema note in migrate.ts.
 */
export function removeWaiter(id: number): void {
  getDb().prepare('DELETE FROM waiters WHERE id = ?').run(id);
}
