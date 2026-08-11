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

export function migrate(): void {
  const db = getDb();
  db.exec(SCHEMA);

  // Seed any setting the build knows about but this database has not seen yet,
  // so a new key added in a later version arrives with a sane default rather
  // than an empty string.
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seed = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  });
  seed();
}
