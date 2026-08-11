'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import { useApp } from './AppContext';
import { Field, Notice } from './ui';

/**
 * The gate before anything else (spec §7).
 *
 * The owner reads the Machine ID to the office; the office signs a key for
 * that machine only. Nothing here can produce a key — the app holds the public
 * half and no more.
 */
export function Activation() {
  const { license, refreshLicense } = useApp();
  const [machineId, setMachineId] = useState(license?.machineId ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (machineId) return;
    api.license
      .machineId()
      .then(setMachineId)
      .catch(() => undefined);
  }, [machineId]);

  const copy = async () => {
    await api.system.copyToClipboard(machineId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.license.activate(key);
      await refreshLicense();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That key could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="activation">
      <form className="activation-card" onSubmit={activate}>
        <h1>{strings.activation.title}</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          {strings.activation.intro}
        </p>

        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Field label={strings.activation.machineId}>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <div className="machine-id" style={{ flex: 1 }}>
                {machineId || '…'}
              </div>
              <button type="button" className="btn" onClick={copy} disabled={!machineId}>
                {copied ? strings.activation.copied : strings.activation.copy}
              </button>
            </div>
          </Field>

          <Field label={strings.activation.keyLabel}>
            <textarea
              className="input"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={strings.activation.keyPlaceholder}
              spellCheck={false}
              autoFocus
            />
          </Field>

          {/* The status message already explains expiry or a wrong-machine key. */}
          {error ? <Notice>{error}</Notice> : null}
          {!error && license && license.status !== 'unlicensed' ? (
            <Notice kind="warn">{license.message}</Notice>
          ) : null}

          <button className="btn primary big block" type="submit" disabled={busy || !key.trim()}>
            {busy ? strings.activation.activating : strings.activation.activate}
          </button>
        </div>
      </form>
    </div>
  );
}
