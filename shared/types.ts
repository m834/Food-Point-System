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

/* ------------------------------------------------------------------ *
 * Deals — a bundle of menu items at one fixed combo price
 * ------------------------------------------------------------------ */

export interface DealComponent {
  id: number;
  deal_id: number;
  menu_item_id: number;
  /** How many of this item are in one deal. */
  qty: number;
  item_name: string;
  sale_price: number;
  cost_price: number;
  is_available: number;
}

export interface Deal {
  id: number;
  name: string;
  /** The one fixed combo price — deliberately not the sum of the parts. */
  price: number;
  is_active: number;
  sort_order: number;
  notes: string | null;
  components: DealComponent[];
  /** What the parts would cost bought separately — shows the saving. */
  menu_value: number;
  /** False when any component is sold out; the order screen greys it out. */
  is_sellable: boolean;
}

/** One component line the backend will write when a deal is added. */
export interface DealLineSpec {
  menu_item_id: number;
  item_name: string;
  qty: number;
  cost_price: number;
  sale_price: number;
  line_total: number;
  deal_id: number;
  deal_name: string;
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
  /** Fixed-list cancellation reason; null on orders cancelled before v1.1. */
  void_reason_code: CancelReasonCode | null;
  void_note: string | null;
  voided_by_staff_id: number | null;
  voided_by_staff_name: string | null;
  /** Whether the money had already been taken when this was cancelled. */
  voided_was_paid: number;
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
  void_reason_code: CancelReasonCode | null;
  void_note: string | null;
  voided_by_staff_id: number | null;
  modifiers: OrderItemModifier[];
  /**
   * Set on the component lines of a sold deal. `deal_group` is what ties one
   * tap of a deal together — the bill collapses a group into a single line at
   * the combo price, while the kitchen and every report still read the
   * individual rows. Null on ordinary lines.
   */
  deal_id: number | null;
  deal_group: number | null;
  deal_name: string | null;
}

/**
 * One deal as it appears on a bill or in the order panel: the lines that
 * belong to it, and what they add up to.
 */
export interface DealLineGroup {
  deal_group: number;
  deal_name: string;
  /** How many of this deal — derived from the component quantities. */
  qty: number;
  total: number;
  lines: OrderItem[];
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
 * Staff & cancellations — the accountability layer
 * ------------------------------------------------------------------ */

/**
 * Who is on the counter.
 *
 * Deliberately the lightest possible identity: a name and a 4-digit PIN, no
 * roles, no permissions, no accounts. Its only job is to put a name on a
 * cancellation, so the owner's per-staff report means something. The PIN
 * exists so a dishonest hand cannot simply pick a colleague's name from a
 * list before voiding a sale — without it, the whole report is forgeable.
 */
export interface StaffMember {
  id: number;
  name: string;
  /** Whether they appear on the sign-in list. History survives either way. */
  is_active: number;
  created_at: string;
  /** True when a PIN is set. The hash itself never leaves the main process. */
  has_pin: boolean;
}

/** The signed-in person, as the UI is allowed to know them. */
export interface StaffSession {
  id: number;
  name: string;
}

/**
 * Cancellation reasons are a fixed list, not free text.
 *
 * Free text cannot be counted, compared or charted — and "asdf" is a valid
 * free-text reason. A closed list means the owner can see that one person's
 * cancellations are overwhelmingly "Customer left" while everyone else's are
 * "Wrong order", which is exactly the kind of pattern worth noticing.
 */
export const CANCEL_REASONS = [
  'wrong_order',
  'customer_left',
  'out_of_stock',
  'duplicate',
  'other',
] as const;

export type CancelReasonCode = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABELS: Record<CancelReasonCode, string> = {
  wrong_order: 'Wrong order',
  customer_left: 'Customer left',
  out_of_stock: 'Out of stock',
  duplicate: 'Duplicate',
  other: 'Other',
};

/** One cancelled order, as the owner's report lists it. */
export interface CancellationRecord {
  order_id: number;
  order_no: string;
  type: OrderType;
  table_name: string | null;
  /** Money involved: what was actually taken if paid, else the running total. */
  amount: number;
  /** True when the money had already been taken — the serious case. */
  was_paid: boolean;
  reason_code: CancelReasonCode | null;
  reason_label: string;
  note: string | null;
  staff_id: number | null;
  staff_name: string | null;
  cancelled_at: string;
  item_count: number;
  items: Array<{ item_name: string; qty: number; line_total: number }>;
}

/** Per-person totals — the number that exposes an outlier. */
export interface CancellationByStaff {
  staff_id: number | null;
  staff_name: string;
  count: number;
  total_value: number;
  /** Of that count, how many were of orders already paid for. */
  paid_count: number;
  paid_value: number;
}

export interface CancellationsReport {
  from: string;
  to: string;
  total_count: number;
  total_value: number;
  paid_count: number;
  paid_value: number;
  by_staff: CancellationByStaff[];
  by_reason: Array<{ reason_code: string; reason_label: string; count: number; value: number }>;
  records: CancellationRecord[];
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
