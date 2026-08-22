'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Badge, Card, Empty, Field, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateTime, hourLabel, money, qty, todayIso, daysAgoIso } from '@/lib/format';
import {
  ORDER_TYPE_LABELS,
  SETTING_KEYS,
  type BestSeller,
  type RangeTotals,
  type SalesByHour,
  type SalesByType,
  type VoidRecord,
} from '../../../shared/types';

/**
 * The owner's night-time view. Plain, readable, printable.
 *
 * Every number here comes from settled orders and the profit that was locked
 * in when each was paid — nothing is recomputed from today's menu prices.
 */
export default function ReportsPage() {
  const { toast, settings } = useApp();

  const [from, setFrom] = useState(daysAgoIso(6));
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);

  const [totals, setTotals] = useState<RangeTotals | null>(null);
  const [byType, setByType] = useState<SalesByType[]>([]);
  const [sellers, setSellers] = useState<BestSeller[]>([]);
  const [byHour, setByHour] = useState<SalesByHour[]>([]);
  const [voidList, setVoidList] = useState<VoidRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, types, best, hours, vs] = await Promise.all([
        api.reports.range(from, to),
        api.reports.byType(from, to),
        api.reports.bestSellers(from, to, 15),
        api.reports.byHour(from, to),
        api.reports.voids(from, to),
      ]);
      setTotals(t);
      setByType(types);
      setSellers(best);
      setByHour(hours);
      setVoidList(vs);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load the reports.', 'error');
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const peakSales = Math.max(1, ...byHour.map((row) => row.sales));

  return (
    <AppShell
      title={strings.reports.title}
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
          <Field label="&nbsp;">
            <button
              className="btn"
              onClick={() => window.print()}
              disabled={loading || !totals || totals.order_count === 0}
            >
              {strings.reports.print}
            </button>
          </Field>
        </>
      }
    >
      {/* Only ever visible on paper: the app chrome does not print, so without
          this a printed sheet would carry no title, shop or date range. */}
      <div className="print-only print-head">
        <h1>{settings[SETTING_KEYS.businessName] || 'Food Point'}</h1>
        <p>
          {strings.reports.title} · {from} → {to}
        </p>
        <p className="tiny">Printed {dateTime(new Date().toISOString().slice(0, 19).replace('T', ' '))}</p>
      </div>

      {loading || !totals ? (
        <div className="empty">{strings.common.loading}</div>
      ) : totals.order_count === 0 ? (
        <Card>
          <Empty title={strings.reports.noneTitle} note={strings.reports.noneNote} />
        </Card>
      ) : (
        <div className="grid" style={{ gap: 18 }}>
          <div className="stat-grid">
            <Stat label={strings.reports.sales} value={money(totals.sales_total)} />
            <Stat
              label={strings.reports.deliveryTotal}
              value={money(totals.delivery_total)}
              note={totals.delivery_total ? strings.reports.deliveryNote : undefined}
              tone="b"
            />
            <Stat
              label={strings.reports.extrasTotal}
              value={money(totals.extras_total)}
              tone="c"
            />
            <Stat label={strings.reports.profit} value={money(totals.profit_total)} profit />
            <Stat label={strings.reports.orders} value={String(totals.order_count)} />
            <Stat
              label="Average order"
              value={money(totals.sales_total / Math.max(1, totals.order_count))}
            />
          </div>

          {/* --- by order type --- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.reports.byType}</h2>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="right">{strings.reports.orders}</th>
                    <th className="right">{strings.reports.sales}</th>
                    <th className="right">{strings.reports.profit}</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr key={row.type}>
                      <td>{ORDER_TYPE_LABELS[row.type]}</td>
                      <td className="right num">{row.order_count}</td>
                      <td className="right num">{money(row.sales)}</td>
                      <td className="right num" style={{ color: 'var(--success)' }}>
                        {money(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* --- sales by hour: the staffing view --- */}
          <Card>
            <h2 style={{ marginBottom: 4 }}>{strings.reports.byHour}</h2>
            <div className="tiny muted">When the rush actually is.</div>
            <div className="hour-chart">
              {byHour.map((row) => (
                <div className="hour-bar" key={row.hour} title={`${money(row.sales)}`}>
                  <div
                    className="hour-bar-fill"
                    style={{ height: `${(row.sales / peakSales) * 100}%` }}
                  />
                  <span className="hour-bar-label">{row.hour}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* --- best sellers --- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.reports.bestSellers}</h2>
              <span className="tiny muted">What to promote, what to drop</span>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="right">Sold</th>
                    <th className="right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((row) => (
                    <tr key={row.item_name}>
                      <td>{row.item_name}</td>
                      <td className="right num">{qty(row.qty)}</td>
                      <td className="right num">{money(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* --- voids: visibility on what was cancelled --- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>{strings.reports.voids}</h2>
              {voidList.length ? <Badge kind="danger">{voidList.length}</Badge> : null}
            </div>
            {voidList.length === 0 ? (
              <Empty title="No voids in this range" note="Nothing was cancelled." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Order</th>
                      <th>What</th>
                      <th>{strings.reports.reason}</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {voidList.map((row, index) => (
                      <tr key={`${row.kind}-${row.order_id}-${index}`}>
                        <td className="num">{dateTime(row.voided_at)}</td>
                        <td className="num">{row.order_no}</td>
                        <td>
                          {row.kind === 'order' ? (
                            <Badge kind="danger">Whole order</Badge>
                          ) : (
                            `${qty(row.qty ?? 0)} × ${row.item_name}`
                          )}
                        </td>
                        <td className="muted">{row.reason || strings.common.none}</td>
                        <td className="right num">{money(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* --- day by day --- */}
          <Card pad={false}>
            <div className="card-head">
              <h2>Day by day</h2>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="right">{strings.reports.orders}</th>
                    <th className="right">{strings.reports.sales}</th>
                    <th className="right">{strings.reports.profit}</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.days.map((day) => (
                    <tr key={day.date}>
                      <td className="num">{day.date}</td>
                      <td className="right num">{day.orders}</td>
                      <td className="right num">{money(day.sales)}</td>
                      <td className="right num" style={{ color: 'var(--success)' }}>
                        {money(day.profit)}
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
