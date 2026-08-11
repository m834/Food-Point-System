/**
 * Demo data for development and for showing the app to a customer.
 *
 *   npm run build:main          # this script uses the compiled main process
 *   npm run seed                # prints the Machine ID and seeds a demo menu
 *   npm run seed -- --license CH1....   # also activates, for a dev machine
 *
 * It runs under Electron because the database path comes from
 * app.getPath('userData'), which only exists inside Electron.
 *
 * Safe to re-run: it never deletes orders, and it skips a menu that already
 * has items.
 */

const { app } = require('electron');
const path = require('node:path');

// Must match electron/main.ts, or this would seed a different database.
app.setName('CodeHustlersFood');

const dist = path.join(__dirname, '..', 'dist-electron', 'electron');

app.whenReady().then(() => {
  const { getDb, closeDb, dbPath } = require(path.join(dist, 'db', 'connection'));
  const { migrate } = require(path.join(dist, 'db', 'migrate'));
  const { getMachineId } = require(path.join(dist, 'services', 'machineId'));

  getDb();
  migrate();

  console.log('');
  console.log(`  Database:   ${dbPath()}`);
  console.log(`  Machine ID: ${getMachineId()}`);

  const licenseIndex = process.argv.indexOf('--license');
  if (licenseIndex !== -1 && process.argv[licenseIndex + 1]) {
    const { activate } = require(path.join(dist, 'services', 'license'));
    try {
      const status = activate(process.argv[licenseIndex + 1]);
      console.log(`  License:    ${status.message}`);
    } catch (error) {
      console.error(`  License:    ${error.message}`);
    }
  }

  seed(getDb());
  closeDb();

  console.log('');
  app.quit();
});

function seed(db) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (existing > 0) {
    console.log(`  Menu:       already has ${existing} items — left alone.`);
    return;
  }

  const categories = ['Fast food', 'BBQ', 'Rice', 'Drinks'];
  const insertCategory = db.prepare(
    'INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)',
  );
  const categoryIds = {};
  categories.forEach((name, index) => {
    categoryIds[name] = Number(insertCategory.run(name, index).lastInsertRowid);
  });

  // sale price, then an honest-ish estimated food cost.
  const items = [
    ['Zinger burger', 'Fast food', 520, 210],
    ['Chicken shawarma', 'Fast food', 320, 130],
    ['Loaded fries', 'Fast food', 380, 140],
    ['Club sandwich', 'Fast food', 450, 190],
    ['Seekh kebab (4 pcs)', 'BBQ', 700, 340],
    ['Chicken tikka', 'BBQ', 550, 280],
    ['Malai boti', 'BBQ', 780, 390],
    ['Chicken biryani', 'Rice', 480, 180],
    ['Mutton pulao', 'Rice', 620, 300],
    ['Fried rice', 'Rice', 400, 150],
    ['Soft drink 345ml', 'Drinks', 120, 70],
    ['Fresh lime', 'Drinks', 180, 60],
    ['Mineral water', 'Drinks', 90, 55],
    ['Tea', 'Drinks', 100, 30],
  ];

  const insertItem = db.prepare(
    `INSERT INTO menu_items (name, category_id, sale_price, cost_price, is_available, sort_order)
     VALUES (?, ?, ?, ?, 1, ?)`,
  );
  items.forEach(([name, category, price, cost], index) => {
    insertItem.run(name, categoryIds[category], price, cost, index);
  });

  // Two modifier groups, attached to the items where they make sense.
  const insertGroup = db.prepare(
    'INSERT INTO modifier_groups (name, selection_type) VALUES (?, ?)',
  );
  const insertModifier = db.prepare(
    'INSERT INTO modifiers (group_id, name, price_delta) VALUES (?, ?, ?)',
  );

  const sizeId = Number(insertGroup.run('Size', 'single').lastInsertRowid);
  insertModifier.run(sizeId, 'Regular', 0);
  insertModifier.run(sizeId, 'Large', 120);

  const addOnsId = Number(insertGroup.run('Add-ons', 'multi').lastInsertRowid);
  insertModifier.run(addOnsId, 'Extra cheese', 90);
  insertModifier.run(addOnsId, 'Extra sauce', 40);
  insertModifier.run(addOnsId, 'No onions', 0);

  const link = db.prepare(
    'INSERT OR IGNORE INTO item_modifier_groups (item_id, group_id) VALUES (?, ?)',
  );
  const burgers = db
    .prepare("SELECT id FROM menu_items WHERE name IN ('Zinger burger', 'Loaded fries', 'Club sandwich')")
    .all();
  for (const row of burgers) {
    link.run(row.id, sizeId);
    link.run(row.id, addOnsId);
  }

  const insertTable = db.prepare('INSERT INTO tables (name, area, seats) VALUES (?, ?, ?)');
  const tables = [
    ['T1', 'Indoor', 4],
    ['T2', 'Indoor', 4],
    ['T3', 'Indoor', 2],
    ['T4', 'Indoor', 6],
    ['R1', 'Rooftop', 4],
    ['R2', 'Rooftop', 4],
  ];
  for (const [name, area, seats] of tables) insertTable.run(name, area, seats);

  db.prepare("UPDATE settings SET value = ? WHERE key = 'business_name'").run('Al-Madina Food Point');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'business_address'").run(
    'Main Boulevard, Gulberg III, Lahore',
  );
  db.prepare("UPDATE settings SET value = ? WHERE key = 'business_phone'").run('0300-1234567');

  console.log(`  Menu:       ${items.length} items, ${categories.length} categories`);
  console.log(`  Tables:     ${tables.length}`);
  console.log('  Modifiers:  Size, Add-ons');
}
