'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Badge, Card, Empty, Field, Modal, Notice } from '@/components/ui';
import { IconPlus, IconTrash } from '@/components/icons';
import { ImagePicker } from '@/components/ImagePicker';
import { api, imageUrl } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money } from '@/lib/format';
import type { Deal, MenuItem } from '../../../shared/types';

/**
 * Deals — bundles of menu items sold at one fixed combo price.
 *
 * An admin screen, so it follows the same rule as Menu and Settings: high
 * contrast, plain rows, no decoration. The owner sets these up once and then
 * lives on the order screen.
 *
 * The one number worth surfacing is the saving. An owner typing a combo price
 * needs to see immediately what the parts cost separately, or it is easy to
 * price a "deal" above its own ingredients by accident.
 */
export default function DealsPage() {
  const { toast } = useApp();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Deal | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, menuItems] = await Promise.all([api.deals.list(), api.menu.listItems()]);
      setDeals(list);
      setItems(menuItems);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load the deals.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Same one-tap treatment as "86 it" on the menu — no confirmation dialog. */
  const toggleActive = async (deal: Deal) => {
    try {
      const updated = await api.deals.setActive(deal.id, !deal.is_active);
      setDeals((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change that.', 'error');
    }
  };

  const remove = async (deal: Deal) => {
    if (!window.confirm(strings.deals.deleteConfirm)) return;
    try {
      await api.deals.remove(deal.id);
      setDeals((current) => current.filter((row) => row.id !== deal.id));
      toast('Deal deleted.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete that deal.', 'error');
    }
  };

  return (
    <AppShell
      title={strings.deals.title}
      subtitle={deals.length ? strings.deals.subtitle : undefined}
      actions={
        <button className="btn primary" onClick={() => setEditing('new')}>
          <IconPlus size={17} />
          {strings.deals.addDeal}
        </button>
      }
    >
      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : deals.length === 0 ? (
        <Card>
          <Empty
            title={strings.deals.emptyTitle}
            note={strings.deals.emptyNote}
            action={
              <button className="btn primary" onClick={() => setEditing('new')}>
                {strings.deals.addDeal}
              </button>
            }
          />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 52 }} />
                  <th>{strings.deals.name}</th>
                  <th>{strings.deals.contents}</th>
                  <th className="right">{strings.deals.menuValue}</th>
                  <th className="right">{strings.deals.price}</th>
                  <th className="right">{strings.deals.saving}</th>
                  <th>{strings.deals.active}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const saving = deal.menu_value - deal.price;
                  const soldOut = deal.components.find((c) => c.is_available !== 1);

                  return (
                    <tr key={deal.id}>
                      <td>
                        {deal.image_file ? (
                          <img
                            className="category-thumb"
                            src={imageUrl('deal', deal.image_file)}
                            alt=""
                            onError={(event) => {
                              event.currentTarget.style.visibility = 'hidden';
                            }}
                          />
                        ) : (
                          <span className="category-thumb category-thumb-empty" />
                        )}
                      </td>
                      <td>
                        <div className="deal-name-cell">
                          <strong>{deal.name}</strong>
                          {soldOut ? (
                            <Badge kind="warning">
                              {strings.deals.soldOutBecause(soldOut.item_name)}
                            </Badge>
                          ) : null}
                        </div>
                        {deal.notes ? <div className="tiny muted">{deal.notes}</div> : null}
                      </td>
                      <td className="muted">
                        {deal.components
                          .map((c) => (c.qty === 1 ? c.item_name : `${c.qty} × ${c.item_name}`))
                          .join(' + ')}
                      </td>
                      <td className="right num muted">{money(deal.menu_value)}</td>
                      <td className="right num">
                        <strong>{money(deal.price)}</strong>
                      </td>
                      <td className="right num">
                        {saving > 0 ? (
                          <span style={{ color: 'var(--success)' }}>{money(saving)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          className={`btn sm${deal.is_active ? ' ok-soft' : ''}`}
                          onClick={() => toggleActive(deal)}
                        >
                          {deal.is_active ? strings.deals.active : strings.deals.inactive}
                        </button>
                      </td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm" onClick={() => setEditing(deal)}>
                            {strings.common.edit}
                          </button>
                          <button
                            className="btn ghost sm"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => remove(deal)}
                            aria-label={strings.common.delete}
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing ? (
        <DealModal
          deal={editing === 'new' ? null : editing}
          items={items}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            toast('Deal saved.', 'ok');
          }}
        />
      ) : null}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ *
 * Create / edit a deal
 * ------------------------------------------------------------------ */

interface DraftComponent {
  menu_item_id: number;
  qty: number;
}

function DealModal({
  deal,
  items,
  onClose,
  onSaved,
}: {
  deal: Deal | null;
  items: MenuItem[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(deal?.name ?? '');
  const [price, setPrice] = useState(deal ? String(deal.price) : '');
  const [isActive, setIsActive] = useState(deal ? deal.is_active === 1 : true);
  const [notes, setNotes] = useState(deal?.notes ?? '');
  const [image, setImage] = useState<string | null>(deal?.image_file ?? null);
  const [components, setComponents] = useState<DraftComponent[]>(
    deal?.components.map((c) => ({ menu_item_id: c.menu_item_id, qty: c.qty })) ?? [],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /** What the bundle would cost at menu prices — the number that makes the
      combo price meaningful while it is being typed. */
  const menuValue = components.reduce((sum, c) => {
    const item = byId.get(c.menu_item_id);
    return sum + (item ? item.sale_price * c.qty : 0);
  }, 0);

  const priceValue = Number(price) || 0;
  const saving = menuValue - priceValue;

  const addComponent = (menuItemId: number) => {
    setComponents((current) =>
      current.some((c) => c.menu_item_id === menuItemId)
        ? current.map((c) => (c.menu_item_id === menuItemId ? { ...c, qty: c.qty + 1 } : c))
        : [...current, { menu_item_id: menuItemId, qty: 1 }],
    );
  };

  const setQty = (menuItemId: number, qty: number) => {
    setComponents((current) =>
      qty <= 0
        ? current.filter((c) => c.menu_item_id !== menuItemId)
        : current.map((c) => (c.menu_item_id === menuItemId ? { ...c, qty } : c)),
    );
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deals.save({
        id: deal?.id,
        name,
        price: priceValue,
        is_active: isActive,
        sort_order: deal?.sort_order ?? 0,
        notes: notes || null,
        image_file: image,
        components,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that deal.');
      setBusy(false);
    }
  };

  const available = items.filter((i) => !components.some((c) => c.menu_item_id === i.id));

  return (
    <Modal
      title={deal ? strings.deals.editDeal : strings.deals.addDeal}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button
            className="btn primary"
            onClick={save}
            disabled={busy || !name.trim() || !components.length || priceValue <= 0}
          >
            {strings.common.save}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label={strings.deals.name}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={strings.deals.namePlaceholder}
            autoFocus
          />
        </Field>
        <Field label={strings.deals.price} hint={strings.deals.priceHint}>
          <input
            className="input num"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </div>

      <Field label={strings.deals.contents}>
        {components.length === 0 ? (
          <div className="tiny muted">{strings.deals.noItemsYet}</div>
        ) : (
          <div className="deal-parts">
            {components.map((component) => {
              const item = byId.get(component.menu_item_id);
              if (!item) return null;
              return (
                <div key={component.menu_item_id} className="deal-part">
                  <div className="deal-part-name">
                    {item.name}
                    <span className="tiny muted"> · {money(item.sale_price)}</span>
                  </div>
                  <span className="qty-stepper">
                    <button onClick={() => setQty(component.menu_item_id, component.qty - 1)}>
                      −
                    </button>
                    <span>{component.qty}</span>
                    <button onClick={() => setQty(component.menu_item_id, component.qty + 1)}>
                      +
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Field>

      {available.length ? (
        <Field label={strings.deals.addItem}>
          <select
            className="input"
            value=""
            onChange={(e) => {
              if (e.target.value) addComponent(Number(e.target.value));
            }}
          >
            <option value="">{strings.deals.addItem}…</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {money(item.sale_price)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {/* The sanity check: an owner typing a combo price needs to see at once
          whether it is actually a saving. */}
      {components.length ? (
        <div className="deal-summary">
          <div className="row-between">
            <span className="muted">{strings.deals.menuValue}</span>
            <span className="num">{money(menuValue)}</span>
          </div>
          <div className="row-between">
            <span className="muted">{strings.deals.price}</span>
            <span className="num">{money(priceValue)}</span>
          </div>
          <div className="row-between deal-summary-saving">
            <span>{saving >= 0 ? strings.deals.saving : strings.deals.markup}</span>
            <span className="num" style={{ color: saving >= 0 ? 'var(--success)' : 'var(--warning)' }}>
              {money(Math.abs(saving))}
            </span>
          </div>
        </div>
      ) : null}

      <Field label={strings.deals.photo}>
        <ImagePicker kind="deal" value={image} onChange={setImage} />
      </Field>

      <Field label={strings.deals.active}>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={`cat-tab${isActive ? ' active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setIsActive(true)}
          >
            {strings.deals.active}
          </button>
          <button
            className={`cat-tab${!isActive ? ' active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setIsActive(false)}
          >
            {strings.deals.inactive}
          </button>
        </div>
      </Field>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
