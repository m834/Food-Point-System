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

export function IconSearch({ size = 18 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
