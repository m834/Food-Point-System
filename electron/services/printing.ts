import { BrowserWindow, webContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllSettings, kitchenPrintEnabled } from '../db/repositories/settings';
import { buildCustomerBill, buildDayReport, buildKitchenTicket } from './receipt';
import { logoRasterBytes } from './receiptLogo';
import { SETTING_KEYS, type DayReport, type Order, type OrderItem } from '../../shared/types';

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

  let printers: PrinterInfo[] = [];
  if (target) {
    const found = await target.getPrintersAsync();
    printers = found.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: p.isDefault,
    }));
  }

  /**
   * Chromium's enumeration comes back empty on some Windows machines even when
   * Control Panel plainly shows the printer — its print backend initialises
   * lazily, and an elevated process does not see printers installed for the
   * logged-in user. Asking Windows directly is the second opinion, and it is
   * the list the counter actually cares about.
   */
  if (!printers.length && process.platform === 'win32') {
    printers = await listWindowsPrinters();
  }

  return printers;
}

function listWindowsPrinters(): Promise<PrinterInfo[]> {
  const { execFile } = require('node:child_process') as typeof import('node:child_process');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        // Get-Printer needs a newer Windows; the WMI class works everywhere.
        'Get-WmiObject -Class Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        if (error || !stdout?.trim()) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          // ConvertTo-Json emits a bare object when there is exactly one.
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          resolve(
            rows
              .filter((row) => row?.Name)
              .map((row) => ({
                name: String(row.Name),
                displayName: String(row.Name),
                isDefault: Boolean(row.Default),
              })),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });
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
  const file = path.join(
    os.tmpdir(),
    `foodpoint-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`,
  );
  // Binary, not utf8 text: these are ESC/POS control bytes plus latin1 text.
  fs.writeFileSync(file, buildEscPos(text));

  try {
    await printRaw(file, printerName);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/* ------------------------------------------------------------------ *
 * ESC/POS — talking to the printer in its own language
 * ------------------------------------------------------------------ */

const ESC = 0x1b;
const GS = 0x1d;

/**
 * How far in from the left edge the text starts, in printer dots.
 *
 * An 80mm head is 576 dots across at 203dpi, so 8 dots is roughly 1mm — a
 * small breathing space that stops the first character sitting against the
 * torn edge, without eating into the 42 columns the layout depends on.
 */
const LEFT_MARGIN_DOTS = 8;

/** Blank lines fed before the first text, so the header clears the tear bar. */
const TOP_FEED_LINES = 2;

/**
 * Wrap the plain-text receipt in ESC/POS control codes.
 *
 * The text itself is untouched — receipt.ts already lays it out for a
 * 42-column roll, and that layout is what aligns the prices. All this adds is
 * the printer-level formatting that a GDI print path destroys:
 *
 *   ESC @      reset, so a previous job's bold/alignment cannot leak in
 *   GS L       left margin in dots
 *   ESC ! 0x08 emphasised (bold) in Font A — legible on thin thermal paper
 *   GS V 1     partial cut at the end
 *
 * Font A is the printer's own 12x24 monospace face. That is the entire reason
 * to go raw: the receipt's columns only line up in a monospace font, and the
 * printer has one built in.
 */
function buildEscPos(text: string): Buffer {
  const parts: Buffer[] = [];

  // Reset to a known state.
  parts.push(Buffer.from([ESC, 0x40]));

  // Left margin, little-endian dots.
  parts.push(Buffer.from([GS, 0x4c, LEFT_MARGIN_DOTS & 0xff, (LEFT_MARGIN_DOTS >> 8) & 0xff]));

  // Font A, emphasised. 0x08 is the bold bit of ESC ! — "a little bold",
  // rather than double-height/width which would halve the columns.
  parts.push(Buffer.from([ESC, 0x21, 0x08]));

  parts.push(Buffer.from('\n'.repeat(TOP_FEED_LINES), 'ascii'));

  /**
   * The shop logo, above everything else on the slip.
   *
   * Returns null today, so these three lines add no bytes and the printed
   * output is byte-identical to before the logo feature existed. When raster
   * printing is built, it plugs in at receiptLogo.ts and appears here with no
   * other change to the print path. See that file before touching this.
   */
  const logo = logoRasterBytes();
  if (logo) parts.push(logo);

  // CRLF is what ESC/POS expects; a bare LF is ignored by some controllers,
  // which is one way a whole receipt ends up printed as a single line.
  const body = text.replace(/\r?\n/g, '\r\n');
  // latin1, not utf8: the printer's codepage is single-byte, and a multi-byte
  // character would be emitted as two garbage glyphs.
  parts.push(Buffer.from(body, 'latin1'));

  // Feed clear of the head, then cut.
  parts.push(Buffer.from('\r\n\r\n\r\n\r\n', 'ascii'));
  parts.push(Buffer.from([GS, 0x56, 0x01]));

  return Buffer.concat(parts);
}

/**
 * Hand raw bytes to a Windows print queue.
 *
 * Windows has no command-line tool that sends raw data to a queue: `print`
 * targets DOS-era ports, and `Out-Printer` renders through GDI with a
 * proportional font and page margins, which turns a column-aligned receipt
 * into one ragged paragraph. The supported route is the spooler API itself —
 * OpenPrinter / StartDocPrinter / WritePrinter with the "RAW" datatype — so
 * this P/Invokes it from PowerShell.
 *
 * The script is written to a file rather than passed with -Command because it
 * contains C#, quotes and braces that do not survive shell quoting.
 */
function writeRawPrinterScript(): string {
  const script = `
param([string]$PrinterName, [string]$FilePath)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class FoodPointRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void SendBytes(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("Could not open printer: " + printerName);

        try
        {
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "Food Point receipt";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di)) throw new Exception("StartDocPrinter failed.");
            try
            {
                if (!StartPagePrinter(hPrinter)) throw new Exception("StartPagePrinter failed.");
                try
                {
                    IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
                    try
                    {
                        Marshal.Copy(bytes, 0, buf, bytes.Length);
                        int written;
                        if (!WritePrinter(hPrinter, buf, bytes.Length, out written))
                            throw new Exception("WritePrinter failed.");
                    }
                    finally { Marshal.FreeCoTaskMem(buf); }
                }
                finally { EndPagePrinter(hPrinter); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
"@

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
    # Blank in Settings means "whatever Windows prints to by default".
    $PrinterName = (Get-WmiObject -Class Win32_Printer -Filter "Default = TRUE").Name
    if ([string]::IsNullOrWhiteSpace($PrinterName)) {
        throw "No printer chosen in Settings and Windows has no default printer."
    }
}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
[FoodPointRawPrinter]::SendBytes($PrinterName, $bytes)
`;

  const file = path.join(os.tmpdir(), `foodpoint-rawprint-${process.pid}.ps1`);
  fs.writeFileSync(file, script, 'utf8');
  return file;
}

function printRaw(file: string, printerName: string): Promise<void> {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');

  return new Promise((resolve, reject) => {
    let command: string;
    let args: string[];
    let scriptFile: string | null = null;

    if (process.platform === 'win32') {
      scriptFile = writeRawPrinterScript();
      command = 'powershell.exe';
      args = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptFile,
        '-PrinterName',
        printerName,
        '-FilePath',
        file,
      ];
    } else {
      // macOS/Linux: -o raw hands the bytes straight through, same as above.
      command = 'lp';
      args = printerName ? ['-d', printerName, '-o', 'raw', file] : ['-o', 'raw', file];
    }

    const child = spawn(command, args, { windowsHide: true });

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const cleanup = () => {
      if (scriptFile) fs.rmSync(scriptFile, { force: true });
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();
      if (code !== 0 || stderr.trim()) {
        reject(new Error(describePrinterError(stderr, printerName)));
        return;
      }
      resolve();
    });
  });
}

/** Turn a printer error into something a cashier can act on. */
function describePrinterError(stderr: string, printerName: string): string {
  const text = stderr.trim();
  if (/could not open printer|cannot find|not exist/i.test(text)) {
    return printerName
      ? `Windows has no printer called "${printerName}". Check the name in Settings.`
      : 'No default printer is set in Windows. Choose one in Settings.';
  }
  return text.split('\n')[0] || 'The printer did not accept the job.';
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

/**
 * Print the end-of-day slip.
 *
 * Goes to the counter printer over the SAME text path as a bill — no image or
 * raster involved. A failed print must not undo the close: the day is already
 * closed and the figures are already saved, so this reports rather than throws.
 */
export async function printDayReport(report: DayReport): Promise<PrintOutcome> {
  try {
    await sendToPrinter(buildDayReport(report), customerPrinter());
    return { printed: true };
  } catch (error) {
    return {
      printed: false,
      warning: `The day is closed, but the report did not print: ${describe(error)}`,
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
