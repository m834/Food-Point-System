import { handle, asBool, asEnum, asId, asMoney, asNumber, asString } from './util';
import { listWaiters, removeWaiter, saveWaiter } from '../db/repositories/waiters';
import { requireAdmin } from '../services/adminSession';
import { WAITER_PAY_TYPES, type WaiterPayType } from '../../shared/types';

/**
 * The waiter roster.
 *
 * `waiters:list` is deliberately open to the counter — the takeaway waiter
 * dropdown on the order screen is exactly what it feeds, the same reason
 * `staff:list` and `tables:list` need no admin session. Everything that adds,
 * edits or removes a waiter is owner-only: deciding who is on the floor is an
 * admin-portal decision, not a counter one.
 */
export function registerWaiterHandlers(): void {
  handle('waiters:list', (_e, activeOnly) => listWaiters(asBool(activeOnly)));

  handle('waiters:save', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;

    // Undefined leaves the existing pay setup untouched — see saveWaiter().
    // Sending `pay_type` is what moves the other two together.
    let payType: WaiterPayType | undefined;
    let payday: number | null | undefined;
    if (raw.pay_type !== undefined) {
      payType = asEnum(raw.pay_type, WAITER_PAY_TYPES, 'Pay type');
      if (payType === 'daily') {
        payday = null;
      } else if (payType === 'weekly') {
        payday = asNumber(raw.payday, 'Payday', { min: 0, max: 6 });
      } else {
        payday = asNumber(raw.payday, 'Payday', { min: 1, max: 31 });
      }
    }

    return saveWaiter({
      id: raw.id === undefined || raw.id === null ? undefined : asId(raw.id, 'Waiter'),
      name: asString(raw.name, 'Name', { max: 60 }),
      code: raw.code ? asString(raw.code, 'Code', { required: false, max: 20 }) : null,
      is_active: raw.is_active === undefined ? true : asBool(raw.is_active),
      pay_type: payType,
      payday,
      wage_rate: raw.wage_rate === undefined ? undefined : asMoney(raw.wage_rate, 'Wage'),
    });
  });

  /**
   * Always a real delete — a waiter's name lives on in `orders.waiter_name`
   * as a snapshot, so removing the roster row here cannot touch a past bill
   * or report. See repositories/waiters.ts.
   */
  handle('waiters:remove', (_e, id) => {
    requireAdmin();
    removeWaiter(asId(id, 'Waiter'));
    return null;
  });
}
