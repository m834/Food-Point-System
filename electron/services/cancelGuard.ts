import { requirePin } from './managerPin';
import type { Order } from '../../shared/types';

/**
 * The one rule that stands between a dishonest counter hand and the till.
 *
 * Deliberately a named function rather than three lines inside an IPC closure:
 * this is the security boundary of the whole cancellation feature, so it
 * should be readable on its own, and testable on its own. A rule that can only
 * be exercised by standing up the IPC layer tends to end up untested.
 *
 *   - An order still OPEN has taken no money. Cancelling it is the ordinary,
 *     honest case (wrong order, customer walked out) and needs no manager.
 *   - An order already SETTLED has money in the till. Cancelling it is exactly
 *     the move used to pocket cash, so it needs the manager PIN — checked in
 *     the main process, never trusted from the renderer.
 */
export function assertMayCancel(order: Order, pin: unknown): void {
  if (order.status === 'void') {
    throw new Error('This order is already cancelled.');
  }
  if (order.status === 'settled') {
    requirePin(pin);
  }
}
