import { BrowserWindow, webContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllSettings, kitchenPrintEnabled } from '../db/repositories/settings';
import { buildCustomerBill, buildKitchenTicket } from './receipt';
import { SETTING_KEYS, type Order, type OrderItem } from '../../shared/types';

/**
 * Thermal printing (spec §10). Fully offline — the printer is attached to this
 * machine, and nothing here reaches the network.
 *
 * Two destinations, one mechanism: the customer bill goes to the counter
 * printer, the kitchen ticket to the kitchen printer. Most small food points
 * own exactly one printer, so every path here has to survive that.
 */

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  const target = BrowserWindow.getAllWindows()[0]?.webContents ?? webContents.getAllWebContents()[0];
  if (!target) return [];
  const printers = await target.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault,
  }));
}

/**
 * Send plain text to a printer.
 *
 * ESC/POS printers accept raw text and advance the paper on form feed, so the
 * text built in receipt.ts can be sent as-is. Electron cannot write to a
 * printer port directly, so the text is staged in a temp file and handed to
 * the OS print queue — which is also what makes a shared USB printer work
 * without a driver-specific integration.
 */
async function sendToPrinter(text: string, printerName: string): Promise<void> {
  const file = path.join(os.tmpdir(), `foodpoint-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  // Cut + feed: leave enough paper past the print head to tear cleanly.
  fs.writeFileSync(file, `${text}\n\n\n\n`, 'utf8');

  try {
    await printTextFile(file, printerName);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function printTextFile(file: string, printerName: string): Promise<void> {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');

  return new Promise((resolve, reject) => {
    const [command, args] =
      process.platform === 'win32'
        ? // Windows: hand the file to the named print queue.
          ['cmd', ['/c', 'print', `/D:${printerName}`, file]]
        : // macOS/Linux dev machines: lp does the same job.
          ['lp', printerName ? ['-d', printerName, file] : [file]];

    const child = spawn(command, args, { windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`The printer refused the job (code ${code}).`)),
    );
  });
}

/** The counter printer. Falls back to the OS default when none is chosen. */
function customerPrinter(): string {
  return getAllSettings()[SETTING_KEYS.printerCustomer] || '';
}

/**
 * Where the kitchen ticket goes.
 *
 * If no kitchen printer is configured, it falls back to the counter printer
 * rather than failing: a one-printer dhaba should still get its ticket, torn
 * off and carried through. Returning null means kitchen printing is switched
 * off entirely in settings.
 */
function kitchenPrinter(): string | null {
  if (!kitchenPrintEnabled()) return null;
  const settings = getAllSettings();
  return settings[SETTING_KEYS.printerKitchen] || settings[SETTING_KEYS.printerCustomer] || '';
}

export interface PrintOutcome {
  printed: boolean;
  /** Filled in when printing failed — the order still saved, so this is a note. */
  warning?: string;
}

export async function printCustomerBill(order: Order): Promise<PrintOutcome> {
  try {
    await sendToPrinter(buildCustomerBill(order), customerPrinter());
    return { printed: true };
  } catch (error) {
    // The sale is already recorded. A printer that is out of paper must never
    // roll back a settled bill — the cashier can reprint from the order list.
    return {
      printed: false,
      warning: `Saved, but the bill did not print: ${describe(error)}`,
    };
  }
}

export async function printKitchenTicket(order: Order, fired: OrderItem[]): Promise<PrintOutcome> {
  const printer = kitchenPrinter();
  if (printer === null) {
    // Switched off deliberately — not a failure, and not worth a warning that
    // would train the cashier to ignore warnings.
    return { printed: false };
  }

  try {
    await sendToPrinter(buildKitchenTicket(order, fired), printer);
    return { printed: true };
  } catch (error) {
    return {
      printed: false,
      warning: `The items were fired, but the kitchen ticket did not print: ${describe(error)}`,
    };
  }
}

export async function testPrint(): Promise<void> {
  const settings = getAllSettings();
  const text = [
    '',
    '        Code Hustlers Food Point',
    '',
    `  ${settings[SETTING_KEYS.businessName] || 'Food Point'}`,
    '',
    '  If you can read this, the printer is set up',
    '  correctly and the app can reach it.',
    '',
  ].join('\n');

  await sendToPrinter(text, customerPrinter());
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the printer did not respond.';
}
