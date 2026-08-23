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
  image_file: string | null;
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
  /** Filename inside <userData>/images/. Null when no photo is set. */
  image_file: string | null;
  /** Modifier groups attached to this item, hydrated for the order screen. */
  modifier_groups?: ModifierGroup[];
  /**
   * Sizes/portions. Empty for a single-price item; when present the order
   * screen asks which one before the line is added.
   */
  variants: MenuItemVariant[];
  /** Cheapest variant price, so the grid can show "from Rs 600". */
  price_from?: number;
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
  image_file: string | null;
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

/**
 * A size/portion of a menu item, with its OWN absolute price.
 *
 * Deliberately not a modifier with a price delta. A pizza menu carries several
 * unrelated pricing tiers — stuffed at 1749/1999, white sauce at
 * 749/1299/1699/2199, red at 600/1199/1499/1999 — and a shared delta cannot
 * express them at once. Half/Full portions differ per dish for the same
 * reason. Storing the real price removes the arithmetic entirely.
 */
export interface MenuItemVariant {
  id: number;
  item_id: number;
  name: string;
  sale_price: number;
  cost_price: number;
  is_available: number;
  sort_order: number;
}

/* ------------------------------------------------------------------ *
 * Extras — packaging and disposables, charged per order
 * ------------------------------------------------------------------ */

/**
 * A chargeable extra the shop keeps on a list: disposable plates, glasses,
 * a carry bag.
 *
 * Deliberately NOT a menu item. A menu item is food the kitchen makes and it
 * counts towards best-sellers and food margin; packaging is neither. Keeping
 * them apart is what lets an owner see "we sold Rs 40,000 of food and Rs 900
 * of plates" rather than one blended number.
 */
export interface ExtraCharge {
  id: number;
  name: string;
  price: number;
  /** What it costs the shop. Zero is fine — plates are often near-free. */
  cost_price: number;
  is_active: number;
  sort_order: number;
}

/** One extra as it sits on an order, with its price snapshotted. */
export interface OrderExtra {
  id: number;
  order_id: number;
  extra_id: number | null;
  name: string;
  price: number;
  cost_price: number;
  qty: number;
  line_total: number;
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
  /** Charged to deliver. Its own field, never folded into item prices. */
  delivery_charge: number;
  /** Packaging and disposables — the sum of `extras`, kept out of subtotal. */
  extras_total: number;
  /** The business day this order was taken on. Null if none was open. */
  session_id: number | null;
  /** Where the rider is going. Required for a delivery order. */
  delivery_address: string | null;
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
  /** Packaging charged on this order. Empty on most orders. */
  extras: OrderExtra[];
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
  /** Snapshot of the chosen size, e.g. "Large". Null for single-price items. */
  variant_name: string | null;
  variant_id: number | null;
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
  /** Which size was chosen. Required when the item has variants. */
  variant_id?: number | null;
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
 * Business day sessions — Open Day / Close Day
 * ------------------------------------------------------------------ */

/**
 * A trading day, bounded by when the owner opens and closes it rather than by
 * the clock. The shop trades past midnight, so an order settled at 1am belongs
 * to the night still running, not the morning that has technically begun.
 */
export interface DaySession {
  id: number;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  opened_by: number | null;
  closed_by: number | null;
  notes: string | null;
}

/** Everything the end-of-day report states, computed from one session. */
export interface DayReport {
  session: DaySession;
  order_count: number;
  by_type: Array<{ type: OrderType; order_count: number; sales: number }>;
  sales_total: number;
  /**
   * Sales minus what the FOOD cost — item level only.
   *
   * Deliberately not the stored `orders.profit`, which also folds in the
   * service charge, delivery fee and packaging. Those are not food margin,
   * and labelling them as such would overstate what the kitchen earned.
   *
   * NULL when the report was requested by the counter rather than the owner.
   * Counter staff open and close the day and count the drawer against it, but
   * margin is the owner's number — so the main process strips it rather than
   * relying on a screen to hide it.
   */
  gross_profit: number | null;
  service_charges: number;
  delivery_charges: number;
  extras_total: number;
  cancelled_count: number;
  cancelled_value: number;
  top_items: Array<{ item_name: string; qty: number; revenue: number }>;
  cash_sales: number;
  card_sales: number;
  /** Only meaningful when an opening float was entered. */
  expected_cash: number | null;
  /** Unpaid orders still attached to this session when it closed. */
  unpaid_count: number;
  unpaid_total: number;
}

/**
 * An unpaid order, with what it owes right now.
 *
 * `total` is 0 on an open order — the money is fixed at the till. `amount_due`
 * is that figure computed live, by the same formula settlement uses.
 */
export interface UnpaidOrder extends Order {
  amount_due: number;
}

/* ------------------------------------------------------------------ *
 * Customers — remembered by phone number
 * ------------------------------------------------------------------ */

/**
 * A returning customer, looked up by the phone number the counter already
 * asks for on takeaway and delivery orders.
 *
 * Its whole purpose is saving the counter from typing an address twice. The
 * record is a convenience layer over what the order already stores — orders
 * keep their own snapshot of name, phone and address, so deleting a customer
 * can never alter what a past bill said.
 */
export interface Customer {
  id: number;
  phone: string;
  name: string | null;
  address: string | null;
  /** Anything the counter should know: "gate at the back", "no chilli". */
  notes: string | null;
  created_at: string;
  last_order_at: string | null;
  order_count: number;
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
  /** Delivery fees taken in the period — money with no food cost behind it. */
  delivery_total: number;
  /** Packaging and disposables charged in the period. */
  extras_total: number;
  order_count: number;
  days: Array<{ date: string; sales: number; profit: number; orders: number }>;
}

export interface SalesByType {
  type: OrderType;
  order_count: number;
  sales: number;
  profit: number;
  /** Zero for dine-in and takeaway; the fees collected for delivery. */
  delivery_charge: number;
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
  /** 'dark' or 'light'. The counter's choice, kept across restarts. */
  theme: 'theme',
  /** Pre-filled on a delivery order; staff can still change it per order. */
  deliveryCharge: 'delivery_charge',
  /**
   * 'fixed' or 'percent'. Fixed is the default: most small food points add a
   * flat cover charge rather than a percentage of the bill.
   */
  serviceChargeMode: 'service_charge_mode',
  /** The rupee amount used when the mode is 'fixed'. */
  serviceChargeAmount: 'service_charge_amount',
  /**
   * Filename of the shop logo inside <userData>/upload/logo/.
   * A filename, never a URL — the app must render it with no network.
   */
  shopLogo: 'shop_logo',
  /** Optional line printed under the thank-you, e.g. a return policy. */
  receiptFooter: 'receipt_footer',
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
  [SETTING_KEYS.theme]: 'dark',
  [SETTING_KEYS.deliveryCharge]: '0',
  [SETTING_KEYS.serviceChargeMode]: 'fixed',
  [SETTING_KEYS.serviceChargeAmount]: '0',
  [SETTING_KEYS.shopLogo]: '',
  [SETTING_KEYS.receiptFooter]: '',
};

/** Labels live here so the whole app names an order type the same way. */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};
