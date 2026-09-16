import { getDb } from '../connection';
import { money, nowIso, todayIso } from '../money';
import { businessDate } from '../businessDate';
import { currentSessionId } from './daySessions';
import { listWaiters } from './waiters';
import { listRecurringExpenses } from './recurringExpenses';
import {
  WAITER_PAY_TYPES,
  WAITER_PAY_TYPE_LABELS,
  type Expense,
  type RecurringExpense,
  type RecurringExpenseEntry,
  type Waiter,
  type WaiterPayType,
  type WaiterWageEntry,
} from '../../../shared/types';

/**
 * Daily expenses and waiter wages — both optional, both admin-only, and both
 * filed the same way an order is: against whichever day session is open, or
 * the calendar date when none is (spec Features 3 & 4).
 *
 * Waiter wages are not a second money bucket. Saving them writes a normal row
 * into THIS SAME `expenses` table, tagged `source = 'wages'`, so the day's
 * cash reconciliation only ever has one ledger to sum.
 */

const EXPENSE_SELECT = `
  SELECT id, description, amount, session_id, expense_date, source, created_at
  FROM expenses
`;

export function getExpense(id: number): Expense | null {
  return (
    (getDb().prepare(`${EXPENSE_SELECT} WHERE id = ?`).get(id) as Expense | undefined) ?? null
  );
}

export function listExpensesForSession(sessionId: number): Expense[] {
  return getDb()
    .prepare(`${EXPENSE_SELECT} WHERE session_id = ? ORDER BY created_at`)
    .all(sessionId) as Expense[];
}

/** Expenses taken with no day open, filed by calendar date instead. */
export function listExpensesForDate(date: string): Expense[] {
  return getDb()
    .prepare(`${EXPENSE_SELECT} WHERE session_id IS NULL AND expense_date = ? ORDER BY created_at`)
    .all(date) as Expense[];
}

/** Whatever the counter is actually looking at right now. */
export function listCurrentExpenses(): Expense[] {
  const sessionId = currentSessionId();
  return sessionId ? listExpensesForSession(sessionId) : listExpensesForDate(todayIso());
}

export function totalForSession(sessionId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE session_id = ?')
    .get(sessionId) as { total: number };
  return money(row.total);
}

export interface ExpenseTotalsInRange {
  expenses_total: number;
  waiter_wages_total: number;
  waiter_wages_daily: number;
  waiter_wages_weekly: number;
  waiter_wages_monthly: number;
}

/**
 * Expense and wage totals for a date range — read live from the ledger, the
 * same rows the Expenses screen and day-close report already show, never
 * recalculated from a waiter's rate.
 *
 * Scoped by the same trading-day rule as every other figure on the Reports
 * screen (see businessDate()): an expense filed against a session is dated
 * by when that session OPENED, not the calendar date it happened to be
 * recorded, so a night that crosses midnight is not split across two days
 * here while the rest of the report treats it as one.
 *
 * The pay-type breakdown is read off the description `saveWaiterWages()`
 * already writes — "Waiter wages (daily) — …", "… (weekly) — …", "…
 * (monthly) — …" — rather than a separate column, since each is already a
 * distinct posted line for the one day it was actually paid. Summing those
 * lines is exactly "never spread a weekly or monthly wage across the days
 * in between": a wage posted on one day inside the range counts once, on
 * that day; a payday outside the range contributes nothing.
 */
export function expenseTotalsInRange(from: string, to: string): ExpenseTotalsInRange {
  const scope = businessDate('', 'expense_date');
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(amount), 0) AS expenses_total,
         COALESCE(SUM(CASE WHEN source = 'wages' THEN amount ELSE 0 END), 0) AS waiter_wages_total,
         COALESCE(SUM(CASE WHEN source = 'wages' AND description LIKE 'Waiter wages (daily)%'
                       THEN amount ELSE 0 END), 0) AS waiter_wages_daily,
         COALESCE(SUM(CASE WHEN source = 'wages' AND description LIKE 'Waiter wages (weekly)%'
                       THEN amount ELSE 0 END), 0) AS waiter_wages_weekly,
         COALESCE(SUM(CASE WHEN source = 'wages' AND description LIKE 'Waiter wages (monthly)%'
                       THEN amount ELSE 0 END), 0) AS waiter_wages_monthly
         FROM expenses
        WHERE ${scope} BETWEEN ? AND ?`,
    )
    .get(from, to) as ExpenseTotalsInRange;

  return {
    expenses_total: money(row.expenses_total),
    waiter_wages_total: money(row.waiter_wages_total),
    waiter_wages_daily: money(row.waiter_wages_daily),
    waiter_wages_weekly: money(row.waiter_wages_weekly),
    waiter_wages_monthly: money(row.waiter_wages_monthly),
  };
}

export interface ExpenseInput {
  id?: number;
  description: string;
  amount: number;
}

/**
 * Add or edit a MANUAL expense. Never touches a 'wages' or 'recurring'
 * line — those are owned entirely by `saveWaiterWages` / `saveRecurringExpensePostings`,
 * so an edit here on either is refused rather than silently corrupting the
 * total it stands for.
 */
export function saveExpense(input: ExpenseInput): Expense {
  const db = getDb();

  if (input.id) {
    const existing = getExpense(input.id);
    if (!existing) throw new Error('That expense no longer exists.');
    if (existing.source !== 'manual') {
      throw new Error(sourceGuardMessage(existing.source));
    }
    db.prepare('UPDATE expenses SET description = ?, amount = ? WHERE id = ?').run(
      input.description,
      money(input.amount),
      input.id,
    );
    return getExpense(input.id)!;
  }

  const info = db
    .prepare(
      `INSERT INTO expenses (description, amount, session_id, expense_date, source, created_at)
       VALUES (?, ?, ?, ?, 'manual', ?)`,
    )
    .run(input.description, money(input.amount), currentSessionId(), todayIso(), nowIso());
  return getExpense(Number(info.lastInsertRowid))!;
}

/** Which review owns a non-manual line, for a message that names the right screen. */
function sourceGuardMessage(source: Expense['source']): string {
  return source === 'wages'
    ? 'Waiter wages are edited from the wages review, not here.'
    : 'Recurring expenses are edited from the recurring-expenses review, not here.';
}

/** Confirmed by the caller (the UI asks) before this is ever reached. */
export function removeExpense(id: number): void {
  const existing = getExpense(id);
  if (!existing) return;
  if (existing.source !== 'manual') {
    throw new Error(sourceGuardMessage(existing.source));
  }
  getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ *
 * Waiter wages — a review that posts into the ledger above
 * ------------------------------------------------------------------ */

/** The last day-of-month `date`'s month actually has. */
function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Whether `waiter` is due for a wage review on `date`.
 *
 * DAILY is due every day — every close offers it. WEEKLY is due on the one
 * matching day of the week (`Date#getDay()`, Sunday=0). MONTHLY is due on the
 * matching day of the month (`Date#getDate()`) — a payday past the end of a
 * short month (31 in February) falls on that month's LAST day instead, so a
 * salary is never silently skipped just because the month is short. A waiter
 * with no payday recorded for a weekly/monthly rate is never due — the
 * roster, not a guess, decides that.
 */
function isDueOn(waiter: Waiter, date: Date): boolean {
  if (waiter.pay_type === 'daily') return true;
  if (waiter.payday === null || waiter.payday === undefined) return false;

  if (waiter.pay_type === 'weekly') return date.getDay() === waiter.payday;

  // monthly
  const effective = Math.min(waiter.payday, daysInMonth(date));
  return date.getDate() === effective;
}

/**
 * What the owner sees on opening the wages review: only the waiters actually
 * due today (see `isDueOn`), each showing whatever was already saved for the
 * CURRENT pay event where that exists, otherwise their own default rate.
 * Reopening the same day shows what actually got saved; the NEXT matching
 * payday always starts fresh from the roster's default — never from a past
 * override, because that is a different pay event with no saved row of its
 * own yet.
 */
export function waiterWagesDraft(): WaiterWageEntry[] {
  const today = new Date();
  const waiters = listWaiters(true).filter((w) => isDueOn(w, today));
  if (!waiters.length) return [];

  const sessionId = currentSessionId();
  const date = todayIso();
  const saved = (
    sessionId
      ? getDb().prepare('SELECT waiter_id, amount FROM waiter_wages WHERE session_id = ?').all(sessionId)
      : getDb()
          .prepare('SELECT waiter_id, amount FROM waiter_wages WHERE session_id IS NULL AND wage_date = ?')
          .all(date)
  ) as Array<{ waiter_id: number | null; amount: number }>;
  const savedByWaiter = new Map(
    saved.filter((row) => row.waiter_id !== null).map((row) => [row.waiter_id as number, row.amount]),
  );

  return waiters.map((waiter) => ({
    waiter_id: waiter.id,
    waiter_name: waiter.name,
    amount: money(savedByWaiter.get(waiter.id) ?? waiter.wage_rate),
    pay_type: waiter.pay_type,
  }));
}

export function waiterWagesForSession(sessionId: number): WaiterWageEntry[] {
  return (
    getDb()
      .prepare(
        `SELECT waiter_id, waiter_name, amount, pay_type
           FROM waiter_wages WHERE session_id = ? ORDER BY waiter_name`,
      )
      .all(sessionId) as Array<{
      waiter_id: number | null;
      waiter_name: string;
      amount: number;
      pay_type: WaiterWageEntry['pay_type'] | null;
    }>
  ).map((row) => ({
    waiter_id: row.waiter_id ?? 0,
    waiter_name: row.waiter_name,
    amount: row.amount,
    pay_type: row.pay_type ?? undefined,
  }));
}

/**
 * Save the day's wages in one shot.
 *
 * Idempotent by design: re-saving the same session REPLACES its rows rather
 * than piling up edits — "the owner reviews the list, then saves" describes
 * one current answer for today, not a history of attempts. The posted
 * expense line(s) are replaced the same way, so re-saving never double-counts.
 *
 * Only waiters who are BOTH active and actually due today can be paid —
 * enforced here again, not just by what the review screen chose to offer, so
 * a stale request can never pay someone on the wrong day, or divide a
 * weekly or monthly wage across the days in between.
 */
export function saveWaiterWages(
  entries: Array<{ waiter_id: number; amount: number }>,
): { wages: WaiterWageEntry[]; expenses: Expense[] } {
  const db = getDb();

  const run = db.transaction(() => {
    const sessionId = currentSessionId();
    const date = todayIso();
    const now = nowIso();
    const today = new Date();

    // No day open still needs somewhere to file wages, exactly like an
    // expense with no session — scoped by date instead in that case.
    if (sessionId) {
      db.prepare('DELETE FROM waiter_wages WHERE session_id = ?').run(sessionId);
      db.prepare("DELETE FROM expenses WHERE session_id = ? AND source = 'wages'").run(sessionId);
    } else {
      db.prepare('DELETE FROM waiter_wages WHERE session_id IS NULL AND wage_date = ?').run(date);
      db.prepare(
        "DELETE FROM expenses WHERE session_id IS NULL AND expense_date = ? AND source = 'wages'",
      ).run(date);
    }

    const insertWage = db.prepare(
      `INSERT INTO waiter_wages (waiter_id, waiter_name, amount, pay_type, session_id, wage_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const dueByWaiter = new Map(
      listWaiters(true)
        .filter((w) => isDueOn(w, today))
        .map((w) => [w.id, w]),
    );
    const saved: WaiterWageEntry[] = [];

    for (const entry of entries) {
      const waiter = dueByWaiter.get(entry.waiter_id);
      // An id that is not an active, currently-due waiter is skipped rather
      // than guessed at — the roster and the calendar decide who is paid,
      // not whatever the caller happened to send.
      if (!waiter) continue;
      const amount = money(Math.max(entry.amount, 0));
      insertWage.run(entry.waiter_id, waiter.name, amount, waiter.pay_type, sessionId, date, now);
      saved.push({
        waiter_id: entry.waiter_id,
        waiter_name: waiter.name,
        amount,
        pay_type: waiter.pay_type,
      });
    }

    /**
     * One line PER PAY TYPE, not one combined line — an ordinary day already
     * mixes cadences (daily waiters every day, plus a weekly waiter on their
     * Friday), and a single total would blur "the pay type in the line" into
     * meaninglessness. Each group is its own distinct, auditable entry:
     * "Waiter wages (daily) — <date>", "Waiter wages (weekly) — <date>", etc.
     */
    const totalsByType = new Map<WaiterPayType, number>();
    for (const entry of saved) {
      totalsByType.set(entry.pay_type!, money((totalsByType.get(entry.pay_type!) ?? 0) + entry.amount));
    }

    const insertExpense = db.prepare(
      `INSERT INTO expenses (description, amount, session_id, expense_date, source, created_at)
       VALUES (?, ?, ?, ?, 'wages', ?)`,
    );
    const expenseIds: number[] = [];
    for (const payType of WAITER_PAY_TYPES) {
      const amount = totalsByType.get(payType);
      if (!amount) continue;
      const description = `Waiter wages (${WAITER_PAY_TYPE_LABELS[payType].toLowerCase()}) — ${date}`;
      const info = insertExpense.run(description, amount, sessionId, date, now);
      expenseIds.push(Number(info.lastInsertRowid));
    }

    return { saved, expenseIds };
  });

  const { saved, expenseIds } = run();
  return { wages: saved, expenses: expenseIds.map((id) => getExpense(id)!).filter(Boolean) };
}

/* ------------------------------------------------------------------ *
 * Recurring expenses — a review that posts into the ledger above
 * ------------------------------------------------------------------ */

/**
 * Whether `item` is due for review on `date`. Mirrors `isDueOn` for waiters,
 * minus the 'weekly' case — a recurring expense only ever runs daily or
 * monthly (see RECURRING_EXPENSE_PAY_TYPES). Reuses the same "clamp to the
 * last day of a short month" rule so a payday of 31 is never silently
 * skipped in February.
 */
function isRecurringDueOn(item: RecurringExpense, date: Date): boolean {
  if (item.pay_type === 'daily') return true;
  if (item.payday === null || item.payday === undefined) return false;
  const effective = Math.min(item.payday, daysInMonth(date));
  return date.getDate() === effective;
}

/**
 * What the owner sees on opening the recurring-expenses review: only the
 * definitions actually due today, each showing whatever was already posted
 * for the CURRENT occurrence where that exists, otherwise the definition's
 * own default amount. Mirrors `waiterWagesDraft` exactly, including why: the
 * NEXT occurrence always starts fresh from the definition's default, never
 * from a past override, because that is a different pay event.
 */
export function recurringExpenseDraft(): RecurringExpenseEntry[] {
  const today = new Date();
  const items = listRecurringExpenses(true).filter((item) => isRecurringDueOn(item, today));
  if (!items.length) return [];

  const sessionId = currentSessionId();
  const date = todayIso();
  const saved = (
    sessionId
      ? getDb()
          .prepare('SELECT recurring_expense_id, amount FROM recurring_expense_postings WHERE session_id = ?')
          .all(sessionId)
      : getDb()
          .prepare(
            `SELECT recurring_expense_id, amount FROM recurring_expense_postings
              WHERE session_id IS NULL AND posting_date = ?`,
          )
          .all(date)
  ) as Array<{ recurring_expense_id: number | null; amount: number }>;
  const savedById = new Map(
    saved
      .filter((row) => row.recurring_expense_id !== null)
      .map((row) => [row.recurring_expense_id as number, row.amount]),
  );

  return items.map((item) => ({
    recurring_expense_id: item.id,
    description: item.description,
    amount: money(savedById.get(item.id) ?? item.amount),
    pay_type: item.pay_type,
  }));
}

/**
 * Save the day's recurring expenses in one shot.
 *
 * Idempotent, exactly like waiter wages: re-saving the same pay event
 * REPLACES its rows rather than piling up edits. Only definitions that are
 * BOTH active and actually due today can post — enforced again here, not
 * just by what the review offered, so a stale request can never post one on
 * the wrong day, or divide a monthly amount across the days in between.
 *
 * Unlike waiter wages, each recurring expense posts its OWN named ledger
 * line ("Rent — <date>") rather than being grouped by pay type — these are
 * distinct, individually-labelled costs, the same way a manual expense is.
 * A confirmed amount of zero is still recorded as reviewed (so reopening
 * today's draft shows 0, not the default again) but posts no ledger line —
 * there is nothing to show for a expense that was waived.
 */
export function saveRecurringExpensePostings(
  entries: Array<{ recurring_expense_id: number; amount: number }>,
): { postings: RecurringExpenseEntry[]; expenses: Expense[] } {
  const db = getDb();

  const run = db.transaction(() => {
    const sessionId = currentSessionId();
    const date = todayIso();
    const now = nowIso();
    const today = new Date();

    if (sessionId) {
      db.prepare('DELETE FROM recurring_expense_postings WHERE session_id = ?').run(sessionId);
      db.prepare("DELETE FROM expenses WHERE session_id = ? AND source = 'recurring'").run(sessionId);
    } else {
      db.prepare(
        'DELETE FROM recurring_expense_postings WHERE session_id IS NULL AND posting_date = ?',
      ).run(date);
      db.prepare(
        "DELETE FROM expenses WHERE session_id IS NULL AND expense_date = ? AND source = 'recurring'",
      ).run(date);
    }

    const insertPosting = db.prepare(
      `INSERT INTO recurring_expense_postings
         (recurring_expense_id, description, amount, session_id, posting_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertExpense = db.prepare(
      `INSERT INTO expenses (description, amount, session_id, expense_date, source, created_at)
       VALUES (?, ?, ?, ?, 'recurring', ?)`,
    );

    const dueById = new Map(
      listRecurringExpenses(true)
        .filter((item) => isRecurringDueOn(item, today))
        .map((item) => [item.id, item]),
    );

    const postings: RecurringExpenseEntry[] = [];
    const expenseIds: number[] = [];

    for (const entry of entries) {
      const item = dueById.get(entry.recurring_expense_id);
      // An id that is not an active, currently-due definition is skipped
      // rather than guessed at — the roster and the calendar decide what
      // can be posted, not whatever the caller happened to send.
      if (!item) continue;
      const amount = money(Math.max(entry.amount, 0));
      insertPosting.run(entry.recurring_expense_id, item.description, amount, sessionId, date, now);
      postings.push({
        recurring_expense_id: entry.recurring_expense_id,
        description: item.description,
        amount,
        pay_type: item.pay_type,
      });
      if (amount > 0) {
        const info = insertExpense.run(`${item.description} — ${date}`, amount, sessionId, date, now);
        expenseIds.push(Number(info.lastInsertRowid));
      }
    }

    return { postings, expenseIds };
  });

  const { postings, expenseIds } = run();
  return { postings, expenses: expenseIds.map((id) => getExpense(id)!).filter(Boolean) };
}
