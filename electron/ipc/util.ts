import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isLicensed } from '../services/license';
import type { Result } from '../../shared/types';

/**
 * Channels that must work before the app is unlocked.
 *
 * `system:copyToClipboard` belongs here: the activation screen's "copy Machine
 * ID" button is the one place it is used, and that screen only exists while the
 * app is still locked.
 */
const OPEN_CHANNELS = new Set([
  'license:status',
  'license:machineId',
  'license:activate',
  'app:version',
  'system:copyToClipboard',
]);

/**
 * Every handler resolves to { ok: true, data } or { ok: false, error }. Errors
 * never cross IPC as throws, and the message is written for a cashier to read
 * mid-service, not for a developer reading a stack trace.
 */
export function handle<T>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      // The UI gates on the license too, but the backend must not depend on the
      // renderer behaving — an open data channel would defeat the whole lock.
      if (!OPEN_CHANNELS.has(channel) && !isLicensed()) {
        return { ok: false, error: 'This copy is not activated.' };
      }
      return { ok: true, data: await handler(event, ...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' };
    }
  });
}

/* ---- Everything from the renderer is untrusted and validated here ---- */

export function asString(
  value: unknown,
  field: string,
  { required = true, max = 500 } = {},
): string {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${field} is required.`);
  if (trimmed.length > max) throw new Error(`${field} is too long.`);
  return trimmed;
}

export function asNumber(
  value: unknown,
  field: string,
  { min = -1_000_000_000, max = 1_000_000_000 } = {},
): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    throw new Error(`${field} must be a number.`);
  }
  if (num < min || num > max) throw new Error(`${field} is out of range.`);
  return num;
}

export function asMoney(value: unknown, field: string): number {
  return asNumber(value, field, { min: 0, max: 10_000_000 });
}

export function asId(value: unknown, field = 'Item'): number {
  const num = asNumber(value, field, { min: 1, max: Number.MAX_SAFE_INTEGER });
  if (!Number.isInteger(num)) throw new Error(`${field} is not valid.`);
  return num;
}

export function asOptionalId(value: unknown, field = 'Item'): number | null {
  if (value === null || value === undefined || value === '') return null;
  return asId(value, field);
}

export function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return false;
}

export function asDate(value: unknown, field: string): string {
  const text = asString(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must be a date.`);
  return text;
}

/** One of a fixed set — order types, payment methods, and the like. */
export function asEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const text = asString(value, field, { max: 40 });
  if (!allowed.includes(text as T)) throw new Error(`${field} is not valid.`);
  return text as T;
}

export function asArray(value: unknown, field: string, max = 200): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} is not valid.`);
  if (value.length > max) throw new Error(`${field} has too many entries.`);
  return value;
}
