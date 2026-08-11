import { getAllSettings } from '../db/repositories/settings';
import { SETTING_KEYS, ORDER_TYPE_LABELS, type Order, type OrderItem } from '../../shared/types';

/**
 * The two print formats (spec §10).
 *
 * Both are plain text laid out for a 42-column thermal roll, which is what an
 * 80mm ESC/POS printer gives at font A. Building text here rather than raw
 * ESC/POS bytes means the same output can be previewed on screen, written to a
 * file, or handed to the printer driver unchanged.
 *
 * The two formats exist because they answer different questions:
 *   - The customer bill is about money.
 *   - The kitchen ticket is about what to cook. It carries NO prices — the
 *     kitchen does not need money, it needs clarity under noise and steam.
 */

const WIDTH = 42;

/**
 * Our mark on every bill that leaves a counter.
 *
 * Deliberately a constant rather than a setting: this is Code Hustlers'
 * credit and sales line, not the food point's own contact details — those come
 * from `business_name` / `business_phone` and print in the header. A shop owner
 * must not be able to edit this away, and every installed copy should carry the
 * same number.
 */
const DEVELOPER_CREDIT = 'Developed by Code Hustlers';
const DEVELOPER_PHONE = '+92-332-7969297';

function line(char = '-'): string {
  return char.repeat(WIDTH);
}

function centre(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return ' '.repeat(pad) + text;
}

/** Name on the left, amount right-aligned, so a column of money scans. */
function row(left: string, right: string): string {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

/** Wrap a long item name rather than truncating it — "Chicken Handi Fam..." helps nobody. */
function wrap(text: string, width: number, indent = ''): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current.length) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.map((l, i) => (i === 0 ? l : indent + l));
}

function money(value: number, symbol: string): string {
  return `${symbol}${value.toFixed(2)}`;
}

function header(order: Order): string[] {
  const where =
    order.type === 'dine_in' && order.table_name
      ? `${ORDER_TYPE_LABELS[order.type]} · ${order.table_name}`
      : ORDER_TYPE_LABELS[order.type];
  return [`Order ${order.order_no}`, where];
}

/* ------------------------------------------------------------------ *
 * Customer bill — the money format
 * ------------------------------------------------------------------ */

export function buildCustomerBill(order: Order): string {
  const settings = getAllSettings();
  const symbol = settings[SETTING_KEYS.currencySymbol] || 'Rs.';
  const out: string[] = [];

  out.push(centre(settings[SETTING_KEYS.businessName] || 'Food Point'));
  if (settings[SETTING_KEYS.businessAddress]) {
    out.push(...wrap(settings[SETTING_KEYS.businessAddress], WIDTH).map(centre));
  }
  if (settings[SETTING_KEYS.businessPhone]) {
    out.push(centre(settings[SETTING_KEYS.businessPhone]));
  }

  out.push('');
  const [orderLine, whereLine] = header(order);
  out.push(row(orderLine, whereLine));
  out.push(order.settled_at ?? order.opened_at);
  if (order.customer_name) out.push(`Customer: ${order.customer_name}`);
  if (order.customer_phone) out.push(`Phone: ${order.customer_phone}`);
  out.push(line());

  for (const item of order.items) {
    if (item.kitchen_status === 'void') continue;

    const qty = `${trimQty(item.qty)} x `;
    const amount = money(item.line_total, symbol);
    const nameWidth = WIDTH - amount.length - qty.length - 1;
    const nameLines = wrap(item.item_name, nameWidth, ' '.repeat(qty.length));

    out.push(row(qty + nameLines[0], amount));
    for (const extra of nameLines.slice(1)) out.push(extra);

    // Modifiers priced on the line above; showing the delta explains the total.
    for (const mod of item.modifiers) {
      const label = `   + ${mod.name}`;
      out.push(mod.price_delta ? row(label, money(mod.price_delta, symbol)) : label);
    }
    if (item.notes) out.push(`   (${item.notes})`);
  }

  out.push(line());
  out.push(row('Subtotal', money(order.subtotal, symbol)));
  if (order.discount) out.push(row('Discount', `-${money(order.discount, symbol)}`));
  if (order.service_charge) out.push(row('Service charge', money(order.service_charge, symbol)));
  out.push(line('='));
  out.push(row('TOTAL', money(order.total, symbol)));
  if (order.payment_method) {
    out.push(row('Paid by', order.payment_method === 'cash' ? 'Cash' : 'Card'));
  }
  out.push('');
  out.push(centre('Thank you — please come again'));
  out.push('');
  // Last, under the thank-you, so it never competes with the total. Two lines
  // because the credit and the number together overrun a 42-column roll.
  out.push(centre(DEVELOPER_CREDIT));
  out.push(centre(DEVELOPER_PHONE));
  out.push('');

  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Kitchen ticket (KOT) — the cooking format
 * ------------------------------------------------------------------ */

/**
 * Prints ONLY the items passed in — the ones just fired. Firing again later
 * produces a second ticket with only the newly added lines; reprinting the
 * whole order would have the kitchen cook everything twice.
 *
 * No prices anywhere. Quantities lead the line and are padded, so a cook can
 * read "2 x" at a glance across a hot pass.
 */
export function buildKitchenTicket(order: Order, fired: OrderItem[]): string {
  const out: string[] = [];
  const [orderLine, whereLine] = header(order);

  out.push(line('*'));
  out.push(centre('KITCHEN'));
  out.push(line('*'));
  out.push(orderLine);
  out.push(whereLine);
  out.push(new Date().toTimeString().slice(0, 5));
  out.push(line());

  for (const item of fired) {
    if (item.kitchen_status === 'void') continue;

    const qty = `${trimQty(item.qty)} x `;
    for (const [i, text] of wrap(item.item_name.toUpperCase(), WIDTH - qty.length, ' '.repeat(qty.length)).entries()) {
      out.push(i === 0 ? qty + text : text);
    }
    for (const mod of item.modifiers) out.push(`   - ${mod.name}`);
    // A line note is the single most likely thing to matter here.
    if (item.notes) out.push(`   ** ${item.notes.toUpperCase()} **`);
    out.push('');
  }

  out.push(line());
  out.push('');

  return out.join('\n');
}

/** "2", not "2.00" — but "1.5" keeps its half, because half portions are real. */
function trimQty(qty: number): string {
  return String(Math.round(qty * 100) / 100);
}
