import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db/connection';
import { getLicenseRow, saveLicenseRow, setLicenseStatus } from '../db/repositories/license';
import { getMachineId } from './machineId';
import { LICENSE_PUBLIC_KEY_PEM } from '../license/publicKey';
import { decodeKey, type LicensePayload } from '../../shared/licenseFormat';
import { todayIso } from '../db/money';
import type { LicenseStatus } from '../../shared/types';

/**
 * Node-locked, offline licensing (spec §7).
 *
 * The app holds the PUBLIC key only. It can verify that the office signed a
 * key for THIS machine; it can never mint one. There is deliberately no code
 * path in this file that produces a valid key.
 */

const LICENSE_FILE = 'license.dat';

/**
 * The product this build accepts. Stamped inside the signed payload by the
 * office, so a Shop or Pharmacy key cannot activate the food point — and
 * because it is covered by the signature, a customer cannot edit it.
 */
const PRODUCT = 'food';

function licenseFilePath(): string {
  return path.join(dataDir(), LICENSE_FILE);
}

/**
 * The stored license is encrypted with a key derived from the machine id —
 * the secondary hardening from spec §9. It stops someone copying license.dat
 * to another PC. The real lock is the signature check below.
 */
function fileKey(): Buffer {
  return crypto.createHash('sha256').update(`CodeHustlers|food|${getMachineId()}`).digest();
}

function writeLicenseFile(key: string): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fileKey(), iv);
  const enc = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  fs.writeFileSync(licenseFilePath(), Buffer.concat([iv, cipher.getAuthTag(), enc]));
}

function readLicenseFile(): string | null {
  try {
    const raw = fs.readFileSync(licenseFilePath());
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    // Missing, tampered with, or copied from a different machine.
    return null;
  }
}

export interface VerifiedLicense {
  payload: LicensePayload;
  expiresAt: string | null;
}

/**
 * Verify a key against the embedded public key and this machine.
 * Every message here is written for a shop owner, not a developer.
 */
export function verifyKey(key: string, machineId = getMachineId()): VerifiedLicense {
  const { payload, payloadRaw, signature } = decodeKey(key);

  const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM);
  if (!crypto.verify(null, payloadRaw, publicKey, signature)) {
    throw new Error('This license key is not valid. Please check it with the office.');
  }

  if (payload.m !== machineId) {
    throw new Error('This license key belongs to a different computer.');
  }

  if (payload.p !== PRODUCT) {
    throw new Error('This license key is for a different Code Hustlers product.');
  }

  if (payload.exp && payload.exp < todayIso()) {
    throw new Error(`This license expired on ${payload.exp}. Please contact the office to renew.`);
  }

  return { payload, expiresAt: payload.exp };
}

export function activate(key: string): LicenseStatus {
  const machineId = getMachineId();
  const verified = verifyKey(key, machineId);

  writeLicenseFile(key.trim());
  saveLicenseRow(machineId, key.trim(), verified.expiresAt);

  return status();
}

/** Re-verified on every startup — never trusted from the stored row alone. */
export function status(): LicenseStatus {
  const machineId = getMachineId();
  const base: LicenseStatus = {
    licensed: false,
    machineId,
    status: 'unlicensed',
    expiresAt: null,
    activatedAt: null,
    message: 'Enter the license key from the office to start using the app.',
  };

  const stored = readLicenseFile() ?? getLicenseRow()?.license_key ?? null;
  if (!stored) return base;

  const row = getLicenseRow();

  try {
    const verified = verifyKey(stored, machineId);
    if (row?.status !== 'active') setLicenseStatus('active');
    return {
      licensed: true,
      machineId,
      status: 'active',
      expiresAt: verified.expiresAt,
      activatedAt: row?.activated_at ?? null,
      message: verified.expiresAt ? `Licensed until ${verified.expiresAt}.` : 'Licensed — lifetime.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'This license is not valid.';
    const expired = message.includes('expired');
    if (row) setLicenseStatus(expired ? 'expired' : 'invalid');
    return {
      ...base,
      status: expired ? 'expired' : 'invalid',
      expiresAt: row?.expires_at ?? null,
      activatedAt: row?.activated_at ?? null,
      message,
    };
  }
}

export function isLicensed(): boolean {
  return status().licensed;
}
