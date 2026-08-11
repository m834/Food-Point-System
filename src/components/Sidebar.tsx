'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './AppContext';
import { strings } from '@/lib/strings';
import {
  IconDashboard,
  IconMenu,
  IconOrder,
  IconReceipt,
  IconReports,
  IconSettings,
  IconTables,
} from './icons';

export function Sidebar() {
  const pathname = usePathname();
  const { tablesEnabled } = useApp();

  const links = [
    { href: '/', label: strings.nav.dashboard, icon: <IconDashboard /> },
    { href: '/order/', label: strings.nav.newOrder, icon: <IconOrder /> },
    { href: '/orders/', label: strings.nav.orders, icon: <IconReceipt /> },
    // A pure takeaway counter never sees this.
    ...(tablesEnabled ? [{ href: '/tables/', label: strings.nav.tables, icon: <IconTables /> }] : []),
    { href: '/menu/', label: strings.nav.menu, icon: <IconMenu /> },
    { href: '/reports/', label: strings.nav.reports, icon: <IconReports /> },
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

      <div className="sidebar-foot">Works fully offline</div>
    </nav>
  );
}
