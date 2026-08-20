#!/usr/bin/env node
/**
 * Import a menu spreadsheet into the live database.
 *
 *   npm run import:menu -- 4Friends_Menu_POS_Seed.xlsx
 *   npm run import:menu -- <file.xlsx> --replace
 *
 * Expects the sheet layout the office uses for a new customer:
 *
 *   Menu  : Category | Item | Size / Variant | Price (Rs) | image_file | ...
 *   Deals : Deal | Contents | Price (Rs) | image_file
 *
 * Rows that repeat the same Category+Item with different sizes become ONE menu
 * item carrying several variants — which is the whole point, since a pizza
 * priced 600/1199/1499/1999 is one dish on the grid, not four.
 *
 * Runs under Electron because better-sqlite3 is built for Electron's ABI and
 * the database path comes from app.getPath('userData'). It writes to the REAL
 * database, so it prints what it is about to do and refuses to run twice
 * without --replace.
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const dist = path.join(ROOT, 'dist-electron', 'electron');

app.setName('CodeHustlersFood');

/* ---------------- minimal xlsx reader ----------------
 * A spreadsheet is a zip of XML. Reading it directly avoids adding a parser
 * dependency to an app that ships offline — this tool is the only thing that
 * needs it, and it runs in the office, not at the shop.
 */

function readZip(file) {
  const buf = fs.readFileSync(file);
  const entries = {};

  // Walk the central directory backwards from the End Of Central Directory.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('That file is not a valid .xlsx');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    const method = buf.readUInt16LE(localOffset + 8);
    const compSize = buf.readUInt32LE(localOffset + 18);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compSize);

    entries[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function sheetRows(xml) {
  const text = xml.toString('utf8');
  const rows = [];

  for (const rowMatch of text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
      const col = cellMatch[1];
      const body = cellMatch[2];
      // Inline strings (<is><t>) or plain values (<v>).
      const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');
      const value = inline || (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
      cells[col] = value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    }
    rows.push(cells);
  }

  return rows;
}

/* ---------------- the import ---------------- */

const file = process.argv.find((a) => a.endsWith('.xlsx'));
const replace = process.argv.includes('--replace');

app.whenReady().then(() => {
  if (!file) {
    console.error('Usage: npm run import:menu -- <file.xlsx> [--replace]');
    app.exit(1);
    return;
  }

  const { getDb } = require(path.join(dist, 'db', 'connection'));
  const { migrate } = require(path.join(dist, 'db', 'migrate'));

  getDb();
  migrate();
  const db = getDb();

  const zip = readZip(path.resolve(ROOT, file));
  const menuRows = sheetRows(zip['xl/worksheets/sheet1.xml']);
  const dealRows = zip['xl/worksheets/sheet2.xml'] ? sheetRows(zip['xl/worksheets/sheet2.xml']) : [];

  /* ---- Menu ----
   * Skip the two title lines and the header. A row is a real menu row only if
   * it has both a category and an item name — the sheet uses bare Category
   * cells as visual section banners ("PIZZA — White Sauce"), which must not
   * become items.
   */
  const priced = menuRows
    .map((r) => ({
      category: (r.A || '').trim(),
      item: (r.B || '').trim(),
      variant: (r.C || '').trim(),
      price: Number(r.D || 0),
      image: (r.E || '').trim(),
    }))
    .filter((r) => r.category && r.item && r.price > 0);

  // Group by category+item so sizes collapse into variants.
  const grouped = new Map();
  for (const row of priced) {
    const key = `${row.category}||${row.item}`;
    if (!grouped.has(key)) {
      grouped.set(key, { category: row.category, item: row.item, image: row.image, rows: [] });
    }
    grouped.get(key).rows.push(row);
  }

  const existing = db.prepare('SELECT COUNT(*) n FROM menu_items').get().n;
  if (existing > 0 && !replace) {
    console.error(`\n  The menu already has ${existing} items.`);
    console.error('  Re-run with --replace to clear it and import fresh.\n');
    app.exit(1);
    return;
  }

  const run = db.transaction(() => {
    if (replace) {
      // Order history keeps its snapshots, so clearing the menu is safe:
      // order_items.menu_item_id is ON DELETE SET NULL.
      db.prepare('DELETE FROM menu_item_variants').run();
      db.prepare('DELETE FROM deal_items').run();
      db.prepare('DELETE FROM deals').run();
      db.prepare('DELETE FROM menu_items').run();
      db.prepare('DELETE FROM menu_categories').run();
    }

    const catIds = new Map();
    const insertCat = db.prepare(
      'INSERT INTO menu_categories (name, sort_order, image_file) VALUES (?, ?, ?)',
    );
    let catOrder = 0;
    for (const { category } of grouped.values()) {
      if (catIds.has(category)) continue;
      // Category photos follow the guide's naming: cat_pizza.jpg etc.
      const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const id = Number(insertCat.run(category, catOrder, `cat_${slug}.jpg`).lastInsertRowid);
      catIds.set(category, id);
      catOrder += 1;
    }

    const insertItem = db.prepare(
      `INSERT INTO menu_items
         (name, category_id, sale_price, cost_price, is_available, sort_order, image_file)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    const insertVariant = db.prepare(
      `INSERT INTO menu_item_variants (item_id, name, sale_price, cost_price, sort_order)
       VALUES (?, ?, ?, 0, ?)`,
    );

    let itemCount = 0;
    let variantCount = 0;
    let order = 0;

    for (const group of grouped.values()) {
      const sizes = group.rows.filter((r) => r.variant && r.variant !== '-');
      // Base price is the cheapest, so an item with no sizes still prices, and
      // one with sizes shows "from Rs X" on the grid.
      const base = Math.min(...group.rows.map((r) => r.price));

      const itemId = Number(
        insertItem.run(
          group.item,
          catIds.get(group.category),
          base,
          // Food cost is the owner's number to set later; the sheet has none.
          0,
          order,
          group.image || null,
        ).lastInsertRowid,
      );
      order += 1;
      itemCount += 1;

      if (sizes.length > 1) {
        sizes.forEach((row, index) => {
          insertVariant.run(itemId, row.variant, row.price, index);
          variantCount += 1;
        });
      }
    }

    /* ---- Deals ----
     * Contents read "3x Zinger Burger + 1x Half Fries + 1x 1.5 litre". Each
     * part is matched to a menu item by name. Anything unmatched is reported
     * rather than guessed at — a deal priced against the wrong dish would
     * quietly corrupt the profit figure.
     */
    const allItems = db.prepare('SELECT id, name FROM menu_items').all();
    /**
     * Match a deal part to a menu item by TOKEN OVERLAP, not substring.
     *
     * The deal sheet and the menu sheet were written by different people, so
     * the same dish appears as "Chicken Special Roll" in one and "Special
     * Chicken Roll" in the other. Substring matching fails on word order;
     * comparing sets of words does not.
     *
     * Size words are stripped first: "Half Fries" and "4F Large Pizza" name a
     * SIZE of an item, and the size lives on the variant, not in the item name.
     */
    const SIZE_WORDS = new Set([
      'half', 'full', 'small', 'medium', 'large', 'family', 'regular', 'reg',
      '4f', 'pcs', 'pc', 'x',
    ]);

    const tokens = (text) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w && !SIZE_WORDS.has(w) && !/^\d+$/.test(w));

    const itemTokens = allItems.map((row) => ({ row, words: new Set(tokens(row.name)) }));

    const findItem = (needle) => {
      const want = tokens(needle);
      if (!want.length) return null;

      let best = null;
      let bestScore = 0;

      for (const { row, words } of itemTokens) {
        let shared = 0;
        for (const w of want) if (words.has(w)) shared += 1;
        if (!shared) continue;

        // Reward covering the search words, and penalise a menu item that
        // carries a lot of extra words the deal never mentioned — otherwise
        // "Wings" matches "Flaming Wings" and "Oven Wings" equally.
        const coverage = shared / want.length;
        const precision = shared / words.size;
        const score = coverage * 2 + precision;

        if (score > bestScore) {
          bestScore = score;
          best = row;
        }
      }

      // Demand most of the words actually matched, so a stray hit on one
      // common word ("chicken") does not silently price the wrong dish.
      return bestScore >= 1.4 ? best : null;
    };

    const insertDeal = db.prepare(
      'INSERT INTO deals (name, price, is_active, sort_order, notes, image_file) VALUES (?, ?, 1, ?, ?, ?)',
    );
    const insertDealItem = db.prepare(
      'INSERT INTO deal_items (deal_id, menu_item_id, qty) VALUES (?, ?, ?)',
    );

    let dealCount = 0;
    const unmatched = [];
    let dealOrder = 0;

    for (const row of dealRows) {
      const name = (row.A || '').trim();
      const contents = (row.B || '').trim();
      const price = Number(row.C || 0);
      const image = (row.D || '').trim();
      if (!name || !contents || !(price > 0)) continue;

      const parts = contents.split('+').map((p) => p.trim()).filter(Boolean);
      const resolved = [];
      for (const part of parts) {
        const m = part.match(/^(\d+)\s*x\s*(.+)$/i);
        const qty = m ? Number(m[1]) : 1;
        const label = (m ? m[2] : part).trim();
        const found = findItem(label);
        if (found) resolved.push({ id: found.id, qty });
        else unmatched.push(`${name}: "${label}"`);
      }

      if (!resolved.length) continue;

      const dealId = Number(
        insertDeal.run(name, price, dealOrder, contents, image || null).lastInsertRowid,
      );
      dealOrder += 1;
      // Same item twice in one deal collapses into a single row with qty.
      const merged = new Map();
      for (const r of resolved) merged.set(r.id, (merged.get(r.id) || 0) + r.qty);
      for (const [id, qty] of merged) insertDealItem.run(dealId, id, qty);
      dealCount += 1;
    }

    return { itemCount, variantCount, dealCount, unmatched, categories: catIds.size };
  });

  const result = run();

  console.log('');
  console.log(`  Categories : ${result.categories}`);
  console.log(`  Items      : ${result.itemCount}`);
  console.log(`  Sizes      : ${result.variantCount}`);
  console.log(`  Deals      : ${result.dealCount}`);
  if (result.unmatched.length) {
    console.log('');
    console.log(`  ${result.unmatched.length} deal part(s) could not be matched to a menu item:`);
    for (const u of result.unmatched) console.log(`    - ${u}`);
    console.log('  Add these to the deal by hand in the Deals screen.');
  }
  console.log('');
  console.log('  Photos: drop the image files into');
  console.log(`    ${path.join(app.getPath('userData'), 'images')}`);
  console.log('  named exactly as the spreadsheet says, and they attach automatically.');
  console.log('');

  app.exit(0);
});
