import { handle } from './util';
import { backupNow, history, last, restoreFromFile } from '../services/backup';

export function registerBackupHandlers(): void {
  handle('backup:now', () => backupNow());

  // Restore opens its own confirmation dialog in the main process — the UI
  // cannot skip it by calling this channel directly.
  handle('backup:restore', () => restoreFromFile());

  handle('backup:history', () => history());

  handle('backup:last', () => last());
}
