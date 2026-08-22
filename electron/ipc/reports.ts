import { handle, asDate, asNumber } from './util';
import {
  bestSellers,
  cancellations,
  dashboard,
  range,
  salesByHour,
  salesByType,
  voids,
} from '../db/repositories/reports';
import { todayIso } from '../db/money';
import { requireAdmin } from '../services/adminSession';

export function registerReportHandlers(): void {
  /**
   * Every report is owner-only.
   *
   * Hiding the links in the counter's sidebar is what makes the UI coherent;
   * this is what makes it enforcement. Without it the takings, the profit and
   * the cancellation log are still answerable to anyone who reaches the
   * bridge, whatever the screen happens to be showing.
   */
  handle('reports:dashboard', (_e, date) => {
    requireAdmin();
    return dashboard(date ? asDate(date, 'Date') : todayIso());
  });

  handle('reports:range', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return range(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  handle('reports:byType', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return salesByType(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  handle('reports:bestSellers', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return bestSellers(
      asDate(raw.from, 'From date'),
      asDate(raw.to, 'To date'),
      raw.limit === undefined ? 20 : asNumber(raw.limit, 'Limit', { min: 1, max: 200 }),
    );
  });

  handle('reports:byHour', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return salesByHour(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  /** The owner's accountability view: who cancelled what, and how much. */
  handle('reports:cancellations', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return cancellations(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  handle('reports:voids', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return voids(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });
}
