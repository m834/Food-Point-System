import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { handle, asId, asString } from './util';
import {
  customersCsv,
  findByPhone,
  getCustomer,
  listCustomers,
  removeCustomer,
  saveCustomer,
} from '../db/repositories/customers';
import { requireAdmin } from '../services/adminSession';

/**
 * Customers.
 *
 * The access split matters here and is not symmetric:
 *
 *  - **Lookup is open to the counter.** Typing a phone number to fill in an
 *    address is the whole point of the feature, and it happens on the till.
 *    It returns one record for a number the caller already typed, which is
 *    not a way to browse the customer base.
 *  - **Everything else is owner-only.** Listing, editing, deleting and
 *    exporting are the customer database itself — a list of names, numbers
 *    and home addresses — and the counter has no business walking it, still
 *    less exporting it to a file.
 */
export function registerCustomerHandlers(): void {
  /** Counter-accessible: one record, for a number already in hand. */
  handle('customers:lookup', (_e, phone) =>
    findByPhone(asString(phone ?? '', 'Phone', { required: false, max: 30 })),
  );

  handle('customers:list', (_e, search) => {
    requireAdmin();
    return listCustomers(
      search ? asString(search, 'Search', { required: false, max: 80 }) : undefined,
    );
  });

  handle('customers:get', (_e, id) => {
    requireAdmin();
    const customer = getCustomer(asId(id, 'Customer'));
    if (!customer) throw new Error('That customer no longer exists.');
    return customer;
  });

  handle('customers:save', (_e, input) => {
    requireAdmin();
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveCustomer({
      id: raw.id === undefined || raw.id === null ? undefined : asId(raw.id, 'Customer'),
      phone: asString(raw.phone, 'Phone', { max: 30 }),
      name: raw.name ? asString(raw.name, 'Name', { required: false, max: 80 }) : null,
      address: raw.address ? asString(raw.address, 'Address', { required: false, max: 300 }) : null,
      notes: raw.notes ? asString(raw.notes, 'Notes', { required: false, max: 300 }) : null,
    });
  });

  /**
   * Deleting removes the convenience record only. Past orders keep their own
   * snapshot of who they were for, so no history is altered.
   */
  handle('customers:remove', (_e, id) => {
    requireAdmin();
    removeCustomer(asId(id, 'Customer'));
    return null;
  });

  /**
   * Export to a file the owner chooses.
   *
   * Written here rather than handed to the renderer as a string: the UI is
   * sandboxed and cannot save a file, and a customer list is exactly the kind
   * of thing that should leave the app deliberately, through a dialog the
   * owner sees, rather than silently.
   */
  handle('customers:csv', async () => {
    requireAdmin();

    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: 'Export customers',
      defaultPath: `customers-${stamp}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (result.canceled || !result.filePath) throw new Error('Export cancelled.');

    const csv = customersCsv();
    // A BOM, so Excel opens it as UTF-8 and Urdu or accented names survive.
    fs.writeFileSync(result.filePath, `\uFEFF${csv}`, 'utf8');

    return { path: result.filePath, count: csv.split('\r\n').length - 1 };
  });
}
