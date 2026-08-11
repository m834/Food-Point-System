/**
 * The vocabulary shared by the Electron main process and the Next.js UI.
 *
 * Both sides import from here so a column rename cannot quietly desync the
 * backend from the screen that renders it.
 */

/** Every IPC call resolves to this. Errors never cross as throws. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

export interface MenuCategory {
  id: number;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  sale_price: number;
  /** Estimated food cost. An estimate is fine — it is the owner's number. */
  cost_price: number;
  /** The one-tap "86 it" toggle for when the kitchen runs out. */
  is_available: number;
  barcode: string | null;
  sort_order: number;
  notes: string | null;
  /** Modifier groups attached to this item, hydrated for the order screen. */
  modifier_groups?: ModifierGroup[];
}

export type SelectionType = 'single' | 'multi';

export interface ModifierGroup {
  id: number;
  name: string;
  selection_type: SelectionType;
  modifiers: Modifier[];
}

export interface Modifier {
  id: number;
  group_id: number;
  name: string;
  /** Added to the line total. Zero for choices like "No onions". */
  price_delta: number;
}

/* ------------------------------------------------------------------ *
 * Orders — the heart of the app
 * ------------------------------------------------------------------ */

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'open' | 'settled' | 'void';
/** Per-line kitchen state. Adding is not firing; firing is not serving. */
export type KitchenStatus = 'new' | 'fired' | 'served' | 'void';
export type PaymentMethod = 'cash' | 'card';

export interface Order {
  id: number;
  /** YYYYMMDD-NNN, assigned inside the open transaction. Unique. */
  order_no: string;
  type: OrderType;
  table_id: number | null;
  table_name: string | null;
  status: OrderStatus;
  opened_at: string;
  settled_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number;
  discount: number;
  service_charge: number;
  total: number;
  /** Locked in at settle time from snapshots. Null while the order is open. */
  profit: number | null;
  payment_method: PaymentMethod | null;
  void_reason: string | null;
  voided_at: string | null;
  items: OrderItem[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number | null;
  /** Snapshot: the menu can be renamed tomorrow without rewriting history. */
  item_name: string;
  qty: number;
  cost_price: number;
  sale_price: number;
  /** Includes modifier deltas. */
  line_total: number;
  notes: string | null;
  kitchen_status: KitchenStatus;
  fired_at: string | null;
  void_reason: string | null;
  voided_at: string | null;
  modifiers: OrderItemModifier[];
}

export interface OrderItemModifier {
  id: number;
  order_item_id: number;
  name: string;
  price_delta: number;
}

/** What the UI sends when adding lines to an open order. */
export interface NewOrderLine {
  menu_item_id: number;
  qty: number;
  notes?: string | null;
  modifier_ids?: number[];
}

/** A compact open order for the "which orders are running" strip. */
export interface OpenOrderSummary {
  id: number;
  order_no: string;
  type: OrderType;
  table_id: number | null;
  table_name: string | null;
  opened_at: string;
  subtotal: number;
  item_count: number;
  /** True when at least one line is still waiting to be fired. */
  has_unfired: number;
}

/* ------------------------------------------------------------------ *
 * Tables — dine-in only, and only when enabled
 * ------------------------------------------------------------------ */

export interface DiningTable {
  id: number;
  name: string;
  area: string | null;
  seats: number | null;
  /**
   * Derived from open orders on every read, never stored. A stored flag
   * strands a table as "occupied" forever if the app dies mid-settle.
   */
  open_order_id: number | null;
  running_total: number;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export interface DashboardSummary {
  date: string;
  sales_total: number;
  profit_total: number;
  order_count: number;
  open_order_count: number;
  open_table_count: number;
  best_seller: { name: string; qty: number } | null;
  busiest_hour: { hour: number; sales: number } | null;
  recent: Array<{
    id: number;
    order_no: string;
    type: OrderType;
    settled_at: string;
    total: number;
  }>;
}

export interface RangeTotals {
  from: string;
  to: string;
  sales_total: number;
  profit_total: number;
  order_count: number;
  days: Array<{ date: string; sales: number; profit: number; orders: number }>;
}

export interface SalesByType {
  type: OrderType;
  order_count: number;
  sales: number;
  profit: number;
}

export interface BestSeller {
  menu_item_id: number | null;
  item_name: string;
  qty: number;
  revenue: number;
}

export interface SalesByHour {
  hour: number;
  order_count: number;
  sales: number;
}

export interface VoidRecord {
  kind: 'order' | 'item';
  order_id: number;
  order_no: string;
  item_name: string | null;
  qty: number | null;
  amount: number;
  reason: string;
  voided_at: string;
}

/* ------------------------------------------------------------------ *
 * Licensing, backup, settings
 * ------------------------------------------------------------------ */

export interface LicenseStatus {
  licensed: boolean;
  machineId: string;
  status: 'unlicensed' | 'active' | 'expired' | 'invalid';
  expiresAt: string | null;
  activatedAt: string | null;
  message: string;
}

export interface BackupRecord {
  id: number;
  path: string;
  created_at: string;
  size_bytes: number;
}

export type SettingsMap = Record<string, string>;

export const SETTING_KEYS = {
  businessName: 'business_name',
  businessAddress: 'business_address',
  businessPhone: 'business_phone',
  printerCustomer: 'printer_customer',
  printerKitchen: 'printer_kitchen',
  enableTables: 'enable_tables',
  enableKitchenPrint: 'enable_kitchen_print',
  serviceChargePercent: 'service_charge_percent',
  currencySymbol: 'currency_symbol',
  /** Hashed. Blank means voids are open — see spec §4. */
  managerPin: 'manager_pin',
} as const;

export const DEFAULT_SETTINGS: SettingsMap = {
  [SETTING_KEYS.businessName]: 'My Food Point',
  [SETTING_KEYS.businessAddress]: '',
  [SETTING_KEYS.businessPhone]: '',
  [SETTING_KEYS.printerCustomer]: '',
  [SETTING_KEYS.printerKitchen]: '',
  [SETTING_KEYS.enableTables]: '1',
  [SETTING_KEYS.enableKitchenPrint]: '1',
  [SETTING_KEYS.serviceChargePercent]: '0',
  [SETTING_KEYS.currencySymbol]: 'Rs.',
  [SETTING_KEYS.managerPin]: '',
};

/** Labels live here so the whole app names an order type the same way. */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};
