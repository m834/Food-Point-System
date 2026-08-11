---
name: food-frontend
description: Build the food-point-specific Next.js UI for Code Hustlers' offline Food-Point Billing System, running inside Electron. Use this ALONGSIDE offline-desktop-frontend whenever the task involves the food app's look or screens — the warm espresso/tomato colour theme, the two-panel order screen (item grid + running order), category tabs, the sold-out toggle, order types, the dine-in tables grid, modifiers UI, or the kitchen-ticket flow from the UI side. Trigger even if the user only says "the food theme", "the order screen", "the item grid", "the tables view", "send to kitchen button", or "make the food app look right".
---

# Food-Point Frontend (theme + screens delta)

You are building the **food-point-specific** UI for Code Hustlers' Food-Point Billing System. This skill is a **delta on top of `offline-desktop-frontend`** — that skill still governs the whole foundation: static-export Next.js (`output: 'export'`, no server, no `fetch`), the preload `window.api` bridge wrapped in `src/lib/api.ts`, Inter bundled locally, tabular numbers, big totals, dark sidebar + light workspace, empty states, plain errors, `strings.ts` for future Urdu. **Do not re-decide any of that.** This skill only covers what makes the food point look and behave like a food point.

Read `Food_Point_System_Build_Spec_v1.md` for scope.

**Numbers on screen must match the backend's.** Never recompute a total, a service charge, or profit in the renderer to "preview" it — display what `orders.get` / `orders.settle` return. Two formulas for one number is how a bill and a report end up disagreeing.

## Theme — warm hospitality (REPLACES the shop palette)

Shop is cool navy (retail); pharmacy is clinical teal (health). A food point should feel **warm, appetising, inviting** — a deep espresso sidebar on a warm-paper workspace with a tomato accent. Use these EXACT tokens; typography and structure are otherwise unchanged.

```css
:root {
  /* Brand & structure — warm hospitality */
  --brand-espresso:       #2B211C;  /* side nav, headers */
  --brand-espresso-hover: #201813;
  --accent:               #E24B32;  /* primary: Send to kitchen, Charge — appetising tomato */
  --accent-hover:         #C43D28;

  /* Surfaces — warm, not cool */
  --bg:                   #FAF7F3;  /* warm-paper workspace */
  --surface:              #FFFFFF;
  --border:               #ECE4DB;

  /* Text */
  --text:                 #241E1B;
  --text-muted:           #6E635C;

  /* Semantic */
  --success:              #2E9E5B;  /* profit, paid, money */
  --warning:              #E0A400;  /* attention (used lightly) */
  --danger:               #B02A37;  /* deep crimson — void, delete, unpaid */
}
```

**Accent vs danger — keep them apart.** Both are warm reds, so pitch them deliberately: **bright tomato (`--accent`) = go** (Charge, Send to kitchen); **deeper crimson (`--danger`) = undo/stop** (Void, delete). Never blur them — a cashier under pressure must not confuse "charge" with "void". Green = money/paid. The **warm-paper `--bg`** is part of the identity — don't swap it for a cool grey.

## Sidebar

Espresso left nav, icon + label: **Dashboard · New order · Tables · Menu · Reports · Settings**. Hide **Tables** when `enable_tables = 0` (pure takeaway counters never see it).

## The order screen — the heart (two-panel, touch-first)

This is where the app lives all day. Build it as **two panels**:

- **Left — item grid.** Category tabs across the top; large tappable item cards below. One tap adds to the current order. **Sold-out items (`is_available = 0`) render greyed and are not tappable.** A search box helps big menus.
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

## Other screens

- **Dashboard** — Today's sales + **Today's profit** (big, green), **open orders / open tables** count (tap to resume), today's order count, a small **best-seller today** and **busiest hour** peek, big **New order** button. *(No expiry strip — irrelevant to food.)*
- **Menu** — categories + items with price, **food cost**, and the **one-tap availability toggle**; attach modifier groups. Fast and unfussy — owners edit this rarely but need it obvious.
- **Reports** — daily/range sales & profit, **by order type**, **best sellers**, **sales by hour**, **voids**. Plain, printable.
- **Settings** — business name/address/phone, **two printer selectors** (customer + kitchen), **enable tables** + **enable kitchen print** toggles, optional **service charge %**, optional **manager PIN** (set / change / clear, with "leave blank to allow voids without a PIN" said plainly), currency, Backup/Restore.

## The differentiators — make them obvious

- **A fast, unconfusing order flow** — fewest taps from item → fire → paid, with many orders open at once handled cleanly. This *is* the product; spend your polish here.
- **Knowing the numbers** — daily profit (green card), plus best-seller and busiest-hour on the dashboard.

## Do not

- No shop navy/orange, no pharmacy teal/blue — use the warm espresso/tomato tokens.
- No hard-coded colours; keep accent (go) and danger (undo) visually distinct.
- Don't let a sold-out item look tappable; don't lose track of which order is active.
- Don't re-implement layout, typography, the api client, or the UX floor — that's `offline-desktop-frontend`.
- No `fetch`, CDNs, servers, or online anything — the app is fully offline.
