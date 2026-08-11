/**
 * The license key wire format, shared by the app (which verifies) and the
 * founder's office key generator (which signs). One definition means the two
 * can never drift apart.
 *
 *   CH1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>
 *
 * The signature covers the exact payload bytes, so the machine id, the expiry
 * and the product are all tamper-proof — a customer cannot edit any of them
 * without invalidating the key.
 */

export const KEY_PREFIX = 'CH1';

export interface LicensePayload {
  /** Machine ID this key is locked to. */
  m: string;
  /** Expiry as YYYY-MM-DD, or null for a lifetime key. */
  exp: string | null;
  /** Issue date, for the office's records. */
  iss: string;
  /** Product code. 'food' here — a shop or pharmacy key must not activate this. */
  p: string;
}

export function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Buffer {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

/** Canonical payload bytes — exactly what gets signed and verified. */
export function payloadBytes(payload: LicensePayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

export function encodeKey(payload: LicensePayload, signature: Buffer): string {
  return [KEY_PREFIX, b64urlEncode(payloadBytes(payload)), b64urlEncode(signature)].join('.');
}

export interface DecodedKey {
  payload: LicensePayload;
  payloadRaw: Buffer;
  signature: Buffer;
}

export function decodeKey(key: string): DecodedKey {
  const parts = key.trim().replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    throw new Error('That does not look like a valid license key.');
  }

  let payloadRaw: Buffer;
  let payload: LicensePayload;
  try {
    payloadRaw = b64urlDecode(parts[1]);
    payload = JSON.parse(payloadRaw.toString('utf8')) as LicensePayload;
  } catch {
    throw new Error('That license key is damaged. Please check it was copied in full.');
  }

  if (!payload || typeof payload.m !== 'string') {
    throw new Error('That license key is damaged. Please check it was copied in full.');
  }

  return { payload, payloadRaw, signature: b64urlDecode(parts[2]) };
}
