import { handle, asEnum } from './util';
import { IMAGE_KINDS, chooseImage, importImageFolder, listImages } from '../services/images';

/**
 * Photos. The renderer never touches the filesystem — it asks the main process
 * to open a picker, and gets back only a filename it can render through
 * app://media/. There is no channel that accepts a path from the UI.
 */
export function registerImageHandlers(): void {
  handle('images:list', (_e, kind) => listImages(asEnum(kind, IMAGE_KINDS, 'Image kind')));

  /** Opens the OS file picker and copies the chosen photo into its folder. */
  handle('images:choose', (_e, kind) => chooseImage(asEnum(kind, IMAGE_KINDS, 'Image kind')));

  /**
   * Bulk import: point at the designer's folder and copy the lot in one go.
   * This is the path that matters when a new customer arrives with fifty
   * photos named to match their menu spreadsheet.
   */
  handle('images:importFolder', (_e, kind) =>
    importImageFolder(asEnum(kind, IMAGE_KINDS, 'Image kind')),
  );

}
