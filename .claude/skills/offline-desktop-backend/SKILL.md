---
name: offline-desktop-backend
description: Build the backend (Electron main process) for Code Hustlers' offline retail desktop apps — the Shop Inventory, Pharmacy, and Food-Point billing systems. Use this whenever working on the backend, database, IPC, licensing, backup, or receipt-printing logic of any of these offline desktop apps, or any time the task involves better-sqlite3, Electron main/preload, node-locked licensing, or thermal (ESC/POS) printing for these products. Trigger even if the user only says "the backend", "the database", "the license check", "the save-sale logic", or "the print logic" for one of these apps.
---

# Offline Desktop Backend

You are building the backend for Code Hustlers' offline retail desktop apps (Shop Inventory first; Pharmacy and Food-Point reuse the same architecture). The backend is the **Electron main process**. It owns the database, the filesystem, licensing, backup, and printing. The Next.js UI (renderer) never touches any of these directly — it asks the backend over IPC.

In this repo the governing spec is `Food_Point_System_Build_Spec_v1.md`; the shop spec it extends is in the sibling repo at `../POS-Shop-Inventory-System/Shop inventory system build spec.md`. This skill is the *how* for the backend.

## Golden rules

1. **Everything is offline.** No network calls, ever. No telemetry, no license server, no cloud. If a task seems to need the internet, it does not belong here.
2. **The renderer is untrusted.** Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The UI reaches the backend only through a small, explicit API exposed via a preload `contextBridge`. Never expose Node, `fs`, or the database object to the renderer.
3. **Validate every IPC input.** Treat every argument from the renderer as if a user typed it. Check types and ranges before touching the database.
4. **Data lives in `app.getPath('userData')`**, not in `Program Files`. This survives app updates and keeps the DB/license out of an obvious copy-paste location.

## Stack

- **Runtime:** Electron main process (Node).
- **Database:** `better-sqlite3` — synchronous, fast, file-based, perfect for a single-machine app. Enable WAL mode (`PRAGMA journal_mode = WAL`) for durability and speed.
- **Fingerprint:** `node-machine-id` (+ `systeminformation` if you need more entropy).
- **Signing/verify:** Node `crypto` with **Ed25519**.
- **Printing:** `node-thermal-printer` (ESC/POS) or raw print to the selected Windows printer.

## Project layout (main side)

```
electron/
├── main.ts          # app lifecycle, window creation, security flags
├── preload.ts       # contextBridge — the ONLY surface the UI can call
├── ipc/             # one file per domain; registers ipcMain.handle channels
│   ├── items.ts
│   ├── sales.ts
│   ├── reports.ts
│   ├── license.ts
│   ├── backup.ts
│   └── printing.ts
├── db/
│   ├── connection.ts   # opens SQLite in userData, sets pragmas
│   ├── migrate.ts      # creates/updates schema; run on startup
│   └── repositories/   # items, invoices, settings — all SQL lives here
└── services/           # licensing, backup, printing, profit calc
```

## IPC pattern

Expose a **named, minimal** API. Do not expose a generic "run any SQL" channel.

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('api', {
  items:   { list: (q) => ipcRenderer.invoke('items:list', q),
             save: (item) => ipcRenderer.invoke('items:save', item),
             remove: (id) => ipcRenderer.invoke('items:remove', id) },
  sales:   { create: (cart) => ipcRenderer.invoke('sales:create', cart),
             reprint: (id) => ipcRenderer.invoke('sales:reprint', id) },
  reports: { daily: (date) => ipcRenderer.invoke('reports:daily', date),
             range: (from, to) => ipcRenderer.invoke('reports:range', {from,to}) },
  license: { status: () => ipcRenderer.invoke('license:status'),
             machineId: () => ipcRenderer.invoke('license:machineId'),
             activate: (key) => ipcRenderer.invoke('license:activate', key) },
  backup:  { now: () => ipcRenderer.invoke('backup:now'),
             restore: (path) => ipcRenderer.invoke('backup:restore', path) },
});
```

Every `ipcMain.handle` returns a plain result object `{ ok: true, data }` or `{ ok: false, error }`. Never throw raw errors across IPC — the UI shows the `error` string.

## Database & the sale transaction

The most important backend operation is completing a sale. It must be **atomic** and it must **snapshot prices** so historical profit never changes.

```ts
const createSale = db.transaction((cart) => {
  let subtotal = 0, profit = 0;
  const invoiceId = insertInvoice({ /* header */ });
  for (const line of cart.lines) {
    const item = getItem(line.itemId);
    if (item.quantity < line.qty) throw new Error(`Not enough stock for ${item.name}`);
    const lineTotal = line.qty * item.sale_price;
    subtotal += lineTotal;
    profit   += line.qty * (item.sale_price - item.cost_price); // snapshot
    insertInvoiceItem({
      invoiceId, itemId: item.id, itemName: item.name,   // snapshot name
      qty: line.qty, costPrice: item.cost_price,          // snapshot cost
      salePrice: item.sale_price, lineTotal,
    });
    decrementStock(item.id, line.qty);
  }
  finalizeInvoice(invoiceId, { subtotal, discount: cart.discount,
                               total: subtotal - cart.discount, profit });
  return invoiceId;
});
```

**Profit rule:** profit always comes from the snapshotted `cost_price` on `invoice_items`. Never recompute past profit from the live item cost.

## Licensing (verify only — NEVER generate)

The backend can *verify* a key. It can **never create one**. Only the founder's office tool (which holds the private key) creates keys. The app ships with the **public key only**.

Flow:
1. Compute a stable machine id: hash of `node-machine-id` output (optionally mixed with CPU/disk serial from `systeminformation`). Expose via `license:machineId`.
2. On `license:activate(key)`, decode the key into `{ machineId, expiresAt, signature }`. Verify the Ed25519 signature over `machineId + expiresAt` using the embedded public key.
3. Reject if: signature invalid, `machineId` ≠ this machine, or `expiresAt` is set and in the past.
4. On success, store the license in an obfuscated/encrypted file in `userData`. On every startup, re-verify before unlocking the app.
5. Support `expiresAt = null` (**lifetime**) and a real date (**time-limited/yearly**). Build both now.

```ts
import { verify } from 'crypto';
function verifyLicense(key: string, machineId: string, publicKeyPem: string) {
  const { m, exp, sig } = decode(key);            // your compact encoding
  if (m !== machineId) return { ok:false, error:'This key is for another computer.' };
  if (exp && Date.now() > exp) return { ok:false, error:'This license has expired.' };
  const good = verify(null, Buffer.from(`${m}|${exp ?? ''}`),
                      publicKeyPem, Buffer.from(sig, 'base64'));
  return good ? { ok:true } : { ok:false, error:'Invalid license key.' };
}
```

Never embed the private key. Never add a code path that mints a valid key inside the shipped app — that would defeat the whole anti-copy design.

## Backup / restore

Data lives only on this machine, so backup is reputation insurance.
- `backup:now` → run `PRAGMA wal_checkpoint(TRUNCATE)`, then copy the `.db` file to the chosen USB/folder with a timestamped name. Log to `backup_log`. No internet.
- `backup:restore(path)` → require an explicit confirmation flag from the UI; close the DB, copy the backup over the live file, reopen. Never auto-restore silently.
- Never delete the shop's data on uninstall.

## Thermal printing

Build an ESC/POS receipt and send it to the printer chosen in Settings.
- Header: shop name/address/phone (from `settings`). Body: line items (name, qty, price, line total). Footer: subtotal, discount, total, short thank-you.
- Printer selection is stored once in settings; printing must work with no internet.
- Expose `sales:create` to auto-print on completion and `sales:reprint(id)` to reprint.

## Do not

- Do not add cloud sync, accounts, auto-update, or any server (out of scope for v1).
- Do not expose raw SQL or the `fs` module to the renderer.
- Do not generate license keys in the app.
- Do not store data in `Program Files`.
