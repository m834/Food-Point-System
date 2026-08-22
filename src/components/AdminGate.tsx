'use client';

import { useEffect, useState } from 'react';
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
  const [recovering, setRecovering] = useState(false);
  const [licenceKey, setLicenceKey] = useState('');
  const [machineId, setMachineId] = useState('');
  const [copied, setCopied] = useState(false);

  /**
   * The Machine ID, fetched when recovery is opened.
   *
   * An owner who has forgotten the PIN usually does not have the licence key
   * to hand either — so the screen that asks for the key has to also give them
   * what the office needs in order to issue one. Without it they would be told
   * to fetch something they have no way to find.
   */
  useEffect(() => {
    if (!recovering || machineId) return;
    api.license
      .machineId()
      .then(setMachineId)
      .catch(() => undefined);
  }, [recovering, machineId]);

  const copyMachineId = async () => {
    try {
      await api.system.copyToClipboard(machineId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard refusal is not worth an error banner. */
    }
  };

  /**
   * Re-read the PIN state whenever this gate appears.
   *
   * The context loads it once at startup, but a RESTORE swaps the database
   * underneath a running app — so a shop that restored a backup could be shown
   * "enter your PIN" for a PIN that no longer exists, or "set a PIN" when the
   * restored file has one. Asking again here is what keeps the gate honest.
   */
  useEffect(() => {
    void refreshAdmin();
  }, [refreshAdmin]);

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

  /**
   * Forgotten PIN. The licence key is the authority: only the founder's
   * office can issue one, and it is locked to this machine. Clearing the PIN
   * does not open admin — the gate immediately asks for a new one instead.
   */
  const recover = async () => {
    setBusy(true);
    setError('');
    try {
      await api.admin.recover(licenceKey);
      setRecovering(false);
      setLicenceKey('');
      setPin('');
      setConfirmPin('');
      await refreshAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That licence key was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="activation">
      <div className="activation-card">
        <img className="activation-logo" src="/logo.png" alt="" width={72} height={72} />

        <h1>
          {recovering
            ? strings.admin.recoverTitle
            : firstRun
              ? strings.admin.setPinTitle
              : strings.admin.title}
        </h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          {recovering
            ? strings.admin.recoverHint
            : firstRun
              ? strings.admin.setPinHint
              : strings.admin.hint}
        </p>

        {recovering ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void recover();
            }}
          >
            {/* What the office needs in order to issue a key for THIS
                computer. Shown first, because it is the step that comes
                first in real life: read it out, then wait for the key. */}
            <div className="recover-machine">
              <div className="tiny muted" style={{ marginBottom: 6 }}>
                {strings.admin.machineIdLabel}
              </div>
              <div className="row" style={{ alignItems: 'stretch' }}>
                <div className="machine-id" style={{ flex: 1 }}>
                  {machineId || '…'}
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={copyMachineId}
                  disabled={!machineId}
                >
                  {copied ? strings.activation.copied : strings.activation.copy}
                </button>
              </div>
            </div>

            <div className="tiny muted" style={{ marginTop: 14, marginBottom: 4 }}>
              {strings.admin.licenceKeyLabel}
            </div>
            <textarea
              className="input"
              rows={3}
              value={licenceKey}
              onChange={(event) => setLicenceKey(event.target.value)}
              placeholder="CH1..."
              autoFocus
            />

            {error ? <Notice>{error}</Notice> : null}

            <div className="row" style={{ marginTop: 16, gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setRecovering(false);
                  setError('');
                }}
                disabled={busy}
              >
                {strings.common.cancel}
              </button>
              <button
                type="submit"
                className="btn primary block"
                disabled={busy || !licenceKey.trim()}
              >
                {strings.admin.recoverAction}
              </button>
            </div>
          </form>
        ) : (
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

          {/* The way out of a forgotten PIN. Only offered when one is set —
              there is nothing to recover from otherwise. */}
          {!firstRun ? (
            <button
              type="button"
              className="btn ghost sm block"
              style={{ marginTop: 12 }}
              onClick={() => {
                setRecovering(true);
                setError('');
              }}
              disabled={busy}
            >
              {strings.admin.forgotPin}
            </button>
          ) : null}
        </form>
        )}
      </div>
    </div>
  );
}
