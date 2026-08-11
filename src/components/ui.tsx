'use client';

import { useEffect, type ReactNode } from 'react';
import { IconClose } from './icons';
import { strings } from '@/lib/strings';

/** Shared primitives, so screens describe intent rather than markup. */

export function Card({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return <div className={`card ${pad ? 'card-pad' : ''} ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  note,
  profit = false,
}: {
  label: string;
  value: string;
  note?: string;
  profit?: boolean;
}) {
  return (
    <div className={`stat${profit ? ' profit' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

/**
 * An empty state names the next action. A blank table tells a new owner
 * nothing; "Add your first item" tells them what the screen is for.
 */
export function Empty({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {note ? <div className="empty-note">{note}</div> : null}
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="tiny muted">{hint}</div> : null}
    </div>
  );
}

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}

export function Badge({
  kind = 'neutral',
  children,
}: {
  kind?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Escape closes. A cashier who opened the wrong dialog should not have to
  // aim for a small × while a queue waits.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head row-between">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label={strings.common.close}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ label = strings.common.loading }: { label?: string }) {
  return <div className="empty muted">{label}</div>;
}
