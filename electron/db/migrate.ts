import { getDb } from './connection';
import { DEFAULT_SETTINGS } from '../../shared/types';

/**
 * Creates and upgrades the food-point schema. Runs on every startup, before
 * the UI can ask for anything.
 *
 * Two shapes are worth noting because they differ from the shop/pharmacy line:
 *
 *  - There is no `invoices` table. An order that reaches `settled` IS the bill,
 *    and every report reads settled orders.
 *  - `tables` has no `status` column. Free/occupied is derived from open orders
 *    at read time — see repositories/tables.ts for why.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS menu_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  category_id  INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
  sale_price   REAL    NOT NULL DEFAULT 0,
  -- Estimated food cost. Recipe-level costing is deferred (spec §2).
  cost_price   REAL    NOT NULL DEFAULT 0,
  -- The "86 it" toggle: 1 = on the menu, 0 = kitchen has run out.
  is_available INTEGER NOT NULL DEFAULT 1,
  barcode      TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id, sort_order);

CREATE TABLE IF NOT EXISTS modifier_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  selection_type TEXT    NOT NULL DEFAULT 'single'
                 CHECK (selection_type IN ('single', 'multi'))
);

CREATE TABLE IF NOT EXISTS modifiers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  -- Added to the line. Zero for choices like "No onions".
  price_delta REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_modifiers_group ON modifiers(group_id);

CREATE TABLE IF NOT EXISTS item_modifier_groups (
  item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, group_id)
);

CREATE TABLE IF NOT EXISTS tables (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE,
  area  TEXT,
  seats INTEGER
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- YYYYMMDD-NNN. UNIQUE is the backstop that turns a numbering bug into a
  -- loud error instead of two orders quietly sharing a number.
  order_no       TEXT    NOT NULL UNIQUE,
  type           TEXT    NOT NULL CHECK (type IN ('dine_in', 'takeaway', 'delivery')),
  table_id       INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'settled', 'void')),
  opened_at      TEXT    NOT NULL,
  settled_at     TEXT,
  customer_name  TEXT,
  customer_phone TEXT,
  subtotal       REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  service_charge REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  -- Locked in at settle time from snapshots; null while open.
  profit         REAL,
  payment_method TEXT    CHECK (payment_method IN ('cash', 'card')),
  void_reason    TEXT,
  voided_at      TEXT
);

-- The floor screen asks "which tables have an open order" on every render.
CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(status, table_id);
-- Reports scan by settle date.
CREATE INDEX IF NOT EXISTS idx_orders_settled ON orders(status, settled_at);

CREATE TABLE IF NOT EXISTS order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id   INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  -- Snapshots: renaming or repricing the menu tomorrow must not rewrite
  -- what today's bill said or what today's profit was.
  item_name      TEXT    NOT NULL,
  qty            REAL    NOT NULL DEFAULT 1,
  cost_price     REAL    NOT NULL DEFAULT 0,
  sale_price     REAL    NOT NULL DEFAULT 0,
  -- Includes modifier deltas.
  line_total     REAL    NOT NULL DEFAULT 0,
  notes          TEXT,
  kitchen_status TEXT    NOT NULL DEFAULT 'new'
                 CHECK (kitchen_status IN ('new', 'fired', 'served', 'void')),
  fired_at       TEXT,
  void_reason    TEXT,
  voided_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  price_delta   REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_line
  ON order_item_modifiers(order_item_id);

CREATE TABLE IF NOT EXISTS deals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  -- The one fixed combo price. NOT the sum of the parts — that is the point.
  price      REAL    NOT NULL DEFAULT 0,
  -- Inactive deals stay in history but leave the order screen.
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes      TEXT
);

CREATE TABLE IF NOT EXISTS deal_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id      INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  qty          REAL    NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON deal_items(deal_id);

CREATE TABLE IF NOT EXISTS menu_item_variants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  -- "Small", "Large", "Half", "10 Pcs" — whatever the shop calls it.
  name         TEXT    NOT NULL,
  -- ABSOLUTE price, not a delta. A pizza shop prices Small 600 / Large 1499
  -- with no arithmetic relationship, and three different pizza tiers on the
  -- same menu cannot share one set of deltas. See repositories/menu.ts.
  sale_price   REAL    NOT NULL DEFAULT 0,
  cost_price   REAL    NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_variants_item ON menu_item_variants(item_id, sort_order);

CREATE TABLE IF NOT EXISTS extra_charges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- "Disposable plates", "Glasses", "Carry bag".
  name       TEXT    NOT NULL,
  price      REAL    NOT NULL DEFAULT 0,
  -- What the packaging actually costs the shop. Zero is fine and common,
  -- but recording it keeps profit honest: plates are not free.
  cost_price REAL    NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_extras (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  extra_id   INTEGER REFERENCES extra_charges(id) ON DELETE SET NULL,
  -- Snapshots, exactly like order_items: repricing plates tomorrow must not
  -- rewrite what a bill printed today.
  name       TEXT    NOT NULL,
  price      REAL    NOT NULL DEFAULT 0,
  cost_price REAL    NOT NULL DEFAULT 0,
  qty        REAL    NOT NULL DEFAULT 1,
  line_total REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_extras_order ON order_extras(order_id);

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The lookup key, but deliberately NOT UNIQUE. A shared household number, a
  -- mistyped digit corrected later, or a restored backup can all produce two
  -- rows for one number; a UNIQUE constraint would turn any of those into a
  -- failed order at the counter. Duplicates are tolerated and the most recent
  -- wins on lookup — see repositories/customers.ts.
  phone         TEXT    NOT NULL,
  name          TEXT,
  address       TEXT,
  -- "No chilli", "gate at the back", "always pays card".
  notes         TEXT,
  created_at    TEXT    NOT NULL,
  last_order_at TEXT,
  order_count   INTEGER NOT NULL DEFAULT 0
);

-- Every lookup is by phone, on every takeaway and delivery order.
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS day_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_at    TEXT    NOT NULL,
  closed_at    TEXT,
  -- Cash in the drawer at open, so close can state what should be there.
  opening_float REAL   NOT NULL DEFAULT 0,
  -- Who opened and closed it, when a staff roster is in use.
  opened_by    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  closed_by    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  notes        TEXT
);

-- "Is a day open?" is asked on every order, so it must not scan.
CREATE INDEX IF NOT EXISTS idx_day_sessions_open ON day_sessions(closed_at);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  -- salt$hash, exactly like the manager PIN. Never leaves the main process.
  pin_hash   TEXT    NOT NULL DEFAULT '',
  -- Someone who has left keeps their history but drops off the sign-in list.
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS waiters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  -- Short code for a badge or a call sign. Optional.
  code       TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS license (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  machine_id   TEXT NOT NULL,
  license_key  TEXT NOT NULL,
  expires_at   TEXT,
  activated_at TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS backup_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0
);

-- ---- Optional feature: partial payments (spec Feature 2) -----------------
-- The ledger of money actually collected on an order, one row per collection.
-- Exists so a partial settle followed by a later balance payment leaves an
-- honest trail, and so the day report can tell which session real cash moved
-- in — an order's own session_id is fixed at open time, but a balance paid
-- days later belongs to whichever session is open THEN, not the one the order
-- opened under. Written only while "Enable partial payments" is on.
CREATE TABLE IF NOT EXISTS order_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount     REAL    NOT NULL DEFAULT 0,
  method     TEXT    NOT NULL CHECK (method IN ('cash', 'card')),
  kind       TEXT    NOT NULL DEFAULT 'advance' CHECK (kind IN ('advance', 'balance')),
  session_id INTEGER REFERENCES day_sessions(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_session ON order_payments(session_id, method);

-- ---- Optional feature: daily expenses (spec Feature 3) -------------------
-- Attached to whichever day session was open when it was recorded, falling
-- back to the calendar date when none was — exactly the same rule an order
-- follows. Admin-only; counter staff never reach the screen that writes this.
CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT    NOT NULL,
  amount       REAL    NOT NULL DEFAULT 0,
  session_id   INTEGER REFERENCES day_sessions(id) ON DELETE SET NULL,
  expense_date TEXT    NOT NULL,
  -- 'wages' is the one line the waiter-wages step writes, upserted per
  -- session rather than duplicated on every save — see repositories/expenses.ts.
  source       TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wages')),
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_session ON expenses(session_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- ---- Optional feature: waiter daily wages (spec Feature 4) ---------------
-- One row per waiter per day session, holding whatever the owner actually
-- saved — not the waiter's default rate, which lives on waiters.daily_wage
-- and only ever PRE-FILLS this. Re-saving the same session replaces its rows
-- outright (see saveWaiterWages), so this table always holds the latest
-- review for that day, never a stack of edits.
CREATE TABLE IF NOT EXISTS waiter_wages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  waiter_id   INTEGER REFERENCES waiters(id) ON DELETE SET NULL,
  -- Snapshot, exactly like orders.waiter_name: deleting a waiter later must
  -- not blank out a wage already paid and recorded.
  waiter_name TEXT    NOT NULL,
  amount      REAL    NOT NULL DEFAULT 0,
  session_id  INTEGER REFERENCES day_sessions(id) ON DELETE SET NULL,
  wage_date   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waiter_wages_session ON waiter_wages(session_id);
`;

/**
 * Add a column to a table that already exists on installed machines.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a database that already has the
 * table, so a column added in a later version has to arrive this way. SQLite
 * has no `ADD COLUMN IF NOT EXISTS`, and re-adding an existing column throws,
 * so the current columns are read first. A paying customer's database upgrades
 * in place; nothing is copied, rebuilt or dropped.
 */
function addColumn(table: string, column: string, definition: string): void {
  const db = getDb();
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (existing.some((col) => col.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function migrate(): void {
  const db = getDb();
  db.exec(SCHEMA);

  /* ---- Deals (added after v1 shipped) ----------------------------------
   * A deal sells as ONE line at a fixed combo price, but is recorded as its
   * component menu items so profit, best-sellers and the kitchen ticket all
   * still see the real food. These three columns are what tie those component
   * rows back together — see repositories/deals.ts for the whole argument.
   */
  addColumn('order_items', 'deal_id', 'INTEGER REFERENCES deals(id) ON DELETE SET NULL');
  // One tap of a deal = one group. Adding the same deal twice gives two groups,
  // so each can be voided or read back independently.
  addColumn('order_items', 'deal_group', 'INTEGER');
  // Snapshot, exactly like item_name: renaming a deal tomorrow must not rewrite
  // what a bill printed today.
  addColumn('order_items', 'deal_name', 'TEXT');

  db.exec('CREATE INDEX IF NOT EXISTS idx_order_items_deal_group ON order_items(deal_group)');

  /* ---- Cancellation accountability (added after v1 shipped) -------------
   * A cancellation is never a delete. The order row stays exactly where it
   * is and gains the answers to "who, when, why, and had the money already
   * been taken" — which is the whole of the anti-theft story. See
   * repositories/orders.ts (voidOrder) and repositories/reports.ts.
   */
  // One of a fixed list, so the reasons can be counted and compared. The
  // existing free-text `void_reason` stays as the human-readable line.
  addColumn('orders', 'void_reason_code', 'TEXT');
  // The typed detail behind "Other".
  addColumn('orders', 'void_note', 'TEXT');
  addColumn('orders', 'voided_by_staff_id', 'INTEGER REFERENCES staff(id) ON DELETE SET NULL');
  /*
   * Whether the money had already been taken when this was cancelled.
   * Derivable from settled_at today, but stored explicitly because it is the
   * single most important fact in the report and must not depend on a future
   * refactor leaving settled_at set for some other reason.
   */
  addColumn('orders', 'voided_was_paid', 'INTEGER NOT NULL DEFAULT 0');

  addColumn('order_items', 'void_reason_code', 'TEXT');
  addColumn('order_items', 'void_note', 'TEXT');
  addColumn('order_items', 'voided_by_staff_id', 'INTEGER REFERENCES staff(id) ON DELETE SET NULL');

  // The cancellations report scans by when the cancellation happened.
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_voided ON orders(status, voided_at)');

  /* ---- Photos and variants (added after v1 shipped) ---------------------
   * Images are stored as a FILENAME, not as bytes in the database. The file
   * lives in <userData>/images/, which keeps the database small enough to
   * copy to a USB stick in a second, lets a shop drop a whole folder of
   * photos in at once, and means a corrupt JPEG can never damage the data.
   */
  addColumn('menu_items', 'image_file', 'TEXT');
  addColumn('menu_categories', 'image_file', 'TEXT');
  addColumn('deals', 'image_file', 'TEXT');

  // Snapshot of the chosen variant, exactly like item_name: renaming "Large"
  // tomorrow must not rewrite what a bill printed today.
  addColumn('order_items', 'variant_name', 'TEXT');
  addColumn('order_items', 'variant_id', 'INTEGER');

  /* ---- Delivery (added after v1 shipped) --------------------------------
   * `delivery` was already a valid order type, but had nowhere to record
   * where the food goes or what was charged to take it there.
   *
   * The charge is its OWN column beside discount and service_charge, never
   * folded into an item price: a delivery fee is not food, it carries no cost
   * of goods, and the owner needs to see it separately from what the kitchen
   * actually sold.
   */
  addColumn('orders', 'delivery_address', 'TEXT');
  addColumn('orders', 'delivery_charge', 'REAL NOT NULL DEFAULT 0');

  /* ---- Extras (packaging, disposables) ---------------------------------
   * Charged per ORDER, not per dish, and on every order type — a dine-in
   * table can want disposable glasses just as a delivery can. Kept out of
   * `subtotal`, which stays the food, so the owner can read what the kitchen
   * sold apart from what the packaging brought in.
   */
  addColumn('orders', 'extras_total', 'REAL NOT NULL DEFAULT 0');

  /* ---- Business day sessions --------------------------------------------
   * The shop trades past midnight, so a calendar date is the wrong unit: an
   * order settled at 1am belongs to the night that is still running, not to
   * the morning that has technically begun. Every order is stamped with the
   * session open at the time it was placed, and the end-of-day report reads
   * that stamp rather than date(settled_at).
   *
   * Nullable on purpose: orders taken before this feature existed, and orders
   * taken while no day is open, simply carry no session. Neither is an error.
   */
  addColumn('orders', 'session_id', 'INTEGER REFERENCES day_sessions(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id, status)');

  /* ---- Waiters (optional, takeaway only) --------------------------------
   * `waiter_id` is a plain reference with no ON DELETE clause spelled out
   * beyond SET NULL — a waiter can be deleted outright at any time, unlike
   * staff, because `waiter_name` is snapshotted onto the row exactly like
   * `customer_name`. History never depends on the waiters table surviving.
   */
  addColumn('orders', 'waiter_id', 'INTEGER REFERENCES waiters(id) ON DELETE SET NULL');
  addColumn('orders', 'waiter_name', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_waiter ON orders(waiter_id)');

  /* ---- Service charge mode: don't change a live shop's bills -------------
   * The new default is 'fixed', which is right for a new install. But a shop
   * already running this app may have a percentage configured, and seeding
   * 'fixed' would silently drop their service charge to zero — a live billing
   * change nobody asked for, discovered at the till.
   *
   * So before the defaults are seeded, a database that has never seen this
   * key AND already charges a percentage gets 'percent' written in. That is
   * exactly the set of databases the new default would have broken, and it
   * happens once ever: from the next launch the row exists, so the seed below
   * ignores it and an owner who chooses 'fixed' is never overruled.
   */
  const hasMode = db
    .prepare("SELECT 1 FROM settings WHERE key = 'service_charge_mode'")
    .get() as unknown;
  if (!hasMode) {
    const pct = db
      .prepare("SELECT value FROM settings WHERE key = 'service_charge_percent'")
      .get() as { value: string } | undefined;
    if (Number(pct?.value ?? 0) > 0) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('service_charge_mode', 'percent')").run();
    }
  }

  /* ---- Weight-based items (Feature 1) ------------------------------------
   * `sale_price` is reused as the PER-UNIT price rather than adding a second
   * price column — an item is either sold as a fixed unit or by weight, never
   * both, so one price field is enough either way. `qty` on the order line
   * (already REAL) becomes the weight instead of a count; nothing about how
   * line_total = qty * price is computed has to change.
   */
  addColumn('menu_items', 'sold_by_weight', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('menu_items', 'unit_label', 'TEXT');
  // Snapshot of the item's unit, exactly like variant_name — see the schema
  // note above order_payments for why snapshots matter here too.
  addColumn('order_items', 'unit_label', 'TEXT');

  /* ---- Partial payments (Feature 2) --------------------------------------
   * Both default to 0, which is exactly right for every order ever settled
   * before this existed: `amount_paid` was always the full amount and
   * `balance_due` was always zero, so leaving them at their default rather
   * than backfilling is already the correct historical value.
   */
  addColumn('orders', 'amount_paid', 'REAL NOT NULL DEFAULT 0');
  addColumn('orders', 'balance_due', 'REAL NOT NULL DEFAULT 0');

  /* ---- Waiter wages (Feature 4) -------------------------------------------
   * Set once when a waiter is added, editable in admin, and only ever
   * consulted when "Enable waiter wages" is on — see repositories/expenses.ts.
   *
   * `daily_wage` was this feature's original column, added and shipped only
   * within this same pre-release branch (never to a live database) before pay
   * types existed. It is carried over into `wage_rate` below rather than
   * dropped — dropping a column is exactly the kind of rebuild this file
   * otherwise never does, and keeping the old column costs nothing.
   */
  const waiterCols = db.prepare('PRAGMA table_info(waiters)').all() as Array<{ name: string }>;
  const hadWageRate = waiterCols.some((c) => c.name === 'wage_rate');
  const hadDailyWage = waiterCols.some((c) => c.name === 'daily_wage');

  addColumn('waiters', 'daily_wage', 'REAL NOT NULL DEFAULT 0');
  // 'daily' | 'weekly' | 'monthly' — validated as a fixed set at the IPC
  // layer (asEnum), the same way every other fixed-list column in this
  // schema is, rather than a SQL CHECK.
  addColumn('waiters', 'pay_type', "TEXT NOT NULL DEFAULT 'daily'");
  // 0-6 (Sunday=0) for weekly, 1-31 for monthly, unused for daily.
  addColumn('waiters', 'payday', 'INTEGER');
  addColumn('waiters', 'wage_rate', 'REAL NOT NULL DEFAULT 0');

  // Runs exactly once — guarded on wage_rate not having existed yet — so it
  // can never overwrite a wage_rate an owner has since edited.
  if (!hadWageRate && hadDailyWage) {
    db.exec('UPDATE waiters SET wage_rate = daily_wage');
  }

  // Which cadence a saved wage was paid under — cosmetic (older rows saved
  // before this existed are simply blank), but lets the day report and the
  // review screen both say WHY a waiter was paid that day.
  addColumn('waiter_wages', 'pay_type', 'TEXT');

  // Seed any setting the build knows about but this database has not seen yet,
  // so a new key added in a later version arrives with a sane default rather
  // than an empty string.
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seed = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  });
  seed();
}
