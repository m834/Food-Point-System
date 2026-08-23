'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Empty, Field, Modal, Notice } from '@/components/ui';
import { CancelModal } from '@/components/CancelModal';
import { foodIconFor } from '@/components/foodIcons';
import { IconDeal, IconFire, IconSearch } from '@/components/icons';
import { api, imageUrl } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money, qty as fmtQty, since } from '@/lib/format';
import {
  ORDER_TYPE_LABELS,
  SETTING_KEYS,
  type DiningTable,
  type Deal,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type OpenOrderSummary,
  type Order,
  type OrderType,
  type Customer,
  type ExtraCharge,
  type SettingsMap,
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
  const { toast, tablesEnabled, settings } = useApp();

  // The floor screen links here: ?order=N resumes, ?table=N starts on a table.
  const params = useSearchParams();
  const resumeOrderId = Number(params.get('order')) || null;
  const startTableId = Number(params.get('table')) || null;

  const [openOrders, setOpenOrders] = useState<OpenOrderSummary[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  // `'deals'` is a pseudo-category: deals are not a menu category row, but on
  // this screen they behave like one.
  const [activeCategory, setActiveCategory] = useState<number | 'deals' | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [startOpen, setStartOpen] = useState(false);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extras, setExtras] = useState<ExtraCharge[]>([]);
  const [voidTarget, setVoidTarget] = useState<{ kind: 'line' | 'order'; id: number; label: string } | null>(
    null,
  );

  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * "/" jumps back to the search box from anywhere on the screen, and Escape
   * clears it. A counter under pressure should never have to reach for the
   * mouse to find the next dish.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      // Don't steal the key from someone typing a note or a customer name.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refreshOpen = useCallback(async () => {
    setOpenOrders(await api.orders.listOpen());
  }, []);

  const loadMenu = useCallback(async () => {
    // Only active deals reach the order screen; the admin screen shows the rest.
    const [cats, list, dealList] = await Promise.all([
      api.menu.listCategories(),
      api.menu.listItems(),
      api.deals.list(true),
    ]);
    setCategories(cats);
    setItems(list);
    setDeals(dealList);
    // Packaging the counter can add to any order. Quiet failure: an older
    // database with no extras set up must not break taking an order.
    try {
      setExtras(await api.extras.list(true));
    } catch {
      setExtras([]);
    }
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

  const term = search.trim().toLowerCase();

  /**
   * Browsing categories, or looking at one.
   *
   * With 50+ dishes a single flat grid is a scrolling contest, so the counter
   * starts at the categories and taps into one. Searching always jumps
   * straight to matching items across the whole menu — a cashier who knows the
   * dish name should never have to guess which category it lives in.
   */
  const browsingCategories = activeCategory === null && !term;

  const visibleItems = useMemo(() => {
    if (activeCategory === 'deals') return [];
    if (activeCategory === null && !term) return [];
    return items.filter((item) => {
      if (typeof activeCategory === 'number' && item.category_id !== activeCategory) return false;
      if (term && !item.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, activeCategory, term]);

  /** Category cards, with how many dishes are in each. */
  const categoryCards = useMemo(
    () =>
      categories.map((category) => ({
        category,
        count: items.filter((item) => item.category_id === category.id).length,
      })),
    [categories, items],
  );

  /** The chosen category, whose photo becomes the backdrop. */
  const openCategory =
    typeof activeCategory === 'number'
      ? categories.find((c) => c.id === activeCategory) ?? null
      : null;

  /**
   * Deals lead the grid on "All" and own the Deals tab, because a combo is the
   * thing a counter most wants to put in front of a customer. A category tab
   * is about that category's food, so they drop out there.
   */
  const visibleDeals = useMemo(() => {
    if (typeof activeCategory === 'number') return [];
    // Deals lead their own tab and any search, but not the category browser —
    // that view is about choosing a section, not about buying yet.
    if (activeCategory === null && !term) return [];
    return deals.filter((deal) => !term || deal.name.toLowerCase().includes(term));
  }, [deals, activeCategory, term]);

  /** Tapping an item: straight onto the order, unless it has options to pick. */
  const tapItem = async (item: MenuItem) => {
    if (!order) {
      setStartOpen(true);
      return;
    }
    if (!item.is_available) return;

    try {
      const hydrated = await api.menu.getItem(item.id);
      // Sizes MUST be chosen — the backend refuses a line without one — and
      // modifiers are offered when the item has them.
      if (hydrated.variants?.length || hydrated.modifier_groups?.length) {
        setModifierItem(hydrated);
        return;
      }
      await addLine(item.id, 1, null, []);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add that item.', 'error');
    }
  };

  /** One tap = the whole deal. The backend expands and prices it. */
  const tapDeal = async (deal: Deal) => {
    if (!order) {
      setStartOpen(true);
      return;
    }
    if (!deal.is_sellable) return;

    setBusy(true);
    try {
      setOrder(await api.orders.addDeal(order.id, deal.id, 1));
      await refreshOpen();
      toast(strings.order.dealAdded, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add that deal.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addLine = async (
    menuItemId: number,
    quantity: number,
    notes: string | null,
    modifierIds: number[],
    variantId: number | null = null,
  ) => {
    if (!order) return;
    setBusy(true);
    try {
      const updated = await api.orders.addItems(order.id, [
        {
          menu_item_id: menuItemId,
          qty: quantity,
          notes,
          modifier_ids: modifierIds,
          variant_id: variantId,
        },
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

  /**
   * What the running-order panel actually draws.
   *
   * A deal was written to the database as its component items, but the cashier
   * sold ONE thing at ONE price and the customer will be quoted that price, so
   * the panel has to say the same. Components are collapsed back into a single
   * row whose total is the sum of their line_totals — which is exactly the
   * combo price, by construction in the backend.
   */
  const orderEntries = useMemo(() => {
    type Entry =
      | { kind: 'line'; key: string; line: (typeof liveLines)[number] }
      | {
          kind: 'deal';
          key: string;
          group: number;
          name: string;
          total: number;
          lines: typeof liveLines;
          fired: boolean;
          voided: boolean;
        };

    const entries: Entry[] = [];
    const index = new Map<number, Extract<Entry, { kind: 'deal' }>>();

    for (const line of order?.items ?? []) {
      if (!line.deal_group) {
        entries.push({ kind: 'line', key: `l${line.id}`, line });
        continue;
      }

      const existing = index.get(line.deal_group);
      if (existing) {
        existing.total = Math.round((existing.total + line.line_total) * 100) / 100;
        existing.lines.push(line);
        existing.fired = existing.fired || line.kitchen_status === 'fired';
        existing.voided = existing.voided && line.kitchen_status === 'void';
        continue;
      }

      const entry: Extract<Entry, { kind: 'deal' }> = {
        kind: 'deal',
        key: `d${line.deal_group}`,
        group: line.deal_group,
        name: line.deal_name ?? 'Deal',
        total: line.line_total,
        lines: [line],
        fired: line.kitchen_status === 'fired',
        voided: line.kitchen_status === 'void',
      };
      index.set(line.deal_group, entry);
      entries.push(entry);
    }

    return entries;
  }, [order]);

  if (loading) return <div className="empty">{strings.common.loading}</div>;

  return (
    <div className="order-screen">
      {/* ------------------------- left: item grid ------------------------- */}
      <section className="order-left">
        <div className="order-toolbar">
          <div className="row">
            {/* The big keyboard-first search bar. A barcode scanner is just a
                keyboard, and a counter with a keyboard types the dish name —
                so this is the largest control on the screen, focused on load
                and reachable again from anywhere with "/". */}
            <div className="order-search">
              <span className="order-search-icon">
                <IconSearch size={18} />
              </span>
              <input
                ref={searchRef}
                className="input"
                placeholder={strings.order.search}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearch('');
                }}
                autoFocus
              />
              {search ? null : <span className="order-search-hint">/</span>}
            </div>
            <button className="btn primary" onClick={() => setStartOpen(true)}>
              {strings.order.newOrder}
            </button>
          </div>

          <div className="cat-tabs">
            <button
              className={`cat-tab${activeCategory === null ? ' active' : ''}`}
              onClick={() => {
                setActiveCategory(null);
                setSearch('');
              }}
            >
              {activeCategory === null ? strings.order.allItems : `← ${strings.order.allItems}`}
            </button>
            {deals.length ? (
              <button
                className={`cat-tab${activeCategory === 'deals' ? ' active' : ''}`}
                onClick={() => setActiveCategory('deals')}
              >
                {strings.order.dealsTab}
              </button>
            ) : null}
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

        {/* The chosen category's photo, blurred far behind the cards.
            Heavily veiled on purpose: this is a working screen, and a
            legible price beats a pretty backdrop every time. */}
        {openCategory?.image_file ? (
          <div
            className="category-backdrop"
            style={{
              backgroundImage: `url(${imageUrl('category', openCategory.image_file)})`,
            }}
            aria-hidden="true"
          />
        ) : null}

        {browsingCategories ? (
          <div className="item-grid category-grid">
            {deals.length ? (
              <button
                className="category-card category-card-deals"
                onClick={() => setActiveCategory('deals')}
              >
                <span className="category-card-art">
                  <IconDeal size={30} />
                </span>
                <span className="category-card-name">{strings.order.dealsTab}</span>
                <span className="category-card-count">
                  {strings.order.itemCount(deals.length)}
                </span>
              </button>
            ) : null}

            {categoryCards.map(({ category, count }) => (
              <CategoryCard
                key={category.id}
                category={category}
                count={count}
                onOpen={() => setActiveCategory(category.id)}
              />
            ))}
          </div>
        ) : visibleItems.length === 0 && visibleDeals.length === 0 ? (
          <Empty
            title={items.length ? 'Nothing matches that' : strings.menu.emptyTitle}
            note={items.length ? 'Try a different search or category.' : strings.menu.emptyNote}
          />
        ) : (
          <div className="item-grid">
            {visibleDeals.map((deal) => (
              <button
                key={`deal-${deal.id}`}
                className={`item-card deal-card${deal.is_sellable ? '' : ' sold-out'}${deal.image_file ? ' has-photo' : ''}`}
                onClick={() => tapDeal(deal)}
                disabled={!deal.is_sellable || busy}
                title={deal.components.map((c) => `${c.qty} × ${c.item_name}`).join(' + ')}
              >
                {deal.image_file ? (
                  <img
                    className="item-card-photo"
                    src={imageUrl('deal', deal.image_file)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
                <span className="deal-card-tag">{strings.deals.inDeal}</span>
                <span className="item-card-name">{deal.name}</span>
                <span className="deal-card-parts">
                  {deal.components
                    .map((c) => (c.qty === 1 ? c.item_name : `${c.qty} × ${c.item_name}`))
                    .join(' + ')}
                </span>
                <span className="row-between">
                  <span className="item-card-price">{money(deal.price)}</span>
                  {deal.is_sellable ? (
                    deal.menu_value > deal.price ? (
                      <span className="deal-card-was">{money(deal.menu_value)}</span>
                    ) : null
                  ) : (
                    <span className="tiny muted">{strings.deals.unavailable}</span>
                  )}
                </span>
              </button>
            ))}
            {visibleItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                disabled={!item.is_available || busy}
                onTap={() => tapItem(item)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ----------------------- right: running order ---------------------- */}
      <aside className="order-right">
        {/* The switcher between orders in progress. The full unpaid list —
            what each owes and how long it has been sitting — lives on the
            Orders screen, where it can also be printed. */}
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
                orderEntries.map((entry) =>
                  entry.kind === 'deal' ? (
                    <div
                      key={entry.key}
                      className={`order-line deal-line${entry.fired ? ' fired' : ''}${entry.voided ? ' voided' : ''}`}
                    >
                      <div className="order-line-main">
                        <div className="order-line-name">
                          <span className="deal-line-tag">{strings.deals.inDeal}</span>
                          {entry.name}
                        </div>
                        {/* The contents, so the counter can check the bundle
                            without opening anything. */}
                        <div className="order-line-meta">
                          {entry.lines
                            .map((part) => `${fmtQty(part.qty)} × ${part.item_name}`)
                            .join(' + ')}
                        </div>
                        {entry.fired ? (
                          <div className="order-line-meta">{strings.order.fired}</div>
                        ) : null}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div className="order-line-total">{money(entry.total)}</div>
                        {!entry.voided ? (
                          <button
                            className="btn ghost sm"
                            style={{ color: 'var(--danger)', marginTop: 4 }}
                            /* Voiding any component voids the whole bundle in
                               the backend — a half-combo is not a thing. */
                            onClick={() =>
                              setVoidTarget({
                                kind: 'line',
                                id: entry.lines[0].id,
                                label: entry.name,
                              })
                            }
                          >
                            {strings.order.void}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                  <div
                    key={entry.key}
                    className={`order-line${entry.line.kitchen_status === 'fired' || entry.line.kitchen_status === 'served' ? ' fired' : ''}${entry.line.kitchen_status === 'void' ? ' voided' : ''}`}
                  >
                    <div className="order-line-main">
                      <div className="order-line-name">{entry.line.item_name}</div>
                      {entry.line.modifiers.length ? (
                        <div className="order-line-meta">
                          {entry.line.modifiers.map((mod) => mod.name).join(', ')}
                        </div>
                      ) : null}
                      {entry.line.notes ? (
                        <div className="order-line-meta">“{entry.line.notes}”</div>
                      ) : null}
                      {entry.line.kitchen_status === 'fired' ? (
                        <div className="order-line-meta">{strings.order.fired}</div>
                      ) : null}

                      {entry.line.kitchen_status === 'new' ? (
                        <div className="row" style={{ marginTop: 6 }}>
                          <span className="qty-stepper">
                            <button
                              onClick={() => changeQty(entry.line.id, entry.line.qty - 1)}
                              disabled={busy}
                            >
                              −
                            </button>
                            <span>{fmtQty(entry.line.qty)}</span>
                            <button
                              onClick={() => changeQty(entry.line.id, entry.line.qty + 1)}
                              disabled={busy}
                            >
                              +
                            </button>
                          </span>
                        </div>
                      ) : (
                        <div className="order-line-meta">× {fmtQty(entry.line.qty)}</div>
                      )}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div className="order-line-total">{money(entry.line.line_total)}</div>
                      {entry.line.kitchen_status !== 'void' ? (
                        <button
                          className="btn ghost sm"
                          style={{ color: 'var(--danger)', marginTop: 4 }}
                          onClick={() =>
                            setVoidTarget({
                              kind: 'line',
                              id: entry.line.id,
                              label: entry.line.item_name,
                            })
                          }
                        >
                          {strings.order.void}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  ),
                )
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

              {/* Packaging, on every order type. Shows what is already on
                  the order so the counter can see it without opening it. */}
              {extras.length ? (
                <button
                  className="btn sm block"
                  style={{ marginTop: 8 }}
                  onClick={() => setExtrasOpen(true)}
                  disabled={busy}
                >
                  {strings.extras.onOrder}
                  {order.extras_total ? ` · ${money(order.extras_total)}` : ''}
                </button>
              ) : null}

              <button
                className="btn ghost sm block"
                style={{ marginTop: 8, color: 'var(--danger)' }}
                onClick={() =>
                  setVoidTarget({ kind: 'order', id: order.id, label: `order ${order.order_no}` })
                }
              >
                {strings.cancel.cancelOrder}
              </button>
            </div>
          </>
        )}
      </aside>

      {startOpen ? (
        <StartOrderModal
          tablesEnabled={tablesEnabled}
          settings={settings}
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
          onAdd={async (quantity, notes, modifierIds, variantId) => {
            setModifierItem(null);
            await addLine(modifierItem.id, quantity, notes, modifierIds, variantId);
          }}
        />
      ) : null}

      {extrasOpen && order ? (
        <ExtrasModal
          order={order}
          extras={extras}
          onClose={() => setExtrasOpen(false)}
          onChanged={setOrder}
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

      {voidTarget && order ? (
        <CancelModal
          order={order}
          line={voidTarget.kind === 'line' ? { id: voidTarget.id, label: voidTarget.label } : null}
          onClose={() => setVoidTarget(null)}
          onCancelled={async (updated) => {
            setVoidTarget(null);
            // A cancelled order leaves the floor; a cancelled line does not.
            setOrder(updated.status === 'void' ? null : updated);
            await refreshOpen();
            toast(strings.cancel.done, 'ok');
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
  settings,
  initialTableId = null,
  onClose,
  onStarted,
}: {
  settings: SettingsMap;
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
  const [address, setAddress] = useState('');
  // Pre-filled from Settings, but the counter can change it for this order —
  // a far-out address costs more to reach than a nearby one.
  const [deliveryCharge, setDeliveryCharge] = useState(
    settings[SETTING_KEYS.deliveryCharge] ?? '0',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** The saved customer behind the typed phone, if there is one. */
  const [known, setKnown] = useState<Customer | null>(null);

  /**
   * Look the phone up as it is typed.
   *
   * Debounced, because the counter types a number one digit at a time and a
   * query per keystroke is wasted work on a machine that is also taking
   * orders. Everything found is a SUGGESTION: the fields stay editable, so a
   * customer ordering to a different address today is not fighting the app.
   */
  useEffect(() => {
    if (type === 'dine_in') return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) {
      setKnown(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const found = await api.customers.lookup(phone);
        if (cancelled) return;
        setKnown(found);
        // Only fill blanks. Whatever the counter has already typed for THIS
        // order wins over what is on file.
        if (found) {
          setName((current) => current || found.name || '');
          setAddress((current) => current || found.address || '');
        }
      } catch {
        /* A lookup failure must never get in the way of taking an order. */
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phone, type]);

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
        delivery_address: type === 'delivery' ? address.trim() : null,
        delivery_charge: type === 'delivery' ? Number(deliveryCharge) || 0 : undefined,
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
            disabled={
              busy ||
              (type === 'dine_in' && !tableId) ||
              // Never let a delivery slip print with a blank address.
              (type === 'delivery' && !address.trim())
            }
            title={
              type === 'delivery' && !address.trim()
                ? strings.order.deliveryNeedsAddress
                : undefined
            }
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
        <>
          {/* Delivery needs somewhere to go, and what it costs to get there.
              Dine-in and takeaway are untouched by any of this. */}
          {type === 'delivery' ? (
            <>
              <Field
                label={strings.order.deliveryAddress}
                hint={strings.order.deliveryAddressHint}
              >
                <textarea
                  className="input"
                  rows={2}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={strings.order.deliveryAddressPlaceholder}
                  autoFocus
                />
              </Field>
              <Field label={strings.order.deliveryCharge}>
                <input
                  className="input num"
                  type="number"
                  min={0}
                  step="0.01"
                  value={deliveryCharge}
                  onChange={(event) => setDeliveryCharge(event.target.value)}
                />
              </Field>
            </>
          ) : null}

          <div className="field-row">
            <Field
              label={`${strings.order.customerPhone} (${strings.order.optional})`}
              hint={strings.order.phoneLookupHint}
            >
              <input
                className="input num"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
            </Field>
            <Field label={`${strings.order.customerName} (${strings.order.optional})`}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>

          {/* A known customer, and anything the counter should know about
              them. Everything above stays editable — this is a suggestion. */}
          {known ? (
            <div className="customer-hit">
              <div className="row-between">
                <span className="customer-hit-name">
                  {known.name || strings.customers.unnamed}
                </span>
                <span className="tiny muted">
                  {strings.customers.ordersBefore(known.order_count)}
                </span>
              </div>
              {known.notes ? <div className="customer-hit-note">“{known.notes}”</div> : null}
            </div>
          ) : null}
        </>
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
  onAdd: (
    qty: number,
    notes: string | null,
    modifierIds: number[],
    variantId: number | null,
  ) => void | Promise<void>;
}) {
  const groups: ModifierGroup[] = item.modifier_groups ?? [];
  const variants = item.variants ?? [];
  const [chosen, setChosen] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  /**
   * Pre-select the first available size rather than leaving it blank.
   *
   * A counter under pressure should be able to tap the item then tap Add for
   * the common case; making them choose every time would cost a tap on every
   * single pizza. The sizes are all visible, so an unusual one is one tap away.
   */
  const [variantId, setVariantId] = useState<number | null>(
    variants.find((v) => v.is_available === 1)?.id ?? null,
  );

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

  // A variant price REPLACES the item price; it is not added to it.
  const chosenVariant = variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = chosenVariant ? chosenVariant.sale_price : item.sale_price;

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {strings.common.cancel}
          </button>
          <button
            className="btn primary"
            onClick={() => onAdd(quantity, notes || null, selectedIds, variantId)}
            disabled={variants.length > 0 && !variantId}
          >
            {strings.order.addToOrder} · {money((unitPrice + delta) * quantity)}
          </button>
        </>
      }
    >
      {variants.length ? (
        <Field label={strings.order.chooseSize} hint={strings.order.chooseSizeHint}>
          <div className="reason-grid">
            {variants.map((variant) => (
              <button
                key={variant.id}
                className={`cat-tab${variantId === variant.id ? ' active' : ''}`}
                onClick={() => setVariantId(variant.id)}
                disabled={variant.is_available !== 1}
              >
                {variant.name}
                <span className="variant-price"> {money(variant.sale_price)}</span>
              </button>
            ))}
          </div>
        </Field>
      ) : null}

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

/** Same rounding the backend applies, so the preview cannot drift by a paisa. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ChargeModal({
  order,
  onClose,
  onSettled,
}: {
  order: Order;
  onClose: () => void;
  onSettled: (message: string) => void | Promise<void>;
}) {
  const { settings } = useApp();
  const [discount, setDiscount] = useState('0');
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Clamped the same way the backend clamps it, so the figure on the button is
  // the figure the customer is asked for. The backend still recomputes and
  // remains the authority — this only has to agree with it, not replace it.
  const discountValue = Math.min(Math.max(0, Number(discount) || 0), order.subtotal);
  // Fixed or percentage — clamped and computed exactly as serviceChargeFor()
  // does in the main process. The backend remains the authority; this only has
  // to agree with it, or the counter quotes a number the bill contradicts.
  const chargeMode = settings[SETTING_KEYS.serviceChargeMode] === 'percent' ? 'percent' : 'fixed';
  const chargePercent = Math.min(
    Math.max(Number(settings[SETTING_KEYS.serviceChargePercent]) || 0, 0),
    100,
  );
  const chargeAmount = Math.max(Number(settings[SETTING_KEYS.serviceChargeAmount]) || 0, 0);
  // A percentage is worked out on the GROSS subtotal, before the discount —
  // matching settleOrder().
  const serviceCharge =
    chargeMode === 'percent' ? round2((order.subtotal * chargePercent) / 100) : chargeAmount;
  // Read from the ORDER, exactly as settleOrder does — it was agreed with the
  // customer when the order was taken, not at the till.
  const deliveryCharge = order.type === 'delivery' ? round2(order.delivery_charge ?? 0) : 0;
  const extrasTotal = round2(order.extras_total ?? 0);
  const previewTotal = Math.max(
    0,
    round2(order.subtotal - discountValue + serviceCharge + deliveryCharge + extrasTotal),
  );

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

      {discountValue > 0 ? (
        <div className="row-between">
          <span className="muted">{strings.order.discount}</span>
          <span className="num">−{money(discountValue)}</span>
        </div>
      ) : null}

      {extrasTotal > 0 ? (
        <div className="row-between">
          <span className="muted">{strings.extras.onOrder}</span>
          <span className="num">{money(extrasTotal)}</span>
        </div>
      ) : null}

      {order.type === 'delivery' ? (
        <div className="row-between">
          <span className="muted">{strings.order.deliveryCharge}</span>
          <span className="num">{money(deliveryCharge)}</span>
        </div>
      ) : null}

      {serviceCharge > 0 ? (
        <div className="row-between">
          <span className="muted">
            {strings.order.serviceCharge}
            {chargeMode === 'percent' ? ` (${chargePercent}%)` : ''}
          </span>
          <span className="num">{money(serviceCharge)}</span>
        </div>
      ) : null}

      <div className="row-between" style={{ fontSize: 20, fontWeight: 700 }}>
        <span>{strings.order.total}</span>
        <span className="num">{money(previewTotal)}</span>
      </div>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * One tappable item on the grid
 * ------------------------------------------------------------------ */

/**
 * Photo when the shop has one, drawn icon when it does not.
 *
 * The two are not interchangeable at render time: a menu imported from a
 * spreadsheet carries the photo FILENAMES before the photos themselves
 * arrive, so `image_file` being set is not proof the file exists. Hiding a
 * broken image would leave a hole the size of a photo at the top of the card;
 * falling back to the icon keeps every card the same shape.
 */
function ItemCard({
  item,
  disabled,
  onTap,
}: {
  item: MenuItem;
  disabled: boolean;
  onTap: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(item.image_file) && !photoFailed;
  const Icon = foodIconFor(item.name, item.category_name);
  const hasSizes = item.variants.length > 0;

  return (
    <button
      className={`item-card${item.is_available ? '' : ' sold-out'}${showPhoto ? ' has-photo' : ''}`}
      onClick={onTap}
      disabled={disabled}
      title={hasSizes ? item.variants.map((v) => v.name).join(' · ') : undefined}
    >
      {showPhoto ? (
        <img
          className="item-card-photo"
          src={imageUrl('menu-item', item.image_file!)}
          alt=""
          loading="lazy"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <span className="item-card-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
      )}

      <span className="item-card-name">{item.name}</span>

      <span className="row-between">
        <span className="item-card-price">
          {hasSizes ? <span className="item-card-from">{strings.order.from} </span> : null}
          {money(hasSizes ? item.price_from ?? item.sale_price : item.sale_price)}
        </span>
        {item.is_available ? null : <span className="tiny muted">{strings.order.soldOut}</span>}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * One category on the browse grid
 * ------------------------------------------------------------------ */

/**
 * A category as a big tappable card: its photo when the shop has one, an icon
 * drawn from the category name when it does not, plus how many dishes are
 * inside so the counter knows what it is opening.
 */
function CategoryCard({
  category,
  count,
  onOpen,
}: {
  category: MenuCategory;
  count: number;
  onOpen: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(category.image_file) && !photoFailed;
  const Icon = foodIconFor(category.name, category.name);

  return (
    <button className={`category-card${showPhoto ? ' has-photo' : ''}`} onClick={onOpen}>
      {showPhoto ? (
        <img
          className="category-card-photo"
          src={imageUrl('category', category.image_file!)}
          alt=""
          loading="lazy"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <span className="category-card-art">
          <Icon size={30} />
        </span>
      )}
      <span className="category-card-name">{category.name}</span>
      <span className="category-card-count">{strings.order.itemCount(count)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Extras — packaging, on any order type
 * ------------------------------------------------------------------ */

/**
 * Tick what applies and set how many.
 *
 * The backend prices each line from the shop's list, so this sends only the
 * extra and the quantity. Steppers rather than checkboxes because two plates
 * is as common as one, and the counter should not have to add the same thing
 * twice.
 */
function ExtrasModal({
  order,
  extras,
  onClose,
  onChanged,
}: {
  order: Order;
  extras: ExtraCharge[];
  onClose: () => void;
  onChanged: (order: Order) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const qtyOf = (extraId: number) =>
    order.extras.find((row) => row.extra_id === extraId)?.qty ?? 0;

  const change = async (extraId: number, qty: number) => {
    setBusy(true);
    setError('');
    try {
      onChanged(await api.orders.setExtra(order.id, extraId, Math.max(0, qty)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={strings.extras.onOrder}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          {strings.common.close}
        </button>
      }
    >
      {extras.length === 0 ? (
        <div className="tiny muted">{strings.extras.setUpFirst}</div>
      ) : (
        <div className="deal-parts">
          {extras.map((extra) => {
            const qty = qtyOf(extra.id);
            return (
              <div className="deal-part" key={extra.id}>
                <div className="deal-part-name">
                  {extra.name}
                  <span className="tiny muted"> · {money(extra.price)}</span>
                </div>
                <span className="qty-stepper">
                  <button onClick={() => change(extra.id, qty - 1)} disabled={busy || qty === 0}>
                    −
                  </button>
                  <span>{qty}</span>
                  <button onClick={() => change(extra.id, qty + 1)} disabled={busy}>
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {order.extras_total ? (
        <div className="row-between" style={{ marginTop: 14, fontWeight: 650 }}>
          <span>{strings.extras.onOrder}</span>
          <span className="num">{money(order.extras_total)}</span>
        </div>
      ) : null}

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
