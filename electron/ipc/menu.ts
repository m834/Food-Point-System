import { handle, asArray, asBool, asEnum, asId, asMoney, asNumber, asOptionalId, asString } from './util';
import {
  getItem,
  listCategories,
  listItems,
  listModifierGroups,
  modifierGroupsForItem,
  removeCategory,
  removeItem,
  removeModifierGroup,
  saveCategory,
  saveItem,
  saveModifierGroup,
  setAvailable,
} from '../db/repositories/menu';

const SELECTION_TYPES = ['single', 'multi'] as const;

export function registerMenuHandlers(): void {
  handle('menu:listCategories', () => listCategories());

  handle('menu:saveCategory', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveCategory({
      id: asOptionalId(raw.id, 'Category') ?? undefined,
      name: asString(raw.name, 'Category name', { max: 60 }),
      sort_order: raw.sort_order === undefined ? 0 : asNumber(raw.sort_order, 'Sort order', { min: 0, max: 9999 }),
    });
  });

  handle('menu:removeCategory', (_e, id) => {
    removeCategory(asId(id, 'Category'));
    return null;
  });

  handle('menu:listItems', (_e, query) => {
    const raw = (query ?? {}) as Record<string, unknown>;
    return listItems({
      search: raw.search ? asString(raw.search, 'Search', { required: false, max: 80 }) : undefined,
      categoryId: asOptionalId(raw.categoryId, 'Category'),
      availableOnly: asBool(raw.availableOnly),
    });
  });

  handle('menu:getItem', (_e, id) => {
    const item = getItem(asId(id, 'Menu item'));
    if (!item) throw new Error('That menu item no longer exists.');
    // Hydrated for the order screen's modifier picker.
    return { ...item, modifier_groups: modifierGroupsForItem(item.id) };
  });

  handle('menu:saveItem', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const salePrice = asMoney(raw.sale_price, 'Price');
    const costPrice = asMoney(raw.cost_price, 'Food cost');

    return saveItem({
      id: asOptionalId(raw.id, 'Menu item') ?? undefined,
      name: asString(raw.name, 'Item name', { max: 80 }),
      category_id: asOptionalId(raw.category_id, 'Category'),
      sale_price: salePrice,
      cost_price: costPrice,
      is_available: raw.is_available === undefined ? true : asBool(raw.is_available),
      barcode: raw.barcode ? asString(raw.barcode, 'Barcode', { required: false, max: 40 }) : null,
      sort_order: raw.sort_order === undefined ? 0 : asNumber(raw.sort_order, 'Sort order', { min: 0, max: 9999 }),
      notes: raw.notes ? asString(raw.notes, 'Note', { required: false, max: 200 }) : null,
      modifier_group_ids: raw.modifier_group_ids
        ? asArray(raw.modifier_group_ids, 'Modifier groups', 20).map((id) => asId(id, 'Modifier group'))
        : undefined,
    });
  });

  handle('menu:removeItem', (_e, id) => {
    removeItem(asId(id, 'Menu item'));
    return null;
  });

  /** The "86 it" toggle — the one action that has to be instant. */
  handle('menu:setAvailable', (_e, id, available) =>
    setAvailable(asId(id, 'Menu item'), asBool(available)),
  );

  handle('modifiers:groups', () => listModifierGroups());

  handle('modifiers:save', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveModifierGroup({
      id: asOptionalId(raw.id, 'Modifier group') ?? undefined,
      name: asString(raw.name, 'Group name', { max: 60 }),
      selection_type: asEnum(raw.selection_type, SELECTION_TYPES, 'Selection type'),
      modifiers: asArray(raw.modifiers, 'Options', 50).map((entry) => {
        const mod = (entry ?? {}) as Record<string, unknown>;
        return {
          name: asString(mod.name, 'Option name', { max: 60 }),
          // Deltas can be negative — a smaller size legitimately takes money off.
          price_delta: asNumber(mod.price_delta ?? 0, 'Price change', {
            min: -100_000,
            max: 100_000,
          }),
        };
      }),
    });
  });

  handle('modifiers:remove', (_e, id) => {
    removeModifierGroup(asId(id, 'Modifier group'));
    return null;
  });
}
