import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

/**
 * Data lives in the OS app-data directory — %APPDATA%/CodeHustlersFood/ on
 * Windows — never in Program Files. It survives updates, and the uninstaller
 * leaves it alone (spec §3, §11).
 */
export function dataDir(): string {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), 'foodpoint.db');
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath());
    // WAL: durable, and a report can read while an order is being settled.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    // Order lines must not outlive their order, nor modifiers their line.
    db.pragma('foreign_keys = ON');
  }
  return db;
}

/** Flush the WAL into the .db file so a plain file copy is complete. */
export function checkpoint(): void {
  if (db) db.pragma('wal_checkpoint(TRUNCATE)');
}

export function closeDb(): void {
  if (db) {
    checkpoint();
    db.close();
    db = null;
  }
}

/** Restore swaps the file underneath us, so it has to reopen. */
export function reopenDb(): Database.Database {
  closeDb();
  return getDb();
}
