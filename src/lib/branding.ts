/**
 * The build switch that decides which product a client is handed.
 *
 *   npm run dist:win              -> SIMPLE  — the stock app, no Appearance screen
 *   npm run dist:win -- --branded -> BRANDED — the client can set their own look
 *
 * One flag, read in one place. It is inlined by Next at build time (that is
 * what the NEXT_PUBLIC_ prefix buys), so the simple build ships with this as a
 * literal `false` and the Appearance card is never rendered.
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
