---
name: food-frontend
description: Build the food-point-specific Next.js UI for Code Hustlers' offline Food-Point Billing System, running inside Electron. Use this ALONGSIDE offline-desktop-frontend whenever the task involves the food app's look or screens — the warm espresso/tomato colour theme, the two-panel order screen (item grid + running order), category tabs, the sold-out toggle, order types, the dine-in tables grid, modifiers UI, or the kitchen-ticket flow from the UI side. Trigger even if the user only says "the food theme", "the order screen", "the item grid", "the tables view", "send to kitchen button", or "make the food app look right".
---

# Food-Point Frontend (theme + screens delta)

You are building the **food-point-specific** UI for Code Hustlers' Food-Point Billing System. This skill is a **delta on top of `offline-desktop-frontend`** — that skill still governs the whole foundation: static-export Next.js (`output: 'export'`, no server, no `fetch`), the preload `window.api` bridge wrapped in `src/lib/api.ts`, Inter bundled locally, tabular numbers, big totals, dark sidebar + light workspace, empty states, plain errors, `strings.ts` for future Urdu. **Do not re-decide any of that.** This skill only covers what makes the food point look and behave like a food point.

Read `Food_Point_System_Build_Spec_v1.md` for scope.

**Numbers on screen must match the backend's.** Never recompute a total, a service charge, or profit in the renderer to "preview" it — display what `orders.get` / `orders.settle` return. Two formulas for one number is how a bill and a report end up disagreeing.

## Theme — dark navy + glass (v2, REPLACES the v1 warm palette)

> **Changed 2026-08-20 by the founder.** v1 shipped warm espresso/tomato. It now uses a **dark navy base with gradient accents and glassmorphism**, to look premium next to cheaper competitors. The **warm accent is kept** — warm against cool navy is what stops a food app reading as corporate software. **Do not revert to the espresso/warm-paper surfaces.**

**All colours live in exactly one place: `src/app/globals.css` `:root`.** Nine values drive the whole app; everything else is derived with `color-mix()`. There are **no colour literals anywhere else in the CSS and none in any `.tsx`**. That is the white-labelling contract — a client is reskinned by editing those nine values and replacing `public/logo.png`. Putting a hex value in a component silently breaks it.

```css
:root {
  --brand-deep-rgb:  9 20 36;    /* sidebar + dashboard base */
  --brand-mid-rgb:  18 40 71;    /* gradient partner */
  --brand-soft-rgb: 32 66 110;   /* lifted navy inside dark areas */
  --accent-rgb:    232 92 54;    /* Charge, Send to kitchen */
  --accent-2-rgb:  245 165 36;   /* accent gradient partner */
  --success-rgb:   34 168 106;   /* money, paid, profit */
  --warning-rgb:  214 152 12;
  --danger-rgb:   202 46 58;     /* void, delete, stop */
  --canvas-rgb:   244 246 249;   /* the light workspace paper */
}
```

**Accent vs danger — keep them apart.** Both are warm reds: bright accent = **go** (Charge, Send to kitchen); deeper crimson = **undo/stop** (Void, delete). Never blur them — a cashier under pressure must not confuse "charge" with "void". Green = money/paid.

### The two registers — the rule that protects the counter

| Register | Screens | Treatment |
|----------|---------|-----------|
| **RICH** | Dashboard, Activation | Dark navy, real `backdrop-filter` blur, gradient accents, layered depth, coloured stat tiles, a CSS chart. Looked **at**. |
| **CALM** | Order, Menu, Deals, Tables, Reports, Settings | Light paper, flat surfaces, high contrast. **No blur, no gradient wash behind text or numbers.** Looked **through**, all day, on a cheap monitor in a bright room. |

Selected by one class: `.workspace.rich`, set via the `AppShell` `rich` prop. **Glass behind a price column is a legibility bug, not a style.** Do not add glassmorphism to the order screen, the menu table or any data-entry form, however good it looks in a screenshot.

**Logo:** one slot — `public/logo.png`, read by the sidebar, the activation screen and the window/dock icon. Replace that one file to rebrand.

**Nothing is ever downloaded.** The background texture on the rich screens is CSS gradients, not an image file — no bytes, cannot fail to load, and it re-tints itself with the brand tokens. Fonts are a pure system stack for the same reason.

## Sidebar

Navy left nav (glass active state, gradient rail), icon + label: **Dashboard · New order · Orders · Tables · Menu · Deals · Reports · Settings**. Hide **Tables** when `enable_tables = 0` (pure takeaway counters never see it).

## The order screen — the heart (two-panel, touch-first)

This is where the app lives all day. Build it as **two panels**:

- **Left — item grid.** Category tabs across the top; large tappable item cards below. One tap adds to the current order. **Sold-out items (`is_available = 0`) render greyed and are not tappable.** A big, keyboard-first search box (autofocused, `/` refocuses it, Escape clears) helps big menus.
- **Deals** lead the grid on "All" and own a **Deals** tab. One tap adds the whole combo. A deal card carries the accent tint, a tag, its contents and the struck-through separate price — but **not** a gradient wash, because the price still has to be read at a glance.
- **Right — running order panel.** The current order's lines (name, modifiers, qty, line total), a big running **Total**, and the two primary actions: **Send to kitchen** and **Charge**.

Flow specifics:
- Starting an order picks a **type**: Dine-in (choose a table) / Takeaway / Delivery (optional name + phone).
- Tapping an item with modifier groups opens a quick **modifier picker** (Size / Spice / Add-ons) before it lands on the line; allow a free-text line note ("no onions").
- **Send to kitchen** fires only the not-yet-fired lines (they get a subtle "fired" marker); you can keep adding and fire again.
- **Charge** opens settle: discount, optional service charge, payment method → prints the bill, closes the order, frees the table.
- **Hold / switch orders freely.** Several orders are open at once — the UI must always make it obvious **which order/table you're on** (a clear header chip). Switching must be one tap.
- **Void** an item or the order (crimson) — always ask for a reason, and prompt for the **manager PIN** when one is set in settings. The PIN is checked in the backend; the UI just collects it and shows the plain error ("That PIN doesn't match.") if it fails.

## Tables / floor — NEW (dine-in, toggleable)

A simple grid of table cards: **free** (quiet) vs **occupied** (accent-tinted, showing the running total). Both the status and the total come from a single `tables.list` call — status is derived from open orders in the backend, not stored, so the floor can never show a stale "occupied". Tap free → start its order; tap occupied → resume. No reservations, no drag-drop floor plan in v1 — just clear, big, tappable cards. Entire screen hidden when tables are disabled.

## Deals — a bundle at one fixed price

A deal is stored as its **component menu items** (see `food-backend`), but the counter and the customer see **one line at the combo price**. So:

- The running-order panel **collapses** a deal's component rows into a single row: tag, deal name, contents as a subtitle, and the combo total. Grouping is by `order_items.deal_group`.
- **Voiding a deal voids the whole bundle** — offer the void on the collapsed row, not per component. A half-combo is not a thing.
- **A deal component's quantity cannot be edited** on its own; the backend refuses it. Void and re-add.
- The **Deals admin screen** (`/deals/`) is a CALM data screen: plain rows, name, contents, separate menu value, combo price, the saving, and an active/inactive toggle. While a price is being typed, show what the parts cost separately — it is easy to price a "deal" above its own ingredients by accident.

## Other screens

- **Dashboard** — the RICH screen. It must **never open empty**: coloured glass stat tiles (sales, **profit** big and green, orders + best seller, open orders), a **sales-by-hour bar chart** drawn in CSS across a fixed 9am–midnight frame so the shape of the day is comparable and the chart has a frame before the first order, and a recent-orders table. Big **New order** button. *(No expiry strip — irrelevant to food.)*
- **Menu** — categories + items with price, **food cost**, and the **one-tap availability toggle**; attach modifier groups. Fast and unfussy — owners edit this rarely but need it obvious.
- **Reports** — daily/range sales & profit, **by order type**, **best sellers**, **sales by hour**, **voids**. Plain, printable.
- **Settings** — business name/address/phone, **two printer selectors** (customer + kitchen), **enable tables** + **enable kitchen print** toggles, optional **service charge %**, optional **manager PIN** (set / change / clear, with "leave blank to allow voids without a PIN" said plainly), currency, Backup/Restore.

## The differentiators — make them obvious

- **A fast, unconfusing order flow** — fewest taps from item → fire → paid, with many orders open at once handled cleanly. This *is* the product; spend your polish here.
- **Knowing the numbers** — daily profit (green card), plus best-seller and busiest-hour on the dashboard.

## Do not

- Do not revert to the v1 espresso/warm-paper surfaces.
- **No hard-coded colours anywhere** — not in CSS outside `:root`, not in a component. It breaks white-labelling.
- No glass, blur or gradient wash on the order screen, menu, deals, tables, reports or settings.
- Don't let a sold-out item look tappable; don't lose track of which order is active.
- Don't re-implement layout, typography, the api client, or the UX floor — that's `offline-desktop-frontend`.
- No `fetch`, CDNs, servers, or online anything — the app is fully offline.
