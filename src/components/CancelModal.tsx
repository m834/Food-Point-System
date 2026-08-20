'use client';

import { useState } from 'react';
import { Field, Modal, Notice } from './ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money } from '@/lib/format';
import {
  CANCEL_REASONS,
  CANCEL_REASON_LABELS,
  type CancelReasonCode,
  type Order,
} from '../../shared/types';

/**
 * The one dialog for cancelling anything.
 *
 * Three deliberate choices:
 *
 *  1. **The reason is a list, not a text box.** Free text cannot be counted or
 *     compared across staff, and "asdf" is a valid free-text reason. A closed
 *     list is what makes the owner's report able to say "this person's
 *     cancellations are overwhelmingly 'Customer left'".
 *  2. **The manager PIN field only appears for a PAID order**, because that is
 *     the only case that needs it. Showing it always would train the counter
 *     to expect it and make the real gate feel routine.
 *  3. **The consequence is stated plainly** before the button is pressed. A
 *     cashier cancelling a paid order should know, in words, that the money
 *     leaves the day's takings and their name is on it permanently.
 */
export function CancelModal({
  order,
  line,
  onClose,
  onCancelled,
}: {
  order: Order;
  /** Set when cancelling a single line rather than the whole order. */
  line?: { id: number; label: string } | null;
  onClose: () => void;
  onCancelled: (updated: Order) => void | Promise<void>;
}) {
  const [reason, setReason] = useState<CancelReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A line only ever exists on an open order, so only a whole-order
  // cancellation can ever be hitting money that has already been taken.
  const isPaid = !line && order.status === 'settled';
  const amount = isPaid ? order.total : order.subtotal;

  const noteNeeded = reason === 'other' && !note.trim();
  const canSubmit = Boolean(reason) && !noteNeeded && !busy;

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      const updated = line
        ? await api.orders.voidItem(line.id, reason, note || null)
        : await api.orders.voidOrder(order.id, reason, note || null, pin || undefined);
      await onCancelled(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel that.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={line ? `${strings.cancel.cancelItem} — ${line.label}` : strings.cancel.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.cancel.keep}
          </button>
          <button className="btn danger-solid" onClick={submit} disabled={!canSubmit}>
            {line ? strings.cancel.confirmItem : strings.cancel.confirm}
          </button>
        </>
      }
    >
      {/* What is actually about to happen, in money terms. */}
      <div className="cancel-summary">
        <div className="row-between">
          <span className="muted">{line ? line.label : order.order_no}</span>
          <span className="num cancel-summary-amount">{money(amount)}</span>
        </div>
      </div>

      {isPaid ? (
        <Notice kind="error">{strings.cancel.paidWarning}</Notice>
      ) : (
        <div className="tiny muted" style={{ marginBottom: 14 }}>
          {strings.cancel.unpaidNote}
        </div>
      )}

      <Field label={strings.cancel.reason}>
        <div className="reason-grid">
          {CANCEL_REASONS.map((code) => (
            <button
              key={code}
              className={`cat-tab${reason === code ? ' active' : ''}`}
              onClick={() => setReason(code)}
            >
              {CANCEL_REASON_LABELS[code]}
            </button>
          ))}
        </div>
      </Field>

      {/* Required for "Other" — otherwise it becomes the escape hatch that
          empties the whole list of meaning. */}
      {reason === 'other' ? (
        <Field label={strings.cancel.note} hint={strings.cancel.noteRequired}>
          <input
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={strings.cancel.notePlaceholder}
            autoFocus
          />
        </Field>
      ) : reason ? (
        <Field label={`${strings.cancel.note} (${strings.order.optional})`}>
          <input
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={strings.cancel.notePlaceholder}
          />
        </Field>
      ) : null}

      {isPaid ? (
        <Field label={strings.cancel.managerPin} hint={strings.cancel.paidPinHint}>
          <input
            className="input num"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            maxLength={8}
          />
        </Field>
      ) : null}

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
