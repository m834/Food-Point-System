import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { checkpoint, closeDb, dbPath, getDb } from '../db/connection';
import { backupHistory, lastBackup, logBackup } from '../db/repositories/backupLog';
import { nowIso } from '../db/money';
import type { BackupRecord } from '../../shared/types';

/**
 * One-click backup to a USB stick or folder (spec §5.8).
 *
 * The data lives on exactly one computer, so this is reputation insurance —
 * not a convenience. Nothing here touches the network, and nothing here ever
 * deletes anything.
 */

function stamp(): string {
  return nowIso().replace(/[: ]/g, '-');
}

export async function backupNow(): Promise<BackupRecord> {
  const result = await dialog.showOpenDialog({
    title: 'Choose where to save the backup',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Save backup here',
  });

  if (result.canceled || !result.filePaths[0]) {
    throw new Error('Backup cancelled.');
  }

  // Fold the write-ahead log into the .db file first, or the copy is missing
  // the most recent orders — exactly the ones worth keeping.
  checkpoint();

  const target = path.join(result.filePaths[0], `foodpoint-backup-${stamp()}.db`);
  fs.copyFileSync(dbPath(), target);

  const size = fs.statSync(target).size;
  logBackup(target, size);

  return { id: 0, path: target, created_at: nowIso(), size_bytes: size };
}

/**
 * Restore asks twice, because it replaces everything. The dialog names what is
 * about to be overwritten rather than asking "are you sure?" in the abstract.
 */
export async function restoreFromFile(): Promise<{ restored: boolean }> {
  const picked = await dialog.showOpenDialog({
    title: 'Choose a backup file to restore',
    properties: ['openFile'],
    filters: [{ name: 'Food Point backup', extensions: ['db'] }],
  });

  if (picked.canceled || !picked.filePaths[0]) {
    throw new Error('Restore cancelled.');
  }

  const source = picked.filePaths[0];
  if (!fs.existsSync(source)) throw new Error('That backup file could not be found.');

  const confirm = await dialog.showMessageBox({
    type: 'warning',
    title: 'Restore this backup?',
    message: 'Replace all current data with this backup?',
    detail:
      `Everything currently in the app — menu, orders and reports — will be replaced by\n` +
      `${path.basename(source)}.\n\nThis cannot be undone.`,
    buttons: ['Cancel', 'Replace everything'],
    defaultId: 0,
    cancelId: 0,
  });

  if (confirm.response !== 1) throw new Error('Restore cancelled.');

  const live = dbPath();

  // Close before touching the file. Windows holds a lock on an open SQLite
  // database, so overwriting it underneath a live connection either fails
  // outright or leaves a half-written file.
  closeDb();

  // Keep a copy of what we are about to overwrite. If this turns out to be the
  // wrong backup, today's takings are still recoverable.
  fs.copyFileSync(live, `${live}.replaced-${stamp()}`);
  fs.copyFileSync(source, live);

  // The WAL and shared-memory sidecars belong to the OLD database. Leaving
  // them would let SQLite replay stale pages over the file we just restored.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${live}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }

  getDb();
  return { restored: true };
}

export function history(): BackupRecord[] {
  return backupHistory();
}

export function last(): BackupRecord | null {
  return lastBackup();
}
