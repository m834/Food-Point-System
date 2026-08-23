'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from './AppContext';
import { strings } from '@/lib/strings';
import { ADMIN_HOME, COUNTER_HOME } from '@/lib/areas';
import {
  IconCancel,
  IconCustomers,
  IconDay,
  IconDashboard,
  IconDeal,
  IconMenu,
  IconOrder,
  IconReceipt,
  IconReports,
  IconLock,
  IconMoon,
  IconSettings,
  IconShield,
  IconSun,
  IconTables,
} from './icons';

export function Sidebar() {
  const pathname = usePathname();
  const { tablesEnabled, staff, signOut, theme, toggleTheme, isAdmin, exitAdmin } = useApp();
  const router = useRouter();

  /**
   * Two navigations, never merged.
   *
   * The counter list contains no admin entry at all — not greyed, not hidden
   * behind a check, simply absent. A disabled Reports link still tells a
   * curious staff member that reports exist and are worth trying; an absent
   * one tells them nothing.
   *
   * The only crossing point is the Admin button below, which leads to a PIN.
   */
  const counterLinks = [
    { href: '/order/', label: strings.nav.newOrder, icon: <IconOrder /> },
    { href: '/orders/', label: strings.nav.orders, icon: <IconReceipt /> },
    ...(tablesEnabled ? [{ href: '/tables/', label: strings.nav.tables, icon: <IconTables /> }] : []),
    { href: '/day/', label: strings.nav.day, icon: <IconDay /> },
  ];

  const adminLinks = [
    { href: '/', label: strings.nav.dashboard, icon: <IconDashboard /> },
    { href: '/reports/', label: strings.nav.reports, icon: <IconReports /> },
    { href: '/cancellations/', label: strings.nav.cancellations, icon: <IconCancel /> },
    { href: '/customers/', label: strings.nav.customers, icon: <IconCustomers /> },
    { href: '/menu/', label: strings.nav.menu, icon: <IconMenu /> },
    { href: '/deals/', label: strings.nav.deals, icon: <IconDeal /> },
    { href: '/day/', label: strings.nav.day, icon: <IconDay /> },
    { href: '/settings/', label: strings.nav.settings, icon: <IconSettings /> },
  ];

  const links = isAdmin ? adminLinks : counterLinks;

  // Compare whole path segments. A plain startsWith would light up "New order"
  // whenever you were on /orders/, since /orders starts with /order.
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    const base = href.replace(/\/$/, '');
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        {/* Served from the exported UI, so one path works in dev and packaged.
            Plain <img>: the Next.js optimizer needs a server, and there is none. */}
        <img className="sidebar-brand-mark" src="/logo.png" alt="" width={34} height={34} />
        <div>
          <div className="sidebar-brand-name">{strings.app.name}</div>
          <div className="sidebar-brand-sub">{strings.app.by}</div>
        </div>
      </div>

      {/* Which area this is. Without it, an owner glancing at the screen
          cannot tell admin from counter at a distance. */}
      <div className={`sidebar-area${isAdmin ? ' admin' : ''}`}>
        {isAdmin ? strings.admin.adminArea : strings.admin.counterArea}
      </div>

      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`nav-link${isActive(link.href) ? ' active' : ''}`}
        >
          {link.icon}
          {link.label}
        </Link>
      ))}

      {/* The one way between the two areas. On the counter it leads to a PIN;
          inside admin it ends the session and drops back to the till. */}
      {isAdmin ? (
        <button
          className="sidebar-admin exit"
          onClick={async () => {
            await exitAdmin();
            router.push(COUNTER_HOME);
          }}
        >
          <IconLock size={16} />
          <span>{strings.admin.exitAdmin}</span>
        </button>
      ) : (
        <button className="sidebar-admin" onClick={() => router.push(ADMIN_HOME)}>
          <IconShield size={16} />
          <span>{strings.admin.adminButton}</span>
        </button>
      )}

      {/* The theme switch. Sits with the other persistent controls at the
          foot rather than in Settings: a counter changes this when the light
          in the room changes, not when configuring the shop. */}
      <button
        className="sidebar-theme"
        onClick={() => void toggleTheme()}
        title={theme === 'dark' ? strings.theme.toLight : strings.theme.toDark}
      >
        {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        <span>{theme === 'dark' ? strings.theme.light : strings.theme.dark}</span>
      </button>

      {/* Who is on the counter. Present at all times so a cancellation can
          never be made under a name the person did not notice they were using. */}
      {staff ? (
        <div className="sidebar-staff">
          <div className="sidebar-staff-who">
            <span className="sidebar-staff-initial">{staff.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <div className="sidebar-staff-label">{strings.staff.signedInAs}</div>
              <div className="sidebar-staff-name">{staff.name}</div>
            </div>
          </div>
          <button className="sidebar-staff-out" onClick={() => void signOut()}>
            {strings.staff.signOut}
          </button>
        </div>
      ) : null}

      <div className="sidebar-foot">Works fully offline</div>
    </nav>
  );
}
