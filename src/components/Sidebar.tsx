'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './AppContext';
import { strings } from '@/lib/strings';
import {
  IconCancel,
  IconDashboard,
  IconDeal,
  IconMenu,
  IconOrder,
  IconReceipt,
  IconReports,
  IconSettings,
  IconTables,
} from './icons';

export function Sidebar() {
  const pathname = usePathname();
  const { tablesEnabled, staff, signOut } = useApp();

  const links = [
    { href: '/', label: strings.nav.dashboard, icon: <IconDashboard /> },
    { href: '/order/', label: strings.nav.newOrder, icon: <IconOrder /> },
    { href: '/orders/', label: strings.nav.orders, icon: <IconReceipt /> },
    // A pure takeaway counter never sees this.
    ...(tablesEnabled ? [{ href: '/tables/', label: strings.nav.tables, icon: <IconTables /> }] : []),
    { href: '/menu/', label: strings.nav.menu, icon: <IconMenu /> },
    { href: '/deals/', label: strings.nav.deals, icon: <IconDeal /> },
    { href: '/reports/', label: strings.nav.reports, icon: <IconReports /> },
    { href: '/cancellations/', label: strings.nav.cancellations, icon: <IconCancel /> },
    { href: '/settings/', label: strings.nav.settings, icon: <IconSettings /> },
  ];

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
