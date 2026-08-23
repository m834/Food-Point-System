/**
 * Inline SVG icons — drawn here rather than pulled from an icon package, so
 * nothing is downloaded and the bundle stays small. All inherit currentColor.
 */

type Props = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function IconDashboard({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconOrder({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4 4h16v3H4z" />
      <path d="M6 7v13h12V7" />
      <path d="M9 11h6M9 15h4" />
    </svg>
  );
}

export function IconTables({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="9" r="5" />
      <path d="M12 14v7M8 21h8" />
    </svg>
  );
}

export function IconMenu({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

export function IconReports({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4 20V9M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function IconSettings({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z" />
    </svg>
  );
}

export function IconFire({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8.3 1 .9 1.8 1.6 2.3 0-2.6.9-5.4 2-7.5Z" />
    </svg>
  );
}

export function IconPlus({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconTrash({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

export function IconPrint({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M7 9V3h10v6" />
      <rect x="4" y="9" width="16" height="7" rx="1.5" />
      <path d="M7 16h10v5H7z" />
    </svg>
  );
}

export function IconCheck({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function IconClose({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconReceipt({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}

export function IconSearch({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** Deals — a tagged bundle. Distinct at a glance from the plain menu list. */
export function IconDeal({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  );
}

/** Cancellations — a struck-through receipt. Distinct from plain Reports. */
export function IconCancel({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M6 2.8h9.5l3.7 3.7V21a1 1 0 0 1-1.5.85L15.5 20.5 13 22l-2.5-1.5L8 22l-2.2-1.15A1 1 0 0 1 4.5 20V4.3a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M8.5 9.5h7" />
      <path d="M8.5 13.5h7" />
    </svg>
  );
}

/** Sun — shown when the app is dark, offering the light theme. */
export function IconSun({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.4v2.2M12 19.4v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.4 12h2.2M19.4 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  );
}

/** Moon — shown when the app is light, offering the dark theme. */
export function IconMoon({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />
    </svg>
  );
}

/** Admin — a shield. The way in to the owner's area. */
export function IconShield({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M12 2.6 20 5.6v6c0 4.6-3.2 8.6-8 9.8-4.8-1.2-8-5.2-8-9.8v-6Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  );
}

/** Leaving admin — a closed padlock. */
export function IconLock({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="4.4" y="10.4" width="15.2" height="10.4" rx="2" />
      <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
    </svg>
  );
}

/** Customers — a person with a contact card. */
export function IconCustomers({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20.2a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.4 8.6h4.8M16.4 12h4.8" />
    </svg>
  );
}

/**
 * Open / close day — a sun on the horizon rather than a clock or a calendar.
 * The trading day this marks is a shift, not a date, and a calendar glyph
 * would suggest the opposite.
 */
export function IconDay({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M2.8 18.5h18.4" />
      <path d="M6.6 18.5a5.4 5.4 0 0 1 10.8 0" />
      <path d="M12 4.2v2.4M4.9 7.1l1.7 1.7M19.1 7.1l-1.7 1.7" />
    </svg>
  );
}
