import crypto from 'node:crypto';

/**
 * PIN hashing, shared by the manager PIN and every staff PIN.
 *
 * Extracted so there is exactly one implementation. Two copies of this drift:
 * one gets the constant-time compare and the other quietly keeps `===`, and
 * nobody notices because both "work".
 *
 * A 4-digit PIN is only 10,000 possibilities, so the hash is not really what
 * protects it — the fact that it never leaves the main process is. What the
 * salt does buy is that reading the database file does not immediately hand
 * over every staff member's PIN by lookup table, and that two people who
 * happen to choose 1234 do not have visibly identical rows.
 */

const SEPARATOR = '$';

function hash(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

/** `salt$hash`. */
export function encodePin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}${SEPARATOR}${hash(pin, salt)}`;
}

/** True when the stored value is a real PIN rather than a blank. */
export function isEncoded(stored: string): boolean {
  return stored.includes(SEPARATOR);
}

/**
 * Constant-time check. A PIN is short enough that a timing oracle is worth
 * avoiding, and it costs nothing to do it properly.
 */
export function verifyPin(supplied: unknown, stored: string): boolean {
  if (!isEncoded(stored)) return false;
  if (typeof supplied !== 'string' || !supplied.trim()) return false;

  const [salt, expected] = stored.split(SEPARATOR);
  const actual = hash(supplied.trim(), salt);

  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The one shape rule, applied to manager and staff PINs alike. */
export function assertPinShape(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('The PIN must be 4 to 8 digits.');
  }
}
