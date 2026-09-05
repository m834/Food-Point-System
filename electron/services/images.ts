import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db/connection';

/**
 * Item, category and deal photos.
 *
 * Laid out on disk by what the picture is OF:
 *
 *   <userData>/upload/category/cat_pizza.jpg
 *   <userData>/upload/menu-item/pizza_crown_crust.jpg
 *   <userData>/upload/deal/deal_01.jpg
 *   <userData>/upload/logo/shop-logo.png      <- the shop's own mark
 *   <userData>/upload/theme/backdrop.jpg      <- the client's branding art
 *
 * Two reasons the folders are split rather than one flat pile. A shop dropping
 * in fifty photos from their designer can keep the category shots separate
 * from the dish shots without inventing a naming convention, and an item and a
 * category are allowed to share a filename without one silently overwriting
 * the other.
 *
 * Only the BASENAME is stored in the database. The folder is implied by which
 * table the row is in, so a photo can never be attributed to the wrong kind of
 * thing by editing a string.
 *
 * Nothing here touches the network — files are chosen from the shop's own disk
 * and copied in.
 */

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * The kinds of thing that can carry a picture. `theme` is the client's own
 * background artwork, which is branding rather than a photo OF anything — it
 * keeps its own folder so a shop clearing out dish photos cannot wipe it.
 */
export const IMAGE_KINDS = ['category', 'menu-item', 'deal', 'logo', 'theme'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export function isImageKind(value: unknown): value is ImageKind {
  return typeof value === 'string' && (IMAGE_KINDS as readonly string[]).includes(value);
}

/** <userData>/upload — the root every photo lives under. */
export function uploadRoot(): string {
  const dir = path.join(dataDir(), 'upload');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function imagesDir(kind: ImageKind): string {
  const dir = path.join(uploadRoot(), kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a stored basename to a real path inside its folder.
 *
 * Returns null for anything that escapes. The name comes from the database,
 * but a restore writes into that database from a file the shop was handed, so
 * this is not a formality: `../../` must never reach the filesystem, and the
 * app:// handler relies on this returning null to refuse the request.
 */
export function resolveImage(kind: string, name: string): string | null {
  if (!isImageKind(kind)) return null;
  if (!name || name.includes('\0')) return null;

  const base = path.basename(name);
  if (base !== name) return null;
  if (!ALLOWED.has(path.extname(base).toLowerCase())) return null;

  const dir = imagesDir(kind);
  const full = path.join(dir, base);
  if (!full.startsWith(dir + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

/** Every photo of one kind — what a "pick an existing photo" list shows. */
export function listImages(kind: ImageKind): string[] {
  try {
    return fs
      .readdirSync(imagesDir(kind))
      .filter((name) => ALLOWED.has(path.extname(name).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Ask for a photo and copy it into the folder for its kind, returning the
 * stored basename.
 *
 * The original filename is kept where possible, because the menu spreadsheet
 * refers to photos by name (`pizza_crown_crust.jpg`) and matching those is how
 * a bulk drop-in works. A clash with a *different* file gets a numeric suffix
 * rather than silently overwriting someone else's photo; a clash with an
 * identical one is treated as the same photo again.
 */
export async function chooseImage(kind: ImageKind): Promise<{ file: string } | null> {
  const result = await dialog.showOpenDialog({
    title:
      kind === 'category'
        ? 'Choose a category photo'
        : kind === 'theme'
          ? 'Choose the background artwork'
          : 'Choose a photo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const source = result.filePaths[0];
  const ext = path.extname(source).toLowerCase();
  if (!ALLOWED.has(ext)) throw new Error('That file is not a JPG, PNG or WEBP image.');

  const stat = fs.statSync(source);
  // A 20MB camera original would make the order grid crawl on a counter PC.
  if (stat.size > 8 * 1024 * 1024) {
    throw new Error('That image is over 8 MB. Please use a smaller photo.');
  }

  const dir = imagesDir(kind);
  const base = path.basename(source, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
  let name = `${base}${ext}`;
  let counter = 1;

  while (fs.existsSync(path.join(dir, name))) {
    if (fs.statSync(path.join(dir, name)).size === stat.size) return { file: name };
    name = `${base}-${counter}${ext}`;
    counter += 1;
  }

  fs.copyFileSync(source, path.join(dir, name));
  return { file: name };
}

/**
 * Copy a whole folder of photos in at once.
 *
 * This is the path that matters for a new customer: the designer hands over
 * fifty files named exactly as the menu spreadsheet says, and the shop imports
 * the lot in one action rather than clicking through fifty dialogs.
 */
export async function importImageFolder(
  kind: ImageKind,
): Promise<{ copied: number; skipped: number }> {
  const result = await dialog.showOpenDialog({
    title: `Choose the folder of ${kind === 'category' ? 'category' : 'item'} photos`,
    properties: ['openDirectory'],
    buttonLabel: 'Import photos',
  });

  if (result.canceled || !result.filePaths[0]) throw new Error('Import cancelled.');

  const source = result.filePaths[0];
  const dir = imagesDir(kind);
  let copied = 0;
  let skipped = 0;

  for (const name of fs.readdirSync(source)) {
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED.has(ext)) continue;

    const from = path.join(source, name);
    if (!fs.statSync(from).isFile()) continue;

    const safe = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const to = path.join(dir, safe);

    // Re-importing the same folder is a no-op, not fifty duplicates.
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) {
      skipped += 1;
      continue;
    }

    fs.copyFileSync(from, to);
    copied += 1;
  }

  return { copied, skipped };
}

/** Copy the whole upload tree somewhere — used by backup. Returns bytes. */
export function copyUploadTree(destination: string): { files: number; bytes: number } {
  const root = uploadRoot();
  let files = 0;
  let bytes = 0;

  for (const kind of IMAGE_KINDS) {
    const from = path.join(root, kind);
    if (!fs.existsSync(from)) continue;

    const to = path.join(destination, kind);
    let names: string[] = [];
    try {
      names = fs.readdirSync(from);
    } catch {
      continue;
    }
    if (!names.length) continue;

    fs.mkdirSync(to, { recursive: true });
    for (const name of names) {
      const file = path.join(from, name);
      try {
        if (!fs.statSync(file).isFile()) continue;
        fs.copyFileSync(file, path.join(to, name));
        files += 1;
        bytes += fs.statSync(file).size;
      } catch {
        // One unreadable photo must not abort the backup of the sales data.
      }
    }
  }

  return { files, bytes };
}

/** Restore the upload tree from a backup folder. Returns how many came back. */
export function restoreUploadTree(source: string): number {
  let restored = 0;

  for (const kind of IMAGE_KINDS) {
    const from = path.join(source, kind);
    if (!fs.existsSync(from)) continue;

    const to = imagesDir(kind);
    for (const name of fs.readdirSync(from)) {
      const file = path.join(from, name);
      try {
        if (!fs.statSync(file).isFile()) continue;
        fs.copyFileSync(file, path.join(to, path.basename(name)));
        restored += 1;
      } catch {
        // A single unreadable photo must not fail the whole restore.
      }
    }
  }

  return restored;
}
