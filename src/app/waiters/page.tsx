'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Field, Modal, Notice } from '@/components/ui';
import { IconTrash } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money } from '@/lib/format';
import {
  WAITER_PAY_TYPES,
  WAITER_PAY_TYPE_LABELS,
  WEEKDAY_LABELS,
  type Waiter,
  type WaiterPayType,
} from '../../../shared/types';

/**
 * The waiter roster.
 *
 * Admin-only — deciding who is allowed to run a takeaway order is the
 * owner's call, and the IPC channels behind add/edit/remove all call
 * `requireAdmin()` regardless of what this screen renders. The counter never
 * reaches this page; it only ever sees the dropdown on the order screen that
 * this list feeds.
 *
 * A CALM screen, like Customers and the Staff list it sits beside in spirit:
 * plain rows, no decoration, and it stays useful whether or not "Enable
 * waiters" is switched on in Settings — an owner can build the list first and
 * turn the feature on when ready.
 */
export default function WaitersPage() {
  const { toast, waitersEnabled, waiterWagesEnabled } = useApp();

  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingCode, setEditingCode] = useState<{ id: number; value: string } | null>(null);
  const [editingPay, setEditingPay] = useState<Waiter | null>(null);

  const load = useCallback(async () => {
    try {
      setWaiters(await api.waiters.list());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load waiters.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await api.waiters.save({ name, code: code || null, is_active: true });
      setName('');
      setCode('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that waiter.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (waiter: Waiter, active: boolean) => {
    try {
      await api.waiters.save({ id: waiter.id, name: waiter.name, code: waiter.code, is_active: active });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change that.', 'error');
    }
  };

  const saveCode = async (waiter: Waiter, value: string) => {
    try {
      await api.waiters.save({
        id: waiter.id,
        name: waiter.name,
        code: value || null,
        is_active: waiter.is_active === 1,
      });
      setEditingCode(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that code.', 'error');
    }
  };

  const remove = async (waiter: Waiter) => {
    if (!window.confirm(strings.waiters.deleteConfirm)) return;
    try {
      await api.waiters.remove(waiter.id);
      await load();
      toast(strings.waiters.deleted, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that waiter.', 'error');
    }
  };

  return (
    <AppShell title={strings.waiters.title} subtitle={strings.waiters.subtitle}>
      {!waitersEnabled ? (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="warn">
            Waiters are off — the order screen shows no dropdown. Turn on "Enable waiters" in
            Settings once the list below is ready.
          </Notice>
        </div>
      ) : null}

      <Card>
        <div className="field-row" style={{ alignItems: 'end' }}>
          <Field label={strings.waiters.name}>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={strings.waiters.namePlaceholder}
            />
          </Field>
          <Field label={`${strings.waiters.code} (${strings.waiters.codeOptional})`}>
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={strings.waiters.codePlaceholder}
              style={{ width: 110 }}
            />
          </Field>
          <button className="btn primary" onClick={add} disabled={busy || !name.trim()}>
            {strings.waiters.addWaiter}
          </button>
        </div>
        {error ? <Notice kind="warn">{error}</Notice> : null}
      </Card>

      <div style={{ marginTop: 18 }}>
        {loading ? (
          <div className="empty">{strings.common.loading}</div>
        ) : waiters.length === 0 ? (
          <Card>
            <Empty title={strings.waiters.emptyTitle} note={strings.waiters.emptyNote} />
          </Card>
        ) : (
          <Card pad={false}>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{strings.waiters.name}</th>
                    <th>{strings.waiters.code}</th>
                    {waiterWagesEnabled ? <th>{strings.waiters.pay}</th> : null}
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {waiters.map((waiter) => (
                    <tr key={waiter.id} className={waiter.is_active ? '' : 'muted'}>
                      <td>
                        <strong>{waiter.name}</strong>
                        {waiter.is_active ? null : (
                          <span className="tiny muted"> · {strings.waiters.inactive}</span>
                        )}
                      </td>
                      <td className="num">
                        {editingCode?.id === waiter.id ? (
                          <div className="row">
                            <input
                              className="input"
                              value={editingCode.value}
                              onChange={(event) =>
                                setEditingCode({ id: waiter.id, value: event.target.value })
                              }
                              style={{ width: 90 }}
                              autoFocus
                            />
                            <button
                              className="btn primary sm"
                              onClick={() => void saveCode(waiter, editingCode.value)}
                            >
                              {strings.common.save}
                            </button>
                            <button className="btn ghost sm" onClick={() => setEditingCode(null)}>
                              {strings.common.cancel}
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn sm"
                            onClick={() => setEditingCode({ id: waiter.id, value: waiter.code ?? '' })}
                          >
                            {waiter.code || strings.common.none}
                          </button>
                        )}
                      </td>
                      {waiterWagesEnabled ? (
                        <td>
                          <button className="btn sm" onClick={() => setEditingPay(waiter)}>
                            {payoutSummary(waiter)}
                          </button>
                        </td>
                      ) : null}
                      <td className="right">
                        <button
                          className={`btn sm${waiter.is_active ? ' ok-soft' : ''}`}
                          onClick={() => void setActive(waiter, waiter.is_active !== 1)}
                        >
                          {waiter.is_active ? strings.waiters.active : strings.waiters.inactive}
                        </button>
                      </td>
                      <td className="right">
                        <button
                          className="btn ghost sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void remove(waiter)}
                          aria-label={strings.common.delete}
                        >
                          <IconTrash size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {editingPay ? (
        <WaiterPayModal
          waiter={editingPay}
          onClose={() => setEditingPay(null)}
          onSaved={async () => {
            setEditingPay(null);
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

/** "Rs500 / Daily", "Rs2,000 / Weekly · Friday", "Rs45,000 / Monthly · 1st" — or "Not set". */
function payoutSummary(waiter: Waiter): string {
  if (!waiter.wage_rate) return strings.waiters.noPay;
  const rate = `${money(waiter.wage_rate)} / ${WAITER_PAY_TYPE_LABELS[waiter.pay_type]}`;
  if (waiter.pay_type === 'weekly' && waiter.payday !== null) {
    return `${rate} · ${WEEKDAY_LABELS[waiter.payday]}`;
  }
  if (waiter.pay_type === 'monthly' && waiter.payday !== null) {
    return `${rate} · ${ordinal(waiter.payday)}`;
  }
  return rate;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Pay type, rate and payday — one waiter at a time, in a modal rather than
 * an inline row: the payday field's very existence depends on the pay type
 * chosen a moment ago, which a table cell has no clean way to show.
 */
function WaiterPayModal({
  waiter,
  onClose,
  onSaved,
}: {
  waiter: Waiter;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [payType, setPayType] = useState<WaiterPayType>(waiter.pay_type);
  const [rate, setRate] = useState(String(waiter.wage_rate || ''));
  const [payday, setPayday] = useState<number>(
    waiter.payday ?? (payType === 'monthly' ? 1 : 0),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.waiters.save({
        id: waiter.id,
        name: waiter.name,
        code: waiter.code,
        is_active: waiter.is_active === 1,
        pay_type: payType,
        payday: payType === 'daily' ? null : payday,
        wage_rate: Math.max(Number(rate) || 0, 0),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${strings.waiters.editPay} · ${waiter.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {strings.waiters.savePay}
          </button>
        </>
      }
    >
      <Field label={strings.waiters.payType}>
        <div className="row" style={{ gap: 8 }}>
          {WAITER_PAY_TYPES.map((option) => (
            <button
              key={option}
              className={`cat-tab${payType === option ? ' active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => {
                setPayType(option);
                if (option === 'weekly' && waiter.payday === null) setPayday(1);
                if (option === 'monthly' && waiter.payday === null) setPayday(1);
              }}
            >
              {WAITER_PAY_TYPE_LABELS[option]}
            </button>
          ))}
        </div>
      </Field>

      <Field label={strings.waiters.wageRate} hint={strings.waiters.wageRateHint}>
        <input
          className="input num"
          type="number"
          min={0}
          step="1"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          autoFocus
        />
      </Field>

      {payType === 'weekly' ? (
        <Field label={strings.waiters.payday} hint={strings.waiters.paydayHintWeekly}>
          <select
            className="input"
            value={payday}
            onChange={(event) => setPayday(Number(event.target.value))}
          >
            {WEEKDAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {payType === 'monthly' ? (
        <Field label={strings.waiters.payday} hint={strings.waiters.paydayHintMonthly}>
          <select
            className="input"
            value={payday}
            onChange={(event) => setPayday(Number(event.target.value))}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
                {day === 31 ? ' (last day, in a shorter month)' : ''}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {error ? <Notice kind="warn">{error}</Notice> : null}
    </Modal>
  );
}
