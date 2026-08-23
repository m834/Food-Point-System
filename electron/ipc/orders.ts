import {
  handle,
  asArray,
  asDate,
  asEnum,
  asId,
  asMoney,
  asNumber,
  asOptionalId,
  asString,
} from './util';
import {
  addDeal,
  addItems,
  fireToKitchen,
  getOrder,
  listOpenOrders,
  listUnpaidOrders,
  listOrders,
  openOrder,
  setDelivery,
  setExtraOnOrder,
  setItemQty,
  settleOrder,
  voidItem,
  voidOrder,
} from '../db/repositories/orders';
import { printCustomerBill, printKitchenTicket } from '../services/printing';
import { assertMayCancel } from '../services/cancelGuard';
import { requireStaffForAudit } from '../services/session';
import { buildCustomerBill, buildKitchenTicket } from '../services/receipt';
import { CANCEL_REASONS } from '../../shared/types';
import type { CancelReasonCode, NewOrderLine, OrderType, PaymentMethod } from '../../shared/types';

const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const satisfies readonly OrderType[];
const PAYMENT_METHODS = ['cash', 'card'] as const satisfies readonly PaymentMethod[];
const ORDER_STATUSES = ['settled', 'void', 'open'] as const;

function parseLines(raw: unknown): NewOrderLine[] {
  const entries = asArray(raw, 'Order items');
  if (!entries.length) throw new Error('There is nothing to add.');

  return entries.map((entry) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    return {
      menu_item_id: asId(line.menu_item_id, 'Menu item'),
      qty: asNumber(line.qty, 'Quantity', { min: 0.01, max: 999 }),
      notes: line.notes ? asString(line.notes, 'Note', { required: false, max: 200 }) : null,
      modifier_ids: line.modifier_ids
        ? asArray(line.modifier_ids, 'Modifiers', 30).map((id) => asId(id, 'Modifier'))
        : [],
      variant_id: asOptionalId(line.variant_id, 'Size'),
    };
  });
}

export function registerOrderHandlers(): void {
  handle('orders:open', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const type = asEnum(raw.type, ORDER_TYPES, 'Order type');
    return openOrder({
      type,
      table_id: type === 'dine_in' ? asOptionalId(raw.table_id, 'Table') : null,
      customer_name: raw.customer_name
        ? asString(raw.customer_name, 'Customer name', { required: false, max: 80 })
        : null,
      customer_phone: raw.customer_phone
        ? asString(raw.customer_phone, 'Phone', { required: false, max: 30 })
        : null,
      // Only meaningful for a delivery; the repository ignores them otherwise
      // and enforces that an address is actually present.
      delivery_address: raw.delivery_address
        ? asString(raw.delivery_address, 'Delivery address', { required: false, max: 300 })
        : null,
      delivery_charge:
        raw.delivery_charge === undefined
          ? undefined
          : asMoney(raw.delivery_charge, 'Delivery charge'),
    });
  });

  handle('orders:get', (_e, id) => getOrder(asId(id, 'Order')));

  handle('orders:listOpen', () => listOpenOrders());

  /**
   * Every unpaid order, with what it owes. No date range on purpose — see
   * listUnpaidOrders(). Not gated: chasing unpaid money is the counter's job.
   */
  handle('orders:listUnpaid', () => listUnpaidOrders());

  handle('orders:list', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return listOrders(
      asDate(raw.from, 'From date'),
      asDate(raw.to, 'To date'),
      raw.status ? asEnum(raw.status, ORDER_STATUSES, 'Status') : undefined,
    );
  });

  handle('orders:addItems', (_e, orderId, lines) =>
    addItems(asId(orderId, 'Order'), parseLines(lines)),
  );

  /**
   * Add a whole deal in ONE action. The renderer sends only which deal and how
   * many; the backend expands it into component lines and prices them.
   */
  handle('orders:addDeal', (_e, orderId, dealId, quantity) =>
    addDeal(
      asId(orderId, 'Order'),
      asId(dealId, 'Deal'),
      quantity === undefined ? 1 : asNumber(quantity, 'Quantity', { min: 1, max: 99 }),
    ),
  );

  /**
   * Change the delivery details on an open order.
   *
   * A rider's address gets corrected more often than anything else on a
   * delivery — a wrong house number is caught while the food cooks — so it
   * must be editable without voiding and re-taking the order.
   */
  handle('orders:setDelivery', (_e, orderId, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return setDelivery(asId(orderId, 'Order'), {
      delivery_address: asString(raw.delivery_address, 'Delivery address', { max: 300 }),
      delivery_charge:
        raw.delivery_charge === undefined ? undefined : asMoney(raw.delivery_charge, 'Delivery charge'),
      customer_name: raw.customer_name
        ? asString(raw.customer_name, 'Customer name', { required: false, max: 80 })
        : null,
      customer_phone: raw.customer_phone
        ? asString(raw.customer_phone, 'Phone', { required: false, max: 30 })
        : null,
    });
  });

  /**
   * Add/change/remove an extra on an open order. The renderer names which
   * extra and how many; the backend prices it from the shop's list.
   */
  handle('orders:setExtra', (_e, orderId, extraId, qty) =>
    setExtraOnOrder(
      asId(orderId, 'Order'),
      asId(extraId, 'Extra'),
      asNumber(qty, 'Quantity', { min: 0, max: 999 }),
    ),
  );

  handle('orders:setItemQty', (_e, orderItemId, qty) =>
    setItemQty(asId(orderItemId, 'Line'), asNumber(qty, 'Quantity', { min: 0, max: 999 })),
  );

  /**
   * Fire: mark the new lines and print a ticket of exactly those. The print
   * outcome rides back with the order so the UI can say "fired, but the ticket
   * didn't print" — the firing itself already happened and must not be undone
   * because the kitchen printer is out of paper.
   */
  handle('orders:fire', async (_e, orderId) => {
    const { order, fired } = fireToKitchen(asId(orderId, 'Order'));
    const outcome = await printKitchenTicket(order, fired);
    return { order, fired, print: outcome };
  });

  handle('orders:settle', async (_e, orderId, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    // Note what is NOT read here: the service charge. It comes from settings in
    // the main process, so the UI cannot bill a percentage the owner never set.
    const order = settleOrder(asId(orderId, 'Order'), {
      discount: raw.discount === undefined ? 0 : asMoney(raw.discount, 'Discount'),
      payment_method: asEnum(raw.payment_method, PAYMENT_METHODS, 'Payment method'),
    });
    const print = await printCustomerBill(order);
    return { order, print };
  });

  handle('orders:reprintBill', async (_e, orderId) => {
    const order = getOrder(asId(orderId, 'Order'));
    if (!order) throw new Error('That order no longer exists.');
    return printCustomerBill(order);
  });

  /* ------------------------------------------------------------------ *
   * Cancellations — the anti-theft gate, enforced here in the main process
   * ------------------------------------------------------------------ */

  /**
   * Parse the reason. It is a fixed list, not free text: free text cannot be
   * counted or compared, and "asdf" is a valid free-text reason. "Other" is
   * the only code that carries a typed note, and it must actually carry one —
   * otherwise it becomes the escape hatch that empties the whole list of
   * meaning.
   */
  const parseReason = (rawReason: unknown, rawNote: unknown) => {
    const reason_code = asEnum(rawReason, CANCEL_REASONS, 'Reason') as CancelReasonCode;
    const note = rawNote ? asString(rawNote, 'Note', { required: false, max: 200 }) : '';
    if (reason_code === 'other' && !note.trim()) {
      throw new Error('Choose a reason, or say what happened in the note.');
    }
    return { reason_code, note: note || null };
  };

  /**
   * Cancel a line off an OPEN order. No manager PIN — nothing has been taken
   * yet — but it is still stamped with the signed-in staff member.
   */
  handle('orders:voidItem', (_e, orderItemId, reason, note) => {
    const staff_id = requireStaffForAudit();
    return voidItem(asId(orderItemId, 'Line'), { ...parseReason(reason, note), staff_id });
  });

  /**
   * Cancel a whole order.
   *
   * The gate that matters: if the order has already been PAID, the manager PIN
   * is required before anything is written. That is the move a dishonest
   * counter hand makes to pocket cash, and a normal staff member must not be
   * able to complete it alone. An unpaid order needs only a reason and a name.
   *
   * The PIN is checked HERE, in the main process, before `voidOrder` is
   * reached — the renderer never gets to report that a check passed.
   */
  handle('orders:voidOrder', (_e, orderId, reason, note, pin) => {
    const id = asId(orderId, 'Order');

    const order = getOrder(id);
    if (!order) throw new Error('That order no longer exists.');
    // The gate: a paid order needs the manager PIN, an open one does not.
    assertMayCancel(order, pin);

    const staff_id = requireStaffForAudit();
    return voidOrder(id, { ...parseReason(reason, note), staff_id });
  });

  /* ---- Previews, so the UI can show a bill without a printer attached ---- */

  handle('orders:previewBill', (_e, orderId) => {
    const order = getOrder(asId(orderId, 'Order'));
    if (!order) throw new Error('That order no longer exists.');
    return buildCustomerBill(order);
  });

  handle('orders:previewTicket', (_e, orderId) => {
    const order = getOrder(asId(orderId, 'Order'));
    if (!order) throw new Error('That order no longer exists.');
    const pending = order.items.filter((item) => item.kitchen_status === 'new');
    return buildKitchenTicket(order, pending.length ? pending : order.items);
  });
}
