import { handle, asBool, asEnum, asId, asMoney, asNumber, asString } from './util';
import {
  listRecurringExpenses,
  removeRecurringExpense,
  saveRecurringExpense,
} from '../db/repositories/recurringExpenses';
import { requireAdmin } from '../services/adminSession';
import { RECURRING_EXPENSE_PAY_TYPES } from '../../shared/types';

/**
 * The recurring-expense roster — rent, a subscription, anything paid on a
 * standing cadence. Admin-only throughout: this is money leaving the till,
 * the same reason the Expenses screen itself is owner-only.
 */
export function registerRecurringExpenseHandlers(): void {
  handle('recurringExpenses:list', () => {
    requireAdmin();
    return listRecurringExpenses();
  });

  handle('recurringExpenses:save', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;

    const payType = asEnum(raw.pay_type, RECURRING_EXPENSE_PAY_TYPES, 'Pay type');
    const payday =
      payType === 'daily' ? null : asNumber(raw.payday, 'Payday', { min: 1, max: 31 });

    return saveRecurringExpense({
      id: raw.id === undefined || raw.id === null ? undefined : asId(raw.id, 'Recurring expense'),
      description: asString(raw.description, 'Description', { max: 120 }),
      amount: asMoney(raw.amount, 'Amount'),
      pay_type: payType,
      payday,
      is_active: raw.is_active === undefined ? true : asBool(raw.is_active),
    });
  });

  /**
   * Always a real delete — a past posting keeps its own `description`
   * snapshot (see repositories/expenses.ts), so removing the definition here
   * can never alter a line already posted to the ledger.
   */
  handle('recurringExpenses:remove', (_e, id) => {
    requireAdmin();
    removeRecurringExpense(asId(id, 'Recurring expense'));
    return null;
  });
}
