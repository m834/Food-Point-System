import { getDb } from '../connection';
import { money, nowIso } from '../money';
import type { RecurringExpense, RecurringExpensePayType } from '../../../shared/types';

/**
 * The recurring-expense roster — rent, a subscription, anything paid on a
 * standing cadence rather than retyped each time it falls due.
 *
 * Deliberately a definition only. Nothing here ever touches the `expenses`
 * ledger by itself — see `recurringExpenseDraft` / `saveRecurringExpensePostings`
 * in repositories/expenses.ts, which is the one place that actually posts,
 * and only once the owner has reviewed and confirmed an occurrence.
 */

const SELECT = `
  SELECT id, description, amount, pay_type, payday, is_active, created_at
  FROM recurring_expenses
`;

export function listRecurringExpenses(activeOnly = false): RecurringExpense[] {
  return getDb()
    .prepare(`${SELECT}${activeOnly ? ' WHERE is_active = 1' : ''} ORDER BY is_active DESC, description`)
    .all() as RecurringExpense[];
}

export function getRecurringExpense(id: number): RecurringExpense | null {
  return (
    (getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as RecurringExpense | undefined) ?? null
  );
}

export interface RecurringExpenseInput {
  id?: number;
  description: string;
  amount: number;
  pay_type: RecurringExpensePayType;
  /** Required for 'monthly'; ignored (stored as null) for 'daily'. */
  payday: number | null;
  is_active: boolean;
}

export function saveRecurringExpense(input: RecurringExpenseInput): RecurringExpense {
  const db = getDb();
  const amount = money(Math.max(input.amount, 0));
  const payday = input.pay_type === 'daily' ? null : input.payday;

  const run = db.transaction(() => {
    if (input.id) {
      db.prepare(
        `UPDATE recurring_expenses
            SET description = ?, amount = ?, pay_type = ?, payday = ?, is_active = ?
          WHERE id = ?`,
      ).run(input.description, amount, input.pay_type, payday, input.is_active ? 1 : 0, input.id);
      return input.id;
    }

    const info = db
      .prepare(
        `INSERT INTO recurring_expenses (description, amount, pay_type, payday, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.description, amount, input.pay_type, payday, input.is_active ? 1 : 0, nowIso());
    return Number(info.lastInsertRowid);
  });

  return getRecurringExpense(run())!;
}

/**
 * Always a real delete. Past postings keep their own `description` snapshot
 * (see repositories/expenses.ts), so removing the definition here can never
 * alter a line already posted to the ledger.
 */
export function removeRecurringExpense(id: number): void {
  getDb().prepare('DELETE FROM recurring_expenses WHERE id = ?').run(id);
}
