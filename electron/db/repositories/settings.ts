import { getDb } from '../connection';
import { DEFAULT_SETTINGS, SETTING_KEYS, type SettingsMap } from '../../../shared/types';

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

export function tablesEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableTables, true);
}

export function kitchenPrintEnabled(): boolean {
  return getBoolSetting(SETTING_KEYS.enableKitchenPrint, true);
}

export function currencySymbol(): string {
  return getSetting(SETTING_KEYS.currencySymbol) || 'Rs.';
}
