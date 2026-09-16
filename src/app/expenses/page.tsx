'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Field, Notice } from '@/components/ui';
import { IconTrash } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money } from '@/lib/format';
import { WAITER_PAY_TYPE_LABELS, type Expense, type WaiterWageEntry } from '../../../shared/types';

/**
 * Cash going out — vegetables, a gas cylinder, and (when the waiter-wages
 * toggle is also on) the day's wages.
 *
 * Admin-only, same as Waiters and Reports: `requireAdmin()` guards every
 * channel behind this screen regardless of what renders here. Two
 * independent toggles gate the two halves — a shop can run either without
 * the other, but waiter wages POST INTO the same expenses list as a single
 * line, never a second bucket. See electron/ipc/expenses.ts.
 */
export default function ExpensesPage() {
  const { toast, dailyExpensesEnabled, waiterWagesEnabled } = useApp();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!dailyExpensesEnabled) {
      setLoading(false);
      return;
    }
    try {
      setExpenses(await api.expenses.list());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load expenses.', 'error');
    } finally {
      setLoading(false);
    }
  }, [dailyExpensesEnabled, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await api.expenses.save({ description: description.trim(), amount: Number(amount) || 0 });
      setDescription('');
      setAmount('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that expense.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (expense: Expense) => {
    if (!window.confirm(strings.expenses.deleteConfirm)) return;
    try {
      await api.expenses.remove(expense.id);
      await load();
      toast(strings.expenses.deleted, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that expense.', 'error');
    }
  };

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <AppShell title={strings.expenses.title} subtitle={strings.expenses.subtitle}>
      {!dailyExpensesEnabled && !waiterWagesEnabled ? (
        <Card>
          <Notice kind="warn">{strings.expenses.disabledNote}</Notice>
        </Card>
      ) : (
        <div className="grid" style={{ gap: 18 }}>
          {dailyExpensesEnabled ? (
            <Card>
              <h2 style={{ marginBottom: 4 }}>{strings.expenses.title}</h2>
              <p className="tiny muted" style={{ marginBottom: 14 }}>
                {strings.expenses.subtitle}
              </p>

              <div className="field-row" style={{ alignItems: 'end' }}>
                <Field label={strings.expenses.description}>
                  <input
                    className="input"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={strings.expenses.descriptionPlaceholder}
                  />
                </Field>
                <Field label={strings.expenses.amount}>
                  <input
                    className="input num"
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    style={{ width: 120 }}
                  />
                </Field>
                <button
                  className="btn primary"
                  onClick={add}
                  disabled={busy || !description.trim() || !(Number(amount) > 0)}
                >
                  {strings.expenses.addExpense}
                </button>
              </div>
              {error ? <Notice kind="warn">{error}</Notice> : null}

              {loading ? (
                <div className="empty">{strings.common.loading}</div>
              ) : expenses.length === 0 ? (
                <Empty title={strings.expenses.emptyTitle} note={strings.expenses.emptyNote} />
              ) : (
                <div style={{ marginTop: 14 }}>
                  <div className="staff-list">
                    {expenses.map((expense) => (
                      <div key={expense.id} className="staff-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="staff-row-name">{expense.description}</div>
                          {expense.source === 'wages' ? (
                            <div className="tiny muted">{strings.expenses.wagesLineNote}</div>
                          ) : null}
                        </div>
                        <div className="row">
                          <span className="num" style={{ fontWeight: 600 }}>
                            {money(expense.amount)}
                          </span>
                          {/* The 'wages' line is owned by the review below —
                              editing or deleting it here would silently
                              disagree with what that screen just saved. */}
                          {expense.source === 'manual' ? (
                            <button
                              className="btn ghost sm"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(expense)}
                              aria-label={strings.common.delete}
                            >
                              <IconTrash size={15} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="row-between" style={{ marginTop: 10, fontWeight: 700 }}>
                    <span>{strings.expenses.total}</span>
                    <span className="num">{money(total)}</span>
                  </div>
                </div>
              )}
            </Card>
          ) : null}

          {waiterWagesEnabled ? <WaiterWagesCard onPosted={load} /> : null}
        </div>
      )}
    </AppShell>
  );
}

/**
 * The day-close wages review: pre-filled from each waiter's rate, editable,
 * saved in one shot. Saving posts a single "Waiter wages" line into the
 * expenses list above — see saveWaiterWages() in the main process.
 */
function WaiterWagesCard({ onPosted }: { onPosted: () => void | Promise<void> }) {
  const { toast } = useApp();
  const [draft, setDraft] = useState<WaiterWageEntry[]>([]);
  const [hasActiveWaiters, setHasActiveWaiters] = useState(true);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // Fetched alongside the draft so an empty list can say WHY: no waiters
      // at all, versus waiters who simply are not due today.
      const [rows, roster] = await Promise.all([api.wages.draft(), api.waiters.list(true)]);
      setDraft(rows);
      setHasActiveWaiters(roster.length > 0);
      setAmounts(Object.fromEntries(rows.map((row) => [row.waiter_id, String(row.amount)])));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load wages.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const entries = draft.map((row) => ({
        waiter_id: row.waiter_id,
        amount: Math.max(Number(amounts[row.waiter_id]) || 0, 0),
      }));
      await api.wages.save(entries);
      toast(strings.wages.saved, 'ok');
      await load();
      await onPosted();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save wages.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const total = draft.reduce(
    (sum, row) => sum + Math.max(Number(amounts[row.waiter_id]) || 0, 0),
    0,
  );

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <h2>{strings.wages.title}</h2>
        <button
          className="btn primary sm"
          onClick={save}
          disabled={busy || loading || draft.length === 0}
        >
          {strings.wages.save}
        </button>
      </div>
      <p className="tiny muted" style={{ marginBottom: 14 }}>
        {strings.wages.subtitle}
      </p>

      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : draft.length === 0 ? (
        <Empty
          title={hasActiveWaiters ? strings.wages.emptyTitle : strings.wages.noWaitersTitle}
          note={hasActiveWaiters ? strings.wages.emptyNote : strings.wages.noWaitersNote}
        />
      ) : (
        <>
          <div className="staff-list">
            {draft.map((row) => (
              <div key={row.waiter_id} className="staff-row">
                <div>
                  <div className="staff-row-name">{row.waiter_name}</div>
                  {row.pay_type ? (
                    <div className="tiny muted">{WAITER_PAY_TYPE_LABELS[row.pay_type]}</div>
                  ) : null}
                </div>
                <input
                  className="input num"
                  type="number"
                  min={0}
                  step="1"
                  style={{ width: 110 }}
                  value={amounts[row.waiter_id] ?? ''}
                  onChange={(event) =>
                    setAmounts((current) => ({ ...current, [row.waiter_id]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 10, fontWeight: 700 }}>
            <span>{strings.wages.total}</span>
            <span className="num">{money(total)}</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {strings.wages.postedNote}
          </div>
        </>
      )}
    </Card>
  );
}
