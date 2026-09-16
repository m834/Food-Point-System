import { getDb } from '../connection';
import { money } from '../money';
import type {
  MenuCategory,
  MenuItem,
  MenuItemVariant,
  Modifier,
  ModifierGroup,
} from '../../../shared/types';

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

export function listCategories(): MenuCategory[] {
  return getDb()
    .prepare('SELECT id, name, sort_order, image_file FROM menu_categories ORDER BY sort_order, name')
    .all() as MenuCategory[];
}

export function saveCategory(input: {
  id?: number;
  name: string;
  sort_order?: number;
  image_file?: string | null;
}): MenuCategory {
  const db = getDb();
  if (input.id) {
    db.prepare(
      'UPDATE menu_categories SET name = ?, sort_order = ?, image_file = ? WHERE id = ?',
    ).run(input.name, input.sort_order ?? 0, input.image_file ?? null, input.id);
    return getCategory(input.id)!;
  }
  const info = db
    .prepare('INSERT INTO menu_categories (name, sort_order, image_file) VALUES (?, ?, ?)')
    .run(input.name, input.sort_order ?? 0, input.image_file ?? null);
  return getCategory(Number(info.lastInsertRowid))!;
}

export function getCategory(id: number): MenuCategory | null {
  return (getDb()
    .prepare('SELECT id, name, sort_order, image_file FROM menu_categories WHERE id = ?')
    .get(id) as MenuCategory | undefined) ?? null;
}

export function removeCategory(id: number): void {
  // Items survive; they just fall back to "Uncategorised" via ON DELETE SET NULL.
  getDb().prepare('DELETE FROM menu_categories WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

const ITEM_SELECT = `
  SELECT i.id, i.name, i.category_id, c.name AS category_name,
         i.sale_price, i.cost_price, i.is_available, i.barcode,
         i.sort_order, i.notes, i.image_file, i.sold_by_weight, i.unit_label
  FROM menu_items i
  LEFT JOIN menu_categories c ON c.id = i.category_id
`;

export interface ItemQuery {
  search?: string;
  categoryId?: number | null;
  availableOnly?: boolean;
}

export function listItems(query: ItemQuery = {}): MenuItem[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    where.push('(i.name LIKE ? OR i.barcode = ?)');
    params.push(`%${query.search}%`, query.search);
  }
  if (query.categoryId) {
    where.push('i.category_id = ?');
    params.push(query.categoryId);
  }
  if (query.availableOnly) {
    where.push('i.is_available = 1');
  }

  const sql =
    ITEM_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY c.sort_order, c.name, i.sort_order, i.name';

  const rows = getDb().prepare(sql).all(...params) as MenuItem[];
  return hydrateVariants(rows);
}

/**
 * Attach each item's sizes in ONE query rather than one per row.
 *
 * The order screen lists the whole menu on every render, so a per-item query
 * here is 50+ round trips on a machine that is also taking orders.
 */
function hydrateVariants(items: MenuItem[]): MenuItem[] {
  if (!items.length) return items;
  const db = getDb();

  const variants = db
    .prepare(
      `SELECT id, item_id, name, sale_price, cost_price, is_available, sort_order
         FROM menu_item_variants
        WHERE item_id IN (${items.map(() => '?').join(', ')})
        ORDER BY sort_order, id`,
    )
    .all(...items.map((i) => i.id)) as MenuItemVariant[];

  return items.map((item) => {
    const mine = variants.filter((v) => v.item_id === item.id);
    return {
      ...item,
      variants: mine,
      // What the grid shows: the cheapest size, labelled "from".
      price_from: mine.length
        ? Math.min(...mine.filter((v) => v.is_available === 1).map((v) => v.sale_price))
        : item.sale_price,
    };
  });
}

/** One variant, for pricing a line the moment it is added. */
export function getVariant(id: number): MenuItemVariant | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, item_id, name, sale_price, cost_price, is_available, sort_order
           FROM menu_item_variants WHERE id = ?`,
      )
      .get(id) as MenuItemVariant | undefined) ?? null
  );
}

export function getItem(id: number): MenuItem | null {
  const row = getDb().prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as MenuItem | undefined;
  return row ? hydrateVariants([row])[0] : null;
}

export interface ItemInput {
  id?: number;
  name: string;
  category_id: number | null;
  sale_price: number;
  cost_price: number;
  is_available: boolean;
  barcode: string | null;
  sort_order: number;
  notes: string | null;
  /** Filename in <userData>/images/. Undefined leaves the current one alone. */
  image_file?: string | null;
  /** Sold by weight/bulk — `sale_price` is then the PER-UNIT price. */
  sold_by_weight?: boolean;
  /** Unit for a weight-based item, e.g. "kg". Ignored when not sold by weight. */
  unit_label?: string | null;
  /** Modifier groups to attach. Replaces whatever was attached before. */
  modifier_group_ids?: number[];
  /**
   * Sizes. Undefined leaves them untouched; an empty array clears them and
   * turns the item back into a single-price one.
   */
  variants?: Array<{ name: string; sale_price: number; cost_price: number }>;
}

export function saveItem(input: ItemInput): MenuItem {
  const db = getDb();

  const run = db.transaction(() => {
    let id = input.id ?? 0;

    // Never both: a weight item's unit is meaningless the moment the toggle
    // is off, so the column is cleared rather than left stale.
    const soldByWeight = input.sold_by_weight ? 1 : 0;
    const unitLabel = soldByWeight ? input.unit_label || null : null;

    if (id) {
      db.prepare(
        `UPDATE menu_items
            SET name = ?, category_id = ?, sale_price = ?, cost_price = ?,
                is_available = ?, barcode = ?, sort_order = ?, notes = ?,
                image_file = COALESCE(?, image_file),
                sold_by_weight = ?, unit_label = ?
          WHERE id = ?`,
      ).run(
        input.name,
        input.category_id,
        money(input.sale_price),
        money(input.cost_price),
        input.is_available ? 1 : 0,
        input.barcode || null,
        input.sort_order,
        input.notes || null,
        input.image_file === undefined ? null : input.image_file,
        soldByWeight,
        unitLabel,
        id,
      );
    } else {
      const info = db
        .prepare(
          `INSERT INTO menu_items
             (name, category_id, sale_price, cost_price, is_available, barcode,
              sort_order, notes, image_file, sold_by_weight, unit_label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.category_id,
          money(input.sale_price),
          money(input.cost_price),
          input.is_available ? 1 : 0,
          input.barcode || null,
          input.sort_order,
          input.notes || null,
          input.image_file ?? null,
          soldByWeight,
          unitLabel,
        );
      id = Number(info.lastInsertRowid);
    }

    if (input.modifier_group_ids) {
      db.prepare('DELETE FROM item_modifier_groups WHERE item_id = ?').run(id);
      const link = db.prepare(
        'INSERT OR IGNORE INTO item_modifier_groups (item_id, group_id) VALUES (?, ?)',
      );
      for (const groupId of input.modifier_group_ids) link.run(id, groupId);
    }

    /**
     * Sizes are replaced wholesale. Past order lines are unaffected — they
     * snapshotted variant_name and the price onto the row at the time of sale,
     * so repricing Large tomorrow cannot rewrite yesterday's bill.
     */
    if (input.variants) {
      db.prepare('DELETE FROM menu_item_variants WHERE item_id = ?').run(id);
      const insert = db.prepare(
        `INSERT INTO menu_item_variants (item_id, name, sale_price, cost_price, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.variants.forEach((variant, index) => {
        insert.run(id, variant.name, money(variant.sale_price), money(variant.cost_price), index);
      });
    }

    return id;
  });

  return getItem(run())!;
}

export function removeItem(id: number): void {
  // Past order lines keep their snapshot name and price, so history survives
  // even though the menu item is gone (order_items.menu_item_id SET NULL).
  getDb().prepare('DELETE FROM menu_items WHERE id = ?').run(id);
}

/** The "86 it" toggle — the one action a cook needs to be instant. */
export function setAvailable(id: number, available: boolean): MenuItem | null {
  getDb().prepare('UPDATE menu_items SET is_available = ? WHERE id = ?').run(available ? 1 : 0, id);
  return getItem(id);
}

/* ------------------------------------------------------------------ *
 * Modifiers
 * ------------------------------------------------------------------ */

export function listModifierGroups(): ModifierGroup[] {
  const db = getDb();
  const groups = db
    .prepare('SELECT id, name, selection_type FROM modifier_groups ORDER BY name')
    .all() as Array<Omit<ModifierGroup, 'modifiers'>>;

  const mods = db
    .prepare('SELECT id, group_id, name, price_delta FROM modifiers ORDER BY id')
    .all() as Modifier[];

  return groups.map((group) => ({
    ...group,
    modifiers: mods.filter((m) => m.group_id === group.id),
  }));
}

/** The groups attached to one item — what the order screen's picker shows. */
export function modifierGroupsForItem(itemId: number): ModifierGroup[] {
  const ids = getDb()
    .prepare('SELECT group_id FROM item_modifier_groups WHERE item_id = ?')
    .all(itemId) as Array<{ group_id: number }>;
  const wanted = new Set(ids.map((row) => row.group_id));
  return listModifierGroups().filter((group) => wanted.has(group.id));
}

export interface ModifierGroupInput {
  id?: number;
  name: string;
  selection_type: 'single' | 'multi';
  modifiers: Array<{ id?: number; name: string; price_delta: number }>;
}

export function saveModifierGroup(input: ModifierGroupInput): ModifierGroup {
  const db = getDb();

  const run = db.transaction(() => {
    let id = input.id ?? 0;

    if (id) {
      db.prepare('UPDATE modifier_groups SET name = ?, selection_type = ? WHERE id = ?').run(
        input.name,
        input.selection_type,
        id,
      );
    } else {
      const info = db
        .prepare('INSERT INTO modifier_groups (name, selection_type) VALUES (?, ?)')
        .run(input.name, input.selection_type);
      id = Number(info.lastInsertRowid);
    }

    // Replace the group's options wholesale. Past orders are unaffected —
    // they snapshotted the modifier name and delta onto the line.
    db.prepare('DELETE FROM modifiers WHERE group_id = ?').run(id);
    const insert = db.prepare(
      'INSERT INTO modifiers (group_id, name, price_delta) VALUES (?, ?, ?)',
    );
    for (const mod of input.modifiers) insert.run(id, mod.name, money(mod.price_delta));

    return id;
  });

  const id = run();
  return listModifierGroups().find((group) => group.id === id)!;
}

export function removeModifierGroup(id: number): void {
  getDb().prepare('DELETE FROM modifier_groups WHERE id = ?').run(id);
}

/** Look up chosen modifiers so the backend can price them, not the renderer. */
export function getModifiersByIds(ids: number[]): Modifier[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return getDb()
    .prepare(
      `SELECT id, group_id, name, price_delta FROM modifiers WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Modifier[];
}
