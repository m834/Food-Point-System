'use client';

import { useEffect, useState } from 'react';
import { Notice } from './ui';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';
import type { StaffMember } from '../../shared/types';

/**
 * The shift sign-in.
 *
 * Shown when the owner has added staff but nobody is signed in. It is a shift
 * gate, not a login screen — pick your name, tap your PIN, and you are on the
 * counter until the app closes. Nothing here grants or withholds access to
 * features; its only purpose is that every cancellation carries a name the
 * owner can trust.
 *
 * A shop that has not added any staff never sees this at all.
 */
export function StaffSignIn({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [chosen, setChosen] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.staff
      .list(true)
      .then(setStaff)
      .catch(() => undefined);
  }, []);

  const submit = async (person: StaffMember, value: string) => {
    setBusy(true);
    setError('');
    try {
      await api.staff.signIn(person.id, value);
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.staff.wrongPin);
      setPin('');
      setBusy(false);
    }
  };

  const choose = (person: StaffMember) => {
    setChosen(person);
    setError('');
    setPin('');
    // Someone with no PIN set is straight through — the owner decided that.
    if (!person.has_pin) void submit(person, '');
  };

  return (
    <div className="activation">
      <div className="activation-card">
        <img className="activation-logo" src="/logo.png" alt="" width={72} height={72} />

        {!chosen ? (
          <>
            <h1>{strings.staff.whoAreYou}</h1>
            <p className="muted small" style={{ marginTop: 6 }}>
              {strings.staff.signInPrompt}
            </p>
            <div className="staff-picker">
              {staff.map((person) => (
                <button key={person.id} className="staff-pick" onClick={() => choose(person)}>
                  <span className="staff-pick-initial">{person.name.slice(0, 1).toUpperCase()}</span>
                  <span className="staff-pick-name">{person.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1>{chosen.name}</h1>
            <p className="muted small" style={{ marginTop: 6 }}>
              {strings.staff.pinHint}
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit(chosen, pin);
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

              {error ? <Notice>{error}</Notice> : null}

              <div className="row" style={{ marginTop: 16, gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setChosen(null);
                    setError('');
                  }}
                  disabled={busy}
                >
                  {strings.common.cancel}
                </button>
                <button
                  type="submit"
                  className="btn primary block"
                  disabled={busy || pin.length < 4}
                >
                  {strings.staff.signIn}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
