'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateTime, hourLabel, money, qty, time } from '@/lib/format';
import { ORDER_TYPE_LABELS, type DashboardSummary, type SalesByHour } from '../../shared/types';

/**
 * The morning glance, and the thing an owner opens at night.
 *
 * This is the app's one RICH screen (with the activation gate): dark navy,
 * glass tiles, gradient depth. It is the screen that sells the product, and
 * the only one nobody has to read for eight hours straight.
 *
 * It must never open empty. Even before the first order of the day there are
 * tiles with zeroes, a chart frame and a clear next action — a blank panel
 * tells a new owner nothing about what the software is for.
 */
export default function DashboardPage() {
  const { toast } = useApp();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [hours, setHours] = useState<SalesByHour[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No date is passed on purpose: the backend answers for the OPEN trading
    // day when there is one, and only falls back to today's date when the shop
    // has not opened a day. Asking for `todayIso()` here would have re-imposed
    // the midnight boundary the trading day exists to escape.
    Promise.all([api.reports.dashboard(), api.reports.tradingHours()])
      .then(([today_, byHour]) => {
        setSummary(today_);
        setHours(byHour);
      })
      .catch((error) =>
        toast(error instanceof Error ? error.message : 'Could not load today.', 'error'),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  /**
   * The trading day as a bar per hour, in TRADING order.
   *
   * A shop that opens at 10am and closes at 3am runs 10, 11, ... 23, 0, 1, 2 —
   * so the axis starts at the hour the day was opened and wraps past midnight
   * rather than stopping dead at 11pm, which would have hidden the last three
   * hours of every night.
   *
   * The window is drawn whole rather than only the hours that happen to have
   * sales, so the shape of the day is comparable from one night to the next
   * and the chart has a frame to sit in before the first order is taken.
   */
  const chart = useMemo(() => {
    const byHour = new Map(hours.map((row) => [row.hour, row.sales]));

    // Where the axis starts: the hour the day was opened, or 9am when no day
    // is open and the chart is just showing a calendar date.
    const start = summary?.session_opened_at
      ? Number(summary.session_opened_at.slice(11, 13))
      : 9;

    /**
     * How many hours to draw. Long enough to reach the last hour that actually
     * took money — so a night that ran to 3am shows its 3am bar — with a
     * 15-hour floor so the frame never collapses to a stub on a quiet evening.
     * Capped at 24 so a stale session cannot draw the axis twice round.
     */
    const span = (h: number) => (h - start + 24) % 24;
    const latest = hours.length ? Math.max(...hours.map((row) => span(row.hour))) : 0;
    const length = Math.min(24, Math.max(15, latest + 1));

    const bars = [];
    for (let i = 0; i < length; i += 1) {
      const hour = (start + i) % 24;
      bars.push({ hour, sales: byHour.get(hour) ?? 0 });
    }
    const peak = Math.max(1, ...bars.map((b) => b.sales));
    return { bars, peak };
  }, [hours, summary]);

  return (
    <AppShell
      rich
      title={strings.dashboard.title}
      subtitle={
        summary
          ? summary.session_opened_at
            ? strings.dashboard.tradingDay(dateTime(summary.session_opened_at))
            : summary.date
          : undefined
      }
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
              tone="b"
            />
            <Stat
              label={strings.dashboard.openOrders}
              value={String(summary.open_order_count)}
              note={
                summary.open_table_count
                  ? `${summary.open_table_count} table(s) sitting`
                  : 'Nothing running right now'
              }
              tone="c"
            />
          </div>

          {/* The day's shape. Always present — an empty frame still says
              "this is when you are busy", which is the point of it. */}
          <Card>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <div>
                <div className="stat-label">{strings.dashboard.today}</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>
                  {strings.reports.byHour}
                </div>
              </div>
              {summary.busiest_hour ? (
                <div className="right">
                  <div className="stat-label">{strings.dashboard.busiestHour}</div>
                  <div style={{ fontSize: 19, fontWeight: 650, marginTop: 3 }}>
                    {hourLabel(summary.busiest_hour.hour)}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="hour-chart">
              {chart.bars.map((bar) => (
                <div
                  key={bar.hour}
                  className="hour-bar"
                  title={`${hourLabel(bar.hour)} — ${money(bar.sales)}`}
                >
                  <div
                    className="hour-bar-fill"
                    style={{ height: `${(bar.sales / chart.peak) * 100}%` }}
                  />
                  <div className="hour-bar-label">{bar.hour}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.dashboard.recent}</h2>
              <div className="row">
                {summary.open_order_count ? (
                  <Link href="/order/" className="btn sm">
                    {strings.order.resume}
                  </Link>
                ) : null}
                <Link href="/orders/" className="btn sm">
                  All orders
                </Link>
              </div>
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
