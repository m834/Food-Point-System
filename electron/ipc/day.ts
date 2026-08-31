import { handle, asId, asMoney } from './util';
import {
  closeDay,
  currentSession,
  dayReport,
  listSessions,
  openDay,
  unpaidOnSession,
} from '../db/repositories/daySessions';
import { printDayReport } from '../services/printing';
import { printDaySheet, saveDaySheetPdf } from '../services/daySheet';
import { listOrdersForSession } from '../db/repositories/orders';
import { isAdmin } from '../services/adminSession';
import { currentStaff } from '../services/session';
import type { DayReport } from '../../shared/types';

/**
 * Open Day / Close Day.
 *
 * Opening and closing the trading day is COUNTER work. The owner is not
 * standing at the till at 11am to press a button before the first order, and a
 * day nobody opened is a day whose orders belong to no report — so gating it
 * on the manager PIN would have quietly broken the reporting it exists to
 * enable.
 *
 * What stays the owner's is the MARGIN. The counter closes the day, counts the
 * drawer against expected cash and prints the slip; gross profit is stripped
 * from both the report and the slip unless an admin session is live. That
 * decision is made here, in the main process, and never by a screen choosing
 * what to render — a renderer that could ask for the full report would make
 * the whole distinction cosmetic.
 */

/**
 * The report as the caller is entitled to see it.
 *
 * Exported so the test suite can assert the stripping directly rather than
 * trusting that a screen remembers to hide a column.
 */
export function reportFor(sessionId: number): DayReport {
  const report = dayReport(sessionId);
  return isAdmin() ? report : { ...report, gross_profit: null };
}

export function registerDayHandlers(): void {
  handle('day:current', () => {
    const session = currentSession();
    return session ? { session, unpaid: unpaidOnSession(session.id) } : null;
  });

  handle('day:list', () => listSessions());

  handle('day:open', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return openDay({
      opening_float:
        raw.opening_float === undefined ? 0 : asMoney(raw.opening_float, 'Opening float'),
      opened_by: currentStaff()?.id ?? null,
    });
  });

  /**
   * Close the day and produce the report.
   *
   * The warning about unpaid orders is raised in the UI from `day:current`,
   * which is where the counter can still act on it. By the time this is called
   * the decision has been made — closing over unpaid orders is allowed,
   * because a customer may genuinely have walked out and the shop has to be
   * able to end the day. It is recorded on the slip either way.
   */
  handle('day:close', async (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;

    const session = closeDay({ closed_by: currentStaff()?.id ?? null });
    const report = reportFor(session.id);

    // A printer that is out of paper must not undo a closed day.
    const print = raw.print === false ? { printed: false } : await printDayReport(report);
    return { report, print };
  });

  handle('day:report', (_e, id) => reportFor(asId(id, 'Day')));

  /** Reprint a past day's till slip, for whoever lost the first one. */
  handle('day:print', async (_e, id) => printDayReport(reportFor(asId(id, 'Day'))));

  /**
   * The day's orders, and the A4 sheet built from them.
   *
   * Kept apart from `day:print` on purpose. That one is the 80mm till slip;
   * these go to an ordinary printer, because a night's worth of orders is a
   * document to file rather than a receipt to hand over.
   *
   * The report travels through `reportFor`, so a counter's sheet carries no
   * margin for exactly the same reason their screen and their slip do not.
   */
  handle('day:orders', (_e, id) => listOrdersForSession(asId(id, 'Day')));

  handle('day:sheetPrint', async (_e, id) => {
    const sessionId = asId(id, 'Day');
    return printDaySheet(reportFor(sessionId), listOrdersForSession(sessionId));
  });

  handle('day:sheetPdf', async (_e, id) => {
    const sessionId = asId(id, 'Day');
    return saveDaySheetPdf(reportFor(sessionId), listOrdersForSession(sessionId));
  });
}
