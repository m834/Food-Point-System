---
name: offline-desktop-frontend
description: Build the Next.js frontend UI for Code Hustlers' offline retail desktop apps — the Shop Inventory, Pharmacy, and Food-Point billing systems that run inside Electron. Use this whenever working on the UI, screens, components, layout, styling, or design system of any of these offline desktop apps. Trigger for anything touching the dashboard, billing/cart screen, items list, reports, settings, license-activation screen, the colour theme, typography, or general look-and-feel — even if the user only says "the UI", "the billing screen", "make it look nicer", or "the design".
---

# Offline Desktop Frontend (Next.js + Electron)

You are building the UI for Code Hustlers' offline retail desktop apps. Small shopkeepers stare at this all day, so the design goal is **calm, fast, and unmistakably clear** — clarity and speed *are* the design, not decoration. A shopkeeper with no training must be able to bill within minutes.

In this repo the governing spec is `Food_Point_System_Build_Spec_v1.md`; the shop spec it extends is in the sibling repo at `../POS-Shop-Inventory-System/Shop inventory system build spec.md`. This skill is the *how* for the UI — note that the food app **replaces the navy/orange palette below** with the warm espresso/tomato tokens in `food-frontend`.

## How the UI runs

- **Next.js in static-export mode:** set `output: 'export'` in `next.config.js`. There is **no Next.js server** — the exported files run from disk inside Electron. Do not use API routes, server components that fetch, `getServerSideProps`, or the Next.js `Image` optimizer (use plain `<img>` or `unoptimized: true`).
- **No `fetch`, ever.** All data comes from the backend through the preload bridge: `window.api.items.list()`, `window.api.sales.create(cart)`, etc. Wrap these in a thin `src/lib/api.ts` client so components never call `window.api` directly.
- **State:** keep it simple. React state/context is enough; reach for Zustand only if a screen genuinely needs shared state. Data is the source of truth in SQLite — fetch on mount, refetch after mutations.

## Design system — use these EXACT tokens

Define once as CSS variables and never hard-code colours in components.

```css
:root {
  --brand-navy:       #14293F;  /* side nav, headers */
  --brand-navy-hover: #0E1E30;
  --accent:           #E07A2F;  /* primary actions: New Sale, Save, Charge */
  --accent-hover:     #C7691F;
  --bg:               #F5F7FA;  /* workspace background */
  --surface:          #FFFFFF;  /* cards, tables, panels */
  --border:           #E3E7ED;
  --text:             #1A2332;
  --text-muted:       #64707F;
  --success:          #178A5B;  /* profit, positive money, healthy stock */
  --warning:          #E0A400;  /* expiring soon, low stock */
  --danger:           #D64545;  /* expired, out of stock, delete */
}
```

**Semantic colour discipline (important):** green = money/healthy, amber = attention soon, red = problem now. Never use these three decoratively — the shopkeeper must be able to trust the colour at a glance.

**Typography:**
- UI face: **Inter** (bundle the font locally — no Google Fonts CDN, the app is offline).
- **All numbers use `font-variant-numeric: tabular-nums`** so prices, totals, and quantities align in columns and scan fast.
- Totals are the biggest text on their screen (cart total; today's profit).
- Sentence case everywhere. Buttons name the action exactly: **Save**, **Charge**, **Print receipt** — never "Submit".

**Layout:** dark navy left sidebar (persistent, icon + label: Dashboard, Billing, Items, Reports, Settings) beside a light workspace of white cards on `--bg`. Generous spacing, large touch targets (many shops use touchscreens), visible keyboard focus outlines.

## Screens to build

1. **License activation** (shown first if unlicensed): displays the Machine ID with a copy button and a key-entry field. On submit → `window.api.license.activate(key)`. Clear success/error states. This gates the whole app.
2. **Dashboard** (home): Today's sales and **Today's profit** (big, green). An **alerts strip** with counts of expired / expiring-soon / low-stock items, each tappable to the filtered Items view. A large **New Sale** button. A short list of today's recent sales.
3. **Billing** (most-used — speed beats everything): a cart where items are added by scanning a barcode or typing a name (live search, keyboard-first, Enter to add). Adjust qty, apply a simple discount, big running **Total**. **Charge** completes the sale (decrements stock, saves, prints). Minimise clicks from scan → charge.
4. **Items**: table with add/edit/delete, barcode-friendly search, stock adjust, expiry field. Row status colour: green healthy, amber expiring-soon/low-stock, red expired/out-of-stock. Filters: all / low stock / expiring soon / expired / by category.
5. **Reports**: daily sales & profit, date-range, stock (with total stock value), expiry, low stock, top sellers. Plain, readable, printable.
6. **Settings**: shop name/address/phone (printed on receipts), thermal printer selection, default low-stock threshold, `expiry_warning_days`, currency symbol, and Backup / Restore.

## The two differentiators — make them obvious

- **Alerts (expiry + low stock):** surface on the Dashboard strip *and* as row colours in Items. This is a headline reason people buy — never bury it.
- **Daily profit view:** a clear Dashboard card — "Today you sold X and earned Y profit." Green, prominent.

## UX quality floor

- **Empty states invite action:** an empty Items screen says "Add your first item", not a blank table.
- **Errors are plain and helpful**, in the interface's voice: "This barcode is already used by [item]." — never a code, never a vague apology.
- **Barcode scanner = keyboard input:** keep the search field focused during billing so a scan lands instantly.
- Respect `prefers-reduced-motion`; keep animation subtle. Too much motion reads as gimmicky and cheap.
- Responsive enough to work on the small, low-res screens common in shops.
- *(Future: optional Urdu UI. Keep all display strings in one `strings.ts` file now so localisation is a swap later — do not scatter hard-coded text through components.)*

## Do not

- No `fetch`, API routes, or anything needing a server or internet.
- No external font/CSS/JS CDNs — bundle everything locally.
- No hard-coded colours — use the tokens.
- Don't over-decorate. Spend boldness in one place (a clean dashboard); keep everything else quiet and disciplined.
