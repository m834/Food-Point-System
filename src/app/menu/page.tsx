'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Badge, Card, Empty, Field, Modal, Notice } from '@/components/ui';
import { IconPlus, IconTrash } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money } from '@/lib/format';
import type { MenuCategory, MenuItem, ModifierGroup } from '../../../shared/types';

/**
 * Manage what is for sale.
 *
 * Owners edit this rarely, so it is plain rather than clever — with one
 * exception: the sold-out toggle is a single tap straight from the list,
 * because a cook running out of biryani cannot wait for a dialog.
 */
export default function MenuPage() {
  const { toast } = useApp();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, cats, mods] = await Promise.all([
        api.menu.listItems(),
        api.menu.listCategories(),
        api.modifiers.groups(),
      ]);
      setItems(list);
      setCategories(cats);
      setGroups(mods);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load the menu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The "86 it" toggle. One tap, instant, no confirmation. */
  const toggleAvailable = async (item: MenuItem) => {
    try {
      const updated = await api.menu.setAvailable(item.id, !item.is_available);
      setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change that.', 'error');
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, search]);

  return (
    <AppShell
      title={strings.menu.title}
      subtitle={items.length ? `${items.length} items` : undefined}
      actions={
        <>
          <button className="btn" onClick={() => setCategoryOpen(true)}>
            {strings.menu.addCategory}
          </button>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <IconPlus size={17} />
            {strings.menu.addItem}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : items.length === 0 ? (
        <Card>
          <Empty
            title={strings.menu.emptyTitle}
            note={strings.menu.emptyNote}
            action={
              <button className="btn primary" onClick={() => setEditing('new')}>
                {strings.menu.addItem}
              </button>
            }
          />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="card-head">
            <input
              className="input"
              style={{ maxWidth: 280 }}
              placeholder={strings.common.search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>{strings.menu.category}</th>
                  <th className="right">{strings.menu.price}</th>
                  <th className="right">{strings.menu.foodCost}</th>
                  <th className="right">Margin</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 550 }}>{item.name}</td>
                    <td className="muted">{item.category_name ?? strings.menu.uncategorised}</td>
                    <td className="right num">{money(item.sale_price)}</td>
                    <td className="right num muted">{money(item.cost_price)}</td>
                    <td className="right num">{money(item.sale_price - item.cost_price)}</td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={() => toggleAvailable(item)}
                        title="Tap to change"
                        style={{ padding: 0, border: 'none', background: 'none' }}
                      >
                        <Badge kind={item.is_available ? 'success' : 'danger'}>
                          {item.is_available ? strings.menu.available : strings.menu.soldOut}
                        </Badge>
                      </button>
                    </td>
                    <td className="right">
                      <button className="btn sm" onClick={() => setEditing(item)}>
                        {strings.common.edit}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing ? (
        <ItemModal
          item={editing === 'new' ? null : editing}
          categories={categories}
          groups={groups}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      {categoryOpen ? (
        <CategoryModal
          categories={categories}
          onClose={() => setCategoryOpen(false)}
          onDone={async () => {
            setCategoryOpen(false);
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function ItemModal({
  item,
  categories,
  groups,
  onClose,
  onDone,
}: {
  item: MenuItem | null;
  categories: MenuCategory[];
  groups: ModifierGroup[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [categoryId, setCategoryId] = useState<string>(item?.category_id ? String(item.category_id) : '');
  const [price, setPrice] = useState(item ? String(item.sale_price) : '');
  const [cost, setCost] = useState(item ? String(item.cost_price) : '');
  const [available, setAvailable] = useState(item ? Boolean(item.is_available) : true);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The item list is not hydrated with its groups; fetch them when editing.
  useEffect(() => {
    if (!item) return;
    api.menu
      .getItem(item.id)
      .then((full) => setSelectedGroups((full.modifier_groups ?? []).map((group) => group.id)))
      .catch(() => undefined);
  }, [item]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.menu.saveItem({
        id: item?.id,
        name,
        category_id: categoryId ? Number(categoryId) : null,
        sale_price: Number(price) || 0,
        cost_price: Number(cost) || 0,
        is_available: available,
        notes: notes || null,
        sort_order: item?.sort_order ?? 0,
        modifier_group_ids: selectedGroups,
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that item.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.menu.removeItem(item.id);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that item.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={item ? item.name : strings.menu.addItem}
      onClose={onClose}
      wide
      footer={
        <>
          {item ? (
            <button className="btn danger" onClick={remove} disabled={busy}>
              <IconTrash size={16} />
              {strings.common.delete}
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            {strings.common.save}
          </button>
        </>
      }
    >
      <Field label={strings.menu.itemName}>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>

      <div className="field-row">
        <Field label={strings.menu.category}>
          <select
            className="input"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">{strings.menu.uncategorised}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={strings.menu.price}>
          <input
            className="input num"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
        <Field label={strings.menu.foodCost} hint={strings.menu.foodCostHint}>
          <input
            className="input num"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
      </div>

      {groups.length ? (
        <Field label={strings.menu.modifierGroups}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {groups.map((group) => (
              <button
                key={group.id}
                className={`cat-tab${selectedGroups.includes(group.id) ? ' active' : ''}`}
                onClick={() =>
                  setSelectedGroups((current) =>
                    current.includes(group.id)
                      ? current.filter((id) => id !== group.id)
                      : [...current, group.id],
                  )
                }
              >
                {group.name}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      <Field label={`${strings.order.lineNote} (${strings.order.optional})`}>
        <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>

      <label className="check">
        <input
          type="checkbox"
          checked={available}
          onChange={(event) => setAvailable(event.target.checked)}
        />
        {strings.menu.available}
      </label>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}

function CategoryModal({
  categories,
  onClose,
  onDone,
}: {
  categories: MenuCategory[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await api.menu.saveCategory({ name, sort_order: categories.length });
      setName('');
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that category.');
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.menu.removeCategory(id);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that category.');
    }
  };

  return (
    <Modal
      title={strings.menu.addCategory}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {strings.common.close}
        </button>
      }
    >
      <div className="row">
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Fast food"
          autoFocus
        />
        <button className="btn primary" onClick={add} disabled={busy || !name.trim()}>
          {strings.common.save}
        </button>
      </div>

      {categories.length ? (
        <table className="data">
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td className="right">
                  <button
                    className="btn ghost sm"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => remove(category.id)}
                  >
                    <IconTrash size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="tiny muted">Categories become the tabs on the order screen.</div>
      )}

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
