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
import { requireAdmin } from '../services/adminSession';
import { currentStaff } from '../services/session';

/**
 * Open Day / Close Day.
 *
 * Every channel is owner-only. Opening and closing the trading day decides
 * which figures land in which report, and the report itself is the day's
 * takings and margin — none of it is the counter's to touch or see.
 *
 * One exception in spirit but not in access: `day:current` is still gated,
 * because even knowing whether a day is open is only useful inside admin.
 */
export function registerDayHandlers(): void {
  handle('day:current', () => {
    requireAdmin();
    const session = currentSession();
    return session ? { session, unpaid: unpaidOnSession(session.id) } : null;
  });

  handle('day:list', () => {
    requireAdmin();
    return listSessions();
  });

  handle('day:open', (_e, input) => {
    requireAdmin();
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
   * which is where the owner can still act on it. By the time this is called
   * the decision has been made — closing over unpaid orders is allowed,
   * because a customer may genuinely have walked out and the owner has to be
   * able to end the day. It is recorded on the slip either way.
   */
  handle('day:close', async (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;

    const session = closeDay({ closed_by: currentStaff()?.id ?? null });
    const report = dayReport(session.id);

    // A printer that is out of paper must not undo a closed day.
    const print = raw.print === false ? { printed: false } : await printDayReport(report);
    return { report, print };
  });

  handle('day:report', (_e, id) => {
    requireAdmin();
    return dayReport(asId(id, 'Day'));
  });

  /** Reprint a past day's slip, for the owner who lost the first one. */
  handle('day:print', async (_e, id) => {
    requireAdmin();
    return printDayReport(dayReport(asId(id, 'Day')));
  });
}
