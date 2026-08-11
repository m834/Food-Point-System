'use client';

import type { ReactNode } from 'react';
import { useApp } from './AppContext';
import { Sidebar } from './Sidebar';
import { Activation } from './Activation';
import { Spinner } from './ui';
import { hasBridge } from '@/lib/api';

/**
 * The frame every screen sits in — and the licence gate.
 *
 * The backend refuses data channels when unlicensed too; this is the friendly
 * half of that rule, not the enforcement.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  children,
  bare = false,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** The order screen manages its own full-height layout. */
  bare?: boolean;
}) {
  const { ready, license } = useApp();

  if (!ready) return <Spinner />;

  if (!hasBridge()) {
    return (
      <div className="activation">
        <div className="activation-card">
          <h1>Open this through the desktop app</h1>
          <p className="muted">
            Food Point runs inside its own window. Launching it in a browser leaves it with no
            database to talk to.
          </p>
        </div>
      </div>
    );
  }

  if (!license?.licensed) return <Activation />;

  return (
    <div className="shell">
      <Sidebar />
      <main className="workspace">
        {bare ? (
          children
        ) : (
          <>
            <div className="workspace-head">
              <div>
                {title ? <h1>{title}</h1> : null}
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
              {actions ? <div className="row">{actions}</div> : null}
            </div>
            <div className="workspace-body">{children}</div>
          </>
        )}
      </main>
    </div>
  );
}
