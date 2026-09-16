import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllSettings } from '../db/repositories/settings';
import {
  ORDER_TYPE_LABELS,
  SETTING_KEYS,
  type DayReport,
  type Order,
} from '../../shared/types';

/**
 * The day's order list, laid out for an ORDINARY printer.
 *
 * Everything else the app prints goes to the 80mm thermal roll, because a
 * receipt is a receipt. A full night's orders is not: forty rows of order
 * number, time, type and total do not fit in 42 columns, and a shop that tried
 * would be tearing off two feet of till roll to file a day's takings.
 *
 * So this path is deliberately different in kind — real HTML, laid out for A4,
 * rendered by Chromium, and sent either to whatever printer the owner picks in
 * the system dialog or to a PDF they can keep. Nothing here touches ESC/POS.
 *
 * Still entirely offline: the page is built as a string, written to a temp
 * file and loaded from disk. No stylesheet, font or image is fetched, because
 * the shop's machine has no internet and the sheet must print anyway.
 */

const escape = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function moneyText(value: number, symbol: string): string {
  return `${symbol}${value.toFixed(2)}`;
}

/** HH:MM from a stored 'YYYY-MM-DD HH:MM:SS'. */
const clock = (stamp: string | null): string => (stamp ? stamp.slice(11, 16) : '—');

/**
 * What each row is worth, which is not the same question for each status.
 *
 * SETTLED is what was banked. STILL OPEN is what is owed — the live lines,
 * since a voided line is not being charged for. CANCELLED is what was thrown
 * away, and that has to count the lines the cancellation voided: cancelling an
 * order marks every line void, so filtering them out here would print a
 * Rs. 0.00 against the exact row the owner opened this sheet to investigate.
 */
function rowValue(order: Order): number {
  if (order.status === 'settled') return order.total;
  if (order.status === 'void') return order.voided_was_paid ? order.total : order.subtotal;
  const live = order.items.filter((i) => i.kitchen_status !== 'void');
  const owed = live.reduce((sum, i) => sum + i.line_total, 0) + (order.extras_total ?? 0);
  return Math.round((owed + Number.EPSILON) * 100) / 100;
}

/** Lines on the row. A cancelled order counts them all, for the reason above. */
function rowItems(order: Order): number {
  if (order.status === 'void') return order.items.length;
  return order.items.filter((i) => i.kitchen_status !== 'void').length;
}

function statusLabel(order: Order): string {
  if (order.status === 'settled') {
    const method = order.payment_method === 'card' ? 'Card' : 'Cash';
    // Zero on every order unless "Enable partial payments" is on — see
    // settleOrder(). Flagged here so the sheet does not read as fully banked
    // when part of it is still owed.
    return order.balance_due > 0 ? `${method} · partial` : method;
  }
  if (order.status === 'void') return 'Cancelled';
  return 'UNPAID';
}

export function buildDaySheetHtml(report: DayReport, orders: Order[]): string {
  const settings = getAllSettings();
  const symbol = settings[SETTING_KEYS.currencySymbol] || 'Rs.';
  const name = settings[SETTING_KEYS.businessName] || 'Food Point';
  const address = settings[SETTING_KEYS.businessAddress] || '';
  const phone = settings[SETTING_KEYS.businessPhone] || '';

  const opened = report.session.opened_at;
  const closed = report.session.closed_at;

  const rows = orders
    .map((order) => {
      const who =
        order.type === 'dine_in'
          ? order.table_name ?? '—'
          : order.customer_name ?? '—';
      const items = rowItems(order);
      const cls = order.status === 'void' ? ' class="void"' : order.status === 'open' ? ' class="owed"' : '';
      return `<tr${cls}>
        <td class="mono">${escape(order.order_no)}</td>
        <td class="mono">${escape(clock(order.settled_at ?? order.opened_at))}</td>
        <td>${escape(ORDER_TYPE_LABELS[order.type])}</td>
        <td>${escape(who)}</td>
        <td class="num">${items}</td>
        <td>${escape(statusLabel(order))}</td>
        <td class="num">${escape(moneyText(rowValue(order), symbol))}</td>
      </tr>`;
    })
    .join('\n');

  /** Only figures the caller was entitled to. Margin is already null for a counter. */
  const summary: Array<[string, string]> = [
    ['Orders', String(report.order_count)],
    ['Sales', moneyText(report.sales_total, symbol)],
    ['Cash', moneyText(report.cash_sales, symbol)],
    ['Card', moneyText(report.card_sales, symbol)],
    ['Service charges', moneyText(report.service_charges, symbol)],
    ['Delivery charges', moneyText(report.delivery_charges, symbol)],
  ];
  if (report.expected_cash !== null) {
    summary.push(['Expected in drawer', moneyText(report.expected_cash, symbol)]);
  }
  if (report.gross_profit !== null) {
    summary.push(['Gross profit (sales − item cost)', moneyText(report.gross_profit, symbol)]);
  }
  if (report.cancelled_count) {
    summary.push([
      'Cancelled',
      `${report.cancelled_count} · ${moneyText(report.cancelled_value, symbol)}`,
    ]);
  }
  if (report.unpaid_count) {
    summary.push([
      'Still unpaid',
      `${report.unpaid_count} · ${moneyText(report.unpaid_total, symbol)}`,
    ]);
  }
  // Distinct from "still unpaid" above — these orders WERE charged, just not
  // in full. Zero on a shop that has never turned partial payments on.
  if (report.partial_count) {
    summary.push([
      'Partially paid — balance owed',
      `${report.partial_count} · ${moneyText(report.partial_balance_total, symbol)}`,
    ]);
  }
  // Empty on a shop that has never turned expenses or waiter wages on.
  if (report.expenses.length) {
    summary.push(['Total expenses', moneyText(report.expenses_total, symbol)]);
    if (report.waiter_wages.length) {
      summary.push(['  of which waiter wages', moneyText(report.waiter_wages_total, symbol)]);
    }
    if (report.net_cash_position !== null) {
      // Deliberately not called profit — see DayReport.net_cash_position.
      summary.push(['Net cash position (cash − expenses)', moneyText(report.net_cash_position, symbol)]);
    }
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Day sheet</title>
<style>
  /* A4 with a real margin — this is a document to be filed, not a till roll. */
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    color: #111; margin: 0; font-size: 11px; line-height: 1.45;
  }
  h1 { font-size: 17px; margin: 0; letter-spacing: -0.01em; }
  .shop { font-size: 12px; font-weight: 700; }
  .muted { color: #555; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
  .when { text-align: right; white-space: nowrap; }
  .summary { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .summary td { padding: 3px 0; }
  .summary td.k { color: #555; }
  .summary td.v { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .summary tr td { border-bottom: 1px dotted #ccc; }
  .cols { display: flex; gap: 26px; }
  .cols > * { flex: 1; }
  table.orders { width: 100%; border-collapse: collapse; }
  table.orders th {
    text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
    color: #444; border-bottom: 1px solid #111; padding: 5px 6px;
  }
  table.orders td { padding: 4px 6px; border-bottom: 1px solid #eee; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  /* A th selector outranks a bare .num class, so the numeric headers need
     their own rule or they sit left over right-aligned figures. */
  table.orders th.num { text-align: right; }
  .mono { font-variant-numeric: tabular-nums; }
  /* Repeat the header on every page — page three of a long night is unreadable
     without it. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  tr.void td { color: #999; text-decoration: line-through; }
  tr.void td:last-child, tr.void td:nth-child(6) { text-decoration: none; }
  tr.owed td { font-weight: 700; }
  tfoot td { padding: 7px 6px; border-top: 2px solid #111; font-weight: 700; font-size: 12px; }
  footer { margin-top: 14px; color: #666; font-size: 10px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header>
    <div class="head-row">
      <div>
        <div class="shop">${escape(name)}</div>
        ${address ? `<div class="muted">${escape(address)}</div>` : ''}
        ${phone ? `<div class="muted">${escape(phone)}</div>` : ''}
      </div>
      <div class="when">
        <h1>Day sheet</h1>
        <div class="muted">Opened ${escape(opened)}</div>
        <div class="muted">${closed ? `Closed ${escape(closed)}` : 'Still open'}</div>
      </div>
    </div>
  </header>

  <div class="cols">
    <table class="summary"><tbody>
      ${summary
        .slice(0, Math.ceil(summary.length / 2))
        .map(([k, v]) => `<tr><td class="k">${escape(k)}</td><td class="v">${escape(v)}</td></tr>`)
        .join('')}
    </tbody></table>
    <table class="summary"><tbody>
      ${summary
        .slice(Math.ceil(summary.length / 2))
        .map(([k, v]) => `<tr><td class="k">${escape(k)}</td><td class="v">${escape(v)}</td></tr>`)
        .join('')}
    </tbody></table>
  </div>

  <table class="orders">
    <thead>
      <tr>
        <th>Order</th><th>Time</th><th>Type</th><th>Table / customer</th>
        <th class="num">Items</th><th>Paid</th><th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="7" class="muted">No orders were taken on this day.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6">Settled sales${report.unpaid_count ? ' (unpaid excluded)' : ''}</td>
        <td class="num">${escape(moneyText(report.sales_total, symbol))}</td>
      </tr>
    </tfoot>
  </table>

  <footer>
    <span>${escape(orders.length)} order${orders.length === 1 ? '' : 's'} listed</span>
    <span>Printed ${escape(new Date().toLocaleString())}</span>
  </footer>
</body>
</html>`;
}

/**
 * Render the sheet in a hidden window and hand it to `use`.
 *
 * Parented to the main window so the system print dialog opens in front of the
 * app rather than behind it, and always destroyed — a leaked BrowserWindow
 * keeps the whole app alive after its last visible window closes.
 */
async function withSheet<T>(html: string, use: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const file = path.join(
    os.tmpdir(),
    `foodpoint-day-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );
  fs.writeFileSync(file, html, 'utf8');

  const parent = BrowserWindow.getAllWindows()[0];
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { javascript: false, sandbox: true },
  });

  try {
    await win.loadFile(file);
    return await use(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(file, { force: true });
  }
}

export interface SheetOutcome {
  ok: boolean;
  /** Where a PDF was written, when one was. */
  path?: string;
  /** Set when nothing happened, including when the owner simply cancelled. */
  warning?: string;
}

/**
 * Print to whatever printer the owner picks.
 *
 * `silent: false` deliberately: the whole point is that this goes to the
 * ordinary office printer, and only the owner knows which one that is. The
 * dialog is also where they choose A4, portrait, and how many copies.
 */
export async function printDaySheet(report: DayReport, orders: Order[]): Promise<SheetOutcome> {
  try {
    return await withSheet(buildDaySheetHtml(report, orders), (win) =>
      new Promise<SheetOutcome>((resolve) => {
        win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
          // `cancelled` is a choice, not a fault, so it is not an error.
          if (success) resolve({ ok: true });
          else if (/cancel/i.test(reason ?? '')) resolve({ ok: false });
          else resolve({ ok: false, warning: `The sheet did not print: ${reason}` });
        });
      }),
    );
  } catch (error) {
    return { ok: false, warning: `Could not build the sheet: ${describe(error)}` };
  }
}

/** Save the same sheet as a PDF the owner chooses a home for. */
export async function saveDaySheetPdf(report: DayReport, orders: Order[]): Promise<SheetOutcome> {
  const stamp = report.session.opened_at.slice(0, 10);

  const chosen = await dialog.showSaveDialog({
    title: 'Save day sheet',
    defaultPath: `day-sheet-${stamp}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (chosen.canceled || !chosen.filePath) return { ok: false };
  const filePath = chosen.filePath;

  try {
    return await withSheet(buildDaySheetHtml(report, orders), async (win) => {
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'default' },
      });
      fs.writeFileSync(filePath, pdf);
      return { ok: true, path: filePath };
    });
  } catch (error) {
    return { ok: false, warning: `Could not save the sheet: ${describe(error)}` };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
