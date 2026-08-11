'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { hourLabel, money, qty, time, todayIso } from '@/lib/format';
import { ORDER_TYPE_LABELS, type DashboardSummary } from '../../shared/types';

/**
 * The morning glance, and the thing an owner opens at night.
 *
 * Today's profit is the headline: small food owners rarely know it, and
 * showing it plainly is a genuine reason to buy the app.
 */
export default function DashboardPage() {
  const { toast } = useApp();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reports
      .dashboard(todayIso())
      .then(setSummary)
      .catch((error) =>
        toast(error instanceof Error ? error.message : 'Could not load today.', 'error'),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <AppShell
      title={strings.dashboard.title}
      subtitle={summary ? summary.date : undefined}
      actions={
        <Link href="/order/" className="btn primary big">
          {strings.dashboard.newOrder}
        </Link>
      }
    >
      {loading || !summary ? (
        <div className="empty">{strings.common.loading}</div>
      ) : (
        <div className="grid" style={{ gap: 18 }}>
          <div className="stat-grid">
            <Stat label={strings.dashboard.salesToday} value={money(summary.sales_total)} />
            <Stat
              label={strings.dashboard.profitToday}
              value={money(summary.profit_total)}
              note={
                summary.order_count
                  ? strings.dashboard.profitLine(
                      money(summary.sales_total),
                      money(summary.profit_total),
                    )
                  : undefined
              }
              profit
            />
            <Stat
              label={strings.dashboard.ordersToday}
              value={String(summary.order_count)}
              note={
                summary.best_seller
                  ? `${strings.dashboard.bestSeller}: ${summary.best_seller.name} (${qty(summary.best_seller.qty)})`
                  : undefined
              }
            />
            <Stat
              label={strings.dashboard.openOrders}
              value={String(summary.open_order_count)}
              note={
                summary.open_table_count
                  ? `${summary.open_table_count} table(s) sitting`
                  : 'Nothing running right now'
              }
            />
          </div>

          {summary.busiest_hour ? (
            <Card>
              <div className="row-between">
                <div>
                  <div className="stat-label">{strings.dashboard.busiestHour}</div>
                  <div style={{ fontSize: 20, fontWeight: 650, marginTop: 4 }}>
                    {hourLabel(summary.busiest_hour.hour)}
                  </div>
                </div>
                <div className="right">
                  <div className="stat-label">{strings.reports.sales}</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 650, marginTop: 4 }}>
                    {money(summary.busiest_hour.sales)}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.dashboard.recent}</h2>
              {summary.open_order_count ? (
                <Link href="/order/" className="btn sm">
                  {strings.order.resume}
                </Link>
              ) : null}
            </div>

            {summary.recent.length === 0 ? (
              <Empty
                title={strings.dashboard.noSalesTitle}
                note={strings.dashboard.noSalesNote}
                action={
                  <Link href="/order/" className="btn primary">
                    {strings.dashboard.newOrder}
                  </Link>
                }
              />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Type</th>
                      <th>Time</th>
                      <th className="right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map((row) => (
                      <tr key={row.id}>
                        <td className="num">{row.order_no}</td>
                        <td>{ORDER_TYPE_LABELS[row.type]}</td>
                        <td className="num">{time(row.settled_at)}</td>
                        <td className="right num">{money(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
