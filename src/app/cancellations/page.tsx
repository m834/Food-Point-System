'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Badge, Card, Empty, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateTime, money, qty as fmtQty, todayIso } from '@/lib/format';
import { ORDER_TYPE_LABELS, type CancellationsReport } from '../../../shared/types';

type Period = 'today' | 'week' | 'month';

/**
 * The owner's accountability screen.
 *
 * A CALM screen despite being the "interesting" one — it is read carefully,
 * often while comparing two people, so it is plain rows and honest numbers
 * rather than glass and gradient.
 *
 * The design leans on one idea: a single shop-wide cancellation total tells an
 * owner nothing. What exposes a problem is the SHAPE — one person's column
 * standing well above everyone else's, especially the paid column, where cash
 * could actually have walked. So the per-staff table leads, sorted by value,
 * with a bar making the comparison visible without arithmetic.
 */
export default function CancellationsPage() {
  const { toast } = useApp();

  const [period, setPeriod] = useState<Period>('today');
  const [report, setReport] = useState<CancellationsReport | null>(null);
  const [loading, setLoading] = useState(true);

  /** Local-date arithmetic — the business's day, never UTC's. */
  const rangeFor = useCallback((choice: Period): { from: string; to: string } => {
    const to = todayIso();
    const now = new Date();
    const start = new Date(now);

    if (choice === 'week') {
      // Week starts Monday: the shift patterns an owner compares run Mon–Sun.
      const weekday = (now.getDay() + 6) % 7;
      start.setDate(now.getDate() - weekday);
    } else if (choice === 'month') {
      start.setDate(1);
    }

    const from = [
      start.getFullYear(),
      String(start.getMonth() + 1).padStart(2, '0'),
      String(start.getDate()).padStart(2, '0'),
    ].join('-');

    return { from, to };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = rangeFor(period);
    try {
      setReport(await api.reports.cancellations(from, to));
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Could not load the cancellations.',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [period, rangeFor, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The widest bar in the per-staff table, so the comparison is to scale. */
  const peak = useMemo(
    () => Math.max(1, ...(report?.by_staff.map((row) => row.total_value) ?? [])),
    [report],
  );

  return (
    <AppShell
      title={strings.cancellations.title}
      subtitle={strings.cancellations.subtitle}
      actions={
        <div className="row" style={{ gap: 7 }}>
          {(['today', 'week', 'month'] as Period[]).map((choice) => (
            <button
              key={choice}
              className={`cat-tab${period === choice ? ' active' : ''}`}
              onClick={() => setPeriod(choice)}
            >
              {strings.cancellations[choice]}
            </button>
          ))}
        </div>
      }
    >
      {loading || !report ? (
        <div className="empty">{strings.common.loading}</div>
      ) : report.total_count === 0 ? (
        <Card>
          <Empty
            title={strings.cancellations.emptyTitle}
            note={strings.cancellations.emptyNote}
          />
        </Card>
      ) : (
        <div className="grid" style={{ gap: 18 }}>
          <div className="stat-grid">
            <Stat
              label={strings.cancellations.totalCount}
              value={String(report.total_count)}
            />
            <Stat
              label={strings.cancellations.totalValue}
              value={money(report.total_value)}
            />
            <Stat
              label={strings.cancellations.paidCount}
              value={String(report.paid_count)}
              note={report.paid_count ? strings.cancellations.watchNote : undefined}
            />
            {/* The number that matters most: money that was in the till and
                then was not. Flagged rather than styled as "profit green". */}
            <Stat
              label={strings.cancellations.paidValue}
              value={money(report.paid_value)}
              danger={report.paid_value > 0}
            />
          </div>

          {/* ---- Per staff: the comparison the owner came for ---- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.cancellations.byStaff}</h2>
              <span className="tiny muted">{strings.cancellations.watchNote}</span>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{strings.cancellations.staffName}</th>
                    <th className="right">{strings.cancellations.count}</th>
                    <th className="right">{strings.cancellations.value}</th>
                    <th style={{ width: '30%' }} />
                    <th className="right">{strings.cancellations.ofWhichPaid}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_staff.map((row) => (
                    <tr key={row.staff_id ?? 'none'}>
                      <td>
                        <strong>{row.staff_name}</strong>
                      </td>
                      <td className="right num">{row.count}</td>
                      <td className="right num">
                        <strong>{money(row.total_value)}</strong>
                      </td>
                      <td>
                        <div className="staff-bar">
                          <div
                            className="staff-bar-fill"
                            style={{ width: `${(row.total_value / peak) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="right num">
                        {row.paid_count ? (
                          <span className="cancel-paid">
                            {money(row.paid_value)}
                            <span className="tiny"> · {row.paid_count}</span>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ---- Reasons: a lopsided pattern is its own signal ---- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.cancellations.byReason}</h2>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{strings.cancellations.reason}</th>
                    <th className="right">{strings.cancellations.count}</th>
                    <th className="right">{strings.cancellations.value}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_reason.map((row) => (
                    <tr key={row.reason_code}>
                      <td>{row.reason_label}</td>
                      <td className="right num">{row.count}</td>
                      <td className="right num">{money(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ---- The full record ---- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.cancellations.theList}</h2>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{strings.cancellations.when}</th>
                    <th>{strings.cancellations.order}</th>
                    <th>{strings.cancellations.staffName}</th>
                    <th>{strings.cancellations.reason}</th>
                    <th>{strings.cancellations.items}</th>
                    <th className="right">{strings.cancellations.amount}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.records.map((row) => (
                    <tr key={row.order_id}>
                      <td className="num">{dateTime(row.cancelled_at)}</td>
                      <td>
                        <div className="num">{row.order_no}</div>
                        <div className="tiny muted">
                          {row.table_name ?? ORDER_TYPE_LABELS[row.type]}
                        </div>
                      </td>
                      <td>{row.staff_name ?? strings.cancellations.notRecorded}</td>
                      <td>
                        {row.reason_label}
                        {row.note ? <div className="tiny muted">“{row.note}”</div> : null}
                      </td>
                      <td className="tiny muted">
                        {row.items
                          .slice(0, 3)
                          .map((it) => `${fmtQty(it.qty)} × ${it.item_name}`)
                          .join(', ')}
                        {row.items.length > 3 ? ` +${row.items.length - 3}` : ''}
                      </td>
                      <td className="right num">
                        <div>{money(row.amount)}</div>
                        {row.was_paid ? (
                          <Badge kind="danger">{strings.cancellations.wasPaid}</Badge>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
