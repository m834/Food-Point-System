import { getSetting, saveSettings } from '../db/repositories/settings';
import { assertPinShape, encodePin, isEncoded, verifyPin } from './pinHash';
import { SETTING_KEYS } from '../../shared/types';

/**
 * The manager/owner PIN — the authority that outranks the counter.
 *
 * It gates exactly one thing: **cancelling an order whose money has already
 * been taken.** That is the theft this app is defending against — a counter
 * hand voiding a paid sale and keeping the cash — so it is the one action a
 * normal staff member must not be able to complete alone.
 *
 * Cancelling an order that has NOT been paid is deliberately not gated. It is
 * the common, honest case (wrong order, customer walked out) and nothing has
 * been taken yet, so demanding a manager for every mis-tap would only teach
 * the counter to work around the app.
 *
 * The PIN is stored as a salted hash and checked HERE, in the main process.
 * The renderer never sees the stored value and never gets to report that a
 * check passed.
 */

export function isPinSet(): boolean {
  return isEncoded(getSetting(SETTING_KEYS.managerPin));
}

/**
 * Throws a message the cashier can act on. Returns quietly when no PIN is
 * configured, which is the "the owner has not turned this on" case.
 */
export function requirePin(supplied: unknown): void {
  const stored = getSetting(SETTING_KEYS.managerPin);
  if (!isEncoded(stored)) return;

  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw new Error('A manager PIN is needed to cancel a paid order.');
  }
  if (!verifyPin(supplied, stored)) {
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
  assertPinShape(trimmed);
  saveSettings({ [SETTING_KEYS.managerPin]: encodePin(trimmed) });
}
