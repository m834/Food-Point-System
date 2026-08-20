import { handle, asArray, asBool, asId, asMoney, asNumber, asOptionalId, asString } from './util';
import {
  getDeal,
  listDeals,
  removeDeal,
  saveDeal,
  setDealActive,
} from '../db/repositories/deals';

/**
 * Deals — combo bundles at one fixed price.
 *
 * Everything from the renderer is untrusted here as everywhere else. Note what
 * is NOT accepted: the component prices. The renderer names which menu items
 * are in the deal and how many, and the backend reads their real prices and
 * costs itself — a UI that could supply its own cost figures could book a
 * profit the owner never made.
 */
export function registerDealHandlers(): void {
  handle('deals:list', (_e, activeOnly) => listDeals(asBool(activeOnly)));

  handle('deals:get', (_e, id) => {
    const deal = getDeal(asId(id, 'Deal'));
    if (!deal) throw new Error('That deal no longer exists.');
    return deal;
  });

  handle('deals:save', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;

    const components = asArray(raw.components, 'Deal items', 30).map((entry) => {
      const part = (entry ?? {}) as Record<string, unknown>;
      return {
        menu_item_id: asId(part.menu_item_id, 'Menu item'),
        qty: asNumber(part.qty, 'Quantity', { min: 0.01, max: 99 }),
      };
    });

    if (!components.length) throw new Error('A deal needs at least one item in it.');

    // One item listed twice is almost certainly a mis-tap, and it would make
    // the deal's contents ambiguous to read back. Say so plainly.
    const ids = new Set(components.map((c) => c.menu_item_id));
    if (ids.size !== components.length) {
      throw new Error('That item is already in this deal — change its quantity instead.');
    }

    return saveDeal({
      id: asOptionalId(raw.id, 'Deal') ?? undefined,
      name: asString(raw.name, 'Deal name', { max: 80 }),
      price: asMoney(raw.price, 'Deal price'),
      is_active: raw.is_active === undefined ? true : asBool(raw.is_active),
      sort_order:
        raw.sort_order === undefined ? 0 : asNumber(raw.sort_order, 'Sort order', { min: 0, max: 9999 }),
      notes: raw.notes ? asString(raw.notes, 'Note', { required: false, max: 200 }) : null,
      components,
    });
  });

  handle('deals:remove', (_e, id) => {
    removeDeal(asId(id, 'Deal'));
    return null;
  });

  /** The active/inactive toggle — same one-tap treatment as "86 it" on items. */
  handle('deals:setActive', (_e, id, active) => setDealActive(asId(id, 'Deal'), asBool(active)));
}
