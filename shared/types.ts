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
  /**
   * Sold by weight/bulk (e.g. rice by the kg) rather than as a fixed unit.
   * `sale_price` is then read as the PER-UNIT price. Only settable, and only
   * ever true, when "Enable weight-based items" is switched on in Settings —
   * see SETTING_KEYS.enableWeightItems.
   */
  sold_by_weight: number;
  /** Unit for a weight-based item, e.g. "kg". Null for an ordinary item. */
  unit_label: string | null;
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
  /**
   * Money actually collected so far. Zero while the order is open. Equals
   * `total` on an ordinary settle; less than `total` only when "Enable
   * partial payments" is on and the counter took an advance rather than the
   * full amount — see SETTING_KEYS.enablePartialPayments.
   */
  amount_paid: number;
  /** `total - amount_paid`, floored at zero. Zero once fully paid. */
  balance_due: number;
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
  /**
   * Which waiter this order belongs to. Only ever set on a takeaway order,
   * and only when "Enable waiters" is on — dine-in and delivery never carry
   * one. Null on every order taken before the feature existed or with it off.
   */
  waiter_id: number | null;
  /**
   * Snapshot of the waiter's name at the moment the order was opened, exactly
   * like `customer_name` — so renaming or deleting a waiter later never
   * changes what a past bill or report says.
   */
  waiter_name: string | null;
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
  /**
   * Snapshot of the item's unit, e.g. "kg", for a weight-based line — `qty` is
   * then the weight, not a count. Null on every ordinary line, exactly like
   * `variant_name`, so a unit changed on the menu tomorrow cannot rewrite
   * today's bill.
   */
  unit_label: string | null;
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
  /** Empty when waiters are off, or nobody took a waiter-tagged order that day. */
  by_waiter: SalesByWaiter[];
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
  /**
   * Orders SETTLED this session that still owe a balance — distinct from
   * `unpaid_*` above, which is orders never charged at all. Zero on a shop
   * that has never turned "Enable partial payments" on. See Order.balance_due.
   */
  partial_count: number;
  partial_balance_total: number;
  /**
   * Money recorded out this session — vegetables, gas, waiter wages. Empty and
   * zero on a shop that has never turned "Enable daily expenses" on.
   */
  expenses: Array<{ id: number; description: string; amount: number; source: 'manual' | 'wages' }>;
  expenses_total: number;
  /**
   * cash_sales - expenses_total. Labelled deliberately as a cash POSITION, not
   * profit — it says nothing about food cost or margin, only what is left in
   * the drawer. Null until at least one expense has ever been recorded, so a
   * shop that has never used the feature sees no new line on its slip.
   */
  net_cash_position: number | null;
  /**
   * Per-waiter wages paid this session — empty on a shop that has never
   * turned "Enable waiter wages" on, or that has no waiters at all.
   */
  waiter_wages: Array<{ waiter_name: string; amount: number; pay_type?: WaiterPayType }>;
  waiter_wages_total: number;
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

/* ------------------------------------------------------------------ *
 * Waiters — optional, and only for takeaway
 * ------------------------------------------------------------------ */

/**
 * Who a takeaway order is being run for.
 *
 * Deliberately separate from `StaffMember`: staff is about who is allowed to
 * cancel a sale, waiters is about which floor person a takeaway belongs to —
 * a shop may run one roster, both, or neither. Managed entirely from the
 * admin portal; the counter only ever sees the dropdown this feeds.
 */
/** How often a waiter is paid. Decides which day-close reviews they appear on. */
export const WAITER_PAY_TYPES = ['daily', 'weekly', 'monthly'] as const;
export type WaiterPayType = (typeof WAITER_PAY_TYPES)[number];

export const WAITER_PAY_TYPE_LABELS: Record<WaiterPayType, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** Sunday-first, matching JS `Date#getDay()` — index IS the stored `payday`. */
export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export interface Waiter {
  id: number;
  name: string;
  /** A short code, e.g. for a badge or a walkie-talkie call sign. Optional. */
  code: string | null;
  /** Deactivated waiters drop off the order-screen dropdown but keep history. */
  is_active: number;
  created_at: string;
  /**
   * How often this waiter is paid. Set once when the waiter is added and
   * editable in admin. Only consulted when "Enable waiter wages" is on — it
   * decides which day-close wages reviews this waiter is offered on at all;
   * see SETTING_KEYS.enableWaiterWages and WaiterWageEntry.
   */
  pay_type: WaiterPayType;
  /**
   * Which day this waiter is due, for 'weekly' (0-6, Sunday=0 — see
   * WEEKDAY_LABELS) or 'monthly' (1-31, the day of the month; a payday past
   * the end of a short month falls on that month's last day instead, so a
   * salary is never silently skipped in February). Null for 'daily', which
   * has no payday — a daily waiter is offered on every review.
   */
  payday: number | null;
  /** The default amount for one pay period, at `pay_type`'s cadence. */
  wage_rate: number;
}

/* ------------------------------------------------------------------ *
 * Expenses & waiter wages — optional, admin-only cash-out tracking
 * ------------------------------------------------------------------ */

/**
 * Money that left the till — vegetables, a gas cylinder, waiter wages.
 *
 * Attached to whichever day session was open when it was recorded, falling
 * back to the calendar date when none was — exactly like an order taken with
 * no day open. Only ever created from the admin portal; counter staff never
 * reach it. See SETTING_KEYS.enableDailyExpenses.
 */
export interface Expense {
  id: number;
  description: string;
  amount: number;
  /** The day session this was recorded against, or null if none was open. */
  session_id: number | null;
  /** Always set, so an expense taken with no day open still files somewhere. */
  expense_date: string;
  /**
   * 'manual' is anything the owner typed in. 'wages' is the one line the
   * waiter-wages step writes — it is upserted per session rather than
   * duplicated on every save, and cannot be edited or deleted from the
   * ordinary expense list; see SETTING_KEYS.enableWaiterWages.
   */
  source: 'manual' | 'wages';
  created_at: string;
}

/**
 * One waiter's wage for one pay event — the row the owner reviews, edits
 * and saves at day close.
 *
 * `amount` is what was actually saved, which is the number that counts even
 * when it differs from the waiter's own `wage_rate` default (someone didn't
 * turn up, or was paid something else that day). See SETTING_KEYS.enableWaiterWages.
 */
export interface WaiterWageEntry {
  waiter_id: number;
  waiter_name: string;
  amount: number;
  /**
   * Present on the draft (pre-save) list and on a saved session's record, so
   * the review — and later the report — can show WHY this waiter appeared:
   * "Ali — Weekly". Absent only on very old rows saved before this existed.
   */
  pay_type?: WaiterPayType;
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
  /**
   * Set when these figures cover an OPEN trading day rather than a calendar
   * date, so the screen can say "since 10:00 AM" instead of naming a date that
   * the night has already run past.
   */
  session_opened_at: string | null;
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

/** Per-waiter totals — only meaningful once "Enable waiters" is switched on. */
export interface SalesByWaiter {
  waiter_id: number | null;
  waiter_name: string;
  order_count: number;
  sales: number;
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
  /** Off by default. On, a takeaway order must name a waiter before it opens. */
  enableWaiters: 'enable_waiters',
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

  /* ---- Branding. Only ever written by a build with branding enabled. ---- */
  /**
   * The nine brand colours as JSON, e.g. {"accent":"232 92 54",...}.
   * One key rather than nine, so applying a preset is a single atomic write
   * and a half-applied palette cannot exist.
   */
  themeColors: 'theme_colors',
  /** Which preset is selected, or 'custom' once the client edits a colour. */
  themePreset: 'theme_preset',
  /**
   * Filename of the background artwork inside <userData>/upload/theme/.
   * A filename, never a URL — the app must render it with no network.
   */
  themeArt: 'theme_art',
  /** Artwork strength on the dashboard, 0-100. */
  themeArtOpacity: 'theme_art_opacity',
  /** How much page colour veils the artwork on the working screens, 0-100. */
  themeArtVeil: 'theme_art_veil',

  /* ---- Optional features, each OFF by default and invisible while off ---- */
  /** On, a menu item can be marked "sold by weight" and priced per unit. */
  enableWeightItems: 'enable_weight_items',
  /** On, the charge step can take an advance instead of the full amount. */
  enablePartialPayments: 'enable_partial_payments',
  /** On, the admin portal grows an Expenses section. */
  enableDailyExpenses: 'enable_daily_expenses',
  /** On, day close grows a per-waiter wages review that posts into expenses. */
  enableWaiterWages: 'enable_waiter_wages',
} as const;

export const DEFAULT_SETTINGS: SettingsMap = {
  [SETTING_KEYS.businessName]: 'My Food Point',
  [SETTING_KEYS.businessAddress]: '',
  [SETTING_KEYS.businessPhone]: '',
  [SETTING_KEYS.printerCustomer]: '',
  [SETTING_KEYS.printerKitchen]: '',
  [SETTING_KEYS.enableTables]: '1',
  [SETTING_KEYS.enableKitchenPrint]: '1',
  [SETTING_KEYS.enableWaiters]: '0',
  [SETTING_KEYS.serviceChargePercent]: '0',
  [SETTING_KEYS.currencySymbol]: 'Rs.',
  [SETTING_KEYS.managerPin]: '',
  [SETTING_KEYS.theme]: 'dark',
  [SETTING_KEYS.deliveryCharge]: '0',
  [SETTING_KEYS.serviceChargeMode]: 'fixed',
  [SETTING_KEYS.serviceChargeAmount]: '0',
  [SETTING_KEYS.shopLogo]: '',
  [SETTING_KEYS.receiptFooter]: '',
  // Blank means "never branded" — the app falls back to DEFAULT_THEME, which
  // is the stock navy. A simple build never writes these.
  [SETTING_KEYS.themeColors]: '',
  [SETTING_KEYS.themePreset]: 'default',
  [SETTING_KEYS.themeArt]: '',
  [SETTING_KEYS.themeArtOpacity]: '30',
  [SETTING_KEYS.themeArtVeil]: '90',

  // All four OFF — a shop that never visits Settings sees no change at all.
  [SETTING_KEYS.enableWeightItems]: '0',
  [SETTING_KEYS.enablePartialPayments]: '0',
  [SETTING_KEYS.enableDailyExpenses]: '0',
  [SETTING_KEYS.enableWaiterWages]: '0',
};

/** Labels live here so the whole app names an order type the same way. */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};
