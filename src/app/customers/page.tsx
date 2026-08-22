'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Empty, Field, Modal, Notice } from '@/components/ui';
import { IconTrash } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { dateOnly } from '@/lib/format';
import type { Customer } from '../../../shared/types';

/**
 * The owner's customer list.
 *
 * Admin-only, and not merely because the sidebar hides it: the IPC channels
 * behind this screen all call `requireAdmin()`. A list of names, phone numbers
 * and home addresses is the single most sensitive thing this app holds, and
 * the counter has no reason to walk it — the till only ever asks about one
 * number it already has in hand.
 *
 * A CALM screen: plain rows, high contrast, no decoration. It is read
 * carefully, often while looking someone up on the phone.
 */
export default function CustomersPage() {
  const { toast } = useApp();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Customer | null>(null);

  const load = useCallback(
    async (term?: string) => {
      try {
        setCustomers(await api.customers.list(term));
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load customers.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced so typing a name is not a query per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  const exportCsv = async () => {
    try {
      const result = await api.customers.csv();
      toast(strings.customers.exported(result.count), 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export.';
      // Cancelling the save dialog is not a failure worth shouting about.
      if (!/cancel/i.test(message)) toast(message, 'error');
    }
  };

  const remove = async (customer: Customer) => {
    if (!window.confirm(strings.customers.deleteConfirm)) return;
    try {
      await api.customers.remove(customer.id);
      setEditing(null);
      await load(search);
      toast(strings.customers.deleted, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete.', 'error');
    }
  };

  return (
    <AppShell
      title={strings.customers.title}
      subtitle={customers.length ? strings.customers.subtitle : undefined}
      actions={
        <>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder={strings.customers.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="btn" onClick={exportCsv} disabled={!customers.length}>
            {strings.customers.exportCsv}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : customers.length === 0 ? (
        <Card>
          <Empty
            title={search ? strings.customers.noResults : strings.customers.emptyTitle}
            note={search ? undefined : strings.customers.emptyNote}
          />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>{strings.customers.name}</th>
                  <th>{strings.customers.phone}</th>
                  <th>{strings.customers.address}</th>
                  <th className="right">{strings.customers.orders}</th>
                  <th>{strings.customers.lastOrder}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name || strings.customers.unnamed}</strong>
                      {customer.notes ? (
                        <div className="tiny muted">“{customer.notes}”</div>
                      ) : null}
                    </td>
                    <td className="num">{customer.phone}</td>
                    <td className="muted">{customer.address || '—'}</td>
                    <td className="right num">{customer.order_count}</td>
                    <td className="num muted">
                      {customer.last_order_at
                        ? dateOnly(customer.last_order_at)
                        : strings.customers.never}
                    </td>
                    <td className="right">
                      <button className="btn sm" onClick={() => setEditing(customer)}>
                        {strings.common.edit}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing ? (
        <CustomerModal
          customer={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(search);
            toast('Customer saved.', 'ok');
          }}
          onDelete={() => remove(editing)}
        />
      ) : null}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ *
 * Edit one customer
 * ------------------------------------------------------------------ */

function CustomerModal({
  customer,
  onClose,
  onSaved,
  onDelete,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDelete: () => void;
}) {
  const [phone, setPhone] = useState(customer.phone);
  const [name, setName] = useState(customer.name ?? '');
  const [address, setAddress] = useState(customer.address ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.customers.save({
        id: customer.id,
        phone,
        name: name || null,
        address: address || null,
        notes: notes || null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that customer.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={strings.customers.edit}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn ghost"
            style={{ color: 'var(--danger)' }}
            onClick={onDelete}
            disabled={busy}
          >
            <IconTrash size={15} />
            {strings.common.delete}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !phone.trim()}>
            {strings.common.save}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label={strings.customers.phone}>
          <input
            className="input num"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
          />
        </Field>
        <Field label={strings.customers.name}>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>

      <Field label={strings.customers.address}>
        <textarea
          className="input"
          rows={2}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </Field>

      <Field label={strings.customers.notes}>
        <input
          className="input"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="e.g. gate at the back, no chilli"
        />
      </Field>

      <div className="row-between tiny muted">
        <span>
          {strings.customers.orders}: {customer.order_count}
        </span>
        <span>
          {strings.customers.lastOrder}:{' '}
          {customer.last_order_at ? dateOnly(customer.last_order_at) : strings.customers.never}
        </span>
      </div>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
