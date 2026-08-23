'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Field, Modal, Notice, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateTime, money, qty as fmtQty } from '@/lib/format';
import { ORDER_TYPE_LABELS, type DayReport, type DaySession } from '../../../shared/types';

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
                                {strings.day.print}
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

      {viewing ? <ReportModal report={viewing} onClose={() => setViewing(null)} /> : null}
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

function ReportModal({ report, onClose }: { report: DayReport; onClose: () => void }) {
  return (
    <Modal
      title={strings.day.report}
      onClose={onClose}
      wide
      footer={
        <button className="btn primary" onClick={onClose}>
          {strings.common.close}
        </button>
      }
    >
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
        </tbody>
      </table>

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
    </Modal>
  );
}
