'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Field, Notice } from './ui';
import { IconTrash } from './icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import type { StaffMember } from '../../shared/types';

/**
 * Managing who works the counter.
 *
 * Until this existed the staff roster could only be populated programmatically,
 * so the sign-in gate never activated and every cancellation recorded "Not
 * recorded" — which made the owner's per-staff breakdown empty and useless.
 * This is the screen that switches that whole feature on.
 *
 * It lives in Settings, inside admin, because deciding who may take orders is
 * the owner's call, not the counter's.
 */
export function StaffManager({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [editingPin, setEditingPin] = useState<{ id: number; value: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStaff(await api.staff.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the staff list.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const after = async () => {
    await load();
    await onChanged?.();
  };

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await api.staff.save({ name, is_active: true, pin: pin || '' });
      setName('');
      setPin('');
      await after();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that person.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (person: StaffMember, active: boolean) => {
    try {
      await api.staff.save({ id: person.id, name: person.name, is_active: active });
      await after();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    }
  };

  const savePin = async (person: StaffMember, value: string) => {
    try {
      await api.staff.save({ id: person.id, name: person.name, is_active: person.is_active === 1, pin: value });
      setEditingPin(null);
      await after();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set that PIN.');
    }
  };

  const remove = async (person: StaffMember) => {
    try {
      const result = await api.staff.remove(person.id);
      // Someone with cancellations against their name is deactivated, never
      // deleted — erasing them would erase the record the report exists for.
      setError(result.deleted ? '' : strings.staff.deactivated);
      await after();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that person.');
    }
  };

  return (
    <div>
      <div className="field-row" style={{ alignItems: 'end' }}>
        <Field label={strings.staff.name}>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={strings.staff.namePlaceholder}
          />
        </Field>
        <Field label={`${strings.staff.pin} (${strings.order.optional})`} hint={strings.staff.pinHint}>
          <div className="row">
            <input
              className="input num"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              maxLength={8}
            />
            <button className="btn primary" onClick={add} disabled={busy || !name.trim()}>
              {strings.staff.addStaff}
            </button>
          </div>
        </Field>
      </div>

      {staff.length === 0 ? (
        <div className="tiny muted">{strings.staff.emptyNote}</div>
      ) : (
        <div className="staff-list">
          {staff.map((person) => (
            <div key={person.id} className={`staff-row${person.is_active ? '' : ' inactive'}`}>
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className="staff-row-initial">{person.name.slice(0, 1).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="staff-row-name">{person.name}</div>
                  <div className="tiny muted">
                    {person.has_pin ? strings.staff.pinSet : strings.staff.noPin}
                    {person.is_active ? '' : ` · ${strings.staff.inactive}`}
                  </div>
                </div>
              </div>

              {editingPin?.id === person.id ? (
                <div className="row">
                  <input
                    className="input num"
                    type="password"
                    inputMode="numeric"
                    value={editingPin.value}
                    onChange={(event) =>
                      setEditingPin({ id: person.id, value: event.target.value.replace(/\D/g, '') })
                    }
                    maxLength={8}
                    style={{ width: 110 }}
                    autoFocus
                  />
                  <button
                    className="btn primary sm"
                    onClick={() => void savePin(person, editingPin.value)}
                  >
                    {strings.common.save}
                  </button>
                  <button className="btn ghost sm" onClick={() => setEditingPin(null)}>
                    {strings.common.cancel}
                  </button>
                </div>
              ) : (
                <div className="row">
                  <button
                    className="btn sm"
                    onClick={() => setEditingPin({ id: person.id, value: '' })}
                  >
                    {person.has_pin ? strings.staff.changePin : strings.staff.setPin}
                  </button>
                  <button
                    className={`btn sm${person.is_active ? ' ok-soft' : ''}`}
                    onClick={() => void setActive(person, person.is_active !== 1)}
                  >
                    {person.is_active ? strings.staff.active : strings.staff.inactive}
                  </button>
                  <button
                    className="btn ghost sm"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => void remove(person)}
                    aria-label={strings.common.delete}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error ? <Notice kind="warn">{error}</Notice> : null}
    </div>
  );
}
