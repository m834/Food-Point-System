/**
 * The build switch that decides which product a client is handed.
 *
 *   npm run dist:win              -> SIMPLE  — the stock app, stock look
 *   npm run dist:win -- --branded -> BRANDED — the client's own colours applied
 *
 * One flag, read in one place. It is inlined by Next at build time (that is
 * what the NEXT_PUBLIC_ prefix buys), so the simple build ships with this as a
 * literal `false` and the theme is never applied.
 *
 * WHY THE MAIN PROCESS DOES NOT ALSO CHECK IT
 *
 * It has nothing to protect. The theme is nine colours and a filename; storing
 * them in a simple build's database is harmless because this flag gates the
 * only thing that ever reads them back out — the stylesheet injection. Adding
 * a second copy of the switch in the main process would mean a build where the
 * two disagree, and no benefit to weigh against that.
 *
 * The practical upshot: a simple-build shop that restores a branded shop's
 * backup keeps their stock look, rather than inheriting someone else's brand.
 */
export const BRANDING_ENABLED = process.env.NEXT_PUBLIC_FOOD_BRANDING === '1';

/**
 * Whether the shop can EDIT that brand from Settings.
 *
 * Separate from BRANDING_ENABLED on purpose. The two questions are different:
 * "does this build wear the client's colours" and "can whoever is standing at
 * the counter change them". A shipped app answers yes to the first and no to
 * the second — the look is agreed once, and a shop that can recolour its own
 * Void button at 11pm on a Friday is a support call waiting to happen.
 *
 * Off unless the build explicitly asks for it, so the Appearance card cannot
 * reach a client by forgetting a flag:
 *
 *   NEXT_PUBLIC_FOOD_APPEARANCE=1 npm run dev:branded
 *
 * That is how the brand gets set in the first place — set it here, then hand
 * the shop the resulting database (or a backup of it). The colours live in
 * `settings`, so they survive with the data rather than with the installer.
 */
export const APPEARANCE_EDITOR = process.env.NEXT_PUBLIC_FOOD_APPEARANCE === '1';
