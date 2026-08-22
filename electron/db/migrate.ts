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

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  -- salt$hash, exactly like the manager PIN. Never leaves the main process.
  pin_hash   TEXT    NOT NULL DEFAULT '',
  -- Someone who has left keeps their history but drops off the sign-in list.
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

  // Seed any setting the build knows about but this database has not seen yet,
  // so a new key added in a later version arrives with a sane default rather
  // than an empty string.
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seed = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  });
  seed();
}
