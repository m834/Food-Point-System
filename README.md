# Code Hustlers — Food Point

Fully offline desktop billing & POS for takeaway counters, cafés, dhabas and
small restaurants. Electron + Next.js (static export) + SQLite (better-sqlite3).
Nothing in this app ever touches the network.

```bash
npm install
npm run dev        # Next.js UI + Electron, for development
npm run build       # production build (UI export + compiled main process)
npm test            # runs tools/test-scenarios.js against a throwaway database
```

## Optional features

Four features ship OFF by default. Each is a single Settings toggle — with a
toggle off, that feature is completely invisible and the app behaves exactly
as it did before the toggle existed: no new fields, no new screens, no new
columns on any bill or report.

Every toggle lives in **Settings → Optional features** (admin only — enter
the manager PIN to reach Settings).

### Enable weight-based items

**What it does:** lets a menu item be marked "sold by weight/bulk" — e.g. rice
sold by the kg rather than as a fixed unit. Such an item carries a **unit**
(e.g. `kg`) and its `Price` field is read as the **per-unit price**. On the
order screen, adding the item asks for the weight (e.g. `15`) instead of a
plain quantity, and the line prices as `weight × per-unit price`. The bill and
kitchen ticket both print the quantity and unit clearly, e.g.:

```
Rice — 15 kg x Rs350.00 = Rs5250.00
```

Weight items are **not tracked as stock** — there is no inventory concept
anywhere in this app (it is a billing system, not a stock system), so a
weight-based item is priced by weight only, with no deduction from any stock
count.

**How to turn it on:** Settings → Optional features → *Enable weight-based
items*. Then, on any menu item (Admin → Menu → edit an item), tick *"Sold by
weight/bulk"* and fill in its unit (e.g. `kg`). The item's `Price` field
becomes its price per unit.

### Enable partial payments

**What it does:** lets the charge step take an **advance** instead of the
full amount. The counter enters what the customer actually hands over; the
rest is stored as `balance_due` and the customer's bill prints **Grand
Total / Advance Paid / Balance Due** instead of a single `TOTAL`. The order
shows up in the existing **Orders → Unpaid** list (reused, not duplicated)
with its balance shown, so the owner can see who still owes. When the
customer returns, staff open the order from that same list and tap **Record
payment** to collect the rest — the app keeps a record of both payments
(advance and balance) taken, and `balance_due` drops to zero once settled in
full.

Reports keep counting **revenue** as the full settled amount, exactly as
before — a partial payment does not shrink the sales or profit figures, it
only tracks what has actually been collected versus what is still owed. The
day-close report separately states how much is still outstanding across
partially-paid orders, and the cash/card drawer reconciliation (`Cash
expected in drawer`) correctly reflects only the money that has actually
changed hands so far in each trading session — including a balance collected
on a later day than the one the order was opened on.

**How to turn it on:** Settings → Optional features → *Enable partial
payments*. Nothing else to configure — the charge screen grows a "Take an
advance" option immediately.

### Enable daily expenses

**What it does:** adds an **Expenses** screen to the admin portal (hidden
from the counter, exactly like Reports and Waiters). The owner can record a
description, an amount and a timestamp for money going out of the till —
"Vegetables 2,000", "Gas cylinder 3,500" — and add, edit or delete an entry
(deleting asks for confirmation first). Expenses attach to whichever trading
day session is currently open; if no day is open, they file under the
calendar date instead, the same rule an order itself follows.

At day close, the end-of-day report and slip show **TOTAL EXPENSES** for the
session, list every expense, and add a line:

```
Net cash position = cash sales − total expenses
```

This is deliberately labelled a cash *position*, not profit — it says nothing
about food cost or margin, only what should be left in the drawer after
paying things out of it. (Waiter wages, when that toggle is also on, are
counted here too — see below.)

**How to turn it on:** Settings → Optional features → *Enable daily
expenses*. An **Expenses** link appears in the admin sidebar as soon as this
(or the wages toggle below) is on.

### Enable waiter wages

**What it does:** adds a pay setup to each waiter (Admin → Waiters → **Edit
pay** on a row) — a **pay type** (Daily, Weekly or Monthly), an **amount**
for that period, and for Weekly/Monthly, a **payday** (a day of the week, or
a day of the month). It also adds a **Waiter wages** review to the Expenses
screen.

**Which waiters show up on the review is auto-detected**, from each waiter's
own pay type and payday — nothing to remember by hand:
- **Daily** waiters are offered every time the review is opened.
- **Weekly** waiters are offered only when today is their payday (e.g. every
  Friday).
- **Monthly** waiters are offered only on their day of the month. A payday of
  31 falls on the last day of a shorter month instead, so a salary is never
  silently skipped in February.

Each row **pre-fills from the waiter's saved rate**. The owner can accept the
list as-is, or edit any amount — set someone to `0` if they didn't turn up,
or pay a one-off different amount — then **Save wages**. Whatever is saved
(not the default rate) is what counts and is what gets recorded for that pay
event, so history stays honest even when the default was overridden. A wage
is only ever recorded on the day it is actually paid — a weekly or monthly
amount is never divided across the days in between.

Saving posts **one line per pay type** — e.g. **"Waiter wages (daily) —
\<date>"**, **"Waiter wages (weekly) — \<date>"** — into the *same* Expenses
ledger described above, rather than one blended total; an ordinary day
already mixes cadences (daily waiters every day, plus a weekly waiter on
their Friday), so a single combined figure would blur exactly the thing the
line is meant to show. There is no second money bucket — the day's cash
reconciliation already includes wages once this is saved. The
day-close report and the printed slip both show the per-waiter breakdown
(name and pay type) alongside the wages total. Next time a given waiter's
payday comes around, the review pre-fills again from their saved *default*
rate, never from a past override.

This feature depends on the waiter roster (Admin → Waiters). If waiters are
not in use, or nobody is due today, the wages review simply has nothing to
show.

**How to turn it on:** Settings → Optional features → *Enable waiter wages*.
Then set each waiter's pay type, amount and (for Weekly/Monthly) payday in
Admin → Waiters → Edit pay, and review / save wages from the Expenses screen
whenever the day is closed out.

## Everything else

With all four toggles off, ordering, firing to the kitchen, billing,
printing, reports, cancellations, tables, deals, day open/close and backup
all work exactly as they did before these features existed. Existing orders
— none of which carry a bulk item, a partial payment, a waiter or an expense
— continue to display, reprint and report correctly.
