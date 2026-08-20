import type {
  BackupRecord,
  BestSeller,
  CancellationsReport,
  CancelReasonCode,
  DashboardSummary,
  Deal,
  DiningTable,
  LicenseStatus,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  NewOrderLine,
  OpenOrderSummary,
  Order,
  OrderItem,
  RangeTotals,
  Result,
  SalesByHour,
  SalesByType,
  SettingsMap,
  StaffMember,
  StaffSession,
  VoidRecord,
} from '../../shared/types';

/**
 * The one place the UI touches the preload bridge.
 *
 * Components call these functions, never `window.api` directly, so the whole
 * app has a single seam to the backend. There is no `fetch` anywhere in this
 * codebase — there is no server to fetch from.
 */

type Bridge = Record<string, Record<string, (...args: any[]) => Promise<Result<any>>>>;

function bridge(): Bridge {
  const api = (globalThis as unknown as { api?: Bridge }).api;
  if (!api) {
    // Only reachable in a plain browser (e.g. `next dev` outside Electron).
    throw new Error('The app is not running inside its desktop shell.');
  }
  return api;
}

/** Unwrap { ok, data | error }. A failed call throws the shopkeeper's message. */
async function call<T>(group: string, method: string, ...args: unknown[]): Promise<T> {
  const result = await bridge()[group][method](...args);
  if (!result.ok) throw new Error(result.error);
  return result.data as T;
}

/** True when running inside Electron — lets pages render a hint instead of crashing. */
export function hasBridge(): boolean {
  return Boolean((globalThis as unknown as { api?: unknown }).api);
}

export interface PrintOutcome {
  printed: boolean;
  warning?: string;
}

export const api = {
  app: {
    version: () => call<string>('app', 'version'),
  },

  menu: {
    listCategories: () => call<MenuCategory[]>('menu', 'listCategories'),
    saveCategory: (category: Partial<MenuCategory>) =>
      call<MenuCategory>('menu', 'saveCategory', category),
    removeCategory: (id: number) => call<null>('menu', 'removeCategory', id),
    listItems: (query?: { search?: string; categoryId?: number | null; availableOnly?: boolean }) =>
      call<MenuItem[]>('menu', 'listItems', query),
    getItem: (id: number) => call<MenuItem>('menu', 'getItem', id),
    saveItem: (item: Record<string, unknown>) => call<MenuItem>('menu', 'saveItem', item),
    removeItem: (id: number) => call<null>('menu', 'removeItem', id),
    setAvailable: (id: number, available: boolean) =>
      call<MenuItem>('menu', 'setAvailable', id, available),
  },

  modifiers: {
    groups: () => call<ModifierGroup[]>('modifiers', 'groups'),
    save: (group: Record<string, unknown>) => call<ModifierGroup>('modifiers', 'save', group),
    remove: (id: number) => call<null>('modifiers', 'remove', id),
  },

  deals: {
    list: (activeOnly?: boolean) => call<Deal[]>('deals', 'list', activeOnly),
    get: (id: number) => call<Deal>('deals', 'get', id),
    save: (deal: Record<string, unknown>) => call<Deal>('deals', 'save', deal),
    remove: (id: number) => call<null>('deals', 'remove', id),
    setActive: (id: number, active: boolean) => call<Deal>('deals', 'setActive', id, active),
  },

  tables: {
    list: () => call<DiningTable[]>('tables', 'list'),
    save: (table: Record<string, unknown>) => call<DiningTable>('tables', 'save', table),
    remove: (id: number) => call<null>('tables', 'remove', id),
  },

  orders: {
    open: (input: {
      type: string;
      table_id?: number | null;
      customer_name?: string | null;
      customer_phone?: string | null;
    }) => call<Order>('orders', 'open', input),
    get: (id: number) => call<Order | null>('orders', 'get', id),
    listOpen: () => call<OpenOrderSummary[]>('orders', 'listOpen'),
    list: (from: string, to: string, status?: 'settled' | 'void' | 'open') =>
      call<Order[]>('orders', 'list', { from, to, status }),
    addItems: (orderId: number, lines: NewOrderLine[]) =>
      call<Order>('orders', 'addItems', orderId, lines),
    /** A whole deal in one action — the backend expands and prices it. */
    addDeal: (orderId: number, dealId: number, quantity = 1) =>
      call<Order>('orders', 'addDeal', orderId, dealId, quantity),
    setItemQty: (orderItemId: number, qty: number) =>
      call<Order>('orders', 'setItemQty', orderItemId, qty),
    fire: (orderId: number) =>
      call<{ order: Order; fired: OrderItem[]; print: PrintOutcome }>('orders', 'fire', orderId),
    settle: (orderId: number, input: { discount?: number; payment_method: string }) =>
      call<{ order: Order; print: PrintOutcome }>('orders', 'settle', orderId, input),
    reprintBill: (orderId: number) => call<PrintOutcome>('orders', 'reprintBill', orderId),
    /** Cancel a line off an open order: reason code + optional note. */
    voidItem: (orderItemId: number, reason: CancelReasonCode, note?: string | null) =>
      call<Order>('orders', 'voidItem', orderItemId, reason, note),
    /** Cancel a whole order. The PIN is only consulted when it was paid. */
    voidOrder: (
      orderId: number,
      reason: CancelReasonCode,
      note?: string | null,
      pin?: string,
    ) => call<Order>('orders', 'voidOrder', orderId, reason, note, pin),
    previewBill: (orderId: number) => call<string>('orders', 'previewBill', orderId),
    previewTicket: (orderId: number) => call<string>('orders', 'previewTicket', orderId),
  },

  staff: {
    list: (activeOnly?: boolean) => call<StaffMember[]>('staff', 'list', activeOnly),
    save: (staff: Record<string, unknown>) => call<StaffMember>('staff', 'save', staff),
    remove: (id: number) => call<{ deleted: boolean }>('staff', 'remove', id),
    signIn: (id: number, pin: string) => call<StaffSession>('staff', 'signIn', id, pin),
    signOut: () => call<null>('staff', 'signOut'),
    current: () => call<StaffSession | null>('staff', 'current'),
  },

  reports: {
    dashboard: (date?: string) => call<DashboardSummary>('reports', 'dashboard', date),
    range: (from: string, to: string) => call<RangeTotals>('reports', 'range', from, to),
    byType: (from: string, to: string) => call<SalesByType[]>('reports', 'byType', from, to),
    bestSellers: (from: string, to: string, limit?: number) =>
      call<BestSeller[]>('reports', 'bestSellers', from, to, limit),
    byHour: (from: string, to: string) => call<SalesByHour[]>('reports', 'byHour', from, to),
    voids: (from: string, to: string) => call<VoidRecord[]>('reports', 'voids', from, to),
    cancellations: (from: string, to: string) =>
      call<CancellationsReport>('reports', 'cancellations', from, to),
  },

  license: {
    status: () => call<LicenseStatus>('license', 'status'),
    machineId: () => call<string>('license', 'machineId'),
    activate: (key: string) => call<LicenseStatus>('license', 'activate', key),
  },

  backup: {
    now: () => call<BackupRecord>('backup', 'now'),
    restore: () => call<{ restored: boolean }>('backup', 'restore'),
    history: () => call<BackupRecord[]>('backup', 'history'),
    last: () => call<BackupRecord | null>('backup', 'last'),
  },

  settings: {
    all: () => call<SettingsMap>('settings', 'all'),
    save: (values: SettingsMap) => call<SettingsMap>('settings', 'save', values),
    setManagerPin: (pin: string) =>
      call<{ manager_pin_set: boolean }>('settings', 'setManagerPin', pin),
  },

  printing: {
    listPrinters: () =>
      call<Array<{ name: string; displayName: string; isDefault: boolean }>>(
        'printing',
        'listPrinters',
      ),
    testPrint: () => call<{ printed: boolean }>('printing', 'testPrint'),
  },

  system: {
    copyToClipboard: (text: string) => call<null>('system', 'copyToClipboard', text),
  },
};
