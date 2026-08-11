import crypto from 'node:crypto';
import { getSetting, saveSettings } from '../db/repositories/settings';
import { SETTING_KEYS } from '../../shared/types';

/**
 * The only permission in v1 (spec §4).
 *
 * A single optional manager PIN gates voids. Set it and voiding asks for it;
 * leave it blank and voids are open. There are no users, no roles and no login
 * — a counter under pressure should not be signing in and out all day, and the
 * thing worth protecting is a cashier quietly cancelling paid items.
 *
 * The PIN is stored as a salted hash, and it is checked HERE, in the main
 * process. The renderer never sees the stored value and never gets to report
 * that a check passed.
 */

const SEPARATOR = '$';

function hash(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

/** `salt$hash`, or '' when no PIN is set. */
export function encodePin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}${SEPARATOR}${hash(pin, salt)}`;
}

export function isPinSet(): boolean {
  return getSetting(SETTING_KEYS.managerPin).includes(SEPARATOR);
}

/**
 * Throws a message the cashier can act on. Returns quietly when no PIN is
 * configured, which is the "voids are open" case.
 */
export function requirePin(supplied: unknown): void {
  const stored = getSetting(SETTING_KEYS.managerPin);
  if (!stored.includes(SEPARATOR)) return;

  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw new Error('A manager PIN is needed to void.');
  }

  const [salt, expected] = stored.split(SEPARATOR);
  const actual = hash(supplied.trim(), salt);

  // Constant-time: a PIN is short enough that a timing oracle is worth avoiding.
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("That PIN doesn't match.");
  }
}

/**
 * Set, change or clear the PIN. An empty string clears it, which is how an
 * owner turns the gate off again.
 */
export function setPin(pin: string): void {
  const trimmed = pin.trim();
  if (!trimmed) {
    saveSettings({ [SETTING_KEYS.managerPin]: '' });
    return;
  }
  if (!/^\d{4,8}$/.test(trimmed)) {
    throw new Error('The manager PIN must be 4 to 8 digits.');
  }
  saveSettings({ [SETTING_KEYS.managerPin]: encodePin(trimmed) });
}
