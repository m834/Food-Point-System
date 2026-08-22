import { handle, asBool, asId, asMoney, asNumber, asOptionalId, asString } from './util';
import {
  listExtras,
  removeExtra,
  saveExtra,
  setExtraActive,
} from '../db/repositories/extras';

/**
 * The shop's list of chargeable extras.
 *
 * Prices come from the list, never from the renderer: the order screen sends
 * only which extra and how many, and the backend prices it. A UI that could
 * supply its own amount could bill something the owner never set.
 */
export function registerExtraHandlers(): void {
  handle('extras:list', (_e, activeOnly) => listExtras(asBool(activeOnly)));

  handle('extras:save', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveExtra({
      id: asOptionalId(raw.id, 'Extra') ?? undefined,
      name: asString(raw.name, 'Name', { max: 60 }),
      price: asMoney(raw.price, 'Price'),
      cost_price: raw.cost_price === undefined ? 0 : asMoney(raw.cost_price, 'Cost'),
      is_active: raw.is_active === undefined ? true : asBool(raw.is_active),
      sort_order:
        raw.sort_order === undefined ? 0 : asNumber(raw.sort_order, 'Sort order', { min: 0, max: 9999 }),
    });
  });

  handle('extras:remove', (_e, id) => {
    removeExtra(asId(id, 'Extra'));
    return null;
  });

  handle('extras:setActive', (_e, id, active) => setExtraActive(asId(id, 'Extra'), asBool(active)));
}
