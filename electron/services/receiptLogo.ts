import { getSetting } from '../db/repositories/settings';
import { resolveImage } from './images';
import { SETTING_KEYS } from '../../shared/types';

/**
 * ════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE THE PRINTED LOGO WILL PLUG IN.
 * ════════════════════════════════════════════════════════════════════
 *
 * Today this is a deliberate NO-OP. `logoRasterBytes()` always returns null,
 * so `buildEscPos()` emits exactly the bytes it emitted before the logo
 * feature existed and the live printer at the client cannot change behaviour.
 *
 * WHY IT IS NOT IMPLEMENTED YET
 * Printing an image on a thermal printer is not printing text. It means
 * emitting an ESC/POS raster bitmap (`GS v 0`): the image has to be resized to
 * the head's dot width, converted to 1-bit black/white with dithering, packed
 * into rows of bytes, and preceded by a header the controller understands.
 * Controllers differ — some want `GS v 0`, older ones only `ESC *`, and a few
 * clones accept neither and print the payload as garbage or jam the roll.
 * That is not something to discover on a paying client's counter during
 * service, so it is staged behind this function until it can be trialled on
 * their actual printer.
 *
 * WHAT "DONE" LOOKS LIKE, WHEN WE COME BACK TO IT
 *   1. Read the file with `logoFilePath()` below (already correct and safe).
 *   2. Decode and downscale it to `LOGO_TARGET_DOTS` wide, preserving aspect.
 *   3. Threshold/dither to 1-bit, MSB-first, one bit per pixel, rows padded to
 *      whole bytes.
 *   4. Emit: centre (`ESC a 1`), then `GS v 0 m xL xH yL yH` + the bit rows,
 *      then restore alignment.
 *   5. Return that Buffer from `logoRasterBytes()`. Nothing else changes —
 *      `buildEscPos()` already splices the result in at the right position.
 *
 * NOTHING ELSE IN THE PRINT PATH SHOULD NEED EDITING. If a future change
 * requires touching `printing.ts` as well, that is a sign the seam is in the
 * wrong place and is worth fixing rather than working around.
 */

/**
 * Target width in printer dots.
 *
 * An 80mm head is 576 dots across at 203dpi. 384 leaves a comfortable margin
 * either side, so the mark reads as a logo rather than as a full-bleed banner.
 * A 58mm printer is 384 dots total, so this will need to become a setting or
 * be derived from the paper width when the feature is built.
 */
export const LOGO_TARGET_DOTS = 384;

/**
 * The absolute path of the configured logo, or null when none is set or the
 * file has gone missing.
 *
 * Shared by the on-screen slip preview and (later) the raster printer, so both
 * agree about whether a logo exists. Uses `resolveImage`, which refuses
 * anything that is not a plain image filename inside the logo folder.
 */
export function logoFilePath(): string | null {
  const file = getSetting(SETTING_KEYS.shopLogo);
  if (!file) return null;
  return resolveImage('logo', file);
}

/** True when a usable logo file is configured — used by the preview. */
export function hasLogo(): boolean {
  return logoFilePath() !== null;
}

/**
 * The ESC/POS bytes for the logo, spliced into the top of every slip.
 *
 * Returns null today. See the block comment above before changing this — it
 * is the single seam the whole feature hangs on, and returning anything other
 * than null starts sending image data to a live thermal printer.
 */
export function logoRasterBytes(): Buffer | null {
  // ── RASTER LOGO PRINTING PLUGS IN HERE ──
  return null;
}
