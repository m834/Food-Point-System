import { getDb } from '../connection';
import { nowIso } from '../money';

export interface LicenseRow {
  machine_id: string;
  license_key: string;
  expires_at: string | null;
  activated_at: string;
  status: string;
}

export function getLicenseRow(): LicenseRow | null {
  return (
    (getDb()
      .prepare(
        'SELECT machine_id, license_key, expires_at, activated_at, status FROM license WHERE id = 1',
      )
      .get() as LicenseRow | undefined) ?? null
  );
}

/** Single row, id = 1 — one machine, one license. */
export function saveLicenseRow(
  machineId: string,
  key: string,
  expiresAt: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO license (id, machine_id, license_key, expires_at, activated_at, status)
       VALUES (1, ?, ?, ?, ?, 'active')
       ON CONFLICT(id) DO UPDATE SET
         machine_id = excluded.machine_id,
         license_key = excluded.license_key,
         expires_at = excluded.expires_at,
         status = 'active'`,
    )
    .run(machineId, key, expiresAt, nowIso());
}

export function setLicenseStatus(status: string): void {
  getDb().prepare('UPDATE license SET status = ? WHERE id = 1').run(status);
}
