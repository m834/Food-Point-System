import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { checkpoint, closeDb, dbPath, getDb } from '../db/connection';
import { copyUploadTree, restoreUploadTree } from './images';
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

  /**
   * A backup is a FOLDER, not a lone .db file, because the photos are part of
   * the shop's data now. A database restored without its images would come
   * back with a menu full of broken pictures and no way to tell what was lost.
   *
   *   foodpoint-backup-<when>/
   *     foodpoint.db
   *     images/...
   *
   * Restoring still accepts a bare .db from an older version — see below.
   */
  const folder = path.join(result.filePaths[0], `foodpoint-backup-${stamp()}`);
  fs.mkdirSync(folder, { recursive: true });

  const target = path.join(folder, 'foodpoint.db');
  fs.copyFileSync(dbPath(), target);

  let size = fs.statSync(target).size;
  // Photos travel with the data: a database restored without its pictures
  // comes back with a menu full of blanks and no way to tell what was lost.
  size += copyUploadTree(path.join(folder, 'upload')).bytes;

  /**
   * The recorded path is the .db FILE, not the folder around it.
   *
   * That keeps one meaning for "path" everywhere — history, "last backup", and
   * the restore picker all point at something that can actually be opened as a
   * database. The photos sit in ./images beside it, and restore looks there.
   */
  logBackup(target, size);

  return { id: 0, path: target, created_at: nowIso(), size_bytes: size };
}

/**
 * Find the database inside a chosen backup folder.
 *
 * Three shapes turn up in practice and all of them should just work:
 *
 *   - a current backup folder      -> foodpoint.db inside it
 *   - an older backup folder       -> one loose foodpoint-backup-....db
 *   - the folder ABOVE a backup    -> a single backup folder within it
 *
 * Anything genuinely ambiguous is refused by name rather than guessed at:
 * restoring the wrong day's takings is not an error anyone can walk back.
 */
function resolveBackupDb(chosen: string): string {
  if (!fs.existsSync(chosen)) throw new Error('That folder could not be found.');

  if (fs.statSync(chosen).isFile()) return chosen;

  // The current layout.
  const standard = path.join(chosen, 'foodpoint.db');
  if (fs.existsSync(standard)) return standard;

  // An older backup: loose .db files in the folder.
  const dbs = fs
    .readdirSync(chosen)
    .filter((name) => name.toLowerCase().endsWith('.db'))
    .map((name) => path.join(chosen, name))
    .filter((file) => fs.statSync(file).isFile());

  if (dbs.length === 1) return dbs[0];
  if (dbs.length > 1) {
    throw new Error(
      'That folder holds several backups. Open the one you want and choose it directly.',
    );
  }

  // They picked the folder that CONTAINS the backup folders.
  const nested = fs
    .readdirSync(chosen)
    .map((name) => path.join(chosen, name))
    .filter((entry) => {
      try {
        return fs.statSync(entry).isDirectory() && fs.existsSync(path.join(entry, 'foodpoint.db'));
      } catch {
        return false;
      }
    });

  if (nested.length === 1) return path.join(nested[0], 'foodpoint.db');
  if (nested.length > 1) {
    throw new Error('That folder holds several backups. Choose the one you want to restore.');
  }

  throw new Error(
    'No backup found in that folder. Choose the folder that contains foodpoint.db.',
  );
}

/**
 * Restore asks twice, because it replaces everything. The dialog names what is
 * about to be overwritten rather than asking "are you sure?" in the abstract.
 */
export async function restoreFromFile(): Promise<{ restored: boolean; images: number }> {
  /**
   * Pick the backup FOLDER, not a file.
   *
   * A backup is a folder — `foodpoint.db` plus `upload/` — so asking for a
   * file made the photos unreachable: the picker would not let you select the
   * thing the backup actually is. Windows cannot offer files and folders in
   * one dialog, so the folder wins, and `resolveBackup` below still accepts a
   * folder that merely CONTAINS a loose .db, which is what an older backup
   * looks like.
   */
  const picked = await dialog.showOpenDialog({
    title: 'Choose the backup folder to restore',
    properties: ['openDirectory'],
    buttonLabel: 'Restore from this folder',
  });

  if (picked.canceled || !picked.filePaths[0]) {
    throw new Error('Restore cancelled.');
  }

  const chosen = picked.filePaths[0];
  const source = resolveBackupDb(chosen);

  // Photos live in ./upload inside the folder. An older backup has none, and
  // restores just as well without them.
  const siblingUpload = path.join(path.dirname(source), 'upload');
  const hasImages = fs.existsSync(siblingUpload) && fs.statSync(siblingUpload).isDirectory();

  const confirm = await dialog.showMessageBox({
    type: 'warning',
    title: 'Restore this backup?',
    message: 'Replace all current data with this backup?',
    detail:
      `Everything currently in the app — menu, orders and reports — will be replaced by\n` +
      `${path.basename(path.dirname(source))}.\n\n` +
      (hasImages ? 'Photos in this backup will be restored too.\n\n' : '') +
      `This cannot be undone.`,
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

  /**
   * Photos come back too, otherwise a restore returns a menu whose pictures
   * are all missing. Copied rather than replaced: a photo the shop added since
   * the backup is not evidence of anything wrong, and deleting it would be a
   * data loss the owner never asked for.
   */
  const images = hasImages ? restoreUploadTree(siblingUpload) : 0;

  getDb();
  return { restored: true, images };
}

export function history(): BackupRecord[] {
  return backupHistory();
}

export function last(): BackupRecord | null {
  return lastBackup();
}
