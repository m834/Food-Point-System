'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './AppContext';
import { strings } from '@/lib/strings';
import {
  IconDashboard,
  IconMenu,
  IconOrder,
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
    // A pure takeaway counter never sees this.
    ...(tablesEnabled ? [{ href: '/tables/', label: strings.nav.tables, icon: <IconTables /> }] : []),
    { href: '/menu/', label: strings.nav.menu, icon: <IconMenu /> },
    { href: '/reports/', label: strings.nav.reports, icon: <IconReports /> },
    { href: '/settings/', label: strings.nav.settings, icon: <IconSettings /> },
  ];

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href.replace(/\/$/, ''));

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">🍽</div>
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
