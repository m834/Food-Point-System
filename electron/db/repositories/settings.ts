import { getDb } from '../connection';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  type OrderType,
  type SettingsMap,
} from '../../../shared/types';

export function getAllSettings(): SettingsMap {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: SettingsMap = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export function getSetting(key: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
}

export function getNumberSetting(key: string, fallback: number): number {
  const parsed = Number(getSetting(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getBoolSetting(key: string, fallback: boolean): boolean {
  const raw = getSetting(key);
  if (raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function saveSettings(values: SettingsMap): SettingsMap {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(values)) upsert.run(key, String(value ?? ''));
  });
  run();
  return getAllSettings();
}

/**
 * The service charge percentage the owner configured.
 *
 * Read here, in the main process, and never accepted from the renderer — a UI
 * that could pass its own percentage could bill a number the owner never set.
 */
export function serviceChargePercent(): number {
  const pct = getNumberSetting(SETTING_KEYS.serviceChargePercent, 0);
  // A typo of 1000 in settings should not multiply every bill.
  return Math.min(Math.max(pct, 0), 100);
}

/**
 * Dine-in is the only order type that carries a service charge.
 *
 * The charge pays for table service: seating, serving, clearing. A takeaway
 * customer carries their own bag out and a delivery customer already pays a
 * delivery fee, so charging either for service bills them for something the
 * shop never did — and on a flat-amount setting it is the same rupees as a
 * full sit-down meal, which is how a Rs. 50 cover charge ends up on a Rs. 200
 * takeaway.
 */
export function serviceChargeApplies(type: OrderType): boolean {
  return type === 'dine_in';
}

/**
 * The service charge for a bill, in rupees.
 *
 * Two modes, because shops split on this: a flat cover charge is the norm at a
 * small food point, while a percentage suits a sit-down restaurant. Fixed is
 * the default.
 *
 * The order type is required, not optional: it decides whether there is a
 * charge at all, and a caller that forgot to pass it would otherwise bill a
 * takeaway for table service. See serviceChargeApplies().
 *
 * Computed HERE, in the main process, and never taken from the renderer —
 * the same rule the percentage always followed. A UI that could supply its own
 * amount could bill a figure the owner never set.
 */
export function serviceChargeFor(subtotal: number, type: OrderType): number {
  if (!serviceChargeApplies(type)) return 0;

  const mode = getSetting(SETTING_KEYS.serviceChargeMode) || 'fixed';

  if (mode === 'percent') {
    const pct = serviceChargePercent();
    return Math.round(((subtotal * pct) / 100 + Number.EPSILON) * 100) / 100;
  }

  // Fixed. Clamped at zero: a negative "charge" is a discount, and discounts
  // have their own field with their own rules.
  const amount = getNumberSetting(SETTING_KEYS.serviceChargeAmount, 0);
  return Math.max(amount, 0);
}

export function serviceChargeMode(): 'fixed' | 'percent' {
  return getSetting(SETTING_KEYS.serviceChargeMode) === 'percent' ? 'percent' : 'fixed';
}

export function tablesEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableTables, true);
}

export function kitchenPrintEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableKitchenPrint, true);
}

export function waitersEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableWaiters, false);
}

export function weightItemsEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableWeightItems, false);
}

export function partialPaymentsEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enablePartialPayments, false);
}

export function dailyExpensesEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableDailyExpenses, false);
}

export function waiterWagesEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableWaiterWages, false);
}

export function currencySymbol(): string {
  return getSetting(SETTING_KEYS.currencySymbol) || 'Rs.';
}
