import { contextBridge, ipcRenderer } from 'electron';

/**
 * The ONLY surface the UI can reach.
 *
 * Named, minimal channels — no generic "run any SQL", no `fs`, no Node. Note
 * what is deliberately absent: there is no channel that mints a license, none
 * that writes the manager PIN in the clear, and none that lets the renderer
 * supply a service-charge percentage. Those all stay in the main process.
 */
const api = {
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },

  admin: {
    status: () => ipcRenderer.invoke('admin:status'),
    unlock: (pin: string) => ipcRenderer.invoke('admin:unlock', pin),
    initialise: (pin: string) => ipcRenderer.invoke('admin:initialise', pin),
    recover: (key: string) => ipcRenderer.invoke('admin:recover', key),
    lock: () => ipcRenderer.invoke('admin:lock'),
  },

  menu: {
    listCategories: () => ipcRenderer.invoke('menu:listCategories'),
    saveCategory: (category: unknown) => ipcRenderer.invoke('menu:saveCategory', category),
    removeCategory: (id: number) => ipcRenderer.invoke('menu:removeCategory', id),
    listItems: (query?: unknown) => ipcRenderer.invoke('menu:listItems', query),
    getItem: (id: number) => ipcRenderer.invoke('menu:getItem', id),
    saveItem: (item: unknown) => ipcRenderer.invoke('menu:saveItem', item),
    removeItem: (id: number) => ipcRenderer.invoke('menu:removeItem', id),
    setAvailable: (id: number, available: boolean) =>
      ipcRenderer.invoke('menu:setAvailable', id, available),
  },

  modifiers: {
    groups: () => ipcRenderer.invoke('modifiers:groups'),
    save: (group: unknown) => ipcRenderer.invoke('modifiers:save', group),
    remove: (id: number) => ipcRenderer.invoke('modifiers:remove', id),
  },

  deals: {
    list: (activeOnly?: boolean) => ipcRenderer.invoke('deals:list', activeOnly),
    get: (id: number) => ipcRenderer.invoke('deals:get', id),
    save: (deal: unknown) => ipcRenderer.invoke('deals:save', deal),
    remove: (id: number) => ipcRenderer.invoke('deals:remove', id),
    setActive: (id: number, active: boolean) =>
      ipcRenderer.invoke('deals:setActive', id, active),
  },

  images: {
    list: (kind: string) => ipcRenderer.invoke('images:list', kind),
    choose: (kind: string) => ipcRenderer.invoke('images:choose', kind),
    importFolder: (kind: string) => ipcRenderer.invoke('images:importFolder', kind),
  },

  customers: {
    lookup: (phone: string) => ipcRenderer.invoke('customers:lookup', phone),
    list: (search?: string) => ipcRenderer.invoke('customers:list', search),
    get: (id: number) => ipcRenderer.invoke('customers:get', id),
    save: (customer: unknown) => ipcRenderer.invoke('customers:save', customer),
    remove: (id: number) => ipcRenderer.invoke('customers:remove', id),
    csv: () => ipcRenderer.invoke('customers:csv'),
  },

  extras: {
    list: (activeOnly?: boolean) => ipcRenderer.invoke('extras:list', activeOnly),
    save: (extra: unknown) => ipcRenderer.invoke('extras:save', extra),
    remove: (id: number) => ipcRenderer.invoke('extras:remove', id),
    setActive: (id: number, active: boolean) => ipcRenderer.invoke('extras:setActive', id, active),
  },

  tables: {
    list: () => ipcRenderer.invoke('tables:list'),
    save: (table: unknown) => ipcRenderer.invoke('tables:save', table),
    remove: (id: number) => ipcRenderer.invoke('tables:remove', id),
  },

  orders: {
    open: (input: unknown) => ipcRenderer.invoke('orders:open', input),
    get: (id: number) => ipcRenderer.invoke('orders:get', id),
    listOpen: () => ipcRenderer.invoke('orders:listOpen'),
    list: (query: unknown) => ipcRenderer.invoke('orders:list', query),
    addItems: (orderId: number, lines: unknown) =>
      ipcRenderer.invoke('orders:addItems', orderId, lines),
    addDeal: (orderId: number, dealId: number, quantity?: number) =>
      ipcRenderer.invoke('orders:addDeal', orderId, dealId, quantity),
    setExtra: (orderId: number, extraId: number, qty: number) =>
      ipcRenderer.invoke('orders:setExtra', orderId, extraId, qty),
    setDelivery: (orderId: number, input: unknown) =>
      ipcRenderer.invoke('orders:setDelivery', orderId, input),
    setItemQty: (orderItemId: number, qty: number) =>
      ipcRenderer.invoke('orders:setItemQty', orderItemId, qty),
    fire: (orderId: number) => ipcRenderer.invoke('orders:fire', orderId),
    settle: (orderId: number, input: unknown) =>
      ipcRenderer.invoke('orders:settle', orderId, input),
    reprintBill: (orderId: number) => ipcRenderer.invoke('orders:reprintBill', orderId),
    voidItem: (orderItemId: number, reason: string, note?: string | null) =>
      ipcRenderer.invoke('orders:voidItem', orderItemId, reason, note),
    voidOrder: (orderId: number, reason: string, note?: string | null, pin?: string) =>
      ipcRenderer.invoke('orders:voidOrder', orderId, reason, note, pin),
    previewBill: (orderId: number) => ipcRenderer.invoke('orders:previewBill', orderId),
    previewTicket: (orderId: number) => ipcRenderer.invoke('orders:previewTicket', orderId),
  },

  staff: {
    list: (activeOnly?: boolean) => ipcRenderer.invoke('staff:list', activeOnly),
    save: (staff: unknown) => ipcRenderer.invoke('staff:save', staff),
    remove: (id: number) => ipcRenderer.invoke('staff:remove', id),
    signIn: (id: number, pin: string) => ipcRenderer.invoke('staff:signIn', id, pin),
    signOut: () => ipcRenderer.invoke('staff:signOut'),
    current: () => ipcRenderer.invoke('staff:current'),
  },

  reports: {
    dashboard: (date?: string) => ipcRenderer.invoke('reports:dashboard', date),
    range: (from: string, to: string) => ipcRenderer.invoke('reports:range', { from, to }),
    byType: (from: string, to: string) => ipcRenderer.invoke('reports:byType', { from, to }),
    bestSellers: (from: string, to: string, limit?: number) =>
      ipcRenderer.invoke('reports:bestSellers', { from, to, limit }),
    byHour: (from: string, to: string) => ipcRenderer.invoke('reports:byHour', { from, to }),
    voids: (from: string, to: string) => ipcRenderer.invoke('reports:voids', { from, to }),
    cancellations: (from: string, to: string) =>
      ipcRenderer.invoke('reports:cancellations', { from, to }),
  },

  license: {
    status: () => ipcRenderer.invoke('license:status'),
    machineId: () => ipcRenderer.invoke('license:machineId'),
    activate: (key: string) => ipcRenderer.invoke('license:activate', key),
  },

  backup: {
    now: () => ipcRenderer.invoke('backup:now'),
    restore: () => ipcRenderer.invoke('backup:restore'),
    history: () => ipcRenderer.invoke('backup:history'),
    last: () => ipcRenderer.invoke('backup:last'),
  },

  settings: {
    all: () => ipcRenderer.invoke('settings:all'),
    save: (values: unknown) => ipcRenderer.invoke('settings:save', values),
    setManagerPin: (pin: string) => ipcRenderer.invoke('settings:setManagerPin', pin),
  },

  printing: {
    listPrinters: () => ipcRenderer.invoke('printing:listPrinters'),
    testPrint: () => ipcRenderer.invoke('printing:testPrint'),
  },

  system: {
    copyToClipboard: (text: string) => ipcRenderer.invoke('system:copyToClipboard', text),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type FoodPointApi = typeof api;
