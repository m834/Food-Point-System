'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useApp } from './AppContext';
import { Sidebar } from './Sidebar';
import { Activation } from './Activation';
import { StaffSignIn } from './StaffSignIn';
import { AdminGate } from './AdminGate';
import { Spinner } from './ui';
import { hasBridge } from '@/lib/api';
import { isAdminRoute } from '@/lib/areas';

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
  rich = false,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** The order screen manages its own full-height layout. */
  bare?: boolean;
  /**
   * Switches the workspace into the RICH visual register — dark navy,
   * glass, gradient depth. Reserved for the dashboard; the activation
   * screen gets the same treatment through its own `.activation` styles.
   *
   * Every other screen stays in the CALM register on purpose: they are
   * data-entry surfaces read all day on cheap monitors, where blur and
   * gradient behind a price column costs legibility for nothing.
   */
  rich?: boolean;
}) {
  const { ready, license, staff, staffRequired, refreshStaff, isAdmin } = useApp();
  const pathname = usePathname();

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

  /**
   * The shift gate. Only appears once the owner has actually added staff — a
   * shop that has not set anyone up carries on exactly as before, and its
   * cancellations are simply recorded without a name until it does.
   */
  if (staffRequired && !staff) return <StaffSignIn onSignedIn={refreshStaff} />;

  /**
   * The admin gate.
   *
   * Applied by ROUTE, not by which button was pressed, so typing the address
   * of a report is stopped by exactly the same check as tapping Admin. The
   * backend re-checks on every owner-only channel regardless — this is what
   * makes the screen coherent, not what makes it safe.
   */
  if (isAdminRoute(pathname) && !isAdmin) return <AdminGate />;

  return (
    <div className="shell">
      <Sidebar />
      <main className={`workspace${rich ? ' rich' : ''}`}>
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
