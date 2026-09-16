'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Field, Modal, Notice, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateTime, money, qty as fmtQty, time } from '@/lib/format';
import {
  ORDER_TYPE_LABELS,
  WAITER_PAY_TYPE_LABELS,
  type DayReport,
  type DaySession,
  type Order,
} from '../../../shared/types';

/**
 * Open Day / Close Day — the business day, not the calendar day.
 *
 * The shop trades past midnight, so a date filter splits one night's trading
 * across two reports and neither describes the shift anyone worked. A session
 * runs from when the owner opens it to when they close it, and every order
 * taken in between is stamped with it.
 *
 * Open to the COUNTER as well as the owner. The owner is not standing at the
 * till at 11am to press a button before the first order, and a day nobody
 * opened is a day whose orders belong to no report.
 *
 * The margin is the part that stays the owner's: `gross_profit` arrives null
 * unless an admin session is live, stripped in the main process rather than
 * hidden by this screen, so a counter's report and a counter's printed slip
 * both simply do not carry it.
 */
export default function DayPage() {
  const { toast } = useApp();

  const [open, setOpen] = useState<{
    session: DaySession;
    unpaid: { count: number; total: number };
  } | null>(null);
  const [history, setHistory] = useState<DaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [viewing, setViewing] = useState<DayReport | null>(null);

  const load = useCallback(async () => {
    try {
      const [current, sessions] = await Promise.all([api.day.current(), api.day.list()]);
      setOpen(current);
      setHistory(sessions);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load the day.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewReport = async (session: DaySession) => {
    try {
      setViewing(await api.day.report(session.id));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not build that report.', 'error');
    }
  };

  return (
    <AppShell
      title={strings.day.title}
      subtitle={strings.day.subtitle}
      actions={
        open ? (
          <button className="btn primary big" onClick={() => setClosing(true)}>
            {strings.day.closeDay}
          </button>
        ) : (
          <button className="btn primary big" onClick={() => setOpening(true)}>
            {strings.day.openDay}
          </button>
        )
      }
    >
      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : (
        <div className="grid" style={{ gap: 18 }}>
          <Card>
            {open ? (
              <div className="row-between">
                <div>
                  <div className="stat-label">{strings.day.dayOpen}</div>
                  <div style={{ fontSize: 20, fontWeight: 650, marginTop: 4 }}>
                    {dateTime(open.session.opened_at)}
                  </div>
                  {open.session.opening_float > 0 ? (
                    <div className="tiny muted" style={{ marginTop: 4 }}>
                      {strings.day.float}: {money(open.session.opening_float)}
                    </div>
                  ) : null}
                </div>
                {/* Surfaced here, not only in the close dialog — an owner
                    should be able to chase unpaid tables before closing. */}
                {open.unpaid.count ? (
                  <div className="right">
                    <div className="stat-label">{strings.day.unpaidNow}</div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 650, color: 'var(--warning-text)' }}>
                      {open.unpaid.count} · {money(open.unpaid.total)}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <Empty title={strings.day.noDayOpen} note={strings.day.noDayOpenNote} />
            )}
          </Card>

          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.day.past}</h2>
            </div>
            {history.length === 0 ? (
              <Empty title={strings.day.noHistory} />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{strings.day.opened}</th>
                      <th>{strings.day.closed}</th>
                      <th className="right">{strings.day.float}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((session) => (
                      <tr key={session.id}>
                        <td className="num">{dateTime(session.opened_at)}</td>
                        <td className="num">
                          {session.closed_at ? (
                            dateTime(session.closed_at)
                          ) : (
                            <span style={{ color: 'var(--success-text)' }}>{strings.day.stillOpen}</span>
                          )}
                        </td>
                        <td className="right num muted">
                          {session.opening_float ? money(session.opening_float) : '—'}
                        </td>
                        <td className="right">
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn sm" onClick={() => viewReport(session)}>
                              {strings.day.viewReport}
                            </button>
                            {session.closed_at ? (
                              <button
                                className="btn sm"
                                onClick={async () => {
                                  const result = await api.day.print(session.id);
                                  toast(
                                    result.warning ?? strings.day.printed,
                                    result.printed ? 'ok' : 'error',
                                  );
                                }}
                              >
                                {strings.day.printSlip}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {opening ? (
        <OpenDayModal
          onClose={() => setOpening(false)}
          onOpened={async () => {
            setOpening(false);
            await load();
            toast(strings.day.opened_, 'ok');
          }}
        />
      ) : null}

      {closing && open ? (
        <CloseDayModal
          unpaid={open.unpaid}
          onClose={() => setClosing(false)}
          onClosed={async (report, warning) => {
            setClosing(false);
            await load();
            setViewing(report);
            toast(warning ?? strings.day.closed_, warning ? 'error' : 'ok');
          }}
        />
      ) : null}

      {viewing ? (
        <ReportModal report={viewing} onClose={() => setViewing(null)} toast={toast} />
      ) : null}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

function OpenDayModal({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: () => void | Promise<void>;
}) {
  const [float, setFloat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.day.open({ opening_float: Number(float) || 0 });
      await onOpened();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the day.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={strings.day.openDay}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {strings.day.openDay}
          </button>
        </>
      }
    >
      <Field label={strings.day.float} hint={strings.day.floatHint}>
        <input
          className="input num"
          type="number"
          min={0}
          step="0.01"
          value={float}
          onChange={(event) => setFloat(event.target.value)}
          autoFocus
        />
      </Field>
      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}

/**
 * Closing asks first when money is still on tables.
 *
 * Closing over unpaid orders is allowed — a customer may genuinely have walked
 * out and the owner has to be able to end the day — but it must never happen
 * silently, because those orders will not be in the report.
 */
function CloseDayModal({
  unpaid,
  onClose,
  onClosed,
}: {
  unpaid: { count: number; total: number };
  onClose: () => void;
  onClosed: (report: DayReport, warning?: string) => void | Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.day.close({});
      await onClosed(result.report, result.print.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the day.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={strings.day.closeDay}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {unpaid.count ? strings.day.closeAnyway : strings.day.closeAndPrint}
          </button>
        </>
      }
    >
      {unpaid.count ? (
        <Notice kind="warn">
          {strings.day.unpaidWarning(unpaid.count, money(unpaid.total))}
        </Notice>
      ) : (
        <p className="muted small">{strings.day.closeHint}</p>
      )}
      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}

/**
 * The day, two ways.
 *
 * SUMMARY is the reconciliation: what was sold, what is owed, what is in the
 * drawer. ORDERS is the audit trail behind it — every order between opening
 * and closing, including the cancelled and the still-unpaid ones, because
 * those are precisely the rows an owner opens this screen to find.
 *
 * Both leave the app through the same A4 sheet. Deliberately NOT the thermal
 * printer: a night's orders is a document to file, and forty rows down an 80mm
 * roll is two feet of till paper nobody can read.
 */
function ReportModal({
  report,
  onClose,
  toast,
}: {
  report: DayReport;
  onClose: () => void;
  toast: (message: string, kind?: 'ok' | 'error') => void;
}) {
  const [tab, setTab] = useState<'summary' | 'orders'>('summary');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetched once, when the tab is first opened — a long night is a lot of rows
  // to carry for an owner who only wanted the takings.
  useEffect(() => {
    if (tab !== 'orders' || orders) return;
    api.day
      .orders(report.session.id)
      .then(setOrders)
      .catch((error) =>
        toast(error instanceof Error ? error.message : 'Could not load the orders.', 'error'),
      );
  }, [tab, orders, report.session.id, toast]);

  const exportSheet = async (how: 'print' | 'pdf') => {
    setBusy(true);
    try {
      const result =
        how === 'pdf'
          ? await api.day.sheetPdf(report.session.id)
          : await api.day.sheetPrint(report.session.id);

      // Cancelling the dialog is a choice, not a failure — say nothing.
      if (result.warning) toast(result.warning, 'error');
      else if (result.ok) {
        toast(
          result.path ? strings.day.sheetSaved(result.path) : strings.day.sheetPrinted,
          'ok',
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not produce the sheet.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={strings.day.report}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => void exportSheet('pdf')} disabled={busy}>
            {strings.day.savePdf}
          </button>
          <button className="btn" onClick={() => void exportSheet('print')} disabled={busy}>
            {strings.day.printSheet}
          </button>
          <button className="btn primary" onClick={onClose}>
            {strings.common.close}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 0, marginBottom: 16 }}>
        {(['summary', 'orders'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`cat-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
            style={{ flex: 1 }}
          >
            {key === 'summary' ? strings.day.tabSummary : strings.day.tabOrders}
            {key === 'orders' && orders ? ` (${orders.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'orders' ? (
        <OrdersTab orders={orders} />
      ) : (
        <SummaryTab report={report} />
      )}
    </Modal>
  );
}

function SummaryTab({ report }: { report: DayReport }) {
  return (
    <>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label={strings.day.sales} value={money(report.sales_total)} />
        {/* Null for the counter — see the note at the top of this file.
            Spelled out for the owner, because "profit" alone reads as
            take-home. */}
        {report.gross_profit !== null ? (
          <Stat label={strings.day.grossProfit} value={money(report.gross_profit)} profit />
        ) : null}
        <Stat label={strings.day.orders} value={String(report.order_count)} tone="b" />
        <Stat
          label={strings.day.cancelled}
          value={`${report.cancelled_count}`}
          note={report.cancelled_value ? money(report.cancelled_value) : undefined}
          danger={report.cancelled_value > 0}
        />
      </div>

      <table className="data">
        <tbody>
          {report.by_type.map((row) => (
            <tr key={row.type}>
              <td>{ORDER_TYPE_LABELS[row.type]}</td>
              <td className="right num">{row.order_count}</td>
              <td className="right num">{money(row.sales)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>{strings.day.serviceCharges}</td>
            <td className="right num">{money(report.service_charges)}</td>
          </tr>
          <tr>
            <td colSpan={2}>{strings.day.deliveryCharges}</td>
            <td className="right num">{money(report.delivery_charges)}</td>
          </tr>
          <tr>
            <td colSpan={2}>{strings.day.cash}</td>
            <td className="right num">{money(report.cash_sales)}</td>
          </tr>
          <tr>
            <td colSpan={2}>{strings.day.card}</td>
            <td className="right num">{money(report.card_sales)}</td>
          </tr>
          {report.expected_cash !== null ? (
            <tr>
              <td colSpan={2}>
                <strong>{strings.day.expectedCash}</strong>
              </td>
              <td className="right num">
                <strong>{money(report.expected_cash)}</strong>
              </td>
            </tr>
          ) : null}
          {report.unpaid_count ? (
            <tr>
              <td colSpan={2} style={{ color: 'var(--warning-text)' }}>
                {strings.day.unpaidAtClose}
              </td>
              <td className="right num" style={{ color: 'var(--warning-text)' }}>
                {report.unpaid_count} · {money(report.unpaid_total)}
              </td>
            </tr>
          ) : null}
          {/* Distinct from "unpaid" above — these WERE charged, just not in
              full. Zero on a shop that has never turned partial payments on. */}
          {report.partial_count ? (
            <tr>
              <td colSpan={2} style={{ color: 'var(--warning-text)' }}>
                {strings.day.partiallyPaid}
              </td>
              <td className="right num" style={{ color: 'var(--warning-text)' }}>
                {report.partial_count} · {money(report.partial_balance_total)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* Empty on a shop that has never used either expenses toggle. */}
      {report.expenses.length ? (
        <>
          <div className="stat-label" style={{ marginTop: 16, marginBottom: 6 }}>
            {strings.expenses.title}
          </div>
          <table className="data">
            <tbody>
              {report.expenses.map((expense) => (
                <tr key={expense.id}>
                  <td colSpan={2}>{expense.description}</td>
                  <td className="right num">{money(expense.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}>
                  <strong>{strings.expenses.total}</strong>
                </td>
                <td className="right num">
                  <strong>{money(report.expenses_total)}</strong>
                </td>
              </tr>
              {report.net_cash_position !== null ? (
                <tr>
                  <td colSpan={2}>
                    <strong>{strings.expenses.netCashPosition}</strong>
                  </td>
                  <td className="right num">
                    <strong>{money(report.net_cash_position)}</strong>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      ) : null}

      {/* The per-waiter detail behind the single "Waiter wages" expense line
          above — empty on a shop that has never turned that toggle on. */}
      {report.waiter_wages.length ? (
        <>
          <div className="stat-label" style={{ marginTop: 16, marginBottom: 6 }}>
            {strings.wages.title}
          </div>
          <table className="data">
            <tbody>
              {report.waiter_wages.map((wage, index) => (
                <tr key={`${wage.waiter_name}-${index}`}>
                  <td colSpan={2}>
                    {wage.waiter_name}
                    {wage.pay_type ? (
                      <span className="tiny muted"> · {WAITER_PAY_TYPE_LABELS[wage.pay_type]}</span>
                    ) : null}
                  </td>
                  <td className="right num">{money(wage.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}>
                  <strong>{strings.wages.total}</strong>
                </td>
                <td className="right num">
                  <strong>{money(report.waiter_wages_total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      {/* Empty on a shop that has never turned waiters on. */}
      {report.by_waiter.length ? (
        <>
          <div className="stat-label" style={{ marginTop: 16, marginBottom: 6 }}>
            {strings.reports.byWaiter}
          </div>
          <table className="data">
            <tbody>
              {report.by_waiter.map((row) => (
                <tr key={row.waiter_id ?? row.waiter_name}>
                  <td>{row.waiter_name}</td>
                  <td className="right num">{row.order_count}</td>
                  <td className="right num">{money(row.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {report.top_items.length ? (
        <>
          <div className="stat-label" style={{ marginTop: 16, marginBottom: 6 }}>
            {strings.day.topItems}
          </div>
          <table className="data">
            <tbody>
              {report.top_items.map((item) => (
                <tr key={item.item_name}>
                  <td>{item.item_name}</td>
                  <td className="right num">{fmtQty(item.qty)}</td>
                  <td className="right num">{money(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

/**
 * Every order of the day, in the order it was taken.
 *
 * Cancelled rows are struck through rather than dropped: an owner reconciling
 * a short drawer is looking for exactly those, and a list that quietly omits
 * them answers the wrong question. Unpaid rows are bold for the same reason —
 * that is money still out on a table.
 */
function OrdersTab({ orders }: { orders: Order[] | null }) {
  if (!orders) return <div className="empty">{strings.common.loading}</div>;
  if (!orders.length) return <Empty title={strings.day.noOrdersOnDay} />;

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{strings.day.ordersOnDay}</p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>{strings.day.colOrder}</th>
              <th>{strings.day.colTime}</th>
              <th>{strings.day.colType}</th>
              <th>{strings.day.colWho}</th>
              <th className="right">{strings.day.colItems}</th>
              <th>{strings.day.colPaid}</th>
              <th className="right">{strings.day.colTotal}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              // A cancellation voids every line, so a cancelled row has to
              // count them all — otherwise the row the owner is investigating
              // is the one row that reads as nothing. Mirrors daySheet.ts.
              const live = order.items.filter((i) => i.kitchen_status !== 'void');
              const items = order.status === 'void' ? order.items.length : live.length;
              const owed =
                Math.round(
                  (live.reduce((sum, i) => sum + i.line_total, 0) +
                    (order.extras_total ?? 0) +
                    Number.EPSILON) * 100,
                ) / 100;
              const value =
                order.status === 'settled'
                  ? order.total
                  : order.status === 'void'
                    ? order.voided_was_paid
                      ? order.total
                      : order.subtotal
                    : owed;
              const who =
                order.type === 'dine_in'
                  ? order.table_name ?? '—'
                  : order.customer_name ?? '—';

              return (
                <tr key={order.id}>
                  <td className="num">{order.order_no}</td>
                  <td className="num muted">{time(order.settled_at ?? order.opened_at)}</td>
                  <td>{ORDER_TYPE_LABELS[order.type]}</td>
                  <td>{who}</td>
                  <td className="right num">{items}</td>
                  <td>
                    {order.status === 'settled' ? (
                      <span className="muted">
                        {order.payment_method === 'card' ? strings.order.card : strings.order.cash}
                      </span>
                    ) : order.status === 'void' ? (
                      <span style={{ color: 'var(--danger-text)' }}>
                        {strings.day.statusCancelled}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--warning-text)' }}>
                        {strings.day.statusUnpaid}
                      </span>
                    )}
                  </td>
                  <td
                    className="right num"
                    style={
                      order.status === 'void'
                        ? { textDecoration: 'line-through', opacity: 0.6 }
                        : order.status === 'open'
                          ? { fontWeight: 700, color: 'var(--warning-text)' }
                          : undefined
                    }
                  >
                    {money(value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
