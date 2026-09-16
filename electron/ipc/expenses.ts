import { handle, asArray, asId, asMoney, asString } from './util';
import {
  listCurrentExpenses,
  removeExpense,
  saveExpense,
  saveWaiterWages,
  waiterWagesDraft,
} from '../db/repositories/expenses';
import { requireAdmin } from '../services/adminSession';

/**
 * Daily expenses and the waiter-wages review that posts into them.
 *
 * Every channel here is owner-only — counter staff must never reach either
 * screen, so `requireAdmin()` runs first on all of them, exactly like the
 * reports channels.
 */
export function registerExpenseHandlers(): void {
  handle('expenses:list', () => {
    requireAdmin();
    return listCurrentExpenses();
  });

  handle('expenses:save', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveExpense({
      id: raw.id === undefined || raw.id === null ? undefined : asId(raw.id, 'Expense'),
      description: asString(raw.description, 'Description', { max: 120 }),
      amount: asMoney(raw.amount, 'Amount'),
    });
  });

  handle('expenses:remove', (_e, id) => {
    requireAdmin();
    removeExpense(asId(id, 'Expense'));
    return null;
  });

  handle('wages:draft', () => {
    requireAdmin();
    return waiterWagesDraft();
  });

  handle('wages:save', (_e, entries) => {
    requireAdmin();
    const list = asArray(entries, 'Wages', 200).map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return {
        waiter_id: asId(e.waiter_id, 'Waiter'),
        amount: asMoney(e.amount, 'Wage'),
      };
    });
    return saveWaiterWages(list);
  });
}
