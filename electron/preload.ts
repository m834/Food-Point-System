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

  tables: {
    list: () => ipcRenderer.invoke('tables:list'),
    save: (table: unknown) => ipcRenderer.invoke('tables:save', table),
    remove: (id: number) => ipcRenderer.invoke('tables:remove', id),
  },

  orders: {
    open: (input: unknown) => ipcRenderer.invoke('orders:open', input),
    get: (id: number) => ipcRenderer.invoke('orders:get', id),
    listOpen: () => ipcRenderer.invoke('orders:listOpen'),
    addItems: (orderId: number, lines: unknown) =>
      ipcRenderer.invoke('orders:addItems', orderId, lines),
    setItemQty: (orderItemId: number, qty: number) =>
      ipcRenderer.invoke('orders:setItemQty', orderItemId, qty),
    fire: (orderId: number) => ipcRenderer.invoke('orders:fire', orderId),
    settle: (orderId: number, input: unknown) =>
      ipcRenderer.invoke('orders:settle', orderId, input),
    reprintBill: (orderId: number) => ipcRenderer.invoke('orders:reprintBill', orderId),
    voidItem: (orderItemId: number, reason: string, pin?: string) =>
      ipcRenderer.invoke('orders:voidItem', orderItemId, reason, pin),
    voidOrder: (orderId: number, reason: string, pin?: string) =>
      ipcRenderer.invoke('orders:voidOrder', orderId, reason, pin),
    previewBill: (orderId: number) => ipcRenderer.invoke('orders:previewBill', orderId),
    previewTicket: (orderId: number) => ipcRenderer.invoke('orders:previewTicket', orderId),
  },

  reports: {
    dashboard: (date?: string) => ipcRenderer.invoke('reports:dashboard', date),
    range: (from: string, to: string) => ipcRenderer.invoke('reports:range', { from, to }),
    byType: (from: string, to: string) => ipcRenderer.invoke('reports:byType', { from, to }),
    bestSellers: (from: string, to: string, limit?: number) =>
      ipcRenderer.invoke('reports:bestSellers', { from, to, limit }),
    byHour: (from: string, to: string) => ipcRenderer.invoke('reports:byHour', { from, to }),
    voids: (from: string, to: string) => ipcRenderer.invoke('reports:voids', { from, to }),
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
