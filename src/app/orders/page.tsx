'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Badge, Card, Empty, Field, Modal, Notice } from '@/components/ui';
import { IconPrint } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateTime, money, qty, todayIso, daysAgoIso } from '@/lib/format';
import { ORDER_TYPE_LABELS, type Order } from '../../../shared/types';

/**
 * The order history.
 *
 * This is what the counter reaches for when a customer comes back holding a
 * torn bill, or when the owner wants to see what a particular order actually
 * contained. Every row can be reprinted — the most common reason to open this
 * screen at all.
 */
export default function OrdersPage() {
  const { toast } = useApp();

  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [status, setStatus] = useState<'all' | 'settled' | 'void'>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Order | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await api.orders.list(from, to, status === 'all' ? undefined : status));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load orders.', 'error');
    } finally {
      setLoading(false);
    }
  }, [from, to, status, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Reprint. A voided order has no bill to hand over, so the button is not
   * offered on those rows rather than failing after the tap.
   */
  const print = async (order: Order) => {
    setPrintingId(order.id);
    try {
      const outcome = await api.orders.reprintBill(order.id);
      if (outcome.warning) toast(outcome.warning, 'error');
      else toast(`${order.order_no} — ${strings.orders.printed}`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not print that bill.', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const totals = useMemo(() => {
    const paid = orders.filter((order) => order.status === 'settled');
    return {
      count: paid.length,
      sales: paid.reduce((sum, order) => sum + order.total, 0),
      profit: paid.reduce((sum, order) => sum + (order.profit ?? 0), 0),
    };
  }, [orders]);

  const quickRange = (days: number) => {
    setFrom(days === 0 ? todayIso() : daysAgoIso(days));
    setTo(todayIso());
  };

  return (
    <AppShell
      title={strings.orders.title}
      subtitle={strings.orders.subtitle}
      actions={
        <>
          <Field label={strings.reports.from}>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label={strings.reports.to}>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => quickRange(0)}>
            Today
          </button>
          <button className="btn sm" onClick={() => quickRange(6)}>
            Last 7 days
          </button>
          <button className="btn sm" onClick={() => quickRange(29)}>
            Last 30 days
          </button>

          <span className="spacer" />

          {(['all', 'settled', 'void'] as const).map((option) => (
            <button
              key={option}
              className={`cat-tab${status === option ? ' active' : ''}`}
              onClick={() => setStatus(option)}
            >
              {option === 'all'
                ? strings.orders.all
                : option === 'settled'
                  ? strings.orders.settled
                  : strings.orders.voided}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty">{strings.common.loading}</div>
        ) : orders.length === 0 ? (
          <Card>
            <Empty title={strings.orders.emptyTitle} note={strings.orders.emptyNote} />
          </Card>
        ) : (
          <>
            {totals.count > 0 ? (
              <Card>
                <div className="row-between">
                  <span className="muted small">
                    {totals.count} paid order{totals.count === 1 ? '' : 's'} in this range
                  </span>
                  <span className="row" style={{ gap: 22 }}>
                    <span>
                      <span className="muted small">{strings.orders.total} </span>
                      <strong className="num">{money(totals.sales)}</strong>
                    </span>
                    <span>
                      <span className="muted small">{strings.orders.profit} </span>
                      <strong className="num" style={{ color: 'var(--success)' }}>
                        {money(totals.profit)}
                      </strong>
                    </span>
                  </span>
                </div>
              </Card>
            ) : null}

            <Card pad={false}>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{strings.orders.orderNo}</th>
                      <th>{strings.orders.type}</th>
                      <th>{strings.orders.when}</th>
                      <th className="right">{strings.orders.items}</th>
                      <th>{strings.orders.payment}</th>
                      <th className="right">{strings.orders.total}</th>
                      <th className="right">{strings.orders.profit}</th>
                      <th className="right">Bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const voided = order.status === 'void';
                      const lines = order.items.filter((item) => item.kitchen_status !== 'void');

                      return (
                        <tr key={order.id}>
                          <td className="num" style={{ fontWeight: 550 }}>
                            {order.order_no}
                          </td>
                          <td>
                            {ORDER_TYPE_LABELS[order.type]}
                            {order.table_name ? (
                              <span className="muted"> · {order.table_name}</span>
                            ) : null}
                          </td>
                          <td className="num muted">
                            {dateTime(order.settled_at ?? order.voided_at ?? order.opened_at)}
                          </td>
                          <td className="right num">{lines.length}</td>
                          <td>
                            {voided ? (
                              <Badge kind="danger">{strings.orders.voided}</Badge>
                            ) : (
                              <Badge kind="success">
                                {order.payment_method === 'card'
                                  ? strings.order.card
                                  : strings.order.cash}
                              </Badge>
                            )}
                          </td>
                          <td className="right num">{voided ? '—' : money(order.total)}</td>
                          <td className="right num" style={{ color: 'var(--success)' }}>
                            {voided ? '—' : money(order.profit)}
                          </td>
                          <td className="right">
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn sm" onClick={() => setViewing(order)}>
                                {strings.orders.view}
                              </button>
                              {/* A voided order was never paid — there is no
                                  bill to reprint, so do not offer one. */}
                              {voided ? null : (
                                <button
                                  className="btn sm primary"
                                  onClick={() => print(order)}
                                  disabled={printingId === order.id}
                                >
                                  <IconPrint size={15} />
                                  {printingId === order.id
                                    ? strings.orders.printing
                                    : strings.orders.print}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {viewing ? (
        <OrderDetail
          order={viewing}
          onClose={() => setViewing(null)}
          onPrint={() => print(viewing)}
          printing={printingId === viewing.id}
        />
      ) : null}
    </AppShell>
  );
}

/** The bill exactly as it printed, so "what was on this order?" is one tap. */
function OrderDetail({
  order,
  onClose,
  onPrint,
  printing,
}: {
  order: Order;
  onClose: () => void;
  onPrint: () => void;
  printing: boolean;
}) {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.orders
      .previewBill(order.id)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not build the bill.'));
  }, [order.id]);

  const voided = order.status === 'void';

  return (
    <Modal
      title={`${strings.orders.orderNo} ${order.order_no}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {strings.common.close}
          </button>
          {voided ? null : (
            <button className="btn primary" onClick={onPrint} disabled={printing}>
              <IconPrint size={16} />
              {printing ? strings.orders.printing : strings.orders.print}
            </button>
          )}
        </>
      }
    >
      {voided ? (
        <Notice kind="warn">
          {strings.orders.voidedNote}
          {order.void_reason ? ` Reason: ${order.void_reason}` : ''}
        </Notice>
      ) : null}

      <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
        <span className="small">
          <span className="muted">{strings.orders.type}: </span>
          {ORDER_TYPE_LABELS[order.type]}
          {order.table_name ? ` · ${order.table_name}` : ''}
        </span>
        <span className="small">
          <span className="muted">{strings.orders.when}: </span>
          {dateTime(order.settled_at ?? order.voided_at ?? order.opened_at)}
        </span>
        {order.customer_name ? (
          <span className="small">
            <span className="muted">Customer: </span>
            {order.customer_name}
          </span>
        ) : null}
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qty</th>
            <th className="right">Line</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} style={item.kitchen_status === 'void' ? { opacity: 0.5 } : undefined}>
              <td>
                {item.item_name}
                {item.modifiers.length ? (
                  <div className="tiny muted">
                    {item.modifiers.map((mod) => mod.name).join(', ')}
                  </div>
                ) : null}
                {item.notes ? <div className="tiny muted">“{item.notes}”</div> : null}
                {item.kitchen_status === 'void' ? (
                  <div className="tiny" style={{ color: 'var(--danger)' }}>
                    Voided{item.void_reason ? ` — ${item.void_reason}` : ''}
                  </div>
                ) : null}
              </td>
              <td className="right num">{qty(item.qty)}</td>
              <td className="right num">{money(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {error ? (
        <Notice>{error}</Notice>
      ) : preview ? (
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            {strings.orders.viewBill} — exactly as it prints
          </div>
          <div className="receipt-preview">{preview}</div>
        </div>
      ) : null}
    </Modal>
  );
}
