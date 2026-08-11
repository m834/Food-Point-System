---
name: food-backend
description: Build the food-point-specific backend (Electron main process) for Code Hustlers' offline Food-Point Billing System. Use this ALONGSIDE offline-desktop-backend whenever the task involves food domain logic — the menu/orders data model, orders that stay OPEN and settle later, holding many orders at once, "send to kitchen" firing and kitchen-ticket (KOT) printing, order types (dine-in/takeaway/delivery), dine-in tables, modifiers, voids, or settle-time profit. Trigger even if the user only says "the order flow", "fire to kitchen", "the KOT", "open orders", "tables", "modifiers", "settle the bill", or "voids" for the food app.
---

# Food-Point Backend (domain layer)

You are building the **food-point-specific** backend for Code Hustlers' Food-Point Billing System. This skill is a **delta on top of `offline-desktop-backend`** — that skill still governs everything generic: offline-only rules, `contextIsolation`/`sandbox` security, the named minimal IPC surface, `{ ok, data|error }` returns, WAL mode, verify-only licensing, backup/restore, and ESC/POS printing. **Do not re-decide any of that here.** This skill only covers what a food point adds.

Read `Food_Point_System_Build_Spec_v1.md` (in this repo) for scope. Where the food spec is silent, the shop spec governs — it lives in the sibling repo at `../POS-Shop-Inventory-System/Shop inventory system build spec.md`, alongside the shop implementation this app is forked from.

## The one idea that drives everything: orders stay OPEN

The shop completed a sale in one shot. A food point does not. An **order** is opened, items are added and **fired to the kitchen** over time, several orders are **open at once** (tables + takeaways in parallel), and only at the end is it **settled** — and the settled order *is* the bill. There is **no separate `invoices` table**; reports read settled `orders`.

Model:
- **`menu_categories`** / **`menu_items`** — the catalogue. `menu_items` has `sale_price`, `cost_price` (**estimated food cost**, for profit), `is_available` (the one-tap "86" toggle). **No expiry, no batch, no stock-on-hand** — a food point makes food to order.
- **`modifier_groups`** / **`modifiers`** / **`item_modifier_groups`** — Size / Spice / Add-ons with `price_delta`.
- **`orders`** — `order_no` (UNIQUE), `type` (dine_in/takeaway/delivery), `table_id?`, `status` (open/settled/void), `opened_at`, `settled_at?`, totals, `profit`, `payment_method`, `void_reason`/`voided_at`.
- **`order_items`** — snapshot `item_name`/`cost_price`/`sale_price`, `qty`, `notes`, plus **`kitchen_status`** (new/fired/served/void), **`fired_at`**, and `void_reason`/`voided_at`.
- **`order_item_modifiers`** — snapshot chosen modifiers per line.
- **`tables`** — dine-in only; **no stored status column**, see below.

## Order lifecycle operations

Keep these as distinct backend operations. Adding an item is **not** the same as firing it, and firing is **not** settling.

1. **openOrder(type, tableId?)** → creates an `open` order. Reject a second open order on a table that already has one (offer resume instead). Assign `order_no` as `YYYYMMDD-NNN` **inside this transaction** — take `MAX(order_no)` under today's `LIKE 'YYYYMMDD-%'` prefix, parse the suffix, add one. Never `COUNT(*)` (it reissues a number the moment an order is voided), never precomputed in the UI, and keep the `UNIQUE` constraint as the backstop. Two orders opened a second apart must not collide.
2. **addItems(orderId, lines)** → append `order_items` with `kitchen_status = 'new'`, snapshotting price/cost and modifier deltas into `line_total`. Recompute the order subtotal. Does **not** print.
3. **fireToKitchen(orderId)** → the KOT step. Select only `kitchen_status = 'new'` items, mark them `fired` + set `fired_at`, and **print a kitchen ticket of just those items** (§ printing). Firing again later prints a second ticket with only the newly-added items. Never reprint already-fired items on a later fire.
4. **settleOrder(orderId, { discount, paymentMethod })** → the money step. Compute `profit` from snapshots **now**, set `status = 'settled'` + `settled_at`, print the **customer bill**. The service-charge percentage is read from `settings` in the main process — do not accept it from the renderer, which would let the UI book a different number than the owner configured.
5. **voidItem / voidOrder(reason, pin?)** → mark `void` and write `void_reason` + `voided_at` **onto the row**; the reason is required, and the voids report reads exactly those columns. Gated by `manager_pin`: if a PIN is set in settings, verify it here in the main process before voiding — never let the renderer decide the check passed. Blank PIN means voids are open.

```ts
// Settle: profit is locked in from snapshots at settle time — never from live menu prices.
const settleOrder = db.transaction((orderId, opts) => {
  const items = getOrderItems(orderId).filter(i => i.kitchen_status !== 'void');
  let subtotal = 0, cogs = 0;
  for (const it of items) {
    subtotal += it.line_total;              // already includes modifier deltas
    cogs     += it.qty * it.cost_price;     // snapshot cost — estimated food cost
  }
  // Service charge % comes from settings, NOT from the renderer.
  const pct = Number(getSetting('service_charge_percent') ?? 0);
  const discount = clampDiscount(opts.discount ?? 0, subtotal);   // validated: 0..subtotal
  const serviceCharge = round(subtotal * pct / 100);
  const total  = subtotal - discount + serviceCharge;
  const profit = total - cogs;             // follows the money actually taken — see below
  finalizeOrder(orderId, {
    subtotal, discount, service_charge: serviceCharge,
    total, profit, payment_method: opts.paymentMethod,
    status: 'settled', settled_at: nowIso(),
  });
  return orderId;                          // the table frees itself — status is derived
});
```

**Profit is `total - cogs`, not the sum of per-line margins.** `Σ qty × (sale_price - cost_price)` is wrong in two directions and both happen daily: a paid modifier ("+150 extra cheese") is folded into `line_total` and so into `subtotal`, but belongs to no line's `sale_price`, so per-line margin silently drops that revenue; and a discount reduces what the customer actually paid while touching no line, so per-line margin books profit the business never made. Deriving from `total` keeps the recorded number equal to money in minus food cost. Cost stays per-line — that's what the snapshots are protecting.

**Rules that are not optional:**
- **Profit is computed at settle time from snapshots on `order_items`** (plus modifier deltas). Changing a menu price tomorrow must not change today's recorded profit.
- **Many orders open concurrently.** Never assume a single "current sale". Every operation takes an explicit `orderId`.
- **Firing ≠ settling.** The kitchen ticket carries **no prices**; the customer bill carries money. They are two different print paths.
- **`is_available` is honoured on the server too** — reject adding a sold-out item, don't rely on the UI alone.

## Two print formats (extends offline-desktop-backend printing)

Same ESC/POS mechanism, two builders:
- **Customer bill** — business name/address/phone, order no + type + table, line items with modifiers + prices, subtotal, discount, service charge, **total**, thank-you.
- **Kitchen ticket (KOT)** — **only newly-fired items**, large/legible, **no prices**: order no + type + table + time, each item qty + modifiers + notes.

Printers come from settings (`printer_customer`, `printer_kitchen`). **Degrade gracefully to one printer:** if `enable_kitchen_print = 0` or only one printer exists, do not error — either route the KOT to the same printer or skip it per settings.

## Tables

**Derive free/occupied; never store it.** A table is occupied iff an `open` order references it:

```sql
SELECT t.id, t.name, t.area, o.id AS open_order_id, COALESCE(o.subtotal, 0) AS running_total
FROM tables t
LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
ORDER BY t.name;
```

One query gives both the status and the running total the floor screen needs. A stored `status` column is a second source of truth: one crash between settling an order and clearing the flag strands the table as permanently occupied with no way back, and someone has to edit the database at a counter mid-service. A floor is a handful of rows — the join costs nothing. No reservations, no floor-plan geometry in v1.

## IPC additions

Extend the preload surface (still named and minimal):
`menu.{listCategories,listItems,saveItem,setAvailable,saveCategory}`, `modifiers.{groups,save}`, `orders.{open,addItems,fire,settle,voidItem,voidOrder,listOpen,get,reprintBill}`, `tables.list` (returns status + running total from the join above). Reports/license/backup stay as `offline-desktop-backend` defines them, reading settled `orders`.

## Do not

- Do not add a separate `invoices` table — a settled order is the bill.
- Do not track per-ingredient stock or deduct raw ingredients per sale (recipe costing is deferred; use estimated per-item food cost).
- Do not print prices on the kitchen ticket.
- Do not assume one active order — always operate on an explicit `orderId`.
- Do not compute profit as the sum of per-line margins, and do not take the service-charge % or the result of a PIN check from the renderer.
- Do not store a `tables.status` column.
- Do not build users, roles, or a login. The only permission in v1 is the optional `manager_pin` on voids.
- Do not add online ordering / aggregator / delivery-tracking (needs internet — out of scope).
- Do not re-implement IPC security, licensing, backup, or base printing — that's `offline-desktop-backend`. Only add `product: "food"` to the license payload.
