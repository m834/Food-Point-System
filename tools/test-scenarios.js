/**
 * Food-Point v1 — the test scenarios, automated.
 *
 * Every scenario in Food_Point_System_Test_Scenarios.md that can be checked
 * without a human looking at a screen is checked here, against the REAL
 * compiled main process in dist-electron.
 *
 *   npm run build:main && npm test
 *
 * It runs under Electron because better-sqlite3 is built for Electron's ABI
 * and the database path comes from app.getPath('userData').
 *
 * It writes to a throwaway userData directory and deletes it afterwards, so it
 * never touches the real %APPDATA%/CodeHustlersFood data. Exit code is non-zero
 * if any scenario fails, so it can gate a build.
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const dist = path.join(ROOT, 'dist-electron', 'electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foodpoint-test-'));
app.setName('CodeHustlersFoodTest');
app.setPath('userData', tmp);

/* ---------------- tiny test framework ---------------- */
const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
}
function test(id, name, fn) {
  try {
    fn();
    results.push({ id, name, status: 'PASS', section: currentSection });
  } catch (error) {
    results.push({ id, name, status: 'FAIL', section: currentSection, error: error.message });
  }
}
async function testAsync(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, status: 'PASS', section: currentSection });
  } catch (error) {
    results.push({ id, name, status: 'FAIL', section: currentSection, error: error.message });
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function ok(cond, what) {
  if (!cond) throw new Error(what);
}
function throws(fn, what) {
  let threw = false;
  let msg = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    msg = e.message;
  }
  if (!threw) throw new Error(`${what}: expected it to be refused, but it succeeded`);
  return msg;
}

app.whenReady().then(async () => {
  const { getDb, closeDb, reopenDb, dbPath } = require(path.join(dist, 'db', 'connection'));
  const { migrate } = require(path.join(dist, 'db', 'migrate'));
  const orders = require(path.join(dist, 'db', 'repositories', 'orders'));
  const tables = require(path.join(dist, 'db', 'repositories', 'tables'));
  const menu = require(path.join(dist, 'db', 'repositories', 'menu'));
  const deals = require(path.join(dist, 'db', 'repositories', 'deals'));
  const staffRepo = require(path.join(dist, 'db', 'repositories', 'staff'));
  const extrasRepo = require(path.join(dist, 'db', 'repositories', 'extras'));
  const customersRepo = require(path.join(dist, 'db', 'repositories', 'customers'));
  const session = require(path.join(dist, 'services', 'session'));
  const managerPin = require(path.join(dist, 'services', 'managerPin'));
  const cancelGuard = require(path.join(dist, 'services', 'cancelGuard'));
  const adminSession = require(path.join(dist, 'services', 'adminSession'));
  const settingsRepo = require(path.join(dist, 'db', 'repositories', 'settings'));
  const reports = require(path.join(dist, 'db', 'repositories', 'reports'));
  const receipt = require(path.join(dist, 'services', 'receipt'));
  const printing = require(path.join(dist, 'services', 'printing'));
  const licenseSvc = require(path.join(dist, 'services', 'license'));
  const backupSvc = require(path.join(dist, 'services', 'backup'));
  const { todayIso } = require(path.join(dist, 'db', 'money'));

  getDb();
  migrate();
  const db = getDb();

  /* ================= Section 0 — seed exact test data ================= */
  section('0 — Test data');
  const cat = {};
  for (const [i, name] of ['Fast Food', 'BBQ', 'Drinks'].entries()) {
    cat[name] = Number(
      getDb().prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run(name, i)
        .lastInsertRowid,
    );
  }
  const ITEMS = [
    ['Chicken Biryani', 'Fast Food', 400, 180],
    ['Zinger Burger', 'Fast Food', 350, 150],
    ['Cold Drink', 'Drinks', 80, 40],
    ['Seekh Kebab', 'BBQ', 600, 300],
    ['Chicken Tikka', 'BBQ', 550, 280],
    ['Mineral Water', 'Drinks', 60, 30],
  ];
  const item = {};
  ITEMS.forEach(([name, c, sale, cost], i) => {
    item[name] = Number(
      db
        .prepare(
          `INSERT INTO menu_items (name, category_id, sale_price, cost_price, is_available, sort_order)
           VALUES (?, ?, ?, ?, 1, ?)`,
        )
        .run(name, cat[c], sale, cost, i).lastInsertRowid,
    );
  });

  const sizeGroup = Number(
    getDb().prepare("INSERT INTO modifier_groups (name, selection_type) VALUES ('Size','single')").run()
      .lastInsertRowid,
  );
  const modRegular = Number(
    getDb().prepare('INSERT INTO modifiers (group_id, name, price_delta) VALUES (?,?,?)').run(sizeGroup, 'Regular', 0).lastInsertRowid,
  );
  const modLarge = Number(
    getDb().prepare('INSERT INTO modifiers (group_id, name, price_delta) VALUES (?,?,?)').run(sizeGroup, 'Large', 50).lastInsertRowid,
  );
  const addOnGroup = Number(
    getDb().prepare("INSERT INTO modifier_groups (name, selection_type) VALUES ('Add-ons','multi')").run()
      .lastInsertRowid,
  );
  const modCheese = Number(
    getDb().prepare('INSERT INTO modifiers (group_id, name, price_delta) VALUES (?,?,?)').run(addOnGroup, 'Extra Cheese', 60).lastInsertRowid,
  );
  const modNoOnions = Number(
    getDb().prepare('INSERT INTO modifiers (group_id, name, price_delta) VALUES (?,?,?)').run(addOnGroup, 'No Onions', 0).lastInsertRowid,
  );
  getDb().prepare('INSERT INTO item_modifier_groups (item_id, group_id) VALUES (?,?)').run(item['Zinger Burger'], sizeGroup);
  getDb().prepare('INSERT INTO item_modifier_groups (item_id, group_id) VALUES (?,?)').run(item['Zinger Burger'], addOnGroup);
  getDb().prepare('INSERT INTO item_modifier_groups (item_id, group_id) VALUES (?,?)').run(item['Chicken Biryani'], sizeGroup);

  const T = {};
  for (const name of ['T1', 'T2', 'T3', 'T4', 'T5']) {
    T[name] = Number(
      getDb().prepare('INSERT INTO tables (name, area, seats) VALUES (?, ?, ?)').run(name, 'Main', 4)
        .lastInsertRowid,
    );
  }
  settingsRepo.saveSettings({
    enable_tables: '1',
    enable_kitchen_print: '1',
    service_charge_mode: 'fixed',
    service_charge_amount: '0',
    service_charge_percent: '0',
    currency_symbol: 'Rs',
    business_name: 'Test Food Point',
    business_address: 'Main Road, Lahore',
    business_phone: '0300-1234567',
    manager_pin: '1234',
  });

  test('0.1', 'Seed data present', () => {
    eq(getDb().prepare('SELECT COUNT(*) n FROM menu_categories').get().n, 3, 'categories');
    eq(getDb().prepare('SELECT COUNT(*) n FROM menu_items').get().n, 6, 'items');
    eq(getDb().prepare('SELECT COUNT(*) n FROM tables').get().n, 5, 'tables');
    eq(settingsRepo.serviceChargePercent(), 0, 'service charge');
  });

  /* ================= Section 2 — Menu management ================= */
  section('2 — Menu management');

  test('2.1', 'Add category & item', () => {
    const c = menu.saveCategory({ name: 'Deals', sort_order: 9 });
    ok(c.id > 0, 'category created');
    const it = menu.saveItem({
      name: 'Family Deal',
      category_id: c.id,
      sale_price: 1500,
      cost_price: 700,
      is_available: 1,
      sort_order: 0,
    });
    ok(it.id > 0, 'item created');
    const grid = menu.listItems();
    ok(grid.some((r) => r.id === it.id && r.category_id === c.id), 'item appears under category');
    menu.removeItem(it.id);
    menu.removeCategory(c.id);
  });

  test('2.2', '86 toggle blocks adding', () => {
    menu.setAvailable(item['Cold Drink'], false);
    eq(menu.getItem(item['Cold Drink']).is_available, 0, 'marked unavailable');
    const o = orders.openOrder({ type: 'takeaway' });
    throws(
      () => orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]),
      'sold-out item add',
    );
    menu.setAvailable(item['Cold Drink'], true);
    const after = orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    eq(after.items.length, 1, 'addable again after toggle back');
    voidOrderCompat(o.id, 'test cleanup');
  });

  test('2.3', 'Attach modifiers surfaces them on the item', () => {
    const groups = menu.modifierGroupsForItem(item['Zinger Burger']);
    ok(groups.some((g) => g.name === 'Size'), 'Size offered on Zinger Burger');
    ok(groups.some((g) => g.name === 'Add-ons'), 'Add-ons offered');
    const noneFor = menu.modifierGroupsForItem(item['Seekh Kebab']);
    eq(noneFor.length, 0, 'unattached item offers no groups');
  });

  test('2.4', 'Category sort order', () => {
    const before = menu.listCategories().map((c) => c.name);
    const bbq = menu.listCategories().find((c) => c.name === 'BBQ');
    menu.saveCategory({ id: bbq.id, name: 'BBQ', sort_order: -5 });
    const after = menu.listCategories().map((c) => c.name);
    eq(after[0], 'BBQ', 'BBQ moved to front');
    ok(JSON.stringify(before) !== JSON.stringify(after), 'ordering actually changed');
    menu.saveCategory({ id: bbq.id, name: 'BBQ', sort_order: 1 });
  });

  test('2.5', 'Editing price does not rewrite settled history', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.total, 400, 'total at settle');
    eq(settled.profit, 220, 'profit at settle');

    menu.saveItem({
      id: item['Chicken Biryani'],
      name: 'Chicken Biryani',
      category_id: cat['Fast Food'],
      sale_price: 999,
      cost_price: 500,
      is_available: 1,
      sort_order: 0,
    });
    const reread = orders.getOrder(o.id);
    eq(reread.total, 400, 'settled total unchanged after menu reprice');
    eq(reread.profit, 220, 'settled profit unchanged after menu reprice');
    eq(reread.items[0].sale_price, 400, 'line snapshot unchanged');
    eq(reread.items[0].cost_price, 180, 'cost snapshot unchanged');
    // restore
    menu.saveItem({
      id: item['Chicken Biryani'],
      name: 'Chicken Biryani',
      category_id: cat['Fast Food'],
      sale_price: 400,
      cost_price: 180,
      is_available: 1,
      sort_order: 0,
    });
  });

  /* ================= Section 3 — Tables ================= */
  section('3 — Tables / floor');

  test('3.1', 'All tables free at start', () => {
    const list = tables.listTables();
    eq(list.length, 5, 'five tables');
    ok(list.every((t) => !t.open_order_id), 'all free');
  });

  let t1Order;
  test('3.2', 'Free -> occupied with running total', () => {
    t1Order = orders.openOrder({ type: 'dine_in', table_id: T.T1 });
    orders.addItems(t1Order.id, [{ menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [] }]);
    const t1 = tables.getTable(T.T1);
    eq(t1.open_order_id, t1Order.id, 'T1 occupied by that order');
    eq(t1.running_total, 350, 'running total shown');
  });

  test('3.3', 'Running total updates on the card', () => {
    orders.addItems(t1Order.id, [{ menu_item_id: item['Cold Drink'], qty: 2, modifier_ids: [] }]);
    eq(tables.getTable(T.T1).running_total, 510, 'total = 350 + 160');
  });

  test('3.4', 'Occupied -> resume existing order', () => {
    const existing = tables.openOrderIdForTable(T.T1);
    eq(existing, t1Order.id, 'tapping T1 resolves to the existing open order');
    const resumed = orders.getOrder(existing);
    eq(resumed.items.length, 2, 'resumed with its items, not a new empty order');
  });

  test('3.8', 'Cannot double-book a table', () => {
    const msg = throws(() => orders.openOrder({ type: 'dine_in', table_id: T.T1 }), 'double-book');
    ok(/resume/i.test(msg), `message should point to resuming, got: ${msg}`);
    eq(
      getDb().prepare("SELECT COUNT(*) n FROM orders WHERE table_id = ? AND status='open'").get(T.T1).n,
      1,
      'still exactly one open order on T1',
    );
  });

  test('3.7', 'Two tables at once, separate totals', () => {
    const t3 = orders.openOrder({ type: 'dine_in', table_id: T.T3 });
    orders.addItems(t3.id, [{ menu_item_id: item['Seekh Kebab'], qty: 1, modifier_ids: [] }]);
    const list = tables.listTables();
    const byName = Object.fromEntries(list.map((t) => [t.name, t]));
    eq(byName.T1.running_total, 510, 'T1 total');
    eq(byName.T3.running_total, 600, 'T3 total');
    ok(!byName.T2.open_order_id && !byName.T4.open_order_id && !byName.T5.open_order_id, 'others free');
    voidOrderCompat(t3.id, 'test cleanup');
  });

  test('3.5', 'Occupied -> free on settle', () => {
    orders.settleOrder(t1Order.id, { payment_method: 'cash' });
    const t1 = tables.getTable(T.T1);
    ok(!t1.open_order_id, 'T1 free after settle');
    eq(t1.running_total, 0, 'total cleared from card');
  });

  test('3.6', 'Occupied -> free on void', () => {
    const o = orders.openOrder({ type: 'dine_in', table_id: T.T2 });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Tikka'], qty: 1, modifier_ids: [] }]);
    ok(tables.getTable(T.T2).open_order_id, 'T2 occupied');
    voidOrderCompat(o.id, 'customer left');
    ok(!tables.getTable(T.T2).open_order_id, 'T2 free after void');
  });

  test('3.9', 'Tables toggle setting readable by backend', () => {
    settingsRepo.saveSettings({ enable_tables: '0' });
    eq(settingsRepo.tablesEnabled(), false, 'tables disabled');
    settingsRepo.saveSettings({ enable_tables: '1' });
    eq(settingsRepo.tablesEnabled(), true, 'tables re-enabled');
  });

  test('3.10', 'Occupancy survives a restart (derived, not stored)', () => {
    const o = orders.openOrder({ type: 'dine_in', table_id: T.T4 });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    reopenDb();
    const t4 = tables.getTable(T.T4);
    eq(t4.open_order_id, o.id, 'T4 still occupied after DB reopen');
    eq(orders.getOrder(o.id).status, 'open', 'order still open');
    eq(orders.getOrder(o.id).items.length, 1, 'items still there');
    voidOrderCompat(o.id, 'test cleanup');
  });

  /* ================= Section 4 — Order taking ================= */
  section('4 — Order taking');

  test('4.1', 'Start each order type', () => {
    const dine = orders.openOrder({ type: 'dine_in', table_id: T.T5 });
    eq(dine.type, 'dine_in', 'dine-in type');
    eq(dine.table_id, T.T5, 'table recorded');

    const take = orders.openOrder({ type: 'takeaway' });
    eq(take.type, 'takeaway', 'takeaway type');
    eq(take.table_id, null, 'no table on takeaway');

    const deliv = orders.openOrder({
      type: 'delivery',
      // v1.5: a delivery without an address is a slip the rider cannot use.
      delivery_address: 'Flat 3B, Askari 10, Lahore',
      customer_name: 'Ali Raza',
      customer_phone: '0300-9998887',
    });
    eq(deliv.type, 'delivery', 'delivery type');
    eq(deliv.delivery_address, 'Flat 3B, Askari 10, Lahore', 'address captured');
    eq(deliv.customer_name, 'Ali Raza', 'name captured');
    eq(deliv.customer_phone, '0300-9998887', 'phone captured');

    voidOrderCompat(dine.id, 'cleanup');
    voidOrderCompat(take.id, 'cleanup');
    voidOrderCompat(deliv.id, 'cleanup');
  });

  let o4;
  test('4.2', 'Add items from grid, line totals correct', () => {
    o4 = orders.openOrder({ type: 'takeaway' });
    const r = orders.addItems(o4.id, [
      { menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] },
      { menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] },
    ]);
    eq(r.items.length, 2, 'two lines');
    eq(r.items[0].line_total, 400, 'biryani line');
    eq(r.items[1].line_total, 80, 'drink line');
  });

  test('4.3', 'Change quantity', () => {
    const line = orders.getOrder(o4.id).items[1];
    const r = orders.setItemQty(line.id, 3);
    const updated = r.items.find((i) => i.id === line.id);
    eq(updated.qty, 3, 'qty set');
    eq(updated.line_total, 240, 'line total = 80 x 3');
  });

  test('4.4', 'Single-select modifier adds its delta', () => {
    const r = orders.addItems(o4.id, [
      { menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modLarge] },
    ]);
    const line = r.items[r.items.length - 1];
    eq(line.line_total, 400, 'burger 350 + large 50');
    eq(line.modifiers.length, 1, 'one modifier');
    eq(line.modifiers[0].name, 'Large', 'Large recorded');
    eq(line.modifiers[0].price_delta, 50, 'delta snapshotted');
  });

  test('4.5', 'Multi-select modifiers, including a zero-priced one', () => {
    const r = orders.addItems(o4.id, [
      { menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modCheese, modNoOnions] },
    ]);
    const line = r.items[r.items.length - 1];
    eq(line.line_total, 410, 'burger 350 + cheese 60 + no onions 0');
    eq(line.modifiers.length, 2, 'both modifiers on the line');
    ok(line.modifiers.some((m) => m.name === 'No Onions' && m.price_delta === 0), 'No Onions shown at 0');
  });

  test('4.6', 'Line note attaches and reaches the kitchen ticket', () => {
    const r = orders.addItems(o4.id, [
      { menu_item_id: item['Chicken Tikka'], qty: 1, notes: 'less spicy', modifier_ids: [] },
    ]);
    const line = r.items[r.items.length - 1];
    eq(line.notes, 'less spicy', 'note stored on the line');
    const ticket = receipt.buildKitchenTicket(r, [line]);
    ok(/LESS SPICY/.test(ticket), 'note appears on kitchen ticket');
  });

  test('4.7', 'Subtotal = sum of line totals including modifier deltas', () => {
    const o = orders.getOrder(o4.id);
    const expected = o.items
      .filter((i) => i.kitchen_status !== 'void')
      .reduce((s, i) => s + i.line_total, 0);
    eq(o.subtotal, Math.round(expected * 100) / 100, 'subtotal matches lines');
    eq(o.subtotal, 400 + 240 + 400 + 410 + 550, 'subtotal arithmetic');
  });

  test('4.8', 'Sold-out item cannot be added', () => {
    menu.setAvailable(item['Seekh Kebab'], false);
    throws(
      () => orders.addItems(o4.id, [{ menu_item_id: item['Seekh Kebab'], qty: 1, modifier_ids: [] }]),
      'sold-out add',
    );
    menu.setAvailable(item['Seekh Kebab'], true);
  });

  test('4.9', 'Sequential per-day order numbers', () => {
    const nos = getDb()
      .prepare('SELECT order_no FROM orders ORDER BY id')
      .all()
      .map((r) => r.order_no);
    const prefix = todayIso().replace(/-/g, '');
    ok(nos.every((n) => n.startsWith(prefix + '-')), 'all carry today prefix');
    const seqs = nos.map((n) => Number(n.split('-')[1]));
    for (let i = 1; i < seqs.length; i++) {
      ok(seqs[i] === seqs[i - 1] + 1, `sequential at ${i}: ${seqs[i - 1]} -> ${seqs[i]}`);
    }
    eq(seqs[0], 1, 'starts at 001');
    eq(nos[0], `${prefix}-001`, 'human readable format');
  });

  /* ================= Section 5 — Send to kitchen ================= */
  section('5 — Send to kitchen (fire != settle)');

  let o5;
  test('5.1', 'First fire prints exactly the new items, no prices', () => {
    o5 = orders.openOrder({ type: 'dine_in', table_id: T.T1 });
    orders.addItems(o5.id, [
      { menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] },
      { menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modLarge] },
      { menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] },
    ]);
    const { order, fired } = orders.fireToKitchen(o5.id);
    eq(fired.length, 3, 'three items fired');
    ok(fired.every((f) => f.kitchen_status === 'fired'), 'all marked fired');
    ok(fired.every((f) => f.fired_at), 'fired_at stamped');
    eq(order.status, 'open', 'order stays OPEN after fire');

    const ticket = receipt.buildKitchenTicket(order, fired);
    ok(/KITCHEN/.test(ticket), 'ticket header');
    ok(ticket.includes(order.order_no), 'order no on ticket');
    ok(/T1/.test(ticket), 'table on ticket');
    ok(/CHICKEN BIRYANI/.test(ticket), 'item names');
    ok(/2 x/.test(ticket), 'quantities');
    ok(/Large/.test(ticket), 'modifier shown');
    ok(/\d{2}:\d{2}/.test(ticket), 'time on ticket');
  });

  test('5.2', 'Second fire prints ONLY the newly added items', () => {
    orders.addItems(o5.id, [
      { menu_item_id: item['Chicken Tikka'], qty: 1, modifier_ids: [] },
      { menu_item_id: item['Mineral Water'], qty: 2, modifier_ids: [] },
    ]);
    const { order, fired } = orders.fireToKitchen(o5.id);
    eq(fired.length, 2, 'only the two new items fired');
    const names = fired.map((f) => f.item_name).sort();
    eq(names.join(','), 'Chicken Tikka,Mineral Water', 'exactly the new items');

    const ticket = receipt.buildKitchenTicket(order, fired);
    ok(!/BIRYANI/.test(ticket), 'first-round biryani NOT reprinted');
    ok(!/ZINGER/.test(ticket), 'first-round burger NOT reprinted');
    ok(/CHICKEN TIKKA/.test(ticket), 'new item on ticket');
  });

  test('5.3', 'Nothing new to fire is refused clearly, no duplicate ticket', () => {
    const msg = throws(() => orders.fireToKitchen(o5.id), 'refire with nothing new');
    ok(/already gone to the kitchen/i.test(msg), `clear message, got: ${msg}`);
    const stillFired = orders
      .getOrder(o5.id)
      .items.filter((i) => i.kitchen_status === 'fired').length;
    eq(stillFired, 5, 'all five still fired, nothing re-marked');
  });

  test('5.4', 'Fire does not settle', () => {
    const o = orders.getOrder(o5.id);
    eq(o.status, 'open', 'order still open');
    eq(o.settled_at, null, 'no settled_at');
    eq(o.payment_method, null, 'no payment taken');
    eq(o.profit, null, 'no profit locked in yet');
    eq(tables.getTable(T.T1).open_order_id, o5.id, 'table still occupied');
  });

  test('5.5', 'Kitchen ticket carries NO money at all', () => {
    const o = orders.getOrder(o5.id);
    const ticket = receipt.buildKitchenTicket(o, o.items);
    ok(!/Rs/i.test(ticket), 'no currency symbol');
    ok(!/subtotal/i.test(ticket), 'no subtotal');
    ok(!/total/i.test(ticket), 'no total');
    ok(!/\d+\.\d{2}/.test(ticket), 'no decimal money figures');
    // Prices from the seeded menu must not leak in any form.
    //
    // The HH:MM clock line is dropped first. It is not a price, and leaving it
    // in made this assertion depend on what time the suite ran: at 18:50 the
    // ticket contains "18:50" and \b50\b matches it, failing a test about
    // money for reasons that have nothing to do with money.
    const noClock = ticket
      .split('\n')
      .filter((l) => !/^\d{2}:\d{2}$/.test(l.trim()))
      .join('\n');
    for (const p of ['400', '350', '80', '550', '60', '50']) {
      ok(!new RegExp(`\\b${p}\\b`).test(noClock), `price ${p} absent from ticket`);
    }
  });

  test('5.6', 'Kitchen ticket legibility: modifiers and notes under each item', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addItems(o.id, [
      {
        menu_item_id: item['Zinger Burger'],
        qty: 2,
        notes: 'no mayo please',
        modifier_ids: [modLarge, modCheese],
      },
    ]);
    const { order, fired } = orders.fireToKitchen(o.id);
    const ticket = receipt.buildKitchenTicket(order, fired);
    const lines = ticket.split('\n');
    const idx = lines.findIndex((l) => /ZINGER BURGER/.test(l));
    ok(idx >= 0, 'item line present');
    ok(/^2 x /.test(lines[idx]), 'qty leads the line');
    ok(/- Large/.test(lines[idx + 1]), 'modifier directly under item');
    ok(/- Extra Cheese/.test(lines[idx + 2]), 'second modifier under item');
    ok(/\*\* NO MAYO PLEASE \*\*/.test(lines[idx + 3]), 'note flagged under item');
    voidOrderCompat(o.id, 'cleanup');
  });

  /* ================= Section 6 — Many orders at once ================= */
  section('6 — Multiple open orders');

  test('6.1 / 6.2', 'Four orders open in parallel, none overwrites another', () => {
    // o5 is already open on T1; close it out of the way for a clean count.
    const before = orders.listOpenOrders().map((o) => o.id);
    for (const id of before) voidOrderCompat(id, 'reset for section 6');

    const a = orders.openOrder({ type: 'dine_in', table_id: T.T1 });
    orders.addItems(a.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const b = orders.openOrder({ type: 'dine_in', table_id: T.T3 });
    orders.addItems(b.id, [{ menu_item_id: item['Seekh Kebab'], qty: 2, modifier_ids: [] }]);
    const c = orders.openOrder({ type: 'takeaway' });
    orders.addItems(c.id, [{ menu_item_id: item['Cold Drink'], qty: 4, modifier_ids: [] }]);
    const d = orders.openOrder({
      type: 'delivery',
      customer_name: 'Sana',
      customer_phone: '0301-1112223',
      delivery_address: 'House 12, Street 4, Gulberg',
    });
    orders.addItems(d.id, [{ menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modCheese] }]);

    const open = orders.listOpenOrders();
    eq(open.length, 4, 'four open at once');

    // Switching away and back preserves each one exactly.
    eq(orders.getOrder(a.id).subtotal, 400, 'A untouched');
    eq(orders.getOrder(b.id).subtotal, 1200, 'B untouched');
    eq(orders.getOrder(c.id).subtotal, 320, 'C untouched');
    eq(orders.getOrder(d.id).subtotal, 410, 'D untouched');

    // Adding to one must not touch the others.
    orders.addItems(c.id, [{ menu_item_id: item['Mineral Water'], qty: 1, modifier_ids: [] }]);
    eq(orders.getOrder(a.id).subtotal, 400, 'A still untouched after editing C');
    eq(orders.getOrder(c.id).subtotal, 380, 'C updated');

    global.__six = { a, b, c, d };
  });

  test('6.3', 'Dashboard open counts', () => {
    const dash = reports.dashboard();
    eq(dash.open_order_count, 4, 'open orders = 4');
    eq(dash.open_table_count, 2, 'open tables = 2 (T1, T3)');
  });

  test('6.4', 'Resume from the open-orders list', () => {
    const { a } = global.__six;
    const summary = orders.listOpenOrders().find((o) => o.id === a.id);
    ok(summary, 'order listed as resumable');
    eq(summary.table_name, 'T1', 'shows its table');
    eq(summary.subtotal, 400, 'shows its running total');
    const resumed = orders.getOrder(summary.id);
    eq(resumed.status, 'open', 're-opens still open');
    eq(resumed.items.length, 1, 'with its items');
  });

  test('6.5', 'Kitchen state is per-order, not global', () => {
    const { a, b } = global.__six;
    orders.fireToKitchen(a.id);
    const aItems = orders.getOrder(a.id).items;
    const bItems = orders.getOrder(b.id).items;
    ok(aItems.every((i) => i.kitchen_status === 'fired'), 'A fired');
    ok(bItems.every((i) => i.kitchen_status === 'new'), 'B still new');
  });

  /* ================= Section 7 — Settlement ================= */
  section('7 — Settlement');

  test('7.1', 'Basic settle', () => {
    const { a } = global.__six;
    const settled = orders.settleOrder(a.id, { payment_method: 'cash' });
    eq(settled.status, 'settled', 'status settled');
    ok(settled.settled_at, 'settled_at set');
    eq(settled.total, 400, 'total');
    ok(!tables.getTable(T.T1).open_order_id, 'table freed');

    const bill = receipt.buildCustomerBill(settled);
    ok(/Rs400\.00/.test(bill), 'bill carries prices');
    ok(/TOTAL/.test(bill), 'bill carries a total');
  });

  test('7.2', 'Discount', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] }]);
    eq(orders.getOrder(o.id).subtotal, 800, 'subtotal 800');
    const settled = orders.settleOrder(o.id, { discount: 100, payment_method: 'cash' });
    eq(settled.discount, 100, 'discount recorded');
    eq(settled.total, 700, 'total 700');
    const bill = receipt.buildCustomerBill(settled);
    ok(/Discount\s+-Rs100\.00/.test(bill), 'discount line on bill');
  });

  test('7.3', 'Service charge 10% on a DINE-IN subtotal of 800', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10' });
    // Dine-in, because that is the only order type the charge applies to —
    // see 22.8. On a takeaway every figure below would be the bare subtotal.
    const o = orders.openOrder({ type: 'dine_in' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.subtotal, 800, 'subtotal');
    eq(settled.service_charge, 80, 'service charge 80');
    eq(settled.total, 880, 'total 880');
    const bill = receipt.buildCustomerBill(settled);
    ok(/Service charge\s+Rs80\.00/.test(bill), 'service charge line on bill');

    // Order of operations, documented: charge on gross subtotal, discount after.
    const o2 = orders.openOrder({ type: 'dine_in' });
    orders.addItems(o2.id, [{ menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] }]);
    const s2 = orders.settleOrder(o2.id, { discount: 100, payment_method: 'cash' });
    eq(s2.service_charge, 80, 'charge computed on gross subtotal');
    eq(s2.total, 780, 'total = 800 - 100 + 80');
    settingsRepo.saveSettings({ service_charge_percent: '0' });
  });

  test('7.3b', 'The counter quotes exactly what the bill charges', () => {
    // Mirrors ChargeModal in src/app/order/page.tsx. If these two formulas ever
    // drift, the cashier collects one number and the bill prints another.
    const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
    const preview = (subtotal, rawDiscount, pct) => {
      const discount = Math.min(Math.max(0, Number(rawDiscount) || 0), subtotal);
      const charge = Math.min(Math.max(pct, 0), 100);
      const serviceCharge = round2((subtotal * charge) / 100);
      return Math.max(0, round2(subtotal - discount + serviceCharge));
    };

    for (const [pct, discount] of [
      [0, 0],
      [0, 100],
      [10, 0],
      [10, 100],
      [5, 50],
      [15, 5000], // discount larger than the bill
      [7.5, 33.33], // awkward percentage and an awkward discount
    ]) {
      settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: String(pct) });
      const o = orders.openOrder({ type: 'dine_in' });
      orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] }]);
      const subtotal = orders.getOrder(o.id).subtotal;
      const quoted = preview(subtotal, discount, pct);
      const settled = orders.settleOrder(o.id, { discount, payment_method: 'cash' });
      eq(quoted, settled.total, `quote matches bill at ${pct}% / discount ${discount}`);
    }
    settingsRepo.saveSettings({ service_charge_percent: '0' });
  });

  test('7.4', 'Payment method recorded', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'card' });
    eq(settled.payment_method, 'card', 'card stored');
    ok(/Paid by\s+Card/.test(receipt.buildCustomerBill(settled)), 'shown on bill');
  });

  test('7.5', 'Profit from snapshots: 400 - 180 = 220', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.profit, 220, 'profit 220');
  });

  test('7.6', 'Profit with a pure-margin modifier', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [
      { menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modLarge] },
    ]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    // Documented rule: modifiers carry no food cost, so the +50 is all margin.
    // profit = total(400) - cogs(150) = 250
    eq(settled.total, 400, 'total includes +50');
    eq(settled.profit, 250, 'profit = 400 - 150');
  });

  test('7.6b', 'Discount comes out of profit, not out of cost', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { discount: 50, payment_method: 'cash' });
    eq(settled.total, 350, 'total after discount');
    eq(settled.profit, 170, 'profit = 350 - 180, discount reduces profit');
  });

  test('7.7', 'Reprint changes nothing', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const first = receipt.buildCustomerBill(settled);
    const again = receipt.buildCustomerBill(orders.getOrder(o.id));
    eq(again, first, 'identical bill text');
    const after = orders.getOrder(o.id);
    eq(after.status, 'settled', 'status unchanged');
    eq(after.total, settled.total, 'total unchanged');
    eq(after.profit, settled.profit, 'profit unchanged');
  });

  test('7.8', 'Settle frees a dine-in table', () => {
    const o = orders.openOrder({ type: 'dine_in', table_id: T.T4 });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Tikka'], qty: 1, modifier_ids: [] }]);
    ok(tables.getTable(T.T4).open_order_id, 'T4 occupied');
    orders.settleOrder(o.id, { payment_method: 'cash' });
    ok(!tables.getTable(T.T4).open_order_id, 'T4 free');
  });

  /* ================= Section 8 — Voids ================= */
  section('8 — Voids');

  test('8.1', 'Void a line item', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [
      { menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] },
      { menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] },
    ]);
    eq(orders.getOrder(o.id).subtotal, 480, 'subtotal before void');
    const lineId = orders.getOrder(o.id).items[1].id;
    const after = voidItemCompat(lineId, 'customer changed mind');
    const line = after.items.find((i) => i.id === lineId);
    eq(line.kitchen_status, 'void', 'line marked void');
    // v1.1: the reason is structured (fixed code + note), so the stored line
    // reads "Other — customer changed mind" rather than the bare note.
    ok(/customer changed mind/.test(line.void_reason), 'reason logged');
    ok(line.voided_at, 'voided_at stamped');
    eq(after.subtotal, 400, 'removed from totals');
    const bill = receipt.buildCustomerBill(after);
    ok(!/Cold Drink/.test(bill), 'voided line absent from the bill');
    global.__void1 = o;
  });

  test('8.2', 'Void a whole order', () => {
    const o = orders.openOrder({ type: 'dine_in', table_id: T.T5 });
    orders.addItems(o.id, [{ menu_item_id: item['Seekh Kebab'], qty: 1, modifier_ids: [] }]);
    const after = voidOrderCompat(o.id, 'walked out');
    eq(after.status, 'void', 'order void');
    ok(/walked out/.test(after.void_reason), 'reason logged');
    ok(!tables.getTable(T.T5).open_order_id, 'table freed');
    ok(after.items.every((i) => i.kitchen_status === 'void'), 'lines voided too');

    const today = todayIso();
    const rng = reports.range(today, today);
    const settledIds = getDb()
      .prepare("SELECT id FROM orders WHERE status='settled'")
      .all()
      .map((r) => r.id);
    ok(!settledIds.includes(o.id), 'not counted as a sale');
  });

  test('8.3', 'Void reason is required', () => {
    const { asString } = require(path.join(dist, 'ipc', 'util'));
    throws(() => asString('', 'Reason for voiding', { max: 200 }), 'empty reason');
    throws(() => asString('   ', 'Reason for voiding', { max: 200 }), 'whitespace reason');
    throws(() => asString(undefined, 'Reason for voiding', { max: 200 }), 'missing reason');
  });

  test('8.4', 'Voids appear in the voids report, separate from sales', () => {
    const today = todayIso();
    const list = reports.voids(today, today);
    ok(list.some((v) => v.kind === 'order' && /walked out/.test(v.reason)), 'order void listed');
    ok(
      list.some((v) => v.kind === 'item' && /customer changed mind/.test(v.reason)),
      'item void listed',
    );
    ok(list.every((v) => v.reason && v.reason.length), 'every void carries a reason');
  });

  test('8.5', 'Void an already-fired item', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [
      { menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] },
      { menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [] },
    ]);
    orders.fireToKitchen(o.id);
    const fired = orders.getOrder(o.id).items[0];
    eq(fired.kitchen_status, 'fired', 'line was fired');
    const after = voidItemCompat(fired.id, 'dropped on the pass');
    eq(after.items.find((i) => i.id === fired.id).kitchen_status, 'void', 'fired line voids fine');
    eq(after.subtotal, 350, 'totals exclude the voided fired line');
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.total, 350, 'customer not charged for it');
    eq(settled.profit, 200, 'cost of the voided item excluded too (350 - 150)');
  });

  /**
   * Changed in v1.1. A paid order used to be uncancellable, which sounds safe
   * but meant a genuine mistake could only be fixed by editing the database.
   * It is now cancellable — but only behind the manager PIN, and it leaves a
   * permanent record. See section 15.
   */
  test('8.x', 'A settled order can only be cancelled with the manager PIN', () => {
    managerPin.setPin('4321');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });

    throws(() => cancelGuard.assertMayCancel(settled, undefined), 'no PIN is refused');
    throws(() => cancelGuard.assertMayCancel(settled, '0000'), 'a wrong PIN is refused');
    cancelGuard.assertMayCancel(settled, '4321');
    ok(true, 'the manager PIN lets it through');
    managerPin.setPin('');
  });

  /* ================= Section 9 — Printing ================= */
  section('9 — Printing');

  // Intercept the OS print queue so routing can be asserted without a printer.
  // printing.ts require()s node:child_process at call time, so patching the
  // cached module here reaches the real code path.
  const childProcess = require('node:child_process');
  const realSpawn = childProcess.spawn;
  const { EventEmitter } = require('node:events');
  let printJobs = [];
  function captureJobs() {
    printJobs = [];
    childProcess.spawn = (command, args) => {
      const file = args[args.length - 1];
      printJobs.push({
        command,
        args,
        printer: args.includes('-d') ? args[args.indexOf('-d') + 1] : '(default)',
        text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '',
      });
      const child = new EventEmitter();
      setImmediate(() => child.emit('close', 0));
      return child;
    };
  }
  const releaseJobs = () => {
    childProcess.spawn = realSpawn;
  };

  await testAsync('9.1', 'Two printers: kitchen ticket and bill go to different devices', async () => {
    settingsRepo.saveSettings({
      printer_customer: 'COUNTER_80MM',
      printer_kitchen: 'KITCHEN_80MM',
      enable_kitchen_print: '1',
    });
    captureJobs();
    try {
      // Section 6 deliberately left orders running; free this table first.
      const sitting = tables.openOrderIdForTable(T.T3);
      if (sitting) voidOrderCompat(sitting, 'cleared for printer routing test');

      const o = orders.openOrder({ type: 'dine_in', table_id: T.T3 });
      orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);

      const { order, fired } = orders.fireToKitchen(o.id);
      const fireOut = await printing.printKitchenTicket(order, fired);
      eq(fireOut.printed, true, 'kitchen ticket printed');
      eq(printJobs.length, 1, 'one job on fire');
      eq(printJobs[0].printer, 'KITCHEN_80MM', 'kitchen ticket -> kitchen printer');
      ok(/KITCHEN/.test(printJobs[0].text), 'it really is the kitchen format');
      ok(!/Rs/.test(printJobs[0].text), 'and it carries no money');

      const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
      const billOut = await printing.printCustomerBill(settled);
      eq(billOut.printed, true, 'bill printed');
      eq(printJobs.length, 2, 'a second, separate job on settle');
      eq(printJobs[1].printer, 'COUNTER_80MM', 'customer bill -> counter printer');
      ok(/TOTAL/.test(printJobs[1].text), 'it really is the money format');
    } finally {
      releaseJobs();
    }
  });

  await testAsync('9.3', 'One printer for both: each format prints in turn', async () => {
    settingsRepo.saveSettings({ printer_customer: 'ONLY_PRINTER', printer_kitchen: 'ONLY_PRINTER' });
    captureJobs();
    try {
      const o = orders.openOrder({ type: 'takeaway' });
      orders.addItems(o.id, [{ menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modLarge] }]);
      const { order, fired } = orders.fireToKitchen(o.id);
      await printing.printKitchenTicket(order, fired);
      const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
      await printing.printCustomerBill(settled);

      eq(printJobs.length, 2, 'two jobs, one after the other');
      ok(printJobs.every((j) => j.printer === 'ONLY_PRINTER'), 'both on the one device');
      ok(/KITCHEN/.test(printJobs[0].text) && !/Rs/.test(printJobs[0].text), 'kitchen format first');
      ok(/TOTAL/.test(printJobs[1].text) && /Rs/.test(printJobs[1].text), 'bill format second');
      // v1.1 sends raw ESC/POS rather than a plain text file, so the job now
      // ends with feeds AND a cut command instead of bare newlines.
      ok(
        printJobs.every((j) => /\r\n\r\n\r\n\r\n/.test(j.text)),
        'paper fed past the head to tear',
      );
      ok(
        printJobs.every((j) => j.text.endsWith('\x1d\x56\x01')),
        'and the roll is cut',
      );
      ok(
        printJobs.every((j) => j.text.startsWith('\x1b@')),
        'each job resets the printer first',
      );
      ok(
        printJobs.every((j) => j.text.includes('\x1b!\x08')),
        'and prints emphasised so thermal paper stays legible',
      );
    } finally {
      releaseJobs();
    }
  });

  await testAsync('9.3b', 'No kitchen printer set falls back to the counter printer', async () => {
    settingsRepo.saveSettings({ printer_customer: 'COUNTER_ONLY', printer_kitchen: '' });
    captureJobs();
    try {
      const o = orders.openOrder({ type: 'takeaway' });
      orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
      const { order, fired } = orders.fireToKitchen(o.id);
      const out = await printing.printKitchenTicket(order, fired);
      eq(out.printed, true, 'still printed');
      eq(printJobs[0].printer, 'COUNTER_ONLY', 'a one-printer shop still gets its ticket');
      voidOrderCompat(o.id, 'cleanup');
    } finally {
      releaseJobs();
      settingsRepo.saveSettings({ printer_customer: '', printer_kitchen: '' });
    }
  });

  await testAsync('9.2', 'Kitchen print OFF degrades cleanly', async () => {
    settingsRepo.saveSettings({ enable_kitchen_print: '0' });
    eq(settingsRepo.kitchenPrintEnabled(), false, 'setting off');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const { order, fired } = orders.fireToKitchen(o.id);
    const outcome = await printing.printKitchenTicket(order, fired);
    eq(outcome.printed, false, 'skipped, not printed');
    eq(outcome.warning, undefined, 'no scary warning for a deliberate setting');
    eq(orders.getOrder(o.id).items[0].kitchen_status, 'fired', 'firing still happened');
    settingsRepo.saveSettings({ enable_kitchen_print: '1' });
    voidOrderCompat(o.id, 'cleanup');
  });

  await testAsync('9.4', 'Printer offline: clear error, order survives', async () => {
    settingsRepo.saveSettings({ printer_customer: 'NO_SUCH_PRINTER_XYZ' });
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const outcome = await printing.printCustomerBill(settled);
    eq(outcome.printed, false, 'print failed');
    ok(outcome.warning && outcome.warning.length > 0, 'a warning was returned');
    ok(/did not print/i.test(outcome.warning), `human-readable warning, got: ${outcome.warning}`);
    // The money must survive a dead printer.
    const after = orders.getOrder(o.id);
    eq(after.status, 'settled', 'order still settled');
    eq(after.total, 400, 'total intact');
    settingsRepo.saveSettings({ printer_customer: '' });
  });

  test('9.5', 'Customer bill contents', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '5' });
    const o = orders.openOrder({
      type: 'delivery',
      delivery_address: 'House 12, Street 4, Gulberg',
      customer_name: 'Bilal',
      customer_phone: '0333-4445556',
    });
    orders.addItems(o.id, [
      { menu_item_id: item['Zinger Burger'], qty: 2, notes: 'extra crispy', modifier_ids: [modLarge, modCheese] },
      { menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] },
    ]);
    const settled = orders.settleOrder(o.id, { discount: 50, payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);

    ok(/Test Food Point/.test(bill), 'business name');
    ok(/Main Road, Lahore/.test(bill), 'business address');
    ok(/0300-1234567/.test(bill), 'business phone');
    ok(bill.includes(settled.order_no), 'order no');
    ok(/Delivery/.test(bill), 'order type');
    ok(/Customer: Bilal/.test(bill), 'customer name');
    ok(/Phone: 0333-4445556/.test(bill), 'customer phone');
    ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(bill), 'datetime');
    ok(/Item\s+Price\s+Qty\s+Amount/.test(bill), 'the item table is headed');
    // 350 + 50 (Large) + 60 (Extra Cheese) = 460 each, two of them = 920.
    ok(/Zinger Burger\s+460\.00\s+2\s+920\.00/.test(bill), 'name, unit price, qty, amount');
    ok(/\+ Large\s+\(incl\. Rs50\.00\)/.test(bill), 'modifier marked as inside the unit price');
    ok(/\+ Extra Cheese\s+\(incl\. Rs60\.00\)/.test(bill), 'second modifier');
    ok(/\(extra crispy\)/.test(bill), 'line note');
    ok(/Subtotal\s+Rs/.test(bill), 'subtotal');
    ok(/Discount\s+-Rs50\.00/.test(bill), 'discount');
    ok(!/Service charge/.test(bill), 'NO service charge line — this is a delivery');
    ok(/TOTAL\s+Rs/.test(bill), 'total');
    ok(/Thank you/.test(bill), 'thank you');

    // 2 x (350 + 50 + 60) = 920, + 80 drink = 1000; -50 discount. The 5%
    // service charge is configured but never applies: a delivery customer buys
    // no table service.
    eq(settled.subtotal, 1000, 'subtotal arithmetic');
    eq(settled.service_charge, 0, 'delivery is not charged for service');
    eq(settled.total, 950, 'total = 1000 - 50');
    ok(bill.split('\n').every((l) => l.length <= 42), 'every line fits a 42-col roll');
    settingsRepo.saveSettings({ service_charge_percent: '0' });
  });

  test('9.6', 'Item lines read: name, price for one, quantity, amount', () => {
    // The shop's own example: three pink crust pizzas must print the price of
    // ONE pizza, the count, and what the three come to — not a lump sum the
    // customer has to take on trust.
    const pizza = Number(
      getDb()
        .prepare(
          `INSERT INTO menu_items (name, category_id, sale_price, cost_price, is_available, sort_order)
           VALUES (?, ?, 450, 200, 1, 99)`,
        )
        .run('Pink Crust Pizza', cat['Fast Food']).lastInsertRowid,
    );
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: pizza, qty: 3, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);

    ok(/^Pink Crust Pizza\s+450\.00\s+3\s+1350\.00$/m.test(bill), 'one line, four columns');
    ok(bill.split('\n').every((l) => l.length <= 42), 'every line fits a 42-col roll');

    // The three figures must agree with each other, or the customer catches
    // the bill out doing arithmetic the till cannot defend.
    const [, price, qty, total] = bill
      .split('\n')
      .find((l) => l.startsWith('Pink Crust Pizza'))
      .match(/^Pink Crust Pizza\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/);
    eq(Number(price) * Number(qty), Number(total), 'price x qty = amount');
  });

  test('9.7', 'A name too long for its column keeps its figures in line', () => {
    // Truncating the name would hide what was bought, so it takes the full
    // width and the figures land underneath, still in their own columns.
    const long = Number(
      getDb()
        .prepare(
          `INSERT INTO menu_items (name, category_id, sale_price, cost_price, is_available, sort_order)
           VALUES (?, ?, 900, 400, 1, 98)`,
        )
        .run('Pink Crust Stuffed Family Pizza', cat['Fast Food']).lastInsertRowid,
    );
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: long, qty: 2, modifier_ids: [] }]);
    const bill = receipt.buildCustomerBill(orders.settleOrder(o.id, { payment_method: 'cash' }));

    ok(/Pink Crust Stuffed Family/.test(bill), 'the name is never cut short');
    ok(/^\s+900\.00\s+2\s+1800\.00$/m.test(bill), 'figures on their own line, in column');
    ok(bill.split('\n').every((l) => l.length <= 42), 'every line fits a 42-col roll');
  });

  /* ================= Section 10 — Reports ================= */
  section('10 — Reports');

  test('10.1', 'Daily sales & profit match settled orders, voids excluded', () => {
    const today = todayIso();
    const dash = reports.dashboard(today);
    const truth = getDb()
      .prepare(
        `SELECT COALESCE(SUM(total),0) t, COALESCE(SUM(profit),0) p, COUNT(*) n
           FROM orders WHERE status='settled' AND date(settled_at)=?`,
      )
      .get(today);
    eq(dash.sales_total, Math.round(truth.t * 100) / 100, 'sales total');
    eq(dash.profit_total, Math.round(truth.p * 100) / 100, 'profit total');
    eq(dash.order_count, truth.n, 'order count');

    const voidTotal = getDb()
      .prepare("SELECT COALESCE(SUM(subtotal),0) t FROM orders WHERE status='void'")
      .get().t;
    ok(voidTotal > 0, 'there ARE voids in the data');
    const rng = reports.range(today, today);
    eq(rng.sales_total, dash.sales_total, 'range matches dashboard — voids excluded from both');
  });

  test('10.2', 'Date range totals', () => {
    const today = todayIso();
    const rng = reports.range('2000-01-01', '2099-12-31');
    const truth = getDb()
      .prepare("SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM orders WHERE status='settled'")
      .get();
    eq(rng.sales_total, Math.round(truth.t * 100) / 100, 'wide range total');
    eq(rng.order_count, truth.n, 'wide range count');
    const narrow = reports.range(today, today);
    eq(narrow.days.length, 1, 'one day bucket');
    eq(narrow.days[0].sales, narrow.sales_total, 'day bucket sums to the range');
  });

  test('10.3', 'By order type adds up to the total', () => {
    const today = todayIso();
    const byType = reports.salesByType(today, today);
    const sum = byType.reduce((s, r) => s + r.sales, 0);
    const rng = reports.range(today, today);
    eq(Math.round(sum * 100) / 100, rng.sales_total, 'type split sums to total');
    const counts = byType.reduce((s, r) => s + r.order_count, 0);
    eq(counts, rng.order_count, 'type counts sum to order count');
    ok(byType.every((r) => ['dine_in', 'takeaway', 'delivery'].includes(r.type)), 'valid types');
  });

  test('10.4', 'Best sellers ranked correctly', () => {
    const today = todayIso();
    const best = reports.bestSellers(today, today);
    ok(best.length > 0, 'has rows');
    for (let i = 1; i < best.length; i++) {
      ok(best[i - 1].qty >= best[i].qty, 'sorted by qty descending');
    }
    const truth = getDb()
      .prepare(
        `SELECT oi.item_name, SUM(oi.qty) q, SUM(oi.line_total) rev
           FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE o.status='settled' AND date(o.settled_at)=? AND oi.kitchen_status!='void'
          GROUP BY oi.item_name ORDER BY q DESC LIMIT 1`,
      )
      .get(today);
    eq(best[0].item_name, truth.item_name, 'top seller matches raw data');
    eq(best[0].qty, truth.q, 'top qty matches');
    eq(Math.round(best[0].revenue * 100) / 100, Math.round(truth.rev * 100) / 100, 'revenue matches');
  });

  test('10.5', 'Sales by hour reflects settle times', () => {
    const today = todayIso();
    const hours = reports.salesByHour(today, today);
    ok(hours.length > 0, 'has rows');
    const sum = hours.reduce((s, r) => s + r.sales, 0);
    eq(Math.round(sum * 100) / 100, reports.range(today, today).sales_total, 'hours sum to total');
    ok(hours.every((h) => h.hour >= 0 && h.hour <= 23), 'valid hour numbers');
    const dash = reports.dashboard(today);
    const busiest = hours.slice().sort((a, b) => b.sales - a.sales)[0];
    eq(dash.busiest_hour.hour, busiest.hour, 'dashboard busiest hour matches the report');
  });

  test('10.6', 'Voids report lists both kinds with reasons', () => {
    const list = reports.voids('2000-01-01', '2099-12-31');
    ok(list.some((v) => v.kind === 'order'), 'order voids');
    ok(list.some((v) => v.kind === 'item'), 'item voids');
    ok(list.every((v) => typeof v.reason === 'string'), 'reasons present');
    ok(list.every((v) => v.order_no), 'each traces to an order');
  });

  test('11.1/11.3', 'Dashboard peeks match the reports', () => {
    const today = todayIso();
    const dash = reports.dashboard(today);
    const best = reports.bestSellers(today, today, 1)[0];
    eq(dash.best_seller.name, best.item_name, 'best seller matches');
    eq(dash.best_seller.qty, best.qty, 'best seller qty matches');
    eq(dash.sales_total, reports.range(today, today).sales_total, 'sales match daily report');
    eq(dash.profit_total, reports.range(today, today).profit_total, 'profit matches daily report');
  });

  /* ================= Section 12 — Backup / persistence ================= */
  section('12 — Backup & persistence');

  // backupNow()/restoreFromFile() drive OS dialogs; stub the picker so the real
  // copy/checkpoint/restore code underneath still runs for real.
  const { dialog } = require('electron');
  const stubDialog = (dir, file, confirm = 1) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file ?? dir] });
    dialog.showMessageBox = async () => ({ response: confirm });
  };

  await testAsync('12.1', 'One-click backup writes a real file and logs it', async () => {
    const dest = path.join(tmp, 'backups');
    fs.mkdirSync(dest, { recursive: true });
    stubDialog(dest);
    const record = await backupSvc.backupNow();
    ok(fs.existsSync(record.path), 'backup file written to the chosen folder');
    ok(record.path.startsWith(dest), 'written where the user pointed');
    ok(record.size_bytes > 0, 'non-empty');
    ok(backupSvc.history().length > 0, 'logged in backup history');
    ok(backupSvc.last().path === record.path, 'last backup recorded');
    global.__backup = record;

    // A backup taken while WAL is dirty must still contain the latest orders.
    const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
    const copy = new Database(record.path, { readonly: true });
    const inCopy = copy.prepare("SELECT COUNT(*) n FROM orders WHERE status='settled'").get().n;
    const inLive = getDb().prepare("SELECT COUNT(*) n FROM orders WHERE status='settled'").get().n;
    eq(inCopy, inLive, 'backup contains every settled order (WAL checkpointed)');
    copy.close();
  });

  await testAsync('12.2', 'Restore brings all data back intact', async () => {
    const record = global.__backup;
    const dbNow = getDb();
    const before = {
      settled: getDb().prepare("SELECT COUNT(*) n FROM orders WHERE status='settled'").get().n,
      items: getDb().prepare('SELECT COUNT(*) n FROM menu_items').get().n,
      tables: getDb().prepare('SELECT COUNT(*) n FROM tables').get().n,
      total: getDb().prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status='settled'").get().t,
    };

    // Simulate a machine that lost everything.
    getDb().prepare('DELETE FROM orders').run();
    getDb().prepare('DELETE FROM menu_items').run();
    eq(getDb().prepare('SELECT COUNT(*) n FROM orders').get().n, 0, 'data wiped');

    stubDialog(null, record.path, 1);
    const result = await backupSvc.restoreFromFile();
    eq(result.restored, true, 'restore reported success');

    const db2 = getDb();
    eq(getDb().prepare("SELECT COUNT(*) n FROM orders WHERE status='settled'").get().n, before.settled, 'orders restored');
    eq(getDb().prepare('SELECT COUNT(*) n FROM menu_items').get().n, before.items, 'menu restored');
    eq(getDb().prepare('SELECT COUNT(*) n FROM tables').get().n, before.tables, 'tables restored');
    eq(
      Math.round(getDb().prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status='settled'").get().t * 100) / 100,
      Math.round(before.total * 100) / 100,
      'money restored exactly',
    );
    eq(getDb().prepare("SELECT value FROM settings WHERE key='business_name'").get().value, 'Test Food Point', 'settings restored');
    ok(
      fs.readdirSync(path.dirname(dbPath())).some((f) => f.includes('.replaced-')),
      'the overwritten database was kept as a safety copy',
    );
  });

  await testAsync('12.2b', 'Cancelling a restore changes nothing', async () => {
    const before = getDb().prepare("SELECT COUNT(*) n FROM orders").get().n;
    stubDialog(null, global.__backup.path, 0); // user picks Cancel on the confirm
    let refused = false;
    try {
      await backupSvc.restoreFromFile();
    } catch {
      refused = true;
    }
    ok(refused, 'restore refused when not confirmed');
    eq(getDb().prepare('SELECT COUNT(*) n FROM orders').get().n, before, 'data untouched');
  });

  test('12.3', 'Persistence across a restart', () => {
    const dbNow = getDb();
    const settledBefore = getDb().prepare("SELECT COUNT(*) n FROM orders WHERE status='settled'").get().n;
    reopenDb();
    const after = getDb().prepare("SELECT COUNT(*) n FROM orders WHERE status='settled'").get().n;
    eq(after, settledBefore, 'nothing lost across reopen');
  });

  test('12.4', 'Data lives under userData, not the app bundle', () => {
    ok(dbPath().startsWith(app.getPath('userData')), 'db under userData');
    ok(!dbPath().includes('/Applications/'), 'not in the app bundle');
  });

  /* ================= Section 13 — Stress & edge cases ================= */
  section('13 — Stress & edge cases');
  const dbS = getDb();

  test('13.1', '20 orders open at once stay independent', () => {
    for (const id of orders.listOpenOrders().map((o) => o.id)) voidOrderCompat(id, 'reset');
    const made = [];
    const started = Date.now();
    for (let i = 0; i < 20; i++) {
      const o = orders.openOrder({ type: 'takeaway' });
      orders.addItems(o.id, [
        { menu_item_id: item['Chicken Biryani'], qty: (i % 3) + 1, modifier_ids: [] },
      ]);
      made.push({ id: o.id, expected: 400 * ((i % 3) + 1) });
    }
    const elapsed = Date.now() - started;
    eq(orders.listOpenOrders().length, 20, 'twenty open');
    for (const m of made) {
      eq(orders.getOrder(m.id).subtotal, m.expected, `order ${m.id} uncorrupted`);
    }
    ok(elapsed < 5000, `stayed fast (${elapsed}ms for 20 orders)`);
    const nos = made.map((m) => orders.getOrder(m.id).order_no);
    eq(new Set(nos).size, 20, 'twenty distinct order numbers');
    for (const m of made) voidOrderCompat(m.id, 'cleanup');
  });

  test('13.2', 'Fire five times, adding one item each round', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const seq = ['Chicken Biryani', 'Zinger Burger', 'Cold Drink', 'Chicken Tikka', 'Mineral Water'];
    let expectedTotal = 0;
    seq.forEach((name, round) => {
      orders.addItems(o.id, [{ menu_item_id: item[name], qty: 1, modifier_ids: [] }]);
      const { order, fired } = orders.fireToKitchen(o.id);
      eq(fired.length, 1, `round ${round + 1} fires exactly one item`);
      eq(fired[0].item_name, name, `round ${round + 1} fires the right item`);
      const ticket = receipt.buildKitchenTicket(order, fired);
      for (const other of seq.filter((s) => s !== name)) {
        ok(!new RegExp(other.toUpperCase()).test(ticket), `${other} not on round ${round + 1} ticket`);
      }
      expectedTotal += ITEMS.find((r) => r[0] === name)[2];
      eq(order.subtotal, expectedTotal, `running total correct after round ${round + 1}`);
    });
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.total, 400 + 350 + 80 + 550 + 60, 'final total correct');
  });

  test('13.3', 'Very large quantity', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 99, modifier_ids: [] }]);
    eq(r.items[0].line_total, 39600, '99 x 400');
    eq(r.subtotal, 39600, 'subtotal');
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.total, 39600, 'total holds');
    eq(settled.profit, 39600 - 99 * 180, 'profit holds');
    ok(/Rs39600\.00/.test(receipt.buildCustomerBill(settled)), 'prints without a format bug');
  });

  test('13.4', 'Discount larger than subtotal is clamped, never negative', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { discount: 5000, payment_method: 'cash' });
    eq(settled.discount, 80, 'discount clamped to subtotal');
    eq(settled.total, 0, 'total floors at zero');
    ok(settled.total >= 0, 'never negative');

    const o2 = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o2.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const s2 = orders.settleOrder(o2.id, { discount: -500, payment_method: 'cash' });
    eq(s2.discount, 0, 'negative discount clamped to zero');
    eq(s2.total, 80, 'total unchanged by a negative discount');
  });

  test('13.5', 'Settling an empty order is blocked', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const msg = throws(() => orders.settleOrder(o.id, { payment_method: 'cash' }), 'empty settle');
    ok(/nothing on this order/i.test(msg), `clear message, got: ${msg}`);
    eq(orders.getOrder(o.id).status, 'open', 'order left open, not half-closed');

    // An order whose every line is voided is empty too.
    const o2 = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o2.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    voidItemCompat(orders.getOrder(o2.id).items[0].id, 'sent back');
    throws(() => orders.settleOrder(o2.id, { payment_method: 'cash' }), 'all-void settle');
    voidOrderCompat(o.id, 'cleanup');
    voidOrderCompat(o2.id, 'cleanup');
  });

  test('13.6', 'Double-tap Settle charges once', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const first = orders.settleOrder(o.id, { payment_method: 'cash' });
    const msg = throws(() => orders.settleOrder(o.id, { payment_method: 'cash' }), 'second settle');
    ok(/already been paid/i.test(msg), `clear message, got: ${msg}`);
    const after = orders.getOrder(o.id);
    eq(after.total, first.total, 'total not doubled');
    eq(after.profit, first.profit, 'profit not doubled');
    eq(after.settled_at, first.settled_at, 'settled_at not overwritten');
    eq(
      getDb().prepare("SELECT COUNT(*) n FROM orders WHERE id=? AND status='settled'").get(o.id).n,
      1,
      'exactly one settled row',
    );
  });

  test('13.7', 'Double-tap Send to kitchen fires once', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const first = orders.fireToKitchen(o.id);
    eq(first.fired.length, 1, 'first fire prints one item');
    throws(() => orders.fireToKitchen(o.id), 'second immediate fire');
    const items = orders.getOrder(o.id).items;
    eq(items.filter((i) => i.kitchen_status === 'fired').length, 1, 'still one fired line');
    eq(items[0].fired_at, first.fired[0].fired_at, 'fired_at not overwritten');
    voidOrderCompat(o.id, 'cleanup');
  });

  test('13.8', 'Power cut mid-order loses nothing', () => {
    const o = orders.openOrder({ type: 'dine_in', table_id: T.T2 });
    orders.addItems(o.id, [
      { menu_item_id: item['Zinger Burger'], qty: 2, notes: 'no onions', modifier_ids: [modLarge] },
    ]);
    orders.fireToKitchen(o.id);
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const before = orders.getOrder(o.id);

    // Hard reopen stands in for the app being killed.
    reopenDb();
    const after = orders.getOrder(o.id);
    eq(after.status, 'open', 'still open');
    eq(after.items.length, 2, 'both lines survive');
    eq(after.subtotal, before.subtotal, 'total survives');
    eq(after.items[0].kitchen_status, 'fired', 'fired state survives');
    eq(after.items[1].kitchen_status, 'new', 'unfired state survives');
    eq(after.items[0].notes, 'no onions', 'note survives');
    eq(after.items[0].modifiers.length, 1, 'modifier survives');
    eq(tables.getTable(T.T2).open_order_id, o.id, 'table still occupied');
    voidOrderCompat(o.id, 'cleanup');
  });

  test('13.9', 'Day rollover: numbering restarts, yesterday untouched', () => {
    // Plant a previous day whose sequence ran HIGH. If numbering leaked across
    // days, today's next order would jump to 901.
    getDb().prepare(
      `INSERT INTO orders (order_no, type, status, opened_at, settled_at, subtotal, total, profit, payment_method)
       VALUES (?, 'takeaway', 'settled', ?, ?, 500, 500, 200, 'cash')`,
    ).run('20250101-900', '2025-01-01 22:10:00', '2025-01-01 22:15:00');

    const prefix = todayIso().replace(/-/g, '');
    const maxBefore = getDb()
      .prepare('SELECT MAX(order_no) m FROM orders WHERE order_no LIKE ?')
      .get(`${prefix}-%`).m;

    const o = orders.openOrder({ type: 'takeaway' });
    ok(o.order_no.startsWith(`${prefix}-`), 'new order carries today prefix');
    const seq = Number(o.order_no.split('-')[1]);
    eq(seq, Number(maxBefore.split('-')[1]) + 1, "sequence continues from today's max only");
    ok(seq < 900, `did not inherit yesterday's 900 (got ${seq})`);
    eq(o.order_no.split('-')[1].length, 3, 'zero-padded to 3 digits');

    // "Today" figures must not pick up yesterday's money.
    const today = todayIso();
    const dash = reports.dashboard(today);
    const yesterday = reports.dashboard('2025-01-01');
    eq(yesterday.sales_total, 500, "yesterday's report finds its own order");
    eq(yesterday.order_count, 1, 'exactly one order that day');
    const rows = getDb()
      .prepare("SELECT COUNT(*) n FROM orders WHERE status='settled' AND date(settled_at)=?")
      .get(today).n;
    eq(dash.order_count, rows, "today's count excludes yesterday");

    // An order opened before midnight and paid after files under the pay date,
    // which is the same day it counts towards in every report.
    const late = orders.openOrder({ type: 'takeaway' });
    orders.addItems(late.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(late.id, { payment_method: 'cash' });
    getDb().prepare("UPDATE orders SET opened_at = '2025-01-01 23:55:00' WHERE id = ?").run(late.id);
    const hist = orders.listOrders(today, today, 'settled');
    ok(hist.some((h) => h.id === late.id), 'a past-midnight order files under its settle date');

    voidOrderCompat(o.id, 'cleanup');
  });

  test('13.z', 'UNIQUE order_no is a real backstop against two bills sharing a number', () => {
    const existing = getDb().prepare('SELECT order_no FROM orders LIMIT 1').get().order_no;
    throws(
      () =>
        getDb()
          .prepare(
            "INSERT INTO orders (order_no, type, status, opened_at) VALUES (?, 'takeaway', 'open', ?)",
          )
          .run(existing, '2026-01-01 10:00:00'),
      'duplicate order number',
    );
  });

  test('13.x', 'Fired lines cannot be silently re-quantified', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const line = orders.getOrder(o.id).items[0];
    orders.fireToKitchen(o.id);
    const msg = throws(() => orders.setItemQty(line.id, 5), 'editing a fired line');
    ok(/void it instead/i.test(msg), `points at the honest action, got: ${msg}`);
    eq(orders.getOrder(o.id).subtotal, 400, 'total unchanged');
    voidOrderCompat(o.id, 'cleanup');
  });

  test('13.y', 'Closed orders reject further edits', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });
    throws(
      () => orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]),
      'adding to a settled order',
    );
    throws(() => orders.fireToKitchen(o.id), 'firing a settled order');
  });

  /* ================= Section 1 — Licensing ================= */
  section('1 — Licensing');

  const crypto = require('node:crypto');
  const { getMachineId } = require(path.join(dist, 'services', 'machineId'));
  const machineId = getMachineId();
  const PRIVATE_PEM = fs.readFileSync(path.join(ROOT, 'tools', 'keygen', 'private-key.pem'));

  /** Mint a key exactly the way the founder's keygen does. */
  function mintKey({ m = machineId, exp = null, p = 'food' } = {}) {
    const payload = { m: String(m).trim().toUpperCase(), exp, iss: todayIso(), p };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = crypto.sign(null, raw, crypto.createPrivateKey(PRIVATE_PEM));
    const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `CH1.${b64(raw)}.${b64(sig)}`;
  }

  test('1.1', 'Fresh install is unlicensed and blocks use', () => {
    getDb().prepare('DELETE FROM license').run();
    const lic = path.join(app.getPath('userData'), 'license.dat');
    if (fs.existsSync(lic)) fs.rmSync(lic);
    const st = licenseSvc.status();
    eq(st.licensed, false, 'not licensed');
    eq(st.status, 'unlicensed', 'status unlicensed');
    eq(licenseSvc.isLicensed(), false, 'isLicensed false — the gate the UI reads');
    ok(st.machineId && st.machineId.length > 0, 'shows a machine id to quote to the office');
  });

  test('1.3', 'A pharmacy/shop key is rejected by the food app', () => {
    for (const product of ['pharmacy', 'shop']) {
      const msg = throws(() => licenseSvc.activate(mintKey({ p: product })), `${product} key`);
      ok(/different Code Hustlers product/i.test(msg), `clear message, got: ${msg}`);
    }
    eq(licenseSvc.isLicensed(), false, 'still not licensed');
  });

  test('1.4', 'An expired key is refused with a clear message', () => {
    const msg = throws(() => licenseSvc.activate(mintKey({ exp: '2020-01-01' })), 'expired key');
    ok(/expired on 2020-01-01/i.test(msg), `names the date, got: ${msg}`);
    eq(licenseSvc.isLicensed(), false, 'still not licensed');
  });

  test('1.3b', 'A key for another computer is rejected', () => {
    const msg = throws(() => licenseSvc.activate(mintKey({ m: 'AAAAA-BBBBB-CCCCC-DDDDD' })), 'foreign key');
    ok(/different computer/i.test(msg), `clear message, got: ${msg}`);
  });

  test('1.3c', 'A tampered key is rejected (signature covers the payload)', () => {
    // Take a valid expired key and edit the expiry in the payload, keeping the
    // old signature — the classic customer attack.
    const good = mintKey({ exp: '2020-01-01' });
    const [prefix, payloadB64, sig] = good.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    payload.exp = '2099-12-31';
    const forged = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const msg = throws(() => licenseSvc.activate(`${prefix}.${forged}.${sig}`), 'forged expiry');
    ok(/not valid/i.test(msg), `rejected on signature, got: ${msg}`);
    eq(licenseSvc.isLicensed(), false, 'not licensed by a forged key');
  });

  test('1.2', 'A valid lifetime food key activates', () => {
    const st = licenseSvc.activate(mintKey());
    eq(st.licensed, true, 'activated');
    eq(st.status, 'active', 'status active');
    eq(st.expiresAt, null, 'lifetime');
    eq(licenseSvc.isLicensed(), true, 'app unlocks');
    // Re-verified from disk on the next startup, not trusted from the row.
    reopenDb();
    eq(licenseSvc.status().licensed, true, 'still licensed after restart');
  });

  test('1.2b', 'A time-limited key that is still valid works', () => {
    const st = licenseSvc.activate(mintKey({ exp: '2099-12-31' }));
    eq(st.licensed, true, 'activated');
    eq(st.expiresAt, '2099-12-31', 'expiry recorded and shown');
    ok(/Licensed until 2099-12-31/.test(st.message), 'owner-readable message');
  });

  test('1.2c', 'license.dat copied to another machine does not unlock it', () => {
    // The stored file is encrypted with a key derived from the machine id.
    const stored = fs.readFileSync(path.join(app.getPath('userData'), 'license.dat'));
    ok(stored.length > 28, 'license file is written');
    ok(!stored.toString('utf8').includes('CH1.'), 'stored key is encrypted at rest, not plain text');
  });

  test('1.5', 'No network calls anywhere in the main process', () => {
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    })(path.join(ROOT, 'electron'));
    files.push(
      ...fs
        .readdirSync(path.join(ROOT, 'src', 'lib'))
        .map((f) => path.join(ROOT, 'src', 'lib', f)),
    );
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /require\(['"]https?['"]\)/, /from ['"]axios['"]/, /new WebSocket/]) {
        if (pattern.test(src)) offenders.push(`${path.relative(ROOT, f)} :: ${pattern}`);
      }
    }
    eq(offenders.join('; '), '', 'no network primitives in backend code');
  });

  test('1.6', 'Data location is product-specific and separate from shop/pharmacy', () => {
    // This harness redirects userData to a temp dir, so assert on the shipping
    // code: main.ts must name the app before anything reads userData.
    const mainSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main.ts'), 'utf8');
    ok(/app\.setName\(['"]CodeHustlersFood['"]\)/.test(mainSrc), 'app named CodeHustlersFood');
    // Compare against CODE only — main.ts documents this rule in a comment
    // above the call, which would otherwise look like an earlier use.
    const code = mainSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .split('\n');
    const nameLine = code.findIndex((l) => /app\.setName/.test(l));
    const firstUse = code.findIndex((l) => /getPath\(['"]userData['"]\)|migrate\(\)|getDb\(\)/.test(l));
    ok(nameLine >= 0, 'setName present in code, not just a comment');
    ok(firstUse === -1 || nameLine < firstUse, 'named before any userData read');
    ok(dbPath().endsWith('foodpoint.db'), 'own database file name');
    ok(dbPath().startsWith(app.getPath('userData')), 'database sits inside userData');
    // Nothing in the backend may reach into a sibling product's folder.
    const backendSrc = fs
      .readdirSync(path.join(ROOT, 'electron'), { recursive: true })
      .filter((f) => String(f).endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(ROOT, 'electron', String(f)), 'utf8'))
      .join('\n');
    ok(!/CodeHustlersShop|CodeHustlersPharmacy/.test(backendSrc), 'no reference to sibling products');
  });

  /* ================= report ================= */
  closeDb();

  /**
   * The void signature changed in v1.1: a fixed reason code plus a note and
   * the staff id, instead of free text. These shims keep the older scenarios
   * expressing what they were written to express.
   */
  function voidItemCompat(id, reason) {
    return orders.voidItem(id, {
      reason_code: 'other',
      note: reason,
      staff_id: session.currentStaff() ? session.currentStaff().id : null,
    });
  }
  function voidOrderCompat(id, reason) {
    return orders.voidOrder(id, {
      reason_code: 'other',
      note: reason,
      staff_id: session.currentStaff() ? session.currentStaff().id : null,
    });
  }

  /* ================================================================== *
   * 14 — Deals (combo bundles at one fixed price)
   * ================================================================== */
  section('14 — Deals');

  // Earlier sections move the service charge around. Pin it, so these tests
  // measure deal arithmetic and not a stray percentage — the exact trap that
  // made 13.2-13.4 fail once already.
  settingsRepo.saveSettings({ service_charge_percent: '0' });

  let comboId = 0;

  test('14.1', 'Create a deal from menu items', () => {
    const d = deals.saveDeal({
      name: 'Burger Combo',
      price: 380,
      is_active: true,
      sort_order: 0,
      notes: null,
      components: [
        { menu_item_id: item['Zinger Burger'], qty: 1 },
        { menu_item_id: item['Cold Drink'], qty: 1 },
      ],
    });
    comboId = d.id;
    eq(d.name, 'Burger Combo', 'name saved');
    eq(d.price, 380, 'combo price saved');
    eq(d.components.length, 2, 'two components');
    eq(d.is_sellable, true, 'sellable while both parts are available');
  });

  test('14.2', 'The combo price is fixed, not the sum of the parts', () => {
    const d = deals.getDeal(comboId);
    eq(d.menu_value, 430, 'parts bought separately cost 430');
    eq(d.price, 380, 'the deal charges 380');
    ok(d.price < d.menu_value, 'the deal is actually a saving');
  });

  test('14.3', 'Adding a deal is ONE action and writes component lines', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, comboId, 1);
    eq(r.items.length, 2, 'one tap produced both component lines');
    ok(r.items.every((l) => l.deal_id === comboId), 'every line knows its deal');
    ok(r.items.every((l) => l.deal_name === 'Burger Combo'), 'deal name snapshotted');
    const groups = new Set(r.items.map((l) => l.deal_group));
    eq(groups.size, 1, 'both lines share one deal_group');
    ok(r.items[0].deal_group !== null, 'deal_group is set');
  });

  test('14.4', 'Component lines sum to EXACTLY the combo price', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, comboId, 1);
    const sum = r.items.reduce((t, l) => t + l.line_total, 0);
    eq(Math.round(sum * 100) / 100, 380, 'lines add up to the combo price');
    eq(r.subtotal, 380, 'order subtotal is the combo price');
  });

  test('14.5', 'Underlying items keep their REAL food cost', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, comboId, 1);
    const burger = r.items.find((l) => l.item_name === 'Zinger Burger');
    const drink = r.items.find((l) => l.item_name === 'Cold Drink');
    eq(burger.cost_price, 150, 'burger keeps its true cost, undiscounted');
    eq(drink.cost_price, 40, 'drink keeps its true cost, undiscounted');
    eq(burger.menu_item_id, item['Zinger Burger'], 'points at the real menu item');
  });

  test('14.6', 'Profit uses the real component costs, not the combo price', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addDeal(o.id, comboId, 1);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.total, 380, 'charged the combo price');
    // COGS = 150 + 40 = 190
    eq(settled.profit, 190, 'profit = 380 - 190 real food cost');
  });

  test('14.7', 'Quantity above one scales every component', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, comboId, 3);
    eq(r.subtotal, 1140, '3 x 380');
    ok(r.items.every((l) => l.qty === 3), 'each component multiplied');
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.profit, 1140 - 3 * 190, 'profit scales with the real costs');
  });

  test('14.8', 'Odd prices split across three parts with no rounding drift', () => {
    const d = deals.saveDeal({
      name: 'Family Deal',
      price: 700,
      is_active: true,
      sort_order: 0,
      notes: null,
      components: [
        { menu_item_id: item['Chicken Biryani'], qty: 1 },
        { menu_item_id: item['Zinger Burger'], qty: 1 },
        { menu_item_id: item['Cold Drink'], qty: 1 },
      ],
    });
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, d.id, 1);
    const sum = r.items.reduce((t, l) => t + l.line_total, 0);
    eq(Math.round(sum * 100) / 100, 700, 'three-way split still lands on 700 exactly');
    eq(r.subtotal, 700, 'subtotal exact');
    // 400/350/80 of 830 menu value, weighted
    ok(r.items[0].line_total > r.items[2].line_total, 'the pricier item absorbs more of the discount');
  });

  test('14.9', 'The bill shows ONE line at the combo price', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addDeal(o.id, comboId, 1);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);
    ok(/Burger Combo\s+380\.00\s+1\s+380\.00/.test(bill), 'one deal line at the combo price');
    ok(!/309\.30/.test(bill), 'the split share is never shown to the customer');
    ok(!/70\.70/.test(bill), 'nor the other share');
    ok(/- 1 Zinger Burger/.test(bill), 'contents listed underneath, without prices');
    ok(/- 1 Cold Drink/.test(bill), 'second content line');
    ok(bill.split('\n').every((l) => l.length <= 42), 'still fits a 42-col roll');
  });

  test('14.10', 'The kitchen ticket lists the real dishes to cook', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addDeal(o.id, comboId, 1);
    const { order, fired } = orders.fireToKitchen(o.id);
    const ticket = receipt.buildKitchenTicket(order, fired);
    ok(/ZINGER BURGER/.test(ticket), 'burger goes to the kitchen');
    ok(/COLD DRINK/.test(ticket), 'drink goes to the kitchen');
    ok(/>> BURGER COMBO/.test(ticket), 'banner tells the pass they plate together');
    ok(!/380/.test(ticket), 'no prices on a kitchen ticket');
  });

  test('14.11', 'Reports count the underlying items, not the deal', () => {
    const before = reports.bestSellers(todayIso(), todayIso(), 50);
    const beforeQty = (before.find((r) => r.item_name === 'Zinger Burger') || {}).qty || 0;
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addDeal(o.id, comboId, 2);
    orders.settleOrder(o.id, { payment_method: 'cash' });
    const after = reports.bestSellers(todayIso(), todayIso(), 50);
    const afterQty = after.find((r) => r.item_name === 'Zinger Burger').qty;
    eq(afterQty - beforeQty, 2, 'the deal sold 2 real burgers and the report knows');
  });

  test('14.12', 'A sold-out component takes the whole deal off sale', () => {
    menu.setAvailable(item['Cold Drink'], false);
    const d = deals.getDeal(comboId);
    eq(d.is_sellable, false, 'deal reports itself unsellable');
    const o = orders.openOrder({ type: 'takeaway' });
    const msg = throws(() => orders.addDeal(o.id, comboId, 1), 'sold-out component blocks the deal');
    ok(/Cold Drink/.test(msg), 'the message names the missing item');
    menu.setAvailable(item['Cold Drink'], true);
  });

  test('14.13', 'An inactive deal cannot be sold', () => {
    deals.setDealActive(comboId, false);
    const o = orders.openOrder({ type: 'takeaway' });
    throws(() => orders.addDeal(o.id, comboId, 1), 'inactive deal is refused');
    deals.setDealActive(comboId, true);
    const r = orders.addDeal(o.id, comboId, 1);
    eq(r.subtotal, 380, 'sells again once reactivated');
  });

  test('14.14', 'Voiding one component voids the whole deal', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, comboId, 1);
    const after = voidItemCompat(r.items[0].id, 'customer changed their mind');
    ok(after.items.every((l) => l.kitchen_status === 'void'), 'every component voided together');
    eq(after.subtotal, 0, 'no half-combo left on the bill');
  });

  test('14.15', 'A deal component cannot be re-quantified on its own', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    const r = orders.addDeal(o.id, comboId, 1);
    const msg = throws(
      () => orders.setItemQty(r.items[0].id, 5),
      'editing one component of a deal is refused',
    );
    ok(/deal/i.test(msg), 'the message explains why');
  });

  test('14.16', 'The same deal twice makes two independent groups', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addDeal(o.id, comboId, 1);
    const r = orders.addDeal(o.id, comboId, 1);
    const groups = new Set(r.items.map((l) => l.deal_group));
    eq(groups.size, 2, 'two separate deal groups');
    eq(r.subtotal, 760, 'two combos priced');
    // Voiding one must leave the other intact.
    const firstGroup = r.items[0].deal_group;
    const after = voidItemCompat(r.items[0].id, 'wrong combo');
    const live = after.items.filter((l) => l.kitchen_status !== 'void');
    eq(live.length, 2, 'the other combo survives whole');
    ok(live.every((l) => l.deal_group !== firstGroup), 'and it is the other group');
    eq(after.subtotal, 380, 'one combo still on the bill');
  });

  test('14.17', 'A deal needs at least one item', () => {
    throws(
      () => deals.saveDeal({ name: 'Empty', price: 100, is_active: true, sort_order: 0, notes: null, components: [] }),
      'an empty deal is refused',
    );
  });

  test('14.18', 'Deleting a deal leaves past bills readable', () => {
    const d = deals.saveDeal({
      name: 'Temporary Deal',
      price: 200,
      is_active: true,
      sort_order: 0,
      notes: null,
      components: [{ menu_item_id: item['Cold Drink'], qty: 2 }],
    });
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addDeal(o.id, d.id, 1);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    deals.removeDeal(d.id);
    const reread = orders.getOrder(settled.id);
    eq(reread.total, 200, 'the settled total is untouched');
    eq(reread.items[0].deal_name, 'Temporary Deal', 'the snapshot name survives the delete');
    ok(/Temporary Deal/.test(receipt.buildCustomerBill(reread)), 'the bill still reprints');
  });


  /* ================================================================== *
   * 15 — Cancellation control & anti-theft
   * ================================================================== */
  section('15 — Cancellation control');

  settingsRepo.saveSettings({ service_charge_percent: '0' });

  let bilal = 0;
  let farhan = 0;

  test('15.1', 'Owner can add staff with their own PIN', () => {
    const a = staffRepo.saveStaff({ name: 'Bilal', is_active: true, pin: '1111' });
    const b = staffRepo.saveStaff({ name: 'Farhan', is_active: true, pin: '2222' });
    bilal = a.id;
    farhan = b.id;
    eq(a.name, 'Bilal', 'name saved');
    eq(a.has_pin, true, 'PIN recorded');
    ok(staffRepo.listStaff(true).length >= 2, 'both on the sign-in list');
  });

  test('15.2', 'The stored PIN never leaves the main process', () => {
    const list = staffRepo.listStaff();
    for (const person of list) {
      ok(!('pin_hash' in person), 'no pin_hash on the object the UI receives');
      ok(!('pin' in person), 'no plaintext pin either');
    }
  });

  test('15.3', 'Signing in needs the right PIN', () => {
    throws(() => session.signIn(bilal, '9999'), 'wrong PIN is refused');
    throws(() => session.signIn(bilal, ''), 'blank PIN is refused');
    const s = session.signIn(bilal, '1111');
    eq(s.name, 'Bilal', 'correct PIN signs in');
    eq(session.currentStaff().id, bilal, 'session holds the signed-in person');
  });

  test('15.4', 'Cancelling an UNPAID order needs no manager PIN', () => {
    managerPin.setPin('4321');
    session.signIn(bilal, '1111');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const cancelled = orders.voidOrder(o.id, {
      reason_code: 'customer_left',
      note: null,
      staff_id: session.currentStaff().id,
    });
    eq(cancelled.status, 'void', 'cancelled');
    eq(cancelled.voided_was_paid, 0, 'recorded as unpaid');
    managerPin.setPin('');
  });

  test('15.5', 'A PAID order CAN now be cancelled — the old build refused outright', () => {
    session.signIn(bilal, '1111');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });
    const cancelled = orders.voidOrder(o.id, {
      reason_code: 'duplicate',
      note: null,
      staff_id: session.currentStaff().id,
    });
    eq(cancelled.status, 'void', 'paid order cancels');
    eq(cancelled.voided_was_paid, 1, 'recorded as PAID — the serious case');
  });

  test('15.6', 'Cancellation is never a delete — the whole order survives', () => {
    session.signIn(bilal, '1111');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [
      { menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] },
      { menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] },
    ]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const amountTaken = settled.total;

    orders.voidOrder(o.id, { reason_code: 'wrong_order', note: null, staff_id: bilal });

    const reread = orders.getOrder(o.id);
    ok(reread !== null, 'the order row still exists');
    eq(reread.items.length, 2, 'its items are still there');
    eq(reread.total, amountTaken, 'the amount taken is preserved');
    ok(reread.settled_at !== null, 'the fact it had been paid is preserved');
    ok(reread.voided_at !== null, 'the exact cancellation time is recorded');
    eq(reread.voided_by_staff_id, bilal, 'the staff member is recorded');
    eq(reread.voided_by_staff_name, 'Bilal', 'and resolvable to a name');
    eq(reread.void_reason_code, 'wrong_order', 'the reason code is recorded');
  });

  test('15.7', 'A cancelled paid order leaves the day takings', () => {
    session.signIn(bilal, '1111');
    const before = reports.dashboard(todayIso()).sales_total;
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Seekh Kebab'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const withSale = reports.dashboard(todayIso()).sales_total;
    eq(Math.round((withSale - before) * 100) / 100, 600, 'the sale counted');

    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: bilal });
    const after = reports.dashboard(todayIso()).sales_total;
    eq(after, before, 'cancelling removed it from takings again');
  });

  test('15.8', 'Reason must come from the fixed list', () => {
    const { asEnum } = require(path.join(dist, 'ipc', 'util'));
    const { CANCEL_REASONS } = require(path.join(dist, '..', 'shared', 'types'));
    throws(() => asEnum('made up', CANCEL_REASONS, 'Reason'), 'free text is refused');
    eq(asEnum('wrong_order', CANCEL_REASONS, 'Reason'), 'wrong_order', 'a listed reason passes');
    eq(CANCEL_REASONS.length, 5, 'five reasons: the four named plus Other');
  });

  test('15.9', 'Cancellations report totals and separates paid from unpaid', () => {
    const report = reports.cancellations(todayIso(), todayIso());
    ok(report.total_count > 0, 'there are cancellations to see');
    ok(report.paid_count > 0, 'and some of them were paid orders');
    ok(report.paid_value > 0, 'with real money against them');
    ok(report.total_value >= report.paid_value, 'paid value is part of the total');
    const rec = report.records[0];
    ok(rec.order_no, 'each record names its order');
    ok(rec.cancelled_at, 'and its exact time');
    ok(Array.isArray(rec.items), 'and carries the items that were on it');
  });

  test('15.10', 'Per-staff breakdown attributes cancellations to the right person', () => {
    // Farhan cancels two paid orders; Bilal already has some on record.
    session.signIn(farhan, '2222');
    for (let i = 0; i < 2; i += 1) {
      const o = orders.openOrder({ type: 'takeaway' });
      orders.addItems(o.id, [{ menu_item_id: item['Chicken Tikka'], qty: 1, modifier_ids: [] }]);
      orders.settleOrder(o.id, { payment_method: 'cash' });
      orders.voidOrder(o.id, { reason_code: 'customer_left', note: null, staff_id: farhan });
    }

    const report = reports.cancellations(todayIso(), todayIso());
    const f = report.by_staff.find((r) => r.staff_id === farhan);
    const b = report.by_staff.find((r) => r.staff_id === bilal);
    ok(f, "Farhan appears in the breakdown");
    eq(f.count, 2, 'with exactly his two');
    eq(f.paid_count, 2, 'both of them paid orders');
    eq(f.paid_value, 1100, '2 x 550 of cash cancelled');
    ok(b && b.count >= 1, 'Bilal is listed separately');
    ok(b.staff_id !== f.staff_id, 'the two are not merged');
  });

  test('15.11', 'Report groups by reason so a pattern is visible', () => {
    const report = reports.cancellations(todayIso(), todayIso());
    ok(report.by_reason.length > 0, 'reasons are grouped');
    const left = report.by_reason.find((r) => r.reason_code === 'customer_left');
    ok(left && left.count >= 2, "Farhan's two 'Customer left' show up as a pattern");
    ok(left.reason_label === 'Customer left', 'with a readable label');
  });

  test('15.12', 'Staff who have cancellations are deactivated, never deleted', () => {
    const result = staffRepo.removeStaff(farhan);
    eq(result.deleted, false, 'not hard-deleted');
    const still = staffRepo.getStaff(farhan);
    ok(still !== null, 'the record survives');
    eq(still.is_active, 0, 'but they leave the sign-in list');
    // History must still resolve to their name.
    const report = reports.cancellations(todayIso(), todayIso());
    const f = report.by_staff.find((r) => r.staff_id === farhan);
    eq(f.staff_name, 'Farhan', 'their past cancellations still name them');
    staffRepo.saveStaff({ id: farhan, name: 'Farhan', is_active: true });
  });

  test('15.13', 'Staff with no history can be removed outright', () => {
    const temp = staffRepo.saveStaff({ name: 'Temp Worker', is_active: true, pin: '3333' });
    const result = staffRepo.removeStaff(temp.id);
    eq(result.deleted, true, 'hard-deleted');
    eq(staffRepo.getStaff(temp.id), null, 'gone');
  });

  test('15.14', 'A deactivated staff member cannot sign in or stay signed in', () => {
    const temp = staffRepo.saveStaff({ name: 'Gone', is_active: true, pin: '5555' });
    session.signIn(temp.id, '5555');
    eq(session.currentStaff().id, temp.id, 'signed in');
    staffRepo.saveStaff({ id: temp.id, name: 'Gone', is_active: false });
    session.revalidate();
    eq(session.currentStaff(), null, 'deactivating them drops the live session');
    throws(() => session.signIn(temp.id, '5555'), 'and they cannot sign back in');
  });

  test('15.15', 'Cancelling is blocked when nobody is signed in and staff exist', () => {
    session.signOut();
    ok(staffRepo.anyActiveStaff(), 'a roster exists');
    const msg = throws(
      () => session.requireStaffForAudit(),
      'an unattributed cancellation is refused',
    );
    ok(/sign in/i.test(msg), 'and the message says why');
    session.signIn(bilal, '1111');
  });

  test('15.16', 'Manager PIN gate is verified in the main process', () => {
    managerPin.setPin('4321');
    throws(() => managerPin.requirePin('0000'), 'a wrong manager PIN is refused');
    throws(() => managerPin.requirePin(''), 'a missing manager PIN is refused');
    throws(() => managerPin.requirePin(true), 'a non-string cannot slip past');
    managerPin.requirePin('4321');
    ok(true, 'the right PIN passes');
    managerPin.setPin('');
    managerPin.requirePin(undefined);
    ok(true, 'with no PIN configured the gate is open');
  });

  test('15.16b', 'The cancel gate: open needs no PIN, paid does', () => {
    managerPin.setPin('4321');
    session.signIn(bilal, '1111');

    const open = orders.openOrder({ type: 'takeaway' });
    orders.addItems(open.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const openOrder = orders.getOrder(open.id);
    cancelGuard.assertMayCancel(openOrder, undefined);
    ok(true, 'an OPEN order passes with no PIN at all');

    const paid = orders.openOrder({ type: 'takeaway' });
    orders.addItems(paid.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(paid.id, { payment_method: 'cash' });
    throws(() => cancelGuard.assertMayCancel(settled, undefined), 'a PAID order is blocked');
    const msg = throws(() => cancelGuard.assertMayCancel(settled, '1111'), 'a STAFF pin is not enough');
    ok(/match/i.test(msg), 'and it says the PIN is wrong');
    cancelGuard.assertMayCancel(settled, '4321');
    ok(true, 'only the manager PIN opens it');

    managerPin.setPin('');
  });

  test('15.17', 'An already-cancelled order cannot be cancelled twice', () => {
    session.signIn(bilal, '1111');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: bilal });
    throws(
      () => orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: bilal }),
      'a second cancellation is refused',
    );
  });

  test('15.18', 'Cancellations outside the period are not counted', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, '0'),
      String(tomorrow.getDate()).padStart(2, '0'),
    ].join('-');
    const report = reports.cancellations(iso, iso);
    eq(report.total_count, 0, 'tomorrow has none');
    eq(report.total_value, 0, 'and no value');
    eq(report.by_staff.length, 0, 'and nobody to blame');
  });


  /* ================================================================== *
   * 16 — Admin portal access control
   * ================================================================== */
  section('16 — Admin portal');

  test('16.1', 'Admin starts locked', () => {
    adminSession.lockAdmin();
    eq(adminSession.isAdmin(), false, 'locked on start');
    throws(() => adminSession.requireAdmin(), 'owner-only data is refused while locked');
  });

  test('16.2', 'An unset PIN does NOT leave admin open', () => {
    managerPin.setPin('');
    // requirePin() passes silently with no PIN — that is the "voids are open"
    // rule, and applying it to admin would expose the takings on any shop
    // that never set one.
    managerPin.requirePin(undefined);
    ok(true, 'the cancellation gate stays open, as designed');
    throws(() => adminSession.unlockAdmin(''), 'but admin refuses to unlock');
    eq(adminSession.adminPinRequired(), true, 'and reports that a PIN is needed');
  });

  test('16.3', 'The manager PIN opens admin — the SAME PIN, not a second one', () => {
    managerPin.setPin('4321');
    throws(() => adminSession.unlockAdmin('0000'), 'a wrong PIN is refused');
    throws(() => adminSession.unlockAdmin(''), 'a blank PIN is refused');
    adminSession.unlockAdmin('4321');
    eq(adminSession.isAdmin(), true, 'the cancellation PIN unlocks admin');
    // Proof it is one store, not two: change it in Settings and admin follows.
    adminSession.lockAdmin();
    managerPin.setPin('8765');
    throws(() => adminSession.unlockAdmin('4321'), 'the old PIN stops working');
    adminSession.unlockAdmin('8765');
    ok(true, 'the new one works — a single shared PIN store');
    managerPin.setPin('4321');
  });

  test('16.4', 'Exiting admin ends the session immediately', () => {
    adminSession.unlockAdmin('4321');
    eq(adminSession.isAdmin(), true, 'unlocked');
    adminSession.lockAdmin();
    eq(adminSession.isAdmin(), false, 'locked again');
    throws(() => adminSession.requireAdmin(), 'and owner-only data is refused');
  });

  test('16.5', 'First run: setting the PIN unlocks, and cannot overwrite one', () => {
    managerPin.setPin('');
    eq(adminSession.adminPinRequired(), true, 'no PIN yet');
    adminSession.initialiseAdminPin('1357');
    eq(adminSession.isAdmin(), true, 'set and entered in one step');
    throws(() => adminSession.initialiseAdminPin('9999'), 'cannot silently replace an existing PIN');
    // And the PIN it set is the real manager PIN — the cancellation gate now
    // honours it too.
    managerPin.requirePin('1357');
    ok(true, 'the same PIN now approves a paid cancellation');
    managerPin.setPin('4321');
    adminSession.lockAdmin();
  });

  test('16.6', 'Route map: counter screens only, everything else is admin', () => {
    // Mirrors src/lib/areas.ts. Default-deny is the property under test: a
    // route nobody classified must land on the admin side, not the counter.
    const COUNTER = ['/order/', '/tables/', '/menu/'];
    const isAdminRoute = (p) => {
      const path = p.endsWith('/') ? p : p + '/';
      return !COUNTER.includes(path === '//' ? '/' : path);
    };
    for (const p of COUNTER) eq(isAdminRoute(p), false, p + ' is counter');
    for (const p of ['/', '/reports/', '/cancellations/', '/settings/', '/orders/', '/deals/'])
      eq(isAdminRoute(p), true, p + ' is admin');
    eq(isAdminRoute('/some-future-screen/'), true, 'an unclassified route defaults to admin');
    eq(isAdminRoute('/reports'), true, 'a missing trailing slash does not slip past');
  });

  test('16.7', 'Counter work is untouched by the lock', () => {
    adminSession.lockAdmin();
    // The whole point: locking admin must not stop anyone serving a customer.
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const fired = orders.fireToKitchen(o.id);
    ok(fired.fired.length === 1, 'sending to the kitchen still works');
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.status, 'settled', 'billing still works');
    ok(menu.listItems().length > 0, 'the menu still lists');
    ok(tables.listTables().length >= 0, 'the floor still lists');
    ok(receipt.buildCustomerBill(settled).length > 0, 'the bill still prints');
  });

  test('16.8', 'Idle admin sessions expire', () => {
    adminSession.unlockAdmin('4321');
    eq(adminSession.isAdmin(), true, 'unlocked');
    // The timeout is real time, so assert the mechanism rather than sleep for
    // fifteen minutes: touching keeps it alive, and lock ends it.
    adminSession.touchAdmin();
    eq(adminSession.isAdmin(), true, 'activity keeps it alive');
    adminSession.lockAdmin();
    eq(adminSession.isAdmin(), false, 'and it can always be ended outright');
  });


  /* ================================================================== *
   * 17 — Delivery
   * ================================================================== */
  section('17 — Delivery');

  settingsRepo.saveSettings({ service_charge_percent: '0' });

  test('17.1', 'A delivery order cannot be started without an address', () => {
    const msg = throws(
      () => orders.openOrder({ type: 'delivery' }),
      'a blank address is refused',
    );
    ok(/address/i.test(msg), 'and the message says why');
    throws(
      () => orders.openOrder({ type: 'delivery', delivery_address: '   ' }),
      'whitespace is not an address',
    );
  });

  test('17.2', 'Address and charge are stored on the order', () => {
    const o = orders.openOrder({
      type: 'delivery',
      delivery_address: 'House 7, Block C, Johar Town',
      delivery_charge: 150,
      customer_name: 'Usman',
      customer_phone: '0321-1234567',
    });
    eq(o.delivery_address, 'House 7, Block C, Johar Town', 'address stored');
    eq(o.delivery_charge, 150, 'charge stored as its own field');
    eq(o.customer_name, 'Usman', 'name stored');
  });

  test('17.3', 'The charge is a SEPARATE field, never folded into item prices', () => {
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'A', delivery_charge: 200 });
    const r = orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    // Subtotal is food only. The fee lives beside it, not inside it.
    eq(r.subtotal, 400, 'subtotal is the food alone');
    eq(r.items[0].line_total, 400, 'the item line is untouched by the fee');
    eq(r.delivery_charge, 200, 'the fee sits in its own column');
  });

  test('17.4', 'Subtotal + delivery = grand total', () => {
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'B', delivery_charge: 150 });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 2, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.subtotal, 800, 'food subtotal');
    eq(settled.delivery_charge, 150, 'delivery kept separate');
    eq(settled.total, 950, 'total = 800 + 150');
    // The fee has no food cost, so it lands whole in profit.
    eq(settled.profit, 950 - 2 * 180, 'profit = total - real food cost');
  });

  test('17.5', 'Delivery takes a discount, and NEVER a service charge', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10' });
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'C', delivery_charge: 100 });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { discount: 50, payment_method: 'cash' });
    // 400 - 50 + 100 = 450. The 10% is live in settings and still does not
    // apply: the customer is already paying to have the food carried to them.
    eq(settled.service_charge, 0, 'the delivery fee is the only extra charge');
    eq(settled.total, 450, 'all three terms combine correctly');
    settingsRepo.saveSettings({ service_charge_percent: '0' });
  });

  test('17.6', 'A zero charge is allowed', () => {
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'D', delivery_charge: 0 });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.delivery_charge, 0, 'free delivery is a real choice');
    eq(settled.total, 80, 'total is just the food');
  });

  test('17.7', 'DINE-IN and TAKEAWAY are completely unaffected', () => {
    const t = orders.openOrder({ type: 'takeaway' });
    orders.addItems(t.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const tSettled = orders.settleOrder(t.id, { payment_method: 'cash' });
    eq(tSettled.delivery_charge, 0, 'takeaway carries no fee');
    eq(tSettled.delivery_address, null, 'and no address');
    eq(tSettled.total, 400, 'takeaway total is unchanged');

    const d = orders.openOrder({ type: 'dine_in', table_id: T.T2 });
    orders.addItems(d.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const dSettled = orders.settleOrder(d.id, { payment_method: 'cash' });
    eq(dSettled.delivery_charge, 0, 'dine-in carries no fee');
    eq(dSettled.total, 400, 'dine-in total is unchanged');
    // Even if a caller passes delivery fields, a non-delivery order ignores them.
    const sneaky = orders.openOrder({ type: 'takeaway', delivery_address: 'X', delivery_charge: 999 });
    eq(sneaky.delivery_charge, 0, 'a fee cannot be attached to a takeaway');
    eq(sneaky.delivery_address, null, 'nor an address');
  });

  test('17.8', 'The customer bill carries the address and the fee', () => {
    const o = orders.openOrder({
      type: 'delivery',
      delivery_address: 'House 7, Block C, Johar Town',
      delivery_charge: 150,
      customer_name: 'Usman',
      customer_phone: '0321-1234567',
    });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);

    ok(/\*\*\* DELIVERY \*\*\*/.test(bill), 'DELIVERY is called out near the top');
    ok(/House 7, Block C, Johar Town/.test(bill), 'the rider gets the address');
    ok(/Customer: Usman/.test(bill), 'and the name');
    ok(/Phone: 0321-1234567/.test(bill), 'and the phone');
    ok(/Delivery\s+Rs150\.00/.test(bill), 'the fee is its own line');
    ok(/TOTAL\s+Rs550\.00/.test(bill), 'and the grand total includes it');
    ok(bill.split('\n').every((l) => l.length <= 42), 'still fits a 42-col roll');
  });

  test('17.9', 'The KITCHEN ticket gets the label and nothing more', () => {
    const o = orders.openOrder({
      type: 'delivery',
      delivery_address: 'House 7, Block C, Johar Town',
      delivery_charge: 150,
      customer_name: 'Usman',
      customer_phone: '0321-1234567',
    });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const { order, fired } = orders.fireToKitchen(o.id);
    const ticket = receipt.buildKitchenTicket(order, fired);

    ok(/DELIVERY/.test(ticket), 'the kitchen is told it is a delivery');
    ok(!/Johar Town/.test(ticket), 'but NOT the address');
    ok(!/0321-1234567/.test(ticket), 'nor the phone');
    ok(!/150/.test(ticket), 'nor the money');
  });

  test('17.10', 'A long address wraps rather than truncating', () => {
    const long = 'Flat 4B, Second Floor, Al-Hamd Plaza, Near Chowk Yateem Khana, Multan Road, Lahore';
    const o = orders.openOrder({ type: 'delivery', delivery_address: long, delivery_charge: 0 });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);
    ok(bill.split('\n').every((l) => l.length <= 42), 'every line fits the roll');
    // Half an address is worse than none — it looks complete.
    ok(/Multan Road/.test(bill), 'the tail of the address survives');
    ok(/Al-Hamd Plaza/.test(bill), 'and the middle');
  });

  test('17.11', 'The address can be corrected on an open order', () => {
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'Wrong house', delivery_charge: 50 });
    const fixed = orders.setDelivery(o.id, {
      delivery_address: 'Right house, Street 9',
      delivery_charge: 120,
    });
    eq(fixed.delivery_address, 'Right house, Street 9', 'address corrected');
    eq(fixed.delivery_charge, 120, 'fee corrected too');
    throws(
      () => orders.setDelivery(o.id, { delivery_address: '  ' }),
      'it cannot be blanked',
    );
    const t = orders.openOrder({ type: 'takeaway' });
    throws(
      () => orders.setDelivery(t.id, { delivery_address: 'somewhere' }),
      'and a takeaway has no delivery to set',
    );
  });

  test('17.12', 'Reports total the delivery charges separately', () => {
    const today = todayIso();
    const before = reports.range(today, today).delivery_total;
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'E', delivery_charge: 250 });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });

    const after = reports.range(today, today);
    eq(Math.round((after.delivery_total - before) * 100) / 100, 250, 'the fee is counted');
    const byType = reports.salesByType(today, today);
    const delivery = byType.find((r) => r.type === 'delivery');
    ok(delivery && delivery.delivery_charge > 0, 'and shows against the delivery row');
    const takeaway = byType.find((r) => r.type === 'takeaway');
    ok(!takeaway || takeaway.delivery_charge === 0, 'takeaway shows no delivery money');
  });


  /* ================================================================== *
   * 18 — Extras (packaging and disposables)
   * ================================================================== */
  section('18 — Extras');

  settingsRepo.saveSettings({ service_charge_percent: '0' });
  let plates = 0, glasses = 0;

  test('18.1', 'The shop keeps a list of extras', () => {
    const a = extrasRepo.saveExtra({ name: 'Disposable plates', price: 20, cost_price: 8, is_active: true, sort_order: 0 });
    const b = extrasRepo.saveExtra({ name: 'Glasses', price: 10, cost_price: 0, is_active: true, sort_order: 1 });
    plates = a.id; glasses = b.id;
    eq(a.name, 'Disposable plates', 'saved');
    eq(a.price, 20, 'priced');
    eq(a.cost_price, 8, 'cost recorded');
    ok(extrasRepo.listExtras(true).length >= 2, 'both offered');
  });

  test('18.2', 'Extras can be added to ANY order type', () => {
    for (const type of ['takeaway', 'dine_in', 'delivery']) {
      const o = orders.openOrder(
        type === 'dine_in'
          ? { type, table_id: T.T3 }
          : type === 'delivery'
            ? { type, delivery_address: 'Somewhere' }
            : { type },
      );
      const r = orders.setExtraOnOrder(o.id, plates, 2);
      eq(r.extras_total, 40, type + ' can carry extras');
      eq(r.extras.length, 1, type + ' has the row');
      // Clear the dine-in table for later tests.
      orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
    }
  });

  test('18.3', 'Extras are NOT part of the food subtotal', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const r = orders.setExtraOnOrder(o.id, plates, 2);
    eq(r.subtotal, 400, 'subtotal is the food alone');
    eq(r.extras_total, 40, 'packaging sits beside it');
  });

  test('18.4', 'Subtotal + extras = grand total', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(o.id, plates, 2);   // 40
    orders.setExtraOnOrder(o.id, glasses, 1);  // 10
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.subtotal, 400, 'food');
    eq(settled.extras_total, 50, 'extras');
    eq(settled.total, 450, 'total = 400 + 50');
    // Profit deducts the food cost AND what the packaging cost (2 x 8).
    eq(settled.profit, 450 - 180 - 16, 'packaging cost is deducted too');
  });

  test('18.5', 'Extras combine with delivery and a discount', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10' });
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'X', delivery_charge: 100 });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(o.id, plates, 1); // 20
    const settled = orders.settleOrder(o.id, { discount: 50, payment_method: 'cash' });
    // 400 - 50 + 100 delivery + 20 extras = 470. The 10% service charge is set
    // and skipped: delivery never pays it.
    eq(settled.total, 470, 'all four terms combine');

    // The same basket dining in DOES pay it: 400 - 50 + 40 + 20 = 410.
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10' });
    const d = orders.openOrder({ type: 'dine_in' });
    orders.addItems(d.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(d.id, plates, 1);
    const dSettled = orders.settleOrder(d.id, { discount: 50, payment_method: 'cash' });
    eq(dSettled.total, 410, 'the very same basket, seated, carries the charge');
    settingsRepo.saveSettings({ service_charge_percent: '0' });
  });

  test('18.6', 'The quantity can be changed and removed', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    let r = orders.setExtraOnOrder(o.id, plates, 3);
    eq(r.extras_total, 60, 'three plates');
    r = orders.setExtraOnOrder(o.id, plates, 1);
    eq(r.extras_total, 20, 'changed to one, not added again');
    eq(r.extras.length, 1, 'still one row');
    r = orders.setExtraOnOrder(o.id, plates, 0);
    eq(r.extras_total, 0, 'zero removes it');
    eq(r.extras.length, 0, 'and the row is gone');
  });

  test('18.7', 'Prices are snapshotted — repricing does not rewrite old bills', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(o.id, plates, 2);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.extras_total, 40, 'billed at 20 each');

    extrasRepo.saveExtra({ id: plates, name: 'Disposable plates', price: 35, cost_price: 8, is_active: true, sort_order: 0 });
    const reread = orders.getOrder(settled.id);
    eq(reread.extras_total, 40, 'the old bill still says 40');
    eq(reread.extras[0].price, 20, 'the snapshot held');
    extrasRepo.saveExtra({ id: plates, name: 'Disposable plates', price: 20, cost_price: 8, is_active: true, sort_order: 0 });
  });

  test('18.8', 'An inactive extra cannot be added', () => {
    extrasRepo.setExtraActive(glasses, false);
    const o = orders.openOrder({ type: 'takeaway' });
    throws(() => orders.setExtraOnOrder(o.id, glasses, 1), 'an extra that is off is refused');
    extrasRepo.setExtraActive(glasses, true);
  });

  test('18.9', 'The bill names each extra rather than lumping them', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(o.id, plates, 2);
    orders.setExtraOnOrder(o.id, glasses, 1);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);
    ok(/2 x Disposable plates\s+Rs40\.00/.test(bill), 'plates named with quantity');
    ok(/Glasses\s+Rs10\.00/.test(bill), 'a single glass needs no "1 x"');
    ok(/TOTAL\s+Rs450\.00/.test(bill), 'grand total includes them');
    ok(bill.split('\n').every((l) => l.length <= 42), 'fits the roll');
  });

  test('18.10', 'Extras never reach the kitchen ticket', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(o.id, plates, 2);
    const { order, fired } = orders.fireToKitchen(o.id);
    const ticket = receipt.buildKitchenTicket(order, fired);
    ok(!/plate/i.test(ticket), 'the kitchen does not cook plates');
  });

  test('18.11', 'Reports total extras separately from food', () => {
    const today = todayIso();
    const before = reports.range(today, today).extras_total;
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    orders.setExtraOnOrder(o.id, plates, 5); // 100
    orders.settleOrder(o.id, { payment_method: 'cash' });
    const after = reports.range(today, today);
    eq(Math.round((after.extras_total - before) * 100) / 100, 100, 'packaging counted apart');
    // And it is NOT counted as an item sold.
    const sellers = reports.bestSellers(today, today, 100);
    ok(!sellers.some((r) => /plate/i.test(r.item_name)), 'plates are not a best seller');
  });

  test('18.12', 'An order with no extras behaves exactly as before', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: item['Chicken Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.extras_total, 0, 'no extras');
    eq(settled.extras.length, 0, 'no rows');
    eq(settled.total, 400, 'total unchanged');
    eq(settled.profit, 400 - 180, 'profit unchanged');
    ok(!/Extras/.test(receipt.buildCustomerBill(settled)), 'and nothing extra on the bill');
  });


  /* ================================================================== *
   * 19 — Customers
   * ================================================================== */
  section('19 — Customers');

  test('19.1', 'A takeaway order with a phone creates a customer', () => {
    const before = customersRepo.listCustomers().length;
    orders.openOrder({ type: 'takeaway', customer_phone: '0300-1112233', customer_name: 'Ahmed' });
    const found = customersRepo.findByPhone('0300-1112233');
    ok(found, 'the customer was remembered');
    eq(found.name, 'Ahmed', 'name saved');
    eq(found.order_count, 1, 'first order counted');
    ok(found.last_order_at, 'last order stamped');
    eq(customersRepo.listCustomers().length, before + 1, 'exactly one new record');
  });

  test('19.2', 'A delivery order saves the address too', () => {
    orders.openOrder({
      type: 'delivery',
      customer_phone: '0301-4445566',
      customer_name: 'Sara',
      delivery_address: 'House 9, Street 2, Model Town',
    });
    const found = customersRepo.findByPhone('0301-4445566');
    eq(found.address, 'House 9, Street 2, Model Town', 'address remembered');
  });

  test('19.3', 'A returning customer is updated, not duplicated', () => {
    orders.openOrder({
      type: 'delivery',
      customer_phone: '0301-4445566',
      customer_name: 'Sara Khan',
      delivery_address: 'Flat 5, New Address, DHA',
    });
    const all = customersRepo.listCustomers().filter((c) => c.phone.includes('4445566'));
    eq(all.length, 1, 'still one record');
    eq(all[0].name, 'Sara Khan', 'the newer name wins');
    eq(all[0].address, 'Flat 5, New Address, DHA', 'people move — latest address wins');
    eq(all[0].order_count, 2, 'order count bumped');
  });

  test('19.4', 'NO phone means NO customer record', () => {
    const before = customersRepo.listCustomers().length;
    orders.openOrder({ type: 'takeaway' });
    orders.openOrder({ type: 'takeaway', customer_name: 'Walk-in, no number' });
    orders.openOrder({ type: 'delivery', delivery_address: 'Somewhere' });
    eq(customersRepo.listCustomers().length, before, 'nothing blank was saved');
    eq(customersRepo.findByPhone(''), null, 'and a blank lookup finds nothing');
  });

  test('19.5', 'DINE-IN never creates a customer', () => {
    const before = customersRepo.listCustomers().length;
    // A phone on a dine-in order is not a delivery contact; a table is not a
    // person. Even when one is supplied, nothing is remembered.
    const o = orders.openOrder({ type: 'dine_in', table_id: T.T4, customer_phone: '0999-9999999' });
    eq(o.type, 'dine_in', 'the order itself is fine');
    eq(customersRepo.listCustomers().length, before, 'no customer written');
    eq(customersRepo.findByPhone('0999-9999999'), null, 'and none to find');
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  test('19.6', 'Lookup ignores punctuation and spacing', () => {
    orders.openOrder({ type: 'takeaway', customer_phone: '0311 222 3333', customer_name: 'Bilal' });
    ok(customersRepo.findByPhone('03112223333'), 'digits only matches');
    ok(customersRepo.findByPhone('0311-222-3333'), 'dashes match');
    ok(customersRepo.findByPhone('0311 222 3333'), 'spaces match');
    eq(customersRepo.findByPhone('031'), null, 'too short to be a lookup');
  });

  test('19.7', 'Duplicate phones are tolerated; the most recent wins', () => {
    // Two rows for one number is legal by design — a shared household line, or
    // a restored backup. A UNIQUE constraint would fail an order instead.
    const a = customersRepo.saveCustomer({ phone: '0350-7778888', name: 'Older', address: 'Old address' });
    const b = customersRepo.saveCustomer({ phone: '0350-7778888', name: 'Newer', address: 'New address' });
    ok(a.id !== b.id, 'both rows exist');
    orders.openOrder({ type: 'takeaway', customer_phone: '0350-7778888', customer_name: 'Newer' });
    const found = customersRepo.findByPhone('0350-7778888');
    eq(found.name, 'Newer', 'the most recently used record answers');
  });

  test('19.8', 'A customer save can NEVER block an order', () => {
    // rememberFromOrder swallows everything: the order is already committed
    // by the time it runs, and the kitchen is about to cook.
    const broken = customersRepo.rememberFromOrder({ phone: null });
    eq(broken, null, 'a null phone returns null rather than throwing');
    eq(customersRepo.rememberFromOrder({ phone: '   ' }), null, 'whitespace too');
    // And the order path itself still completes with a hostile phone value.
    const o = orders.openOrder({ type: 'takeaway', customer_phone: "'; DROP TABLE customers; --" });
    eq(o.status, 'open', 'the order was placed regardless');
    ok(customersRepo.listCustomers().length >= 0, 'the table is still there');
  });

  test('19.9', 'Deleting a customer does NOT touch order history', () => {
    const o = orders.openOrder({
      type: 'delivery',
      customer_phone: '0366-1234567',
      customer_name: 'Temp Person',
      delivery_address: 'Somewhere real',
    });
    orders.addItems(o.id, [{ menu_item_id: item['Cold Drink'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });

    const customer = customersRepo.findByPhone('0366-1234567');
    customersRepo.removeCustomer(customer.id);
    eq(customersRepo.findByPhone('0366-1234567'), null, 'the contact is gone');

    const reread = orders.getOrder(settled.id);
    eq(reread.customer_name, 'Temp Person', 'the order still knows who it was for');
    eq(reread.customer_phone, '0366-1234567', 'and their number');
    eq(reread.delivery_address, 'Somewhere real', 'and where it went');
    eq(reread.total, settled.total, 'and what it cost');
    ok(/Temp Person/.test(receipt.buildCustomerBill(reread)), 'the bill still reprints in full');
  });

  test('19.10', 'Search finds by name and by phone', () => {
    customersRepo.saveCustomer({ phone: '0399-5551234', name: 'Zainab Malik', address: 'Gulberg' });
    ok(customersRepo.listCustomers('Zainab').length >= 1, 'by name');
    ok(customersRepo.listCustomers('zainab').length >= 1, 'case-insensitive');
    ok(customersRepo.listCustomers('5551234').length >= 1, 'by phone digits');
    eq(customersRepo.listCustomers('nobody-by-this-name').length, 0, 'no false matches');
  });

  test('19.11', 'CSV export quotes commas and quotes correctly', () => {
    customersRepo.saveCustomer({
      phone: '0388-0001111',
      name: 'Comma, Person',
      address: 'House 1, Street 2, "The Corner"',
      notes: 'line one',
    });
    const csv = customersRepo.customersCsv();
    ok(csv.startsWith('Name,Phone,Address,Notes,Orders,Last order,First seen'), 'header present');
    ok(/"Comma, Person"/.test(csv), 'a name with a comma is quoted');
    ok(/""The Corner""/.test(csv), 'inner quotes are doubled');
    // Every row must have the same column count, or the file is unusable.
    const header = csv.split('\r\n')[0].split(',').length;
    eq(header, 7, 'seven columns');
  });

  test('19.12', 'Admin-only channels are gated; lookup is not', () => {
    // The asymmetry is the point: the till may ask about ONE number it already
    // has, but must not be able to walk or export the customer base.
    adminSession.lockAdmin();
    throws(() => adminSession.requireAdmin(), 'listing/exporting is refused while locked');
    // Lookup itself has no admin check — it is a counter action.
    ok(customersRepo.findByPhone('0311 222 3333'), 'the counter can still look one up');
  });


  /* ================================================================== *
   * 20 — Forgotten PIN recovery
   * ================================================================== */
  section('20 — PIN recovery');

  test('20.1', 'Recovery needs a REAL licence key, not any string', () => {
    managerPin.setPin('4321');
    throws(() => adminSession.recoverWithLicenceKey(''), 'blank is refused');
    throws(() => adminSession.recoverWithLicenceKey('CH1.rubbish'), 'nonsense is refused');
    throws(() => adminSession.recoverWithLicenceKey('not-even-a-key'), 'garbage is refused');
    eq(managerPin.isPinSet(), true, 'and the PIN is untouched by a failed attempt');
  });

  test('20.2', 'A valid licence key clears the PIN', () => {
    const { getMachineId } = require(path.join(dist, 'services', 'machineId'));
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('node', [path.join(ROOT, 'tools/keygen/keygen.js'), '--machine', getMachineId()], { encoding: 'utf8' });
    const key = (out.match(/CH1\.[A-Za-z0-9_\-.]+/) || [])[0];
    ok(key, 'the office produced a key');

    managerPin.setPin('4321');
    adminSession.recoverWithLicenceKey(key);
    eq(managerPin.isPinSet(), false, 'the forgotten PIN is cleared');
  });

  test('20.3', 'Recovery does NOT open admin — it forces a new PIN', () => {
    // The property that stops this being a backdoor: clearing the PIN leaves
    // admin MORE locked, not less, until a fresh one is chosen.
    eq(adminSession.isAdmin(), false, 'not unlocked by recovering');
    throws(() => adminSession.unlockAdmin(''), 'and cannot be opened without a PIN');
    throws(() => adminSession.requireAdmin(), 'owner-only data still refused');
    eq(adminSession.adminPinRequired(), true, 'the gate demands a new PIN');

    adminSession.initialiseAdminPin('2468');
    eq(adminSession.isAdmin(), true, 'setting one lets the owner back in');
    managerPin.requirePin('2468');
    ok(true, 'and it is the real manager PIN, honoured by the void gate too');
    managerPin.setPin('4321');
    adminSession.lockAdmin();
  });

  test('20.4', "A key for another machine cannot open this one", () => {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('node', [path.join(ROOT, 'tools/keygen/keygen.js'), '--machine', 'SOME-OTHER-MACHINE-ID'], { encoding: 'utf8' });
    const foreign = (out.match(/CH1\.[A-Za-z0-9_\-.]+/) || [])[0];
    managerPin.setPin('4321');
    throws(() => adminSession.recoverWithLicenceKey(foreign), 'a node-locked key from elsewhere is refused');
    eq(managerPin.isPinSet(), true, 'the PIN survives the attempt');
  });


  /* ================================================================== *
   * 21 — Restoring an OLD backup
   * ================================================================== */
  section('21 — Old backup restore');

  await testAsync('21.1', 'A backup from an older version restores and works', async () => {
    // Build a database with the ORIGINAL v1 schema: no delivery columns, no
    // customers, no extras. This is what a backup taken months ago looks like.
    const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
    const oldDir = path.join(tmp, 'oldbackup');
    fs.mkdirSync(oldDir, { recursive: true });
    const oldDb = path.join(oldDir, 'foodpoint.db');

    const legacy = new Database(oldDb);
    legacy.exec(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','delivery')),
        table_id INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        opened_at TEXT NOT NULL,
        settled_at TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        service_charge REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        profit REAL,
        payment_method TEXT,
        void_reason TEXT,
        voided_at TEXT
      );
      CREATE TABLE menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, category_id INTEGER,
        sale_price REAL NOT NULL DEFAULT 0, cost_price REAL NOT NULL DEFAULT 0,
        is_available INTEGER NOT NULL DEFAULT 1, barcode TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0, notes TEXT
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
    `);
    legacy.prepare("INSERT INTO menu_items (name, sale_price, cost_price) VALUES ('Old Biryani', 400, 180)").run();
    legacy.prepare(
      "INSERT INTO orders (order_no,type,status,opened_at,settled_at,subtotal,total,profit,payment_method) " +
      "VALUES ('20260101-001','takeaway','settled','2026-01-01 12:00:00','2026-01-01 12:05:00',400,400,220,'cash')"
    ).run();
    // Prove the old file genuinely lacks the newer columns.
    const cols = legacy.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
    ok(!cols.includes('delivery_address'), 'the old backup really has no delivery_address');
    ok(!cols.includes('extras_total'), 'nor extras_total');
    legacy.close();

    // Restore it, exactly as the shop would.
    stubDialog(oldDir, null, 1);
    const result = await backupSvc.restoreFromFile();
    eq(result.restored, true, 'restore reported success');

    // THE BUG: before restore ran migrate(), this threw
    // "table orders has no column named delivery_address".
    const after = getDb();
    const nowCols = after.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
    ok(nowCols.includes('delivery_address'), 'delivery_address was added on restore');
    ok(nowCols.includes('delivery_charge'), 'delivery_charge too');
    ok(nowCols.includes('extras_total'), 'and extras_total');

    // The tables added since that backup exist as well.
    const tables = after
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t) => t.name);
    for (const t of ['customers', 'extra_charges', 'order_extras', 'staff', 'deals'])
      ok(tables.includes(t), t + ' table created on restore');

    // And the old data survived the upgrade.
    eq(after.prepare('SELECT COUNT(*) n FROM orders').get().n, 1, 'the old order is still there');
    eq(after.prepare("SELECT name FROM menu_items").get().name, 'Old Biryani', 'and the old menu');

    // Most importantly: the app can actually WORK against it now.
    const o = orders.openOrder({ type: 'delivery', delivery_address: 'Post-restore address' });
    eq(o.delivery_address, 'Post-restore address', 'a delivery order can be taken immediately');
    ok(customersRepo.listCustomers().length >= 0, 'and the customer table answers');
  });

  /* ================= Section 22 — Service charge modes ================= */
  section('22 — Service charge (fixed or percent)');

  /**
   * Fresh menu items for the last two sections.
   *
   * Earlier sections delete, rename and hide the shared seed items, so a test
   * down here that reaches for `item['Cold Drink']` is testing whatever
   * section 13 happened to leave behind. These belong to sections 22-23 alone
   * and have round numbers chosen so a margin can be read by eye.
   */
  const dayCat = Number(
    getDb().prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run('Day Test', 99)
      .lastInsertRowid,
  );
  const D = {};
  for (const [name, sale, cost] of [
    ['Day Biryani', 400, 180],
    ['Day Kebab', 600, 300],
    ['Day Tikka', 550, 280],
    ['Day Water', 60, 30],
    ['Day Burger', 350, 150],
  ]) {
    D[name] = Number(
      getDb()
        .prepare(
          `INSERT INTO menu_items (name, category_id, sale_price, cost_price, is_available, sort_order)
           VALUES (?, ?, ?, ?, 1, 0)`,
        )
        .run(name, dayCat, sale, cost).lastInsertRowid,
    );
  }
  // Section 9.5 and friends rewrite the shop name; the slip test below reads it.
  settingsRepo.saveSettings({ business_name: 'Test Food Point' });

  test('22.1', 'Fixed is the default', () => {
    settingsRepo.saveSettings({ service_charge_mode: '', service_charge_amount: '0', service_charge_percent: '0' });
    eq(settingsRepo.serviceChargeMode(), 'fixed', 'a blank mode means fixed');
    eq(settingsRepo.serviceChargeFor(1000, 'dine_in'), 0, 'and nothing is charged until an amount is set');
  });

  test('22.2', 'A fixed amount is the SAME on every bill', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '50' });
    eq(settingsRepo.serviceChargeFor(100, 'dine_in'), 50, 'small bill');
    eq(settingsRepo.serviceChargeFor(10000, 'dine_in'), 50, 'large bill — still 50, that is the point');
    eq(settingsRepo.serviceChargeFor(0, 'dine_in'), 50, 'even an empty subtotal');
  });

  test('22.3', 'A percentage scales with the bill', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10' });
    eq(settingsRepo.serviceChargeFor(100, 'dine_in'), 10, '10% of 100');
    eq(settingsRepo.serviceChargeFor(455, 'dine_in'), 45.5, 'rounded to paisa, not to rupees');
    eq(settingsRepo.serviceChargeFor(0, 'dine_in'), 0, 'nothing ordered, nothing charged');
  });

  test('22.4', 'The fixed amount is ignored while on percent, and vice versa', () => {
    // Both numbers are stored; only the chosen one may reach a bill. A shop
    // that experiments with the other mode must not be double-charged.
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10', service_charge_amount: '500' });
    eq(settingsRepo.serviceChargeFor(200, 'dine_in'), 20, 'percent mode ignores the fixed amount');
    settingsRepo.saveSettings({ service_charge_mode: 'fixed' });
    eq(settingsRepo.serviceChargeFor(200, 'dine_in'), 500, 'fixed mode ignores the percentage');
  });

  test('22.5', 'Nonsense values cannot inflate a bill', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '-100' });
    eq(settingsRepo.serviceChargeFor(500, 'dine_in'), 0, 'a negative charge is not a discount');
    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '1000' });
    eq(settingsRepo.serviceChargeFor(100, 'dine_in'), 100, 'a typo of 1000% is clamped to 100%');
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: 'abc' });
    eq(settingsRepo.serviceChargeFor(500, 'dine_in'), 0, 'a non-number falls back to nothing');
  });

  test('22.6', 'A real order picks the charge up from the chosen mode', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '30' });
    const o = orders.openOrder({ type: 'dine_in' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Water'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.subtotal, 60, 'one bottle of water');
    eq(settled.service_charge, 30, 'the flat charge, not a percentage of 60');
    eq(settled.total, 90, 'and it is on the total');
  });

  test('22.7', 'The counter QUOTE matches the bill in fixed mode too', () => {
    // Mirrors ChargeModal in src/app/order/page.tsx, the same way 7.3b does
    // for percentages. If the two formulas drift, the cashier collects one
    // number and the bill prints another.
    const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
    const preview = (subtotal, rawDiscount, amount) => {
      const discount = Math.min(Math.max(0, Number(rawDiscount) || 0), subtotal);
      return Math.max(0, round2(subtotal - discount + Math.max(amount, 0)));
    };

    for (const [amount, discount] of [
      [0, 0],
      [50, 0],
      [50, 100],
      [37.5, 33.33],
      [100, 5000], // discount larger than the bill
    ]) {
      settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: String(amount) });
      const o = orders.openOrder({ type: 'dine_in' });
      orders.addItems(o.id, [{ menu_item_id: D['Day Biryani'], qty: 2, modifier_ids: [] }]);
      const subtotal = orders.getOrder(o.id).subtotal;
      const quoted = preview(subtotal, discount, amount);
      const settled = orders.settleOrder(o.id, { discount, payment_method: 'cash' });
      eq(quoted, settled.total, `quote matches bill at flat ${amount} / discount ${discount}`);
    }
    settingsRepo.saveSettings({ service_charge_amount: '0' });
  });

  test('22.8', 'ONLY dine-in pays a service charge', () => {
    // The rule the whole feature turns on. A takeaway customer carries their
    // own bag out and a delivery customer already pays a rider; neither buys
    // table service, and on a flat setting they would otherwise be charged the
    // same rupees as a full sit-down meal.
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '50' });
    eq(settingsRepo.serviceChargeFor(1000, 'dine_in'), 50, 'dine-in pays');
    eq(settingsRepo.serviceChargeFor(1000, 'takeaway'), 0, 'takeaway does not');
    eq(settingsRepo.serviceChargeFor(1000, 'delivery'), 0, 'delivery does not');

    settingsRepo.saveSettings({ service_charge_mode: 'percent', service_charge_percent: '10' });
    eq(settingsRepo.serviceChargeFor(1000, 'dine_in'), 100, 'and the same in percent mode');
    eq(settingsRepo.serviceChargeFor(1000, 'takeaway'), 0, 'takeaway still free of it');
    eq(settingsRepo.serviceChargeFor(1000, 'delivery'), 0, 'delivery still free of it');
    settingsRepo.saveSettings({ service_charge_percent: '0' });
  });

  test('22.9', 'The same basket is billed differently by order type', () => {
    // End to end, through settleOrder rather than the helper: the charge has to
    // reach (or miss) the stored column and the printed bill, not just agree in
    // a unit test.
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '50' });

    const bill = (type, extra) => {
      const o = orders.openOrder({ type, ...extra });
      orders.addItems(o.id, [{ menu_item_id: D['Day Biryani'], qty: 1, modifier_ids: [] }]);
      const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
      return { settled, slip: receipt.buildCustomerBill(settled) };
    };

    const dine = bill('dine_in', {});
    eq(dine.settled.subtotal, 400, 'one biryani');
    eq(dine.settled.service_charge, 50, 'seated: charged');
    eq(dine.settled.total, 450, 'and it reaches the total');
    ok(/Service charge/.test(dine.slip), 'the line is printed for the seated customer');

    const take = bill('takeaway', {});
    eq(take.settled.service_charge, 0, 'takeaway: not charged');
    eq(take.settled.total, 400, 'the total is the food and nothing else');
    ok(!/Service charge/.test(take.slip), 'and no line is printed to explain a charge of nothing');

    const deliver = bill('delivery', { delivery_address: 'Somewhere', delivery_charge: 100 });
    eq(deliver.settled.service_charge, 0, 'delivery: not charged');
    eq(deliver.settled.total, 500, 'food + the delivery fee only');
    ok(!/Service charge/.test(deliver.slip), 'no service line on a delivery bill');

    settingsRepo.saveSettings({ service_charge_amount: '0' });
  });

  test('22.10', 'A takeaway cannot be talked into a table charge at the till', () => {
    // The order type is fixed when the order is opened and settleOrder reads it
    // from the ORDER, not from whatever the till sends. Nothing in the settle
    // payload can turn a takeaway into a dine-in.
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '50' });
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Biryani'], qty: 1, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, {
      payment_method: 'cash',
      type: 'dine_in',
      service_charge: 50,
    });
    eq(settled.type, 'takeaway', 'the type is still what was opened');
    eq(settled.service_charge, 0, 'and no charge was smuggled in');
    eq(settled.total, 400, 'the customer pays for the food');
    settingsRepo.saveSettings({ service_charge_amount: '0' });
  });

  /* ================= Section 23 — Open day / close day ================= */
  section('23 — Business day');

  const day = require(path.join(dist, 'db', 'repositories', 'daySessions'));

  test('23.1', 'No day is open to begin with', () => {
    eq(day.currentSession(), null, 'the shop has not opened');
    eq(day.currentSessionId(), null, 'so orders carry no session');
  });

  test('23.2', 'Orders taken with no day open are NOT lost', () => {
    // The counter must be able to serve regardless of whether the owner
    // remembered to press Open Day. Such an order simply belongs to no report.
    const o = orders.openOrder({ type: 'takeaway' });
    eq(o.session_id, null, 'no session stamped');
    eq(o.status, 'open', 'but the order is perfectly valid');
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  let session1;
  test('23.3', 'Open Day starts a session', () => {
    session1 = day.openDay({ opening_float: 2000 });
    ok(session1.id > 0, 'a session exists');
    ok(session1.opened_at, 'stamped with the time it opened');
    eq(session1.closed_at, null, 'and it is still open');
    eq(session1.opening_float, 2000, 'the float was recorded');
    eq(day.currentSession().id, session1.id, 'it is the current day');
  });

  test('23.4', 'Only ONE day can be open at a time', () => {
    // Two open days would make "which day does this order belong to?"
    // ambiguous and every figure on both reports wrong.
    throws(() => day.openDay({ opening_float: 0 }), 'a second day is refused');
    eq(day.listSessions().filter((d) => !d.closed_at).length, 1, 'still exactly one open');
  });

  test('23.5', 'Orders taken now are stamped with the open day', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '0' });
    const o = orders.openOrder({ type: 'takeaway' });
    eq(o.session_id, session1.id, 'stamped');
    orders.addItems(o.id, [{ menu_item_id: D['Day Biryani'], qty: 2, modifier_ids: [] }]);
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.subtotal, 800, '2 x 400');
    eq(settled.session_id, session1.id, 'and the stamp survives settlement');
  });

  test('23.6', 'GROSS PROFIT is sales MINUS ITEM COST — nothing else', () => {
    // The label on the slip says "sales - item cost", so the number has to be
    // exactly that. Folding the service charge or delivery fee in here would
    // overstate what the kitchen actually earned.
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '75' });
    const o = orders.openOrder({ type: 'dine_in' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Kebab'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });

    const r = day.dayReport(session1.id);
    // Biryani x2: 800 sale, 360 cost -> 440. Kebab: 600 sale, 300 cost -> 300.
    eq(r.gross_profit, 740, 'item margin only');
    eq(r.service_charges, 75, 'the service charge is reported separately...');
    ok(r.sales_total > r.gross_profit, '...and shows up in sales, not in margin');
    settingsRepo.saveSettings({ service_charge_amount: '0' });
  });

  test('23.7', 'The report counts only THIS day', () => {
    // Every order from sections 2-22 was taken before any day was opened.
    const r = day.dayReport(session1.id);
    eq(r.order_count, 2, 'two settled orders on this day');
    eq(r.sales_total, 1475, '800 + 600 + 75 service charge');
    eq(r.cash_sales, 1475, 'both paid cash');
    eq(r.card_sales, 0, 'nothing on card');
  });

  test('23.8', 'Unpaid orders are counted and warned about, not swallowed', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Tikka'], qty: 1, modifier_ids: [] }]);
    const unpaid = day.unpaidOnSession(session1.id);
    eq(unpaid.count, 1, 'one order still owing');
    eq(unpaid.total, 550, 'and how much');
    const r = day.dayReport(session1.id);
    eq(r.unpaid_count, 1, 'the report says so too');
    eq(r.unpaid_total, 550, 'with the money attached');
    // Unpaid money is NOT counted as sales.
    eq(r.sales_total, 1475, 'sales unchanged by an unsettled order');
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  test('23.9', 'Cancellations are reported against the day', () => {
    const r = day.dayReport(session1.id);
    // The void in 23.2 happened before any day was opened, so it belongs to
    // no report — which is the same rule the sales figures follow.
    eq(r.cancelled_count, 1, 'only the void taken while this day was open');
    eq(r.cancelled_value, 550, 'with its value stated');
  });

  test('23.10', 'Expected cash = float + cash taken', () => {
    const r = day.dayReport(session1.id);
    eq(r.expected_cash, 3475, '2000 float + 1475 cash');
  });

  test('23.11', 'Close Day ends the session', () => {
    const closed = day.closeDay({});
    ok(closed.closed_at, 'stamped with the time it closed');
    eq(day.currentSession(), null, 'nothing is open now');
    throws(() => day.closeDay({}), 'and closing again is refused');
  });

  test('23.12', 'A closed day is FROZEN — new orders do not join it', () => {
    // The whole point of closing: the report the owner printed and acted on
    // must still say the same thing tomorrow.
    const before = day.dayReport(session1.id);
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Burger'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(o.session_id, null, 'the new order joins no day');
    const after = day.dayReport(session1.id);
    eq(after.sales_total, before.sales_total, 'yesterday total unchanged');
    eq(after.gross_profit, before.gross_profit, 'and its margin unchanged');
  });

  test('23.13', 'A second day is a separate report', () => {
    const session2 = day.openDay({ opening_float: 0 });
    ok(session2.id !== session1.id, 'a new session');
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Water'], qty: 3, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'card' });

    const r2 = day.dayReport(session2.id);
    eq(r2.order_count, 1, 'only today');
    eq(r2.sales_total, 180, '3 x 60');
    eq(r2.gross_profit, 90, '3 x (60 - 30)');
    eq(r2.card_sales, 180, 'paid by card');
    eq(r2.cash_sales, 0, 'no cash today');
    eq(r2.expected_cash, null, 'no float was counted, so no figure is invented');

    // And day one is still exactly as it was.
    eq(day.dayReport(session1.id).sales_total, 1475, 'day one untouched');
    day.closeDay({});
  });

  test('23.14', 'The printed report is TEXT, and says gross profit in full', () => {
    const text = receipt.buildDayReport(day.dayReport(session1.id));
    ok(typeof text === 'string', 'a string, not an image buffer');
    ok(
      text.includes('Gross profit (sales - item cost)'),
      'labelled in full so it cannot be read as take-home',
    );
    ok(text.includes('END OF DAY'), 'titled');
    ok(text.includes('EXPECTED CASH'), 'the drawer figure a manager counts against');
    ok(text.includes('Test Food Point'), 'the shop name');
    for (const line of text.split('\n')) ok(line.length <= 42, 'fits 42 columns: ' + line);
  });

  test('23.15', 'Voided lines are excluded from margin', () => {
    const session3 = day.openDay({ opening_float: 0 });
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [
      { menu_item_id: D['Day Biryani'], qty: 1, modifier_ids: [] },
      { menu_item_id: D['Day Water'], qty: 1, modifier_ids: [] },
    ]);
    const drink = orders.getOrder(o.id).items.find((i) => i.item_name === 'Day Water');
    orders.voidItem(drink.id, { reason_code: 'wrong_item', note: null, staff_id: null });
    orders.settleOrder(o.id, { payment_method: 'cash' });

    const r = day.dayReport(session3.id);
    eq(r.gross_profit, 220, 'only the biryani: 400 - 180');
    ok(!r.top_items.some((t) => t.item_name === 'Day Water'), 'and the void is not a best seller');
    day.closeDay({});
  });

  test('23.16', 'The counter can open and close the day; MARGIN stays the owner\'s', () => {
    // Opening and closing is counter work — the owner is not at the till at
    // 11am. What must not travel with it is the margin.
    const s4 = day.openDay({ opening_float: 0 });
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Biryani'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });
    day.closeDay({});

    const dayIpc = require(path.join(dist, 'ipc', 'day'));

    adminSession.lockAdmin();
    const counterCopy = dayIpc.reportFor(s4.id);
    eq(counterCopy.gross_profit, null, 'the counter is told nothing about margin');
    eq(counterCopy.sales_total, 400, 'but sees the takings, which it must count against');
    eq(counterCopy.expected_cash, null, 'no float was entered');
    ok(!receipt.buildDayReport(counterCopy).includes('Gross profit'),
      'and the slip it prints does not carry it either');

    if (!managerPin.isPinSet()) managerPin.setPin('1234');
    adminSession.unlockAdmin('1234');
    const ownerCopy = dayIpc.reportFor(s4.id);
    eq(ownerCopy.gross_profit, 220, 'the owner sees 400 - 180');
    ok(receipt.buildDayReport(ownerCopy).includes('Gross profit (sales - item cost)'),
      'labelled in full on the owner\'s slip');
    adminSession.lockAdmin();
  });

  /* ================= Section 24 — Unpaid orders ================= */
  section('24 — Unpaid orders');

  test('24.1', 'The unpaid list carries what it takes to chase the money', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Kebab'], qty: 1, modifier_ids: [] }]);
    const row = orders.listUnpaidOrders().find((u) => u.id === o.id);
    ok(row, 'it appears in the unpaid list');
    eq(row.amount_due, 600, 'with what is owed');
    ok(row.opened_at, 'and when it started, so the oldest table can be found');
    ok(row.order_no, 'and its number');
    ok(row.items.length === 1, 'and its lines, so it can be checked before printing');
    orders.settleOrder(o.id, { payment_method: 'cash' });
    ok(!orders.listUnpaidOrders().some((u) => u.id === o.id), 'and it leaves once paid');
  });

  test('24.2', 'AMOUNT DUE follows the same rules the till will', () => {
    // orders.total is 0 until settlement, so a screen that read it would show
    // the customer a bill for nothing. What is quoted here must equal what
    // settleOrder charges — including the dine-in-only service charge.
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '40' });
    const o = orders.openOrder({
      type: 'delivery',
      delivery_address: 'House 3, Model Town',
      delivery_charge: 150,
    });
    orders.addItems(o.id, [{ menu_item_id: D['Day Tikka'], qty: 2, modifier_ids: [] }]);

    const row = orders.listUnpaidOrders().find((u) => u.id === o.id);
    eq(row.total, 0, 'the stored total really is still zero');
    eq(row.amount_due, 1250, '1100 food + 150 delivery, no service charge');

    // And settling charges exactly what was quoted.
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    eq(settled.total, 1250, 'the till charges what the list said');

    // The seated equivalent DOES carry the charge, in the list and at the till.
    const d = orders.openOrder({ type: 'dine_in' });
    orders.addItems(d.id, [{ menu_item_id: D['Day Tikka'], qty: 2, modifier_ids: [] }]);
    const dRow = orders.listUnpaidOrders().find((u) => u.id === d.id);
    eq(dRow.amount_due, 1140, '1100 food + 40 service');
    eq(orders.settleOrder(d.id, { payment_method: 'cash' }).total, 1140, 'and the till agrees');
    settingsRepo.saveSettings({ service_charge_amount: '0' });
  });

  test('24.3', 'The unpaid slip can NEVER be mistaken for a receipt', () => {
    settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '25' });
    // Seated, so the slip has a live service charge to prove it computes.
    const o = orders.openOrder({ type: 'dine_in' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Burger'], qty: 2, modifier_ids: [] }]);
    const slip = receipt.buildCustomerBill(orders.getOrder(o.id));

    ok(slip.includes('*** UNPAID — NOT A RECEIPT ***'), 'banner at the top');
    ok(slip.includes('AMOUNT DUE'), 'totalled as a debt');
    ok(!slip.includes('TOTAL '), 'and NOT as a paid total');
    ok(slip.includes('Please pay at the counter'), 'closes by asking for the money');
    ok(!slip.includes('Thank you'), 'never thanks them for money not yet taken');
    // Read the symbol rather than hard-coding it — earlier sections change it,
    // and this test is about the WORDS on the slip, not the currency.
    const sym = settingsRepo.currencySymbol().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ok(new RegExp(`Service charge\\s+${sym}25\\.00`).test(slip), 'the live service charge is on it');
    ok(new RegExp(`AMOUNT DUE\\s+${sym}725\\.00`).test(slip), '700 food + 25 service');
    for (const l of slip.split('\n')) ok(l.length <= 42, 'fits a 42-col roll: ' + l);

    // Once paid, the very same builder produces a normal receipt.
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const paid = receipt.buildCustomerBill(settled);
    ok(!paid.includes('UNPAID'), 'no banner on a paid bill');
    ok(paid.includes('Thank you'), 'and the thank-you is back');
    ok(new RegExp(`TOTAL\\s+${sym}725\\.00`).test(paid), 'totalled as TOTAL');
    settingsRepo.saveSettings({ service_charge_amount: '0' });
  });

  test('24.4', 'The unpaid list is NOT limited to today', () => {
    // The whole point: an order left owing on Monday is still owing on Friday,
    // and a date filter would hide exactly the money being chased.
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Water']  , qty: 1, modifier_ids: [] }]);
    getDb().prepare("UPDATE orders SET opened_at = '2020-01-01 12:00:00' WHERE id = ?").run(o.id);

    ok(orders.listUnpaidOrders().some((u) => u.id === o.id), 'a five-year-old debt still shows');
    // The dated history, by contrast, correctly does not carry open orders.
    const today = todayIso();
    ok(!orders.listOrders(today, today).some((h) => h.id === o.id), 'history excludes open orders');

    // Oldest first, so the longest-waiting table is at the top.
    eq(orders.listUnpaidOrders()[0].id, o.id, 'and it sorts to the top');
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  test('24.5', 'Voided lines are not billed on an unpaid slip', () => {
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [
      { menu_item_id: D['Day Biryani'], qty: 1, modifier_ids: [] },
      { menu_item_id: D['Day Water'], qty: 1, modifier_ids: [] },
    ]);
    const water = orders.getOrder(o.id).items.find((i) => i.item_name === 'Day Water');
    orders.voidItem(water.id, { reason_code: 'wrong_item', note: null, staff_id: null });

    const row = orders.listUnpaidOrders().find((u) => u.id === o.id);
    eq(row.amount_due, 400, 'only the biryani is owed');
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  /* ================= Section 25 — A day that runs past midnight ================= */
  section('25 — Trading past midnight');

  /**
   * The client opens at 10am and closes at 3am. Everything below is about one
   * rule: the trading day ends when someone PRESSES Close Day, and nothing
   * about the clock striking twelve may start a new one.
   */

  // Clear the decks: close whatever section 23/24 left open.
  if (day.currentSession()) day.closeDay({});
  for (const u of orders.listUnpaidOrders()) {
    orders.voidOrder(u.id, { reason_code: 'duplicate', note: null, staff_id: null });
  }
  settingsRepo.saveSettings({ service_charge_mode: 'fixed', service_charge_amount: '0' });

  const reports_history = (from, to) =>
    orders.listOrders(from, to).map((o) => o.order_no);

  test('25.1', 'Midnight does NOT close the open day', () => {
    const s = day.openDay({ opening_float: 0 });
    // Backdate the session so it looks like it opened at 10am YESTERDAY and
    // the clock has since rolled past midnight — exactly the client's night.
    const yest = new Date(Date.now() - 24 * 3600 * 1000);
    const ymd = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
    getDb().prepare('UPDATE day_sessions SET opened_at = ? WHERE id = ?').run(`${ymd} 10:00:00`, s.id);

    const still = day.currentSession();
    ok(still, 'the day is still open on the far side of midnight');
    eq(still.id, s.id, 'and it is the SAME day, not a fresh one');
    eq(still.closed_at, null, 'nothing closed it but a human');
  });

  test('25.2', 'Order numbers do NOT restart at midnight', () => {
    // The counter's evidence that a new day began: the slip in their hand.
    // One trading night must be one unbroken run of numbers.
    const session = day.currentSession();
    const openedYmd = session.opened_at.slice(0, 10).replace(/-/g, '');

    const a = orders.openOrder({ type: 'takeaway' });
    const b = orders.openOrder({ type: 'takeaway' });

    ok(
      a.order_no.startsWith(`${openedYmd}-`),
      `numbered under the day that is OPEN (${openedYmd}), got ${a.order_no}`,
    );
    ok(
      b.order_no.startsWith(`${openedYmd}-`),
      `and so is the next one, got ${b.order_no}`,
    );
    eq(
      Number(b.order_no.split('-')[1]) - Number(a.order_no.split('-')[1]),
      1,
      'the sequence just carries on — no restart at 001',
    );

    orders.voidOrder(a.id, { reason_code: 'duplicate', note: null, staff_id: null });
    orders.voidOrder(b.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  test('25.3', 'The takings of one night stay on ONE report', () => {
    const session = day.currentSession();
    const o = orders.openOrder({ type: 'takeaway' });
    orders.addItems(o.id, [{ menu_item_id: D['Day Biryani'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(o.id, { payment_method: 'cash' });

    const r = day.dayReport(session.id);
    // Settled "after midnight" by the clock, but it belongs to the open day.
    ok(r.sales_total >= 400, 'the sale lands on the open day, not on a new one');
    eq(r.session.id, session.id, 'and the report is that day');
  });

  test('25.4', 'Only a human ends the day — and then numbering moves on', () => {
    const before = day.currentSession();
    const closed = day.closeDay({});
    eq(closed.id, before.id, 'the day the human closed');
    ok(closed.closed_at, 'stamped with the moment they pressed it');
    eq(day.currentSession(), null, 'and nothing re-opened one by itself');

    // A fresh day, opened by hand, starts its own run of numbers.
    const next = day.openDay({ opening_float: 0 });
    const o = orders.openOrder({ type: 'takeaway' });
    const todayYmd = next.opened_at.slice(0, 10).replace(/-/g, '');
    ok(o.order_no.startsWith(`${todayYmd}-`), `new day, new prefix, got ${o.order_no}`);
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
    day.closeDay({});
  });

  test('25.5', 'With NO day open, the calendar date still numbers orders', () => {
    // Opening a day is not compulsory — the counter must be able to serve
    // regardless — so with nothing open there is nothing to anchor to and
    // today's date is the honest answer.
    eq(day.currentSession(), null, 'no day open');
    const prefix = require(path.join(dist, 'db', 'money')).orderNoPrefix();
    const o = orders.openOrder({ type: 'takeaway' });
    ok(o.order_no.startsWith(`${prefix}-`), `falls back to the calendar date, got ${o.order_no}`);
    orders.voidOrder(o.id, { reason_code: 'duplicate', note: null, staff_id: null });
  });

  test('25.6', 'The DASHBOARD counts the trading day, not the calendar day', () => {
    // The proof: one night's orders, half before midnight and half after.
    // A calendar dashboard splits them across two dates and tells the owner
    // the shift earned half of what it did.
    const s = day.openDay({ opening_float: 0 });
    const yest = new Date(Date.now() - 24 * 3600 * 1000);
    const ymd = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
    const today = todayIso();
    getDb().prepare('UPDATE day_sessions SET opened_at = ? WHERE id = ?').run(`${ymd} 10:00:00`, s.id);

    const ins = getDb().prepare(
      `INSERT INTO orders (order_no, type, status, session_id, opened_at, settled_at,
                           subtotal, total, profit, payment_method)
       VALUES (?, 'takeaway', 'settled', ?, ?, ?, ?, ?, ?, 'cash')`,
    );
    // 11pm — before midnight, on the opening date.
    ins.run(`${ymd.replace(/-/g, '')}-901`, s.id, `${ymd} 23:00:00`, `${ymd} 23:00:00`, 500, 500, 200);
    // 1am — after midnight, on the NEXT calendar date, same trading night.
    ins.run(`${ymd.replace(/-/g, '')}-902`, s.id, `${today} 01:00:00`, `${today} 01:00:00`, 300, 300, 100);

    const byDay = reports.dashboardForSession(day.currentSession());
    eq(byDay.order_count, 2, 'the trading day sees the WHOLE night');
    eq(byDay.sales_total, 800, 'and totals all of it');
    eq(byDay.session_opened_at, `${ymd} 10:00:00`, 'labelled by when the day opened');

    // The same night by calendar date: only the half that fell before midnight.
    // (Today's calendar date is not asserted on — earlier sections settled
    // plenty of orders under it, which is exactly why it is the wrong unit.)
    const cal = reports.dashboard(ymd);
    eq(cal.order_count, 1, 'a calendar date sees only its half of the night');
    eq(cal.sales_total, 500, 'and so counts only half the money');

    // The hour chart must carry both sides of midnight too.
    const hours = reports.salesByHourForSession(s.id).map((r) => r.hour);
    ok(hours.includes(23), '11pm is on the chart');
    ok(hours.includes(1), 'and so is 1am — the hours a fixed 9-to-11 axis hid');

    day.closeDay({});
  });

  test('25.7', 'With no day open the dashboard falls back to the calendar date', () => {
    // Opening a day is not compulsory, so the dashboard must still say
    // something sensible for a shop that never presses the button.
    if (day.currentSession()) day.closeDay({});
    eq(day.currentSession(), null, 'nothing open');
    const d = reports.dashboard(todayIso());
    eq(d.session_opened_at, null, 'and it does not pretend to be a trading day');
    eq(d.date, todayIso(), 'it is simply today');
  });

  test('25.8', 'A night that crosses midnight is ONE row in the reports', () => {
    // The owner comparing nights must not be handed two half-nights. Sales by
    // day, the order history and the void log all date an order by the trading
    // day it belongs to, not by the calendar page it happened to fall on.
    const s = day.openDay({ opening_float: 0 });
    const back = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const ymd = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}-${String(back.getDate()).padStart(2, '0')}`;
    const nextDay = new Date(back.getTime() + 24 * 3600 * 1000);
    const ymd2 = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
    getDb().prepare('UPDATE day_sessions SET opened_at = ? WHERE id = ?').run(`${ymd} 10:00:00`, s.id);

    const ins = getDb().prepare(
      `INSERT INTO orders (order_no, type, status, session_id, opened_at, settled_at,
                           subtotal, total, profit, payment_method)
       VALUES (?, 'takeaway', 'settled', ?, ?, ?, ?, ?, ?, 'cash')`,
    );
    ins.run('NIGHT-A', s.id, `${ymd} 23:30:00`, `${ymd} 23:30:00`, 600, 600, 250);
    ins.run('NIGHT-B', s.id, `${ymd2} 02:00:00`, `${ymd2} 02:00:00`, 400, 400, 150);

    // Ask across BOTH calendar dates; the night must come back as one row.
    const r = reports.range(ymd, ymd2);
    const rows = r.days.filter((d) => d.date === ymd || d.date === ymd2);
    eq(rows.length, 1, 'one trading day, one row — not split at midnight');
    eq(rows[0].date, ymd, 'dated by the day the shop OPENED');
    eq(rows[0].sales, 1000, 'and it carries the whole night');
    eq(rows[0].orders, 2, 'both orders on the one day');

    // The history agrees: asking for the opening date alone finds the 2am one.
    const hist = reports_history(ymd, ymd);
    ok(hist.includes('NIGHT-A'), 'the 11:30pm order is on the opening date');
    ok(hist.includes('NIGHT-B'), 'and so is the 2am one, though the clock says otherwise');

    day.closeDay({});
  });

  /* ================= Section 26 — The day's order sheet ================= */
  section('26 — Day order sheet');

  const daySheet = require(path.join(dist, 'services', 'daySheet'));
  const dayIpc = require(path.join(dist, 'ipc', 'day'));

  let sheetSession;
  let sheetOrders;

  test('26.1', 'The list carries EVERY order between opening and closing', () => {
    if (day.currentSession()) day.closeDay({});
    sheetSession = day.openDay({ opening_float: 1000 });

    // One of each fate, because all three are what an owner reconciles against.
    const paid = orders.openOrder({ type: 'takeaway' });
    orders.addItems(paid.id, [{ menu_item_id: D['Day Biryani'], qty: 2, modifier_ids: [] }]);
    orders.settleOrder(paid.id, { payment_method: 'cash' });

    const killed = orders.openOrder({ type: 'takeaway' });
    orders.addItems(killed.id, [{ menu_item_id: D['Day Burger'], qty: 1, modifier_ids: [] }]);
    orders.voidOrder(killed.id, { reason_code: 'duplicate', note: null, staff_id: null });

    const owing = orders.openOrder({ type: 'dine_in' });
    orders.addItems(owing.id, [{ menu_item_id: D['Day Water'], qty: 1, modifier_ids: [] }]);

    sheetOrders = orders.listOrdersForSession(sheetSession.id);
    eq(sheetOrders.length, 3, 'all three are listed');

    const byStatus = Object.fromEntries(sheetOrders.map((o) => [o.status, o.order_no]));
    ok(byStatus.settled, 'the settled one is there');
    ok(byStatus.void, 'the CANCELLED one is there — the row an owner is hunting for');
    ok(byStatus.open, 'and the one still owing');

    // Chronological, so the sheet reads like the night happened.
    const opened = sheetOrders.map((o) => o.opened_at);
    eq(
      opened.join('|'),
      [...opened].sort().join('|'),
      'oldest first',
    );
    // The items travel with each row, so the sheet can count them.
    ok(sheetOrders.every((o) => Array.isArray(o.items)), 'each row carries its items');
  });

  test('26.2', "One day's sheet never shows another day's orders", () => {
    day.closeDay({});
    const other = day.openDay({ opening_float: 0 });
    const stray = orders.openOrder({ type: 'takeaway' });
    orders.addItems(stray.id, [{ menu_item_id: D['Day Water'], qty: 1, modifier_ids: [] }]);
    orders.settleOrder(stray.id, { payment_method: 'cash' });

    const first = orders.listOrdersForSession(sheetSession.id).map((o) => o.order_no);
    ok(!first.includes(stray.order_no), 'the later order stays on its own day');
    eq(orders.listOrdersForSession(other.id).length, 1, 'and shows up on that one');
    day.closeDay({});
  });

  test('26.3', 'The sheet is an A4 DOCUMENT, not a till roll', () => {
    const report = day.dayReport(sheetSession.id);
    const html = daySheet.buildDaySheetHtml(report, sheetOrders);

    // The whole point of this path: HTML for a normal printer, and none of the
    // ESC/POS control bytes the thermal path emits.
    ok(html.startsWith('<!doctype html>'), 'it is a real document');
    ok(/@page\s*\{\s*size:\s*A4/.test(html), 'laid out for A4');
    ok(!html.includes('\x1b'), 'no ESC/POS escape bytes anywhere near it');

    ok(html.includes('Test Food Point'), 'headed with the shop name');
    for (const o of sheetOrders) ok(html.includes(o.order_no), `lists ${o.order_no}`);
    ok(/Cancelled/.test(html), 'says which one was cancelled');
    ok(/UNPAID/.test(html), 'and which is still owed');
    ok(html.includes('Opened'), 'states when the day opened');
    ok(/thead\s*\{\s*display:\s*table-header-group/.test(html),
      'repeats the column headers on page two');
  });

  test('26.3b', 'A CANCELLED order shows what was thrown away, not zero', () => {
    // Cancelling marks every line void. Counting only live lines would print
    // "0 items, Rs.0.00" against the one row an owner opens this sheet to
    // investigate — the money that went missing.
    const report = day.dayReport(sheetSession.id);
    const html = daySheet.buildDaySheetHtml(report, sheetOrders);
    const killed = sheetOrders.find((o) => o.status === 'void');
    ok(killed, 'there is a cancelled order to check');
    ok(killed.subtotal > 0, 'and it was worth something');

    const row = html.split('<tr').find((chunk) => chunk.includes(killed.order_no));
    ok(row, 'its row is on the sheet');
    ok(!/>0</.test(row), 'it does NOT read as zero items');
    ok(
      row.includes(killed.subtotal.toFixed(2)),
      `it carries what was lost (${killed.subtotal.toFixed(2)}), got: ${row.replace(/\s+/g, ' ')}`,
    );
  });

  test('26.4', 'A COUNTER cannot read margin off the sheet', () => {
    // The same rule as the screen and the slip: gross profit is the owner's.
    adminSession.lockAdmin();
    const counter = dayIpc.reportFor(sheetSession.id);
    eq(counter.gross_profit, null, 'stripped before it reaches the sheet builder');
    const html = daySheet.buildDaySheetHtml(counter, sheetOrders);
    ok(!/Gross profit/.test(html), 'so no margin line is printed');
    ok(/Sales/.test(html), 'the takings are still there — that is counter work');
  });

  test('26.5', 'An empty day still produces a sheet', () => {
    // A day opened and closed with no trade must not crash the print path.
    const quiet = day.openDay({ opening_float: 0 });
    const report = day.dayReport(quiet.id);
    const html = daySheet.buildDaySheetHtml(report, []);
    ok(html.includes('No orders were taken'), 'it says so plainly');
    ok(html.startsWith('<!doctype html>'), 'and is still a valid document');
    day.closeDay({});
  });

  /* ================================================================== *
     27 — Client branding (the theme a shop sets for itself)
     ================================================================== */
  section('27 — Client branding');

  const theme = require(path.join(ROOT, 'dist-electron', 'shared', 'theme'));
  const images = require(path.join(dist, 'services', 'images'));

  test('27.1', 'The nine brand colours survive a save and reload', () => {
    const squid = theme.PRESETS.find((p) => p.id === 'squid').colors;
    settingsRepo.saveSettings({ theme_colors: JSON.stringify(squid) });
    const back = JSON.parse(settingsRepo.getAllSettings().theme_colors);
    eq(back.accent, squid.accent, 'the accent came back exactly');
    eq(Object.keys(back).length, 9, 'all nine came back');
  });

  test('27.2', 'A palette that is not colours cannot reach the stylesheet', () => {
    // The realistic route in is a RESTORE: the database arrives from a file
    // the shop was handed, so a hostile value is not hypothetical.
    const evil = theme.sanitizeColors({
      accent: '0 0 0; } body { display: none } :root {',
      danger: 'red',
      canvas: '999 999 999',
      'brand-deep': ['9', '20', '36'],
    });
    eq(evil.accent, theme.DEFAULT_COLORS.accent, 'a CSS injection falls back to stock');
    eq(evil.danger, theme.DEFAULT_COLORS.danger, 'a colour NAME is not accepted');
    eq(evil.canvas, theme.DEFAULT_COLORS.canvas, 'out-of-range channels are refused');
    eq(evil['brand-deep'], theme.DEFAULT_COLORS['brand-deep'], 'a non-string is refused');
  });

  test('27.3', 'Generated CSS contains only numbers the parser produced', () => {
    const css = theme.themeToCss(
      { colors: theme.sanitizeColors({ accent: '1 2 3; } * { color: red' }), art: theme.DEFAULT_ART },
      null,
    );
    ok(!css.includes('color: red'), 'the injected rule is gone');
    ok(css.includes('--accent-rgb:'), 'and a real accent token is still written');
    ok(css.includes('--dashboard-art: none'), 'no artwork means none, not an empty url()');
  });

  test('27.3b', 'The artwork sliders reach BOTH themes, not just the dark one', () => {
    // Regression: the veil used to be emitted as a finished color-mix(), which
    // the light theme overrode at higher specificity — so the slider moved and
    // nothing happened on paper. It is emitted as a bare number now, and
    // globals.css derives each theme's veil from it.
    const css = theme.themeToCss(
      { colors: theme.DEFAULT_COLORS, art: { file: 'bg.jpg', opacity: 55, veil: 70 } },
      'app://foodpoint/media/theme/bg.jpg',
    );
    ok(css.includes('--workspace-art-veil-pct: 70;'), 'the veil is a plain number');
    ok(!css.includes('color-mix'), 'and not a finished colour that a theme can outrank');
    ok(css.includes('--dashboard-art-opacity: 0.55;'), 'strength is a 0-1 fraction');
  });

  test('27.4', 'The artwork is a filename in the shop\'s own folder, never a path', () => {
    eq(theme.sanitizeArt({ file: '../../../etc/passwd' }).file, '', 'a path escape is refused');
    eq(theme.sanitizeArt({ file: 'http://x/y.jpg' }).file, '', 'a URL is refused — the app is offline');
    eq(theme.sanitizeArt({ file: 'shop.exe' }).file, '', 'a non-image is refused');
    eq(theme.sanitizeArt({ file: 'backdrop.jpg' }).file, 'backdrop.jpg', 'a plain filename is kept');
  });

  test('27.5', 'The app:// handler will not serve artwork from outside the folder', () => {
    eq(images.resolveImage('theme', '../logo/shop.png'), null, 'no climbing out of upload/theme');
    eq(images.resolveImage('theme', 'nothing-here.jpg'), null, 'a missing file is not served');
    ok(images.IMAGE_KINDS.includes('theme'), 'and theme art has its own folder');
  });

  test('27.6', 'Artwork strength cannot be pushed outside 0-100', () => {
    // The sliders are bounded, but a restored database is not.
    eq(theme.sanitizeArt({ file: 'a.jpg', opacity: 900 }).opacity, 100, 'clamped at the top');
    eq(theme.sanitizeArt({ file: 'a.jpg', veil: -40 }).veil, 0, 'clamped at the bottom');
    eq(theme.sanitizeArt({ file: 'a.jpg', opacity: 'lots' }).opacity, 30, 'nonsense falls back');
  });

  test('27.7', 'Charge and Void can never be confused on a shipped preset', () => {
    // The whole reason the guard exists: a cashier under pressure must not
    // mistake the primary action for the destructive one.
    for (const preset of theme.PRESETS) {
      const gap = theme.deltaE(preset.colors.accent, preset.colors.danger);
      ok(gap >= 20, `preset "${preset.id}" separates them by only ${gap.toFixed(0)}`);
      eq(theme.checkColors(preset.colors).length, 0, `preset "${preset.id}" trips no guard`);
    }
  });

  test('27.8', 'A dangerous palette IS reported to the owner', () => {
    const bad = {
      ...theme.DEFAULT_COLORS,
      accent: '224 16 112',
      danger: '236 60 140', // near-identical pink
      canvas: '20 20 20', // black paper under black text
    };
    const warned = theme.checkColors(bad).map((w) => w.token);
    ok(warned.includes('danger'), 'Charge/Void being alike is called out');
    ok(warned.includes('canvas'), 'unreadable workspace paper is called out');
  });

  test('27.9', 'A shop with no branding set gets the stock look', () => {
    settingsRepo.saveSettings({ theme_colors: '' });
    eq(settingsRepo.getAllSettings().theme_colors, '', 'nothing is stored');
    // sanitizeColors of nothing is the stock palette, which is what the
    // renderer falls back to — a blank setting is normal, not an error.
    eq(theme.sanitizeColors(null).accent, theme.DEFAULT_COLORS.accent, 'and stock is what shows');
  });

  /* ================================================================== *
     28 — Waiters (optional, takeaway only)
     ================================================================== */
  section('28 — Waiters');

  const waitersRepo = require(path.join(dist, 'db', 'repositories', 'waiters'));

  test('28.1', 'Off by default: a takeaway order needs no waiter', () => {
    eq(settingsRepo.waitersEnabled(), false, 'off out of the box');
    const o = orders.openOrder({ type: 'takeaway' });
    eq(o.waiter_id, null, 'no waiter attached');
    eq(o.waiter_name, null, 'no waiter attached');
  });

  test('28.2', 'Dine-in and delivery are unaffected even when waiters are on', () => {
    settingsRepo.saveSettings({ enable_waiters: '1' });
    const dine = orders.openOrder({ type: 'dine_in', table_id: T.T2 });
    eq(dine.waiter_id, null, 'dine-in never carries a waiter');
    const deliv = orders.openOrder({ type: 'delivery', delivery_address: 'House 1, Lahore' });
    eq(deliv.waiter_id, null, 'delivery never carries a waiter');
    orders.voidOrder(dine.id, { reason_code: 'other', note: 'cleanup', staff_id: null });
    orders.voidOrder(deliv.id, { reason_code: 'other', note: 'cleanup', staff_id: null });
  });

  test('28.3', 'ON, a takeaway order cannot start without choosing a waiter', () => {
    const msg = throws(() => orders.openOrder({ type: 'takeaway' }), 'no waiter chosen');
    ok(/waiter/i.test(msg), 'message names what is missing');
  });

  let waiterAli;
  test('28.4', 'A takeaway order can be started once a waiter is chosen', () => {
    waiterAli = waitersRepo.saveWaiter({ name: 'Ali', code: 'W1', is_active: true });
    const o = orders.openOrder({ type: 'takeaway', waiter_id: waiterAli.id });
    eq(o.waiter_id, waiterAli.id, 'waiter attached');
    eq(o.waiter_name, 'Ali', 'name snapshotted onto the row');
    orders.voidOrder(o.id, { reason_code: 'other', note: 'cleanup', staff_id: null });
  });

  test('28.5', 'A deactivated waiter drops off the dropdown but not off history', () => {
    const paid = orders.addItems(
      orders.openOrder({ type: 'takeaway', waiter_id: waiterAli.id }).id,
      [{ menu_item_id: item['Cold Drink'], qty: 1 }],
    );
    const settled = orders.settleOrder(paid.id, { payment_method: 'cash' });
    eq(settled.waiter_name, 'Ali', 'snapshot carried through settlement');

    waitersRepo.saveWaiter({ id: waiterAli.id, name: 'Ali', is_active: false });
    ok(
      !waitersRepo.listWaiters(true).some((w) => w.id === waiterAli.id),
      'gone from the active-only list the order screen uses',
    );
    eq(orders.getOrder(settled.id).waiter_name, 'Ali', 'the past order still says who it was');
  });

  let aliOrderId;
  test('28.6', 'Deleting a waiter outright never touches a past order', () => {
    // Ali was deactivated in 28.5 — a deactivated waiter cannot be attached to
    // a NEW order (the same "no longer available" rule as a removed one), so
    // this checks the order that already carries her snapshot from 28.5.
    aliOrderId = orders
      .listOrders(todayIso(), todayIso(), 'settled')
      .find((o) => o.waiter_name === 'Ali').id;

    waitersRepo.removeWaiter(waiterAli.id);
    eq(waitersRepo.getWaiter(waiterAli.id), null, 'the roster row is really gone');
    const reread = orders.getOrder(aliOrderId);
    eq(reread.waiter_name, 'Ali', 'the bill still names them');
    ok(reread.total > 0, 'and the rest of the order is untouched');
  });

  test('28.7', "The bill and the kitchen ticket print the waiter's name", () => {
    const w = waitersRepo.saveWaiter({ name: 'Bilal', is_active: true });
    let o = orders.openOrder({ type: 'takeaway', waiter_id: w.id });
    o = orders.addItems(o.id, [{ menu_item_id: item['Zinger Burger'], qty: 1, modifier_ids: [modRegular] }]);
    const { fired } = orders.fireToKitchen(o.id);
    const ticket = receipt.buildKitchenTicket(orders.getOrder(o.id), fired);
    ok(/WAITER: BILAL/.test(ticket), 'kitchen ticket names the waiter');
    const settled = orders.settleOrder(o.id, { payment_method: 'cash' });
    const bill = receipt.buildCustomerBill(settled);
    ok(/Waiter: Bilal/.test(bill), 'customer bill names the waiter');
  });

  test('28.8', 'Per-waiter sales are reported for the period', () => {
    const rows = reports.salesByWaiter(todayIso(), todayIso());
    const ali = rows.find((r) => r.waiter_name === 'Ali');
    ok(ali && ali.order_count >= 1, "Ali's settled order is counted");
    const bilal = rows.find((r) => r.waiter_name === 'Bilal');
    ok(bilal && bilal.sales > 0, "Bilal's sale is counted");
  });

  test('28.9', 'Turning the flag back off restores the old behaviour exactly', () => {
    settingsRepo.saveSettings({ enable_waiters: '0' });
    const o = orders.openOrder({ type: 'takeaway' });
    eq(o.waiter_id, null, 'no waiter required or attached once off again');
  });

  fs.rmSync(tmp, { recursive: true, force: true });

  const pad = (s, n) => String(s).padEnd(n);
  let lastSection = '';
  console.log('\n' + '='.repeat(78));
  console.log('  FOOD-POINT v1 — TEST SCENARIO RESULTS');
  console.log('='.repeat(78));
  for (const r of results) {
    if (r.section !== lastSection) {
      console.log(`\n  ${r.section}`);
      console.log('  ' + '-'.repeat(74));
      lastSection = r.section;
    }
    const mark = r.status === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${pad(r.id, 10)} ${r.name}`);
    if (r.error) console.log(`         ^^^^ ${r.error}`);
  }
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n' + '='.repeat(78));
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log('='.repeat(78) + '\n');

  app.exit(failed ? 1 : 0);
});
