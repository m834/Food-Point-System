'use client';

import { useCallback, useEffect, useState } from 'react';
import { Field, Notice } from './ui';
import { IconTrash } from './icons';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { money } from '@/lib/format';
import type { ExtraCharge } from '../../shared/types';

/**
 * The shop's list of chargeable extras — plates, glasses, a carry bag.
 *
 * Lives in admin because it is pricing, and pricing is the owner's. The
 * counter only ticks what applies to an order.
 *
 * "Cost to you" is optional and usually small, but it is offered because this
 * app takes profit seriously: packaging billed at Rs 20 that costs Rs 8 is Rs
 * 12 of margin, and an owner who records it gets a truthful number instead of
 * packaging quietly flattering their profit.
 */
export function ExtrasManager() {
  const [extras, setExtras] = useState<ExtraCharge[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setExtras(await api.extras.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the extras.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await api.extras.save({
        name,
        price: Number(price) || 0,
        cost_price: Number(cost) || 0,
        is_active: true,
        sort_order: extras.length,
      });
      setName('');
      setPrice('');
      setCost('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (extra: ExtraCharge) => {
    try {
      await api.extras.setActive(extra.id, extra.is_active !== 1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    }
  };

  const remove = async (extra: ExtraCharge) => {
    try {
      await api.extras.remove(extra.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that.');
    }
  };

  return (
    <div>
      <div className="extras-add">
        <Field label={strings.extras.name}>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={strings.extras.namePlaceholder}
          />
        </Field>
        <Field label={strings.extras.price}>
          <input
            className="input num"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
        <Field label={strings.extras.cost} hint={strings.extras.costHint}>
          <input
            className="input num"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
        <button
          className="btn primary"
          onClick={add}
          disabled={busy || !name.trim() || !(Number(price) >= 0)}
        >
          {strings.extras.add}
        </button>
      </div>

      {extras.length === 0 ? (
        <div className="tiny muted">{strings.extras.none}</div>
      ) : (
        <div className="staff-list">
          {extras.map((extra) => (
            <div key={extra.id} className={`staff-row${extra.is_active ? '' : ' inactive'}`}>
              <div style={{ minWidth: 0 }}>
                <div className="staff-row-name">{extra.name}</div>
                <div className="tiny muted">
                  {money(extra.price)}
                  {extra.cost_price ? ` · ${strings.extras.cost} ${money(extra.cost_price)}` : ''}
                </div>
              </div>
              <div className="row">
                <button
                  className={`btn sm${extra.is_active ? ' ok-soft' : ''}`}
                  onClick={() => void toggle(extra)}
                >
                  {extra.is_active ? strings.extras.active : strings.extras.inactive}
                </button>
                <button
                  className="btn ghost sm"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => void remove(extra)}
                  aria-label={strings.common.delete}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? <Notice kind="warn">{error}</Notice> : null}
    </div>
  );
}
