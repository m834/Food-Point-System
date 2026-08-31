import { getAllSettings, serviceChargeFor } from '../db/repositories/settings';
import { groupOrderLines, isDealGroup } from '../../shared/dealLines';
import {
  SETTING_KEYS,
  ORDER_TYPE_LABELS,
  type DayReport,
  type Order,
  type OrderItem,
} from '../../shared/types';

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

  // A ruled masthead rather than a bare line of text. Thermal paper has no
  // logo to lean on, so the rules do the work of carrying the top of the bill.
  // The name itself stays verbatim — letter-spacing it would look smart and
  // make the shop's own name unsearchable in a reprinted bill.
  out.push(line('='));
  out.push(centre(settings[SETTING_KEYS.businessName] || 'Food Point'));
  if (settings[SETTING_KEYS.businessAddress]) {
    out.push(...wrap(settings[SETTING_KEYS.businessAddress], WIDTH).map(centre));
  }
  if (settings[SETTING_KEYS.businessPhone]) {
    out.push(centre(settings[SETTING_KEYS.businessPhone]));
  }

  out.push(line('='));
  const [orderLine, whereLine] = header(order);
  out.push(row(orderLine, whereLine));
  out.push(order.settled_at ?? order.opened_at);

  /**
   * The delivery block — this slip is what the rider carries.
   *
   * Banner-lined and near the top so it cannot be missed on a busy pass, and
   * the address is wrapped rather than truncated: half an address is worse
   * than none, because it looks complete.
   */
  if (order.type === 'delivery') {
    out.push('');
    out.push(centre('*** DELIVERY ***'));
    if (order.delivery_address) {
      out.push(...wrap(order.delivery_address, WIDTH));
    }
  }

  /**
   * An UNPAID order can be printed too — that is how a customer is handed
   * what they owe. It must never be mistakable for a receipt, so it is
   * banner-lined at the top, totalled as AMOUNT DUE rather than TOTAL, and
   * closes by asking for payment instead of thanking them for it.
   */
  const unpaid = order.status === 'open';
  if (unpaid) {
    out.push('');
    out.push(centre('*** UNPAID — NOT A RECEIPT ***'));
  }

  if (order.customer_name) out.push(`Customer: ${order.customer_name}`);
  if (order.customer_phone) out.push(`Phone: ${order.customer_phone}`);
  out.push(line());

  /**
   * Deals print as ONE line at the combo price, with their contents listed
   * underneath without prices. The component rows exist in the database and
   * carry the real food costs, but a customer handed a bill that itemises a
   * "deal" into three separately-priced parts would reasonably ask why the
   * numbers do not match the price on the menu board.
   */
  for (const entry of groupOrderLines(order.items)) {
    if (isDealGroup(entry)) {
      const qty = `${trimQty(entry.qty)} x `;
      const amount = money(entry.total, symbol);
      const nameWidth = WIDTH - amount.length - qty.length - 1;
      const nameLines = wrap(entry.deal_name, nameWidth, ' '.repeat(qty.length));

      out.push(row(qty + nameLines[0], amount));
      for (const extra of nameLines.slice(1)) out.push(extra);

      for (const part of entry.lines) {
        const label = `   - ${trimQty(part.qty)} `;
        for (const [i, text] of wrap(part.item_name, WIDTH - label.length, ' '.repeat(label.length)).entries()) {
          out.push(i === 0 ? label + text : text);
        }
        if (part.notes) out.push(`     (${part.notes})`);
      }
      continue;
    }

    const item = entry;
    const qty = `${trimQty(item.qty)} x `;
    const amount = money(item.line_total, symbol);
    const nameWidth = WIDTH - amount.length - qty.length - 1;
    // The size is part of what was bought: "Chicken Tikka (Large)".
    const label = item.variant_name ? `${item.item_name} (${item.variant_name})` : item.item_name;
    const nameLines = wrap(label, nameWidth, ' '.repeat(qty.length));

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

  // On an unpaid order the money columns have not been written yet, so the
  // stored service charge and total are both 0. Compute them the same way
  // settlement will, or the slip hands the customer a bill for nothing.
  const liveLines = order.items.filter((it) => it.kitchen_status !== 'void');
  const subtotal = unpaid
    ? Math.round((liveLines.reduce((sum, it) => sum + it.line_total, 0) + Number.EPSILON) * 100) / 100
    : order.subtotal;
  const serviceCharge = unpaid ? serviceChargeFor(subtotal, order.type) : order.service_charge;
  const total = unpaid
    ? Math.round(
        (subtotal + serviceCharge + (order.delivery_charge ?? 0) + (order.extras_total ?? 0) +
          Number.EPSILON) * 100,
      ) / 100
    : order.total;

  out.push(row('Subtotal', money(subtotal, symbol)));
  if (order.discount) out.push(row('Discount', `-${money(order.discount, symbol)}`));
  if (serviceCharge) out.push(row('Service charge', money(serviceCharge, symbol)));

  /**
   * Each extra on its own line, named.
   *
   * A single "Extras 55" line invites the question it does not answer. The
   * customer paid for plates; the bill should say plates.
   */
  for (const extra of order.extras ?? []) {
    const label = extra.qty === 1 ? extra.name : `${trimQty(extra.qty)} x ${extra.name}`;
    out.push(row(label, money(extra.line_total, symbol)));
  }
  // Its own line, so the customer can see what the food cost and what the
  // ride cost. Printed even at zero on a delivery, because "Delivery 0.00"
  // answers the question a blank line leaves open.
  if (order.type === 'delivery') {
    out.push(row('Delivery', money(order.delivery_charge, symbol)));
  }
  out.push(line('='));
  out.push(row(unpaid ? 'AMOUNT DUE' : 'TOTAL', money(total, symbol)));
  if (order.payment_method) {
    out.push(row('Paid by', order.payment_method === 'cash' ? 'Cash' : 'Card'));
  }
  out.push('');
  out.push(centre(unpaid ? 'Please pay at the counter' : 'Thank you — please come again'));

  // The shop's own closing line: return policy, wifi password, whatever they
  // want on every bill. Wrapped, because owners type more than fits.
  const footer = settings[SETTING_KEYS.receiptFooter];
  if (footer) {
    out.push('');
    out.push(...wrap(footer, WIDTH).map(centre));
  }

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
  /**
   * The kitchen is told it is a delivery — it changes packing, not cooking —
   * and deliberately nothing more. The address, the phone and the money are
   * the counter's business; a pass covered in customer details is a pass
   * where the food is harder to read.
   */
  if (order.type === 'delivery') out.push('** DELIVERY **');
  out.push(new Date().toTimeString().slice(0, 5));
  out.push(line());

  // A deal's components are printed as the individual dishes they are — that
  // is what the kitchen cooks — but banner-lined so the pass can see they
  // belong to one combo and plate them together.
  let currentDeal: number | null = null;

  for (const item of fired) {
    if (item.kitchen_status === 'void') continue;

    if (item.deal_group !== currentDeal) {
      currentDeal = item.deal_group;
      if (item.deal_group && item.deal_name) {
        out.push(`>> ${item.deal_name.toUpperCase()}`);
      }
    }

    const qty = `${trimQty(item.qty)} x `;
    // The kitchen needs the size most of all — it decides the dough.
    const kitchenLabel = item.variant_name
      ? `${item.item_name} (${item.variant_name})`
      : item.item_name;
    for (const [i, text] of wrap(kitchenLabel.toUpperCase(), WIDTH - qty.length, ' '.repeat(qty.length)).entries()) {
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

/* ------------------------------------------------------------------ *
 * End-of-day report — the third print format
 * ------------------------------------------------------------------ */

/**
 * The close-of-day slip.
 *
 * Plain text on the same 42-column roll as the bill, deliberately: it uses the
 * existing ESC/POS text path, so nothing about image printing is involved and
 * the owner can tear it off and put it in a drawer with the cash.
 *
 * Ordered the way an owner reads it — what came in, what it cost, what is
 * missing — rather than the order the database happens to hold it.
 */
export function buildDayReport(report: DayReport): string {
  const settings = getAllSettings();
  const symbol = settings[SETTING_KEYS.currencySymbol] || 'Rs.';
  const out: string[] = [];

  out.push(line('='));
  out.push(centre(settings[SETTING_KEYS.businessName] || 'Food Point'));
  out.push(centre('END OF DAY'));
  out.push(line('='));

  out.push(row('Opened', report.session.opened_at));
  out.push(row('Closed', report.session.closed_at ?? '—'));
  out.push(line());

  out.push(row('Orders', String(report.order_count)));
  for (const entry of report.by_type) {
    out.push(row(`  ${ORDER_TYPE_LABELS[entry.type]}`, `${entry.order_count}  ${money(entry.sales, symbol)}`));
  }
  out.push(line());

  out.push(row('TOTAL SALES', money(report.sales_total, symbol)));
  // Spelled out in full, because "profit" alone would be read as take-home.
  // Absent entirely on a counter's copy: margin is the owner's number, and a
  // slip that carries it is a slip anyone in the shop can pick up.
  if (report.gross_profit !== null) {
    out.push('Gross profit (sales - item cost)');
    out.push(row('', money(report.gross_profit, symbol)));
  }
  out.push(line());

  if (report.service_charges) out.push(row('Service charges', money(report.service_charges, symbol)));
  if (report.delivery_charges) out.push(row('Delivery charges', money(report.delivery_charges, symbol)));
  if (report.extras_total) out.push(row('Extras / packaging', money(report.extras_total, symbol)));

  out.push(row('Cash', money(report.cash_sales, symbol)));
  out.push(row('Card', money(report.card_sales, symbol)));

  if (report.expected_cash !== null) {
    out.push(line());
    out.push(row('Opening float', money(report.session.opening_float, symbol)));
    out.push(row('EXPECTED CASH', money(report.expected_cash, symbol)));
  }

  out.push(line());
  out.push(row('Cancellations', String(report.cancelled_count)));
  if (report.cancelled_count) {
    out.push(row('  value', money(report.cancelled_value, symbol)));
  }

  // Stated even at zero: an owner closing over unpaid orders should see it on
  // the slip, not only in the dialog they clicked past.
  if (report.unpaid_count) {
    out.push(row('UNPAID AT CLOSE', String(report.unpaid_count)));
    out.push(row('  value', money(report.unpaid_total, symbol)));
  }

  if (report.top_items.length) {
    out.push(line());
    out.push('Top items');
    for (const item of report.top_items) {
      out.push(row(`  ${trimQty(item.qty)} x ${item.item_name}`, money(item.revenue, symbol)));
    }
  }

  out.push(line('='));
  out.push('');
  out.push(centre(DEVELOPER_CREDIT));
  out.push('');

  return out.join('\n');
}

/** "2", not "2.00" — but "1.5" keeps its half, because half portions are real. */
function trimQty(qty: number): string {
  return String(Math.round(qty * 100) / 100);
}
