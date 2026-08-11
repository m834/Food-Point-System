'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Badge, Card, Empty, Field, Modal, Notice } from '@/components/ui';
import { IconPlus, IconTrash } from '@/components/icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { moneyShort } from '@/lib/format';
import type { DiningTable } from '../../../shared/types';

/**
 * The floor.
 *
 * Free/occupied and the running total both arrive from one derived query, so
 * this screen cannot show a table as occupied after its order was settled —
 * there is no stored flag to go stale.
 */
export default function TablesPage() {
  const { toast, tablesEnabled } = useApp();
  const router = useRouter();

  const [tables, setTables] = useState<DiningTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DiningTable | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setTables(await api.tables.list());
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load the floor.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Tap free to start its order, occupied to resume the one already on it. */
  const tapTable = (table: DiningTable) => {
    router.push(
      table.open_order_id ? `/order/?order=${table.open_order_id}` : `/order/?table=${table.id}`,
    );
  };

  if (!tablesEnabled) {
    return (
      <AppShell title={strings.tables.title}>
        <Card>
          <Empty title={strings.tables.disabledTitle} note={strings.tables.disabledNote} />
        </Card>
      </AppShell>
    );
  }

  const occupied = tables.filter((table) => table.open_order_id).length;

  return (
    <AppShell
      title={strings.tables.title}
      subtitle={
        tables.length
          ? `${occupied} of ${tables.length} ${strings.tables.occupied.toLowerCase()}`
          : undefined
      }
      actions={
        <button className="btn primary" onClick={() => setEditing('new')}>
          <IconPlus size={17} />
          {strings.tables.addTable}
        </button>
      }
    >
      {loading ? (
        <div className="empty">{strings.common.loading}</div>
      ) : tables.length === 0 ? (
        <Card>
          <Empty
            title={strings.tables.emptyTitle}
            note={strings.tables.emptyNote}
            action={
              <button className="btn primary" onClick={() => setEditing('new')}>
                {strings.tables.addTable}
              </button>
            }
          />
        </Card>
      ) : (
        <div className="floor-grid">
          {tables.map((table) => (
            <button
              key={table.id}
              className={`table-card${table.open_order_id ? ' occupied' : ''}`}
              onClick={() => tapTable(table)}
            >
              <div className="row-between">
                <span className="table-card-name">{table.name}</span>
                <Badge kind={table.open_order_id ? 'accent' : 'neutral'}>
                  {table.open_order_id ? strings.tables.occupied : strings.tables.free}
                </Badge>
              </div>
              <div className="tiny muted">
                {[table.area, table.seats ? `${table.seats} seats` : null]
                  .filter(Boolean)
                  .join(' · ') || ' '}
              </div>
              <div className="table-card-total">
                {table.open_order_id ? moneyShort(table.running_total) : ' '}
              </div>
            </button>
          ))}
        </div>
      )}

      {editing ? (
        <TableModal
          table={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onDeleted={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function TableModal({
  table,
  onClose,
  onSaved,
  onDeleted,
}: {
  table: DiningTable | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const [name, setName] = useState(table?.name ?? '');
  const [area, setArea] = useState(table?.area ?? '');
  const [seats, setSeats] = useState(table?.seats ? String(table.seats) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.tables.save({
        id: table?.id,
        name,
        area: area || null,
        seats: seats ? Number(seats) : null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that table.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!table) return;
    setBusy(true);
    setError('');
    try {
      await api.tables.remove(table.id);
      await onDeleted();
    } catch (err) {
      // "This table has an open order" lands here — a real, actionable reason.
      setError(err instanceof Error ? err.message : 'Could not delete that table.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={table ? table.name : strings.tables.addTable}
      onClose={onClose}
      footer={
        <>
          {table ? (
            <button className="btn danger" onClick={remove} disabled={busy}>
              <IconTrash size={16} />
              {strings.common.delete}
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            {strings.common.save}
          </button>
        </>
      }
    >
      <Field label={strings.tables.tableName}>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="T1"
          autoFocus
        />
      </Field>
      <div className="field-row">
        <Field label={`${strings.tables.area} (${strings.order.optional})`}>
          <input
            className="input"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="Indoor"
          />
        </Field>
        <Field label={`${strings.tables.seats} (${strings.order.optional})`}>
          <input
            className="input num"
            type="number"
            min={1}
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        </Field>
      </div>

      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
