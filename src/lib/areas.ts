/**
 * Which screens belong to the counter, and which to the owner.
 *
 * One list, used by three things that must never disagree: the sidebar (what
 * is offered), the route guard (what can be reached), and the redirect that
 * catches a typed URL. If any of those had its own idea of "admin", a screen
 * could be hidden from the nav while still being reachable by address — which
 * is the failure this file exists to prevent.
 *
 * The rule for placement is money. Anything that shows takings, profit, food
 * cost or the cancellation log is the owner's; anything needed to actually
 * serve a customer belongs to the counter.
 */

/** Screens the counter can reach without any PIN. */
export const COUNTER_ROUTES = [
  '/order/', // take orders and bill — the counter's whole job
  '/orders/', // the day's orders, for looking one up and reprinting a bill
  '/tables/', // the dine-in floor: how a table order is started and resumed
] as const;

/** Screens behind the manager PIN. */
export const ADMIN_ROUTES = [
  '/', // dashboard: today's takings and profit
  '/menu/', // items carry the owner's food cost
  '/deals/', // combo pricing, cost and margin
  '/reports/', // sales, best sellers, hours
  '/cancellations/', // who cancelled what, and for how much
  '/customers/', // names, numbers and home addresses — the owner's to hold
  '/day/', // opening and closing the trading day, and its takings and margin
  '/settings/', // printers, staff, PIN, logo, backup, licence
] as const;

/**
 * The counter reaches /orders/, but must never see food cost, profit or
 * margin — so that screen hides its money columns unless admin is unlocked.
 * Route access and column visibility are separate questions, and this is the
 * one screen where they differ.
 */

/** Where the counter starts, and where "Exit admin" returns to. */
export const COUNTER_HOME = '/order/';

/** Where the owner lands after unlocking. */
export const ADMIN_HOME = '/';

/**
 * Normalise a pathname for comparison.
 *
 * The app is exported with `trailingSlash: true`, so routes arrive as
 * `/reports/`. A stray missing slash should not be enough to slip past the
 * guard, so both shapes resolve to the same key.
 */
function normalise(pathname: string): string {
  if (!pathname) return '/';
  const withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return withSlash === '//' ? '/' : withSlash;
}

export function isAdminRoute(pathname: string): boolean {
  const path = normalise(pathname);
  // Default-deny: anything not explicitly a counter screen is treated as the
  // owner's. A new route added later is locked until someone decides it is not.
  return !(COUNTER_ROUTES as readonly string[]).includes(path);
}

export function isCounterRoute(pathname: string): boolean {
  return !isAdminRoute(pathname);
}
