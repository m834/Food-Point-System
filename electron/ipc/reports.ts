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

export function registerReportHandlers(): void {
  handle('reports:dashboard', (_e, date) =>
    dashboard(date ? asDate(date, 'Date') : todayIso()),
  );

  handle('reports:range', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return range(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  handle('reports:byType', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return salesByType(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  handle('reports:bestSellers', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return bestSellers(
      asDate(raw.from, 'From date'),
      asDate(raw.to, 'To date'),
      raw.limit === undefined ? 20 : asNumber(raw.limit, 'Limit', { min: 1, max: 200 }),
    );
  });

  handle('reports:byHour', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return salesByHour(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  /** The owner's accountability view: who cancelled what, and how much. */
  handle('reports:cancellations', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return cancellations(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });

  handle('reports:voids', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return voids(asDate(raw.from, 'From date'), asDate(raw.to, 'To date'));
  });
}
