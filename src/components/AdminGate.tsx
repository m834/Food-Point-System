'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Notice } from './ui';
import { useApp } from './AppContext';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { COUNTER_HOME } from '@/lib/areas';

/**
 * The manager PIN prompt that guards the owner's portal.
 *
 * Shown whenever an admin route is reached without a live admin session —
 * whether the owner tapped "Admin" or somebody typed the address. The check
 * happens in the main process; this only collects the digits and reports what
 * came back.
 *
 * Deliberately reuses the SAME PIN as cancelling a paid order. A second secret
 * would be a second thing to forget, and the two guard the same authority: the
 * owner's, as distinct from the counter's.
 */
export function AdminGate() {
  const { adminPinSet, refreshAdmin } = useApp();
  const router = useRouter();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // First run: no PIN exists. Admin cannot be left open, and Settings — where
  // the PIN lives — is itself inside admin, so the only way out of that circle
  // is to let the owner set it here.
  const firstRun = !adminPinSet;

  const submit = async () => {
    if (pin.length < 4) return;
    setBusy(true);
    setError('');
    try {
      if (firstRun) {
        if (pin !== confirmPin) {
          setError(strings.admin.pinMismatch);
          setBusy(false);
          return;
        }
        await api.admin.initialise(pin);
      } else {
        await api.admin.unlock(pin);
      }
      await refreshAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.admin.wrongPin);
      setPin('');
      setConfirmPin('');
      setBusy(false);
    }
  };

  return (
    <div className="activation">
      <div className="activation-card">
        <img className="activation-logo" src="/logo.png" alt="" width={72} height={72} />

        <h1>{firstRun ? strings.admin.setPinTitle : strings.admin.title}</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          {firstRun ? strings.admin.setPinHint : strings.admin.hint}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            className="input num pin-input"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            maxLength={8}
            placeholder="••••"
            autoFocus
          />

          {firstRun ? (
            <input
              className="input num pin-input"
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
              maxLength={8}
              placeholder={strings.admin.confirmPin}
              style={{ marginTop: 10 }}
            />
          ) : null}

          {error ? <Notice>{error}</Notice> : null}

          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => router.push(COUNTER_HOME)}
              disabled={busy}
            >
              {strings.admin.backToCounter}
            </button>
            <button type="submit" className="btn primary block" disabled={busy || pin.length < 4}>
              {firstRun ? strings.admin.setPinAction : strings.admin.unlock}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
