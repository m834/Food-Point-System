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
  RECURRING_EXPENSE_PAY_TYPES,
  RECURRING_EXPENSE_PAY_TYPE_LABELS,
  WAITER_PAY_TYPE_LABELS,
  type Expense,
  type RecurringExpense,
  type RecurringExpenseEntry,
  type RecurringExpensePayType,
  type WaiterWageEntry,
} from '../../../shared/types';

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
                          ) : expense.source === 'recurring' ? (
                            <div className="tiny muted">{strings.expenses.recurringLineNote}</div>
                          ) : null}
                        </div>
                        <div className="row">
                          <span className="num" style={{ fontWeight: 600 }}>
                            {money(expense.amount)}
                          </span>
                          {/* A 'wages' or 'recurring' line is owned by its own
                              review — editing or deleting it here would
                              silently disagree with what that screen saved. */}
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

          {/* Recurring expenses — a sub-feature of "Enable daily expenses",
              not a toggle of its own. */}
          {dailyExpensesEnabled ? <RecurringExpensesDueCard onPosted={load} /> : null}
          {dailyExpensesEnabled ? <RecurringExpensesManager /> : null}
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

/**
 * The recurring-expenses review: only definitions actually due today (daily
 * ones every time, monthly ones only on their payday), pre-filled from each
 * definition's amount, editable, posted in one shot. Mirrors WaiterWagesCard
 * exactly — see saveRecurringExpensePostings() in the main process.
 */
function RecurringExpensesDueCard({ onPosted }: { onPosted: () => void | Promise<void> }) {
  const { toast } = useApp();
  const [draft, setDraft] = useState<RecurringExpenseEntry[]>([]);
  const [hasAny, setHasAny] = useState(true);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // Fetched alongside the draft so an empty list can say WHY: nothing
      // defined at all, versus definitions that simply are not due today.
      const [rows, defined] = await Promise.all([
        api.recurringExpenses.draft(),
        api.recurringExpenses.list(),
      ]);
      setDraft(rows);
      setHasAny(defined.length > 0);
      setAmounts(
        Object.fromEntries(rows.map((row) => [row.recurring_expense_id, String(row.amount)])),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load recurring expenses.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    setBusy(true);
    try {
      const entries = draft.map((row) => ({
        recurring_expense_id: row.recurring_expense_id,
        amount: Math.max(Number(amounts[row.recurring_expense_id]) || 0, 0),
      }));
      await api.recurringExpenses.post(entries);
      toast(strings.recurringExpenses.posted, 'ok');
      await load();
      await onPosted();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post recurring expenses.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const total = draft.reduce(
    (sum, row) => sum + Math.max(Number(amounts[row.recurring_expense_id]) || 0, 0),
    0,
  );

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <h2>{strings.recurringExpenses.dueTitle}</h2>
        <button
          className="btn primary sm"
          onClick={post}
          disabled={busy || loading || draft.length === 0}
        >
          {strings.recurringExpenses.post}
        </button>
      </div>
      <p className="tiny muted" style={{ marginBottom: 14 }}>
        {strings.recurringExpenses.dueSubtitle}
      </p>

      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : draft.length === 0 ? (
        <Empty
          title={hasAny ? strings.recurringExpenses.dueEmptyTitle : strings.recurringExpenses.noneDefinedTitle}
          note={hasAny ? strings.recurringExpenses.dueEmptyNote : strings.recurringExpenses.noneDefinedNote}
        />
      ) : (
        <>
          <div className="staff-list">
            {draft.map((row) => (
              <div key={row.recurring_expense_id} className="staff-row">
                <div>
                  <div className="staff-row-name">{row.description}</div>
                  <div className="tiny muted">{RECURRING_EXPENSE_PAY_TYPE_LABELS[row.pay_type]}</div>
                </div>
                <input
                  className="input num"
                  type="number"
                  min={0}
                  step="0.01"
                  style={{ width: 110 }}
                  value={amounts[row.recurring_expense_id] ?? ''}
                  onChange={(event) =>
                    setAmounts((current) => ({
                      ...current,
                      [row.recurring_expense_id]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 10, fontWeight: 700 }}>
            <span>{strings.expenses.total}</span>
            <span className="num">{money(total)}</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {strings.recurringExpenses.postedNote}
          </div>
        </>
      )}
    </Card>
  );
}

/** "Rs2,000 / Monthly · 1st", "Rs500 / Daily". */
function recurringSummary(item: RecurringExpense): string {
  const rate = `${money(item.amount)} / ${RECURRING_EXPENSE_PAY_TYPE_LABELS[item.pay_type]}`;
  if (item.pay_type === 'monthly' && item.payday !== null) {
    return `${rate} · ${ordinal(item.payday)}`;
  }
  return rate;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * The recurring-expense roster: add, edit, pause or delete a standing
 * expense definition. Nothing here touches the ledger — see
 * RecurringExpensesDueCard above for the review that actually posts.
 */
function RecurringExpensesManager() {
  const { toast } = useApp();
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.recurringExpenses.list());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load recurring expenses.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (item: RecurringExpense, active: boolean) => {
    try {
      await api.recurringExpenses.save({
        id: item.id,
        description: item.description,
        amount: item.amount,
        pay_type: item.pay_type,
        payday: item.payday,
        is_active: active,
      });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change that.', 'error');
    }
  };

  const remove = async (item: RecurringExpense) => {
    if (!window.confirm(strings.recurringExpenses.deleteConfirm)) return;
    try {
      await api.recurringExpenses.remove(item.id);
      await load();
      toast(strings.recurringExpenses.deleted, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that.', 'error');
    }
  };

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <h2>{strings.recurringExpenses.title}</h2>
        <button className="btn sm" onClick={() => setEditing('new')}>
          {strings.recurringExpenses.addRecurring}
        </button>
      </div>
      <p className="tiny muted" style={{ marginBottom: 14 }}>
        {strings.recurringExpenses.subtitle}
      </p>

      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : items.length === 0 ? (
        <Empty title={strings.recurringExpenses.emptyTitle} note={strings.recurringExpenses.emptyNote} />
      ) : (
        <div className="staff-list">
          {items.map((item) => (
            <div key={item.id} className={`staff-row${item.is_active ? '' : ' inactive'}`}>
              <div style={{ minWidth: 0 }}>
                <div className="staff-row-name">{item.description}</div>
                <div className="tiny muted">{recurringSummary(item)}</div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => setEditing(item)}>
                  {strings.common.edit}
                </button>
                <button
                  className={`btn sm${item.is_active ? ' ok-soft' : ''}`}
                  onClick={() => void setActive(item, item.is_active !== 1)}
                >
                  {item.is_active ? strings.recurringExpenses.active : strings.recurringExpenses.inactive}
                </button>
                <button
                  className="btn ghost sm"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => void remove(item)}
                  aria-label={strings.common.delete}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <RecurringExpenseModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </Card>
  );
}

function RecurringExpenseModal({
  item,
  onClose,
  onSaved,
}: {
  item: RecurringExpense | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [description, setDescription] = useState(item?.description ?? '');
  const [amount, setAmount] = useState(item ? String(item.amount) : '');
  const [payType, setPayType] = useState<RecurringExpensePayType>(item?.pay_type ?? 'daily');
  const [payday, setPayday] = useState<number>(item?.payday ?? 1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.recurringExpenses.save({
        id: item?.id,
        description: description.trim(),
        amount: Number(amount) || 0,
        pay_type: payType,
        payday: payType === 'daily' ? null : payday,
        is_active: item ? item.is_active === 1 : true,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={item ? strings.recurringExpenses.editRecurring : strings.recurringExpenses.addRecurring}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button
            className="btn primary"
            onClick={save}
            disabled={busy || !description.trim() || !(Number(amount) > 0)}
          >
            {strings.recurringExpenses.save}
          </button>
        </>
      }
    >
      <Field label={strings.recurringExpenses.description}>
        <input
          className="input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={strings.recurringExpenses.descriptionPlaceholder}
          autoFocus
        />
      </Field>

      <Field label={strings.recurringExpenses.amount}>
        <input
          className="input num"
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>

      <Field label={strings.recurringExpenses.payType}>
        <div className="row" style={{ gap: 8 }}>
          {RECURRING_EXPENSE_PAY_TYPES.map((option) => (
            <button
              key={option}
              className={`cat-tab${payType === option ? ' active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setPayType(option)}
            >
              {RECURRING_EXPENSE_PAY_TYPE_LABELS[option]}
            </button>
          ))}
        </div>
      </Field>

      {payType === 'monthly' ? (
        <Field label={strings.recurringExpenses.payday} hint={strings.recurringExpenses.paydayHint}>
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
