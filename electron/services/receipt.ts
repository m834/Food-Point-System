import { getAllSettings, serviceChargeFor } from '../db/repositories/settings';
import { groupOrderLines, isDealGroup } from '../../shared/dealLines';
import {
  SETTING_KEYS,
  ORDER_TYPE_LABELS,
  WAITER_PAY_TYPE_LABELS,
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

/**
 * The item table's columns, in characters, summing to WIDTH with a single
 * space between each: 18 + 1 + 8 + 1 + 3 + 1 + 10 = 42.
 *
 * The figures print bare — no "Rs." — because the symbol repeated four times
 * a line costs the item name the room it needs, and the currency is already
 * stated on every total below. A 42-column roll has no width to waste.
 */
const NAME_W = 18;
const PRICE_W = 8;
const QTY_W = 3;
const TOTAL_W = 10;

/**
 * One item the way the shop asks for it read: what it was, what ONE costs,
 * how many, and what that comes to. Three pink crust pizzas print as
 * "Pink Crust Pizza  450.00  3  1350.00" — the customer can check the
 * multiplication themselves, which is the whole point of the format.
 *
 * Returns lines rather than a line: a name too long for its column takes the
 * full width and the figures land underneath, still in their columns.
 * Truncating "Pink Crust Pizza (Family)" to fit would hide what was bought.
 */
function itemRows(name: string, price: string, qty: string, total: string): string[] {
  const figures =
    price.padStart(PRICE_W) + ' ' + qty.padStart(QTY_W) + ' ' + total.padStart(TOTAL_W);
  const nameLines = wrap(name, NAME_W);

  if (nameLines.length === 1 && nameLines[0].length <= NAME_W) {
    return [nameLines[0].padEnd(NAME_W) + ' ' + figures];
  }
  return [...wrap(name, WIDTH), ' '.repeat(NAME_W) + ' ' + figures];
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

/** The same number without the symbol, for the item table's columns. */
function amount(value: number): string {
  return value.toFixed(2);
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

  // Set only on a takeaway order, and only when the shop has waiters turned
  // on — printed here, ahead of the customer's own details, so the person
  // handing the bag over is named as plainly as who it is for.
  if (order.waiter_name) out.push(`Waiter: ${order.waiter_name}`);
  if (order.customer_name) out.push(`Customer: ${order.customer_name}`);
  if (order.customer_phone) out.push(`Phone: ${order.customer_phone}`);

  // The column heads. Without them the three figures on an item line are
  // three unexplained numbers; with them the customer knows which one is the
  // price of a single pizza and which one is what three of them come to.
  out.push(line());
  out.push(...itemRows('Item', 'Price', 'Qty', 'Amount'));
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
      // A deal's own quantity, its price for one, and what they come to —
      // the same four columns as any other line.
      const unitPrice = entry.qty ? entry.total / entry.qty : entry.total;

      out.push(
        ...itemRows(entry.deal_name, amount(unitPrice), trimQty(entry.qty), amount(entry.total)),
      );

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
    /**
     * What ONE of these costs, modifiers and all.
     *
     * Taken from the snapshotted `sale_price` plus the chosen deltas rather
     * than by dividing the line total, so price x qty lands exactly on the
     * amount printed beside it. A customer who multiplies the two figures
     * must get the third; a rounded division would sometimes leave them a
     * paisa short and the bill looking wrong.
     */
    const unitPrice =
      item.sale_price + item.modifiers.reduce((sum, mod) => sum + mod.price_delta, 0);
    // The size is part of what was bought: "Chicken Tikka (Large)".
    const label = item.variant_name ? `${item.item_name} (${item.variant_name})` : item.item_name;

    if (item.unit_label) {
      /**
       * A weight-based line — printed as one plain sentence rather than
       * squeezed into the fixed price/qty/amount columns, which are too
       * narrow for "15 kg". This is the one format the spec asks for by
       * example: "Rice — 15 kg × Rs 350 = Rs 5,250".
       */
      out.push(
        ...wrap(
          `${label} — ${trimQty(item.qty)} ${item.unit_label} x ${money(unitPrice, symbol)} = ${money(item.line_total, symbol)}`,
          WIDTH,
        ),
      );
    } else {
      out.push(...itemRows(label, amount(unitPrice), trimQty(item.qty), amount(item.line_total)));
    }

    // Each modifier's delta is already inside the unit price above, so it is
    // marked as included — printed as a bare amount it would read as another
    // charge to add on, and the customer would total the bill higher than it is.
    for (const mod of item.modifiers) {
      const label = `   + ${mod.name}`;
      out.push(mod.price_delta ? row(label, `(incl. ${money(mod.price_delta, symbol)})`) : label);
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

  /**
   * A settled order that still owes a balance — an advance was taken instead
   * of the full amount. Printed as GRAND TOTAL / ADVANCE PAID / BALANCE DUE
   * rather than a single TOTAL, so the slip states plainly what was paid now
   * and what is still owed, exactly as the spec asks. Only reachable when
   * "Enable partial payments" is on — settleOrder() never leaves a balance
   * otherwise, so `order.balance_due` is always 0 with it off.
   */
  const isPartial = order.status === 'settled' && order.balance_due > 0;

  if (isPartial) {
    out.push(row('GRAND TOTAL', money(total, symbol)));
    out.push(row('Advance paid', money(order.amount_paid, symbol)));
    out.push(row('BALANCE DUE', money(order.balance_due, symbol)));
  } else {
    out.push(row(unpaid ? 'AMOUNT DUE' : 'TOTAL', money(total, symbol)));
  }
  if (order.payment_method) {
    out.push(row('Paid by', order.payment_method === 'cash' ? 'Cash' : 'Card'));
  }
  out.push('');
  out.push(
    centre(
      isPartial
        ? 'Balance due on delivery / collection'
        : unpaid
          ? 'Please pay at the counter'
          : 'Thank you — please come again',
    ),
  );

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
  // So the runner reads whose order this is at a glance, under noise and
  // steam — the same reason everything else on this ticket is oversized.
  if (order.waiter_name) out.push(`WAITER: ${order.waiter_name.toUpperCase()}`);
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

    // A weight line reads as "RICE — 15 KG" — the kitchen needs the weight,
    // not a count, so it is not prefixed like an ordinary quantity.
    const qty = item.unit_label ? '' : `${trimQty(item.qty)} x `;
    // The kitchen needs the size most of all — it decides the dough.
    const kitchenLabel = item.unit_label
      ? `${item.item_name} — ${trimQty(item.qty)} ${item.unit_label}`
      : item.variant_name
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

  // Empty on a shop that has never turned waiters on — nothing prints.
  if (report.by_waiter.length) {
    out.push(line());
    out.push('By waiter');
    for (const entry of report.by_waiter) {
      out.push(
        row(`  ${entry.waiter_name}`, `${entry.order_count}  ${money(entry.sales, symbol)}`),
      );
    }
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

  // Distinct from "unpaid" above: these orders WERE charged, just not in
  // full. Zero on a shop that has never turned partial payments on.
  if (report.partial_count) {
    out.push(row('PARTIALLY PAID', String(report.partial_count)));
    out.push(row('  balance owed', money(report.partial_balance_total, symbol)));
  }

  // Empty on a shop that has never turned expenses or waiter wages on.
  if (report.expenses.length) {
    out.push(line());
    out.push('Expenses');
    for (const expense of report.expenses) {
      out.push(row(`  ${expense.description}`, money(expense.amount, symbol)));
    }
    out.push(row('TOTAL EXPENSES', money(report.expenses_total, symbol)));

    if (report.waiter_wages.length) {
      out.push('Waiter wages');
      for (const wage of report.waiter_wages) {
        const label = wage.pay_type ? `${wage.waiter_name} (${WAITER_PAY_TYPE_LABELS[wage.pay_type]})` : wage.waiter_name;
        out.push(row(`  ${label}`, money(wage.amount, symbol)));
      }
    }

    if (report.net_cash_position !== null) {
      out.push(line());
      // Deliberately not called profit — see DayReport.net_cash_position.
      out.push('Net cash position (cash sales - expenses)');
      out.push(row('', money(report.net_cash_position, symbol)));
    }
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
