'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Empty, Field, Modal, Notice } from '@/components/ui';
import { IconFire, IconSearch } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money, qty as fmtQty, since } from '@/lib/format';
import {
  ORDER_TYPE_LABELS,
  type DiningTable,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type OpenOrderSummary,
  type Order,
  type OrderType,
} from '../../../shared/types';

/**
 * The order screen — where the app lives all day.
 *
 * Two panels: a big item grid to tap on the left, the running order on the
 * right. Several orders are open at once, so the strip along the top always
 * says which one you are on, and switching is one tap.
 */
export default function OrderPage() {
  return (
    <AppShell bare>
      {/* useSearchParams needs a boundary in a statically exported build. */}
      <Suspense fallback={<div className="empty">{strings.common.loading}</div>}>
        <OrderWorkspace />
      </Suspense>
    </AppShell>
  );
}

function OrderWorkspace() {
  const { toast, tablesEnabled } = useApp();

  // The floor screen links here: ?order=N resumes, ?table=N starts on a table.
  const params = useSearchParams();
  const resumeOrderId = Number(params.get('order')) || null;
  const startTableId = Number(params.get('table')) || null;

  const [openOrders, setOpenOrders] = useState<OpenOrderSummary[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [startOpen, setStartOpen] = useState(false);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ kind: 'line' | 'order'; id: number; label: string } | null>(
    null,
  );

  const refreshOpen = useCallback(async () => {
    setOpenOrders(await api.orders.listOpen());
  }, []);

  const loadMenu = useCallback(async () => {
    const [cats, list] = await Promise.all([api.menu.listCategories(), api.menu.listItems()]);
    setCategories(cats);
    setItems(list);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([refreshOpen(), loadMenu()]);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load the menu.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshOpen, loadMenu, toast]);

  /** Resume an order that is already running. */
  const selectOrder = useCallback(
    async (id: number) => {
      try {
        setOrder(await api.orders.get(id));
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not open that order.', 'error');
      }
    },
    [toast],
  );

  // Act on the link the floor sent us, once the first load has finished.
  useEffect(() => {
    if (loading) return;
    if (resumeOrderId) void selectOrder(resumeOrderId);
    else if (startTableId) setStartOpen(true);
  }, [loading, resumeOrderId, startTableId, selectOrder]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory && item.category_id !== activeCategory) return false;
      if (term && !item.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, activeCategory, search]);

  /** Tapping an item: straight onto the order, unless it has options to pick. */
  const tapItem = async (item: MenuItem) => {
    if (!order) {
      setStartOpen(true);
      return;
    }
    if (!item.is_available) return;

    try {
      const hydrated = await api.menu.getItem(item.id);
      if (hydrated.modifier_groups?.length) {
        setModifierItem(hydrated);
        return;
      }
      await addLine(item.id, 1, null, []);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add that item.', 'error');
    }
  };

  const addLine = async (
    menuItemId: number,
    quantity: number,
    notes: string | null,
    modifierIds: number[],
  ) => {
    if (!order) return;
    setBusy(true);
    try {
      const updated = await api.orders.addItems(order.id, [
        { menu_item_id: menuItemId, qty: quantity, notes, modifier_ids: modifierIds },
      ]);
      setOrder(updated);
      await refreshOpen();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add that item.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeQty = async (lineId: number, next: number) => {
    setBusy(true);
    try {
      setOrder(await api.orders.setItemQty(lineId, next));
      await refreshOpen();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change that quantity.', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Fire: only the not-yet-sent lines go, and a ticket prints for just those. */
  const fire = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const result = await api.orders.fire(order.id);
      setOrder(result.order);
      await refreshOpen();
      if (result.print.warning) toast(result.print.warning, 'error');
      else toast(`${result.fired.length} item(s) sent to the kitchen.`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send to the kitchen.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const unfired = order?.items.filter((item) => item.kitchen_status === 'new').length ?? 0;
  const liveLines = order?.items.filter((item) => item.kitchen_status !== 'void') ?? [];

  if (loading) return <div className="empty">{strings.common.loading}</div>;

  return (
    <div className="order-screen">
      {/* ------------------------- left: item grid ------------------------- */}
      <section className="order-left">
        <div className="order-toolbar">
          <div className="row">
            <div className="row" style={{ flex: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, color: 'var(--text-muted)', display: 'flex' }}>
                <IconSearch size={17} />
              </span>
              <input
                className="input"
                style={{ paddingLeft: 38 }}
                placeholder={strings.order.search}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button className="btn primary" onClick={() => setStartOpen(true)}>
              {strings.order.newOrder}
            </button>
          </div>

          <div className="cat-tabs">
            <button
              className={`cat-tab${activeCategory === null ? ' active' : ''}`}
              onClick={() => setActiveCategory(null)}
            >
              {strings.order.allItems}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                className={`cat-tab${activeCategory === category.id ? ' active' : ''}`}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <Empty
            title={items.length ? 'Nothing matches that' : strings.menu.emptyTitle}
            note={items.length ? 'Try a different search or category.' : strings.menu.emptyNote}
          />
        ) : (
          <div className="item-grid">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                className={`item-card${item.is_available ? '' : ' sold-out'}`}
                onClick={() => tapItem(item)}
                disabled={!item.is_available || busy}
              >
                <span className="item-card-name">{item.name}</span>
                <span className="row-between">
                  <span className="item-card-price">{money(item.sale_price)}</span>
                  {item.is_available ? null : (
                    <span className="tiny muted">{strings.order.soldOut}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ----------------------- right: running order ---------------------- */}
      <aside className="order-right">
        {openOrders.length > 0 ? (
          <div className="open-strip">
            {openOrders.map((summary) => (
              <button
                key={summary.id}
                className={`open-chip${order?.id === summary.id ? ' active' : ''}`}
                onClick={() => selectOrder(summary.id)}
              >
                {summary.has_unfired ? <span className="dot" /> : null}
                {summary.table_name ?? ORDER_TYPE_LABELS[summary.type]}
                <span className="muted tiny">{summary.order_no.split('-')[1]}</span>
              </button>
            ))}
          </div>
        ) : null}

        {!order ? (
          <Empty
            title={strings.order.noOpenOrders}
            note="Start an order to begin taking items."
            action={
              <button className="btn primary big" onClick={() => setStartOpen(true)}>
                {strings.order.startOrder}
              </button>
            }
          />
        ) : (
          <>
            {/* Which order am I on — never ambiguous. */}
            <div className="order-header">
              <div className="order-header-no">
                {order.order_no} · {since(order.opened_at)}
              </div>
              <div className="order-header-where">
                {order.table_name ?? ORDER_TYPE_LABELS[order.type]}
              </div>
            </div>

            <div className="order-lines">
              {liveLines.length === 0 ? (
                <Empty title={strings.order.emptyTitle} note={strings.order.emptyNote} />
              ) : (
                order.items.map((line) => (
                  <div
                    key={line.id}
                    className={`order-line${line.kitchen_status === 'fired' || line.kitchen_status === 'served' ? ' fired' : ''}${line.kitchen_status === 'void' ? ' voided' : ''}`}
                  >
                    <div className="order-line-main">
                      <div className="order-line-name">{line.item_name}</div>
                      {line.modifiers.length ? (
                        <div className="order-line-meta">
                          {line.modifiers.map((mod) => mod.name).join(', ')}
                        </div>
                      ) : null}
                      {line.notes ? <div className="order-line-meta">“{line.notes}”</div> : null}
                      {line.kitchen_status === 'fired' ? (
                        <div className="order-line-meta">{strings.order.fired}</div>
                      ) : null}

                      {line.kitchen_status === 'new' ? (
                        <div className="row" style={{ marginTop: 6 }}>
                          <span className="qty-stepper">
                            <button onClick={() => changeQty(line.id, line.qty - 1)} disabled={busy}>
                              −
                            </button>
                            <span>{fmtQty(line.qty)}</span>
                            <button onClick={() => changeQty(line.id, line.qty + 1)} disabled={busy}>
                              +
                            </button>
                          </span>
                        </div>
                      ) : (
                        <div className="order-line-meta">× {fmtQty(line.qty)}</div>
                      )}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div className="order-line-total">{money(line.line_total)}</div>
                      {line.kitchen_status !== 'void' ? (
                        <button
                          className="btn ghost sm"
                          style={{ color: 'var(--danger)', marginTop: 4 }}
                          onClick={() =>
                            setVoidTarget({ kind: 'line', id: line.id, label: line.item_name })
                          }
                        >
                          {strings.order.void}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="order-foot">
              <div className="order-total">
                <span className="order-total-label">{strings.order.total}</span>
                <span className="order-total-value">{money(order.subtotal)}</span>
              </div>

              <div className="order-actions">
                <button
                  className="btn"
                  onClick={fire}
                  disabled={busy || unfired === 0}
                  title={unfired === 0 ? 'Everything has already been sent' : undefined}
                >
                  <IconFire size={17} />
                  {strings.order.sendToKitchen}
                </button>
                <button
                  className="btn primary"
                  onClick={() => setChargeOpen(true)}
                  disabled={busy || liveLines.length === 0}
                >
                  {strings.order.charge}
                </button>
              </div>

              <button
                className="btn ghost sm block"
                style={{ marginTop: 8, color: 'var(--danger)' }}
                onClick={() =>
                  setVoidTarget({ kind: 'order', id: order.id, label: `order ${order.order_no}` })
                }
              >
                {strings.order.voidOrder}
              </button>
            </div>
          </>
        )}
      </aside>

      {startOpen ? (
        <StartOrderModal
          tablesEnabled={tablesEnabled}
          initialTableId={startTableId}
          onClose={() => setStartOpen(false)}
          onStarted={async (created) => {
            setOrder(created);
            setStartOpen(false);
            await refreshOpen();
          }}
        />
      ) : null}

      {modifierItem ? (
        <ModifierModal
          item={modifierItem}
          onClose={() => setModifierItem(null)}
          onAdd={async (quantity, notes, modifierIds) => {
            setModifierItem(null);
            await addLine(modifierItem.id, quantity, notes, modifierIds);
          }}
        />
      ) : null}

      {chargeOpen && order ? (
        <ChargeModal
          order={order}
          onClose={() => setChargeOpen(false)}
          onSettled={async (message) => {
            setChargeOpen(false);
            setOrder(null);
            await refreshOpen();
            toast(message, 'ok');
          }}
        />
      ) : null}

      {voidTarget ? (
        <VoidModal
          target={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={async (updated) => {
            setVoidTarget(null);
            // A voided order is gone from the floor; a voided line is not.
            setOrder(updated.status === 'void' ? null : updated);
            await refreshOpen();
            toast('Voided.', 'ok');
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Start an order — type first, because it changes what else is asked
 * ------------------------------------------------------------------ */

function StartOrderModal({
  tablesEnabled,
  initialTableId = null,
  onClose,
  onStarted,
}: {
  tablesEnabled: boolean;
  /** Preselected when the floor screen sent us here by tapping a free table. */
  initialTableId?: number | null;
  onClose: () => void;
  onStarted: (order: Order) => void | Promise<void>;
}) {
  const [type, setType] = useState<OrderType>(tablesEnabled ? 'dine_in' : 'takeaway');
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [tableId, setTableId] = useState<number | null>(initialTableId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tablesEnabled) return;
    api.tables
      .list()
      .then(setTables)
      .catch(() => undefined);
  }, [tablesEnabled]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await api.orders.open({
        type,
        table_id: type === 'dine_in' ? tableId : null,
        customer_name: name || null,
        customer_phone: phone || null,
      });
      await onStarted(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the order.');
    } finally {
      setBusy(false);
    }
  };

  const freeTables = tables.filter((table) => !table.open_order_id);

  return (
    <Modal
      title={strings.order.newOrder}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
          <button
            className="btn primary"
            onClick={start}
            disabled={busy || (type === 'dine_in' && !tableId)}
          >
            {strings.order.startOrder}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        {(['dine_in', 'takeaway', 'delivery'] as OrderType[])
          .filter((option) => option !== 'dine_in' || tablesEnabled)
          .map((option) => (
            <button
              key={option}
              className={`cat-tab${type === option ? ' active' : ''}`}
              onClick={() => setType(option)}
              style={{ flex: 1 }}
            >
              {ORDER_TYPE_LABELS[option]}
            </button>
          ))}
      </div>

      {type === 'dine_in' ? (
        freeTables.length ? (
          <Field label={strings.order.chooseTable}>
            <div className="floor-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
              {freeTables.map((table) => (
                <button
                  key={table.id}
                  className={`cat-tab${tableId === table.id ? ' active' : ''}`}
                  onClick={() => setTableId(table.id)}
                >
                  {table.name}
                </button>
              ))}
            </div>
          </Field>
        ) : (
          <Notice kind="warn">
            Every table has an order on it. Resume one from the strip, or take this as a takeaway.
          </Notice>
        )
      ) : (
        <div className="field-row">
          <Field label={`${strings.order.customerName} (${strings.order.optional})`}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={`${strings.order.customerPhone} (${strings.order.optional})`}>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
      )}

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Modifier picker — Size / Spice / Add-ons, then the line note
 * ------------------------------------------------------------------ */

function ModifierModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (qty: number, notes: string | null, modifierIds: number[]) => void | Promise<void>;
}) {
  const groups: ModifierGroup[] = item.modifier_groups ?? [];
  const [chosen, setChosen] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const toggle = (group: ModifierGroup, modifierId: number) => {
    setChosen((current) => {
      const existing = current[group.id] ?? [];
      if (group.selection_type === 'single') {
        return { ...current, [group.id]: existing[0] === modifierId ? [] : [modifierId] };
      }
      return {
        ...current,
        [group.id]: existing.includes(modifierId)
          ? existing.filter((id) => id !== modifierId)
          : [...existing, modifierId],
      };
    });
  };

  const selectedIds = Object.values(chosen).flat();
  const delta = groups
    .flatMap((group) => group.modifiers)
    .filter((mod) => selectedIds.includes(mod.id))
    .reduce((sum, mod) => sum + mod.price_delta, 0);

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={() => onAdd(quantity, notes || null, selectedIds)}>
            {strings.order.addToOrder} · {money((item.sale_price + delta) * quantity)}
          </button>
        </>
      }
    >
      {groups.map((group) => (
        <Field
          key={group.id}
          label={group.name}
          hint={group.selection_type === 'single' ? 'Pick one' : 'Pick any'}
        >
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {group.modifiers.map((mod) => (
              <button
                key={mod.id}
                className={`cat-tab${(chosen[group.id] ?? []).includes(mod.id) ? ' active' : ''}`}
                onClick={() => toggle(group, mod.id)}
              >
                {mod.name}
                {mod.price_delta ? ` (${mod.price_delta > 0 ? '+' : ''}${money(mod.price_delta)})` : ''}
              </button>
            ))}
          </div>
        </Field>
      ))}

      <Field label={strings.order.lineNote}>
        <input
          className="input"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={strings.order.lineNotePlaceholder}
        />
      </Field>

      <div className="row">
        <span className="qty-stepper">
          <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
          <span>{quantity}</span>
          <button onClick={() => setQuantity((q) => q + 1)}>+</button>
        </span>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Charge — the money step
 * ------------------------------------------------------------------ */

function ChargeModal({
  order,
  onClose,
  onSettled,
}: {
  order: Order;
  onClose: () => void;
  onSettled: (message: string) => void | Promise<void>;
}) {
  const [discount, setDiscount] = useState('0');
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const discountValue = Math.max(0, Number(discount) || 0);
  // A preview only. The backend recomputes everything — including the service
  // charge, which comes from settings and never from this screen.
  const previewTotal = Math.max(0, order.subtotal - discountValue);

  const settle = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.orders.settle(order.id, {
        discount: discountValue,
        payment_method: method,
      });
      await onSettled(
        result.print.warning ?? `Paid — ${money(result.order.total)}. Bill printed.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the payment.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${strings.order.takePayment} · ${order.order_no}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={settle} disabled={busy}>
            {strings.order.charge} {money(previewTotal)}
          </button>
        </>
      }
    >
      <div className="row-between">
        <span className="muted">{strings.order.subtotal}</span>
        <span className="num">{money(order.subtotal)}</span>
      </div>

      <Field label={strings.order.discount}>
        <input
          className="input num"
          type="number"
          min={0}
          step="0.01"
          value={discount}
          onChange={(event) => setDiscount(event.target.value)}
        />
      </Field>

      <Field label={strings.order.paymentMethod}>
        <div className="row" style={{ gap: 8 }}>
          {(['cash', 'card'] as const).map((option) => (
            <button
              key={option}
              className={`cat-tab${method === option ? ' active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setMethod(option)}
            >
              {option === 'cash' ? strings.order.cash : strings.order.card}
            </button>
          ))}
        </div>
      </Field>

      <div className="row-between" style={{ fontSize: 20, fontWeight: 700 }}>
        <span>{strings.order.total}</span>
        <span className="num">{money(previewTotal)}</span>
      </div>
      <div className="tiny muted">
        Any service charge set in Settings is added when the bill is worked out.
      </div>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Void — reason always, PIN when the owner set one
 * ------------------------------------------------------------------ */

function VoidModal({
  target,
  onClose,
  onVoided,
}: {
  target: { kind: 'line' | 'order'; id: number; label: string };
  onClose: () => void;
  onVoided: (order: Order) => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const updated =
        target.kind === 'line'
          ? await api.orders.voidItem(target.id, reason, pin || undefined)
          : await api.orders.voidOrder(target.id, reason, pin || undefined);
      await onVoided(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not void that.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${strings.order.void} — ${target.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn danger-solid" onClick={submit} disabled={busy || !reason.trim()}>
            {strings.order.void}
          </button>
        </>
      }
    >
      <Field label={strings.order.voidReason}>
        <input
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={strings.order.voidReasonPlaceholder}
          autoFocus
        />
      </Field>

      {/* Always offered: the backend decides whether a PIN is actually needed,
          and says so plainly if one is missing. */}
      <Field label={`${strings.order.managerPin} (${strings.order.optional})`}>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />
      </Field>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
