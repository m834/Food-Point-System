import { getDb } from '../connection';
import { nowIso } from '../money';
import type { BackupRecord } from '../../../shared/types';

export function logBackup(path: string, sizeBytes: number): void {
  getDb()
    .prepare('INSERT INTO backup_log (path, created_at, size_bytes) VALUES (?, ?, ?)')
    .run(path, nowIso(), sizeBytes);
}

export function backupHistory(limit = 20): BackupRecord[] {
  return getDb()
    .prepare(
      'SELECT id, path, created_at, size_bytes FROM backup_log ORDER BY created_at DESC LIMIT ?',
    )
    .all(limit) as BackupRecord[];
}

/** Drives the gentle "you haven't backed up in a while" nudge. */
export function lastBackup(): BackupRecord | null {
  return (
    (getDb()
      .prepare(
        'SELECT id, path, created_at, size_bytes FROM backup_log ORDER BY created_at DESC LIMIT 1',
      )
      .get() as BackupRecord | undefined) ?? null
  );
}
