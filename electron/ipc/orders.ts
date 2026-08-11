import {
  handle,
  asArray,
  asEnum,
  asId,
  asMoney,
  asNumber,
  asOptionalId,
  asString,
} from './util';
import {
  addItems,
  fireToKitchen,
  getOrder,
  listOpenOrders,
  openOrder,
  setItemQty,
  settleOrder,
  voidItem,
  voidOrder,
} from '../db/repositories/orders';
import { printCustomerBill, printKitchenTicket } from '../services/printing';
import { requirePin } from '../services/managerPin';
import { buildCustomerBill, buildKitchenTicket } from '../services/receipt';
import type { NewOrderLine, OrderType, PaymentMethod } from '../../shared/types';

const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const satisfies readonly OrderType[];
const PAYMENT_METHODS = ['cash', 'card'] as const satisfies readonly PaymentMethod[];

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
    });
  });

  handle('orders:get', (_e, id) => getOrder(asId(id, 'Order')));

  handle('orders:listOpen', () => listOpenOrders());

  handle('orders:addItems', (_e, orderId, lines) =>
    addItems(asId(orderId, 'Order'), parseLines(lines)),
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

  /* ---- Voids: PIN checked here, in the main process ---- */

  handle('orders:voidItem', (_e, orderItemId, reason, pin) => {
    requirePin(pin);
    return voidItem(
      asId(orderItemId, 'Line'),
      asString(reason, 'Reason for voiding', { max: 200 }),
    );
  });

  handle('orders:voidOrder', (_e, orderId, reason, pin) => {
    requirePin(pin);
    return voidOrder(asId(orderId, 'Order'), asString(reason, 'Reason for voiding', { max: 200 }));
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
