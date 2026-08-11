/**
 * Display formatting. Everything money-shaped goes through here so a total
 * looks identical on the dashboard, the order panel and a report.
 */

let currency = 'Rs.';

/** Set once from settings when the app boots. */
export function setCurrency(symbol: string): void {
  currency = symbol || 'Rs.';
}

export function currencySymbol(): string {
  return currency;
}

/** `Rs.1,240.00` — grouped, two decimals, ready for tabular-nums. */
export function money(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return `${currency}${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole rupees, for tight spaces like a table card. */
export function moneyShort(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return `${currency}${Math.round(num).toLocaleString()}`;
}

/** "2" not "2.00", but a half portion keeps its half. */
export function qty(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Stored timestamps are "YYYY-MM-DD HH:MM:SS" in local time already. */
export function time(timestamp: string | null | undefined): string {
  if (!timestamp) return '';
  return timestamp.slice(11, 16);
}

export function dateOnly(timestamp: string | null | undefined): string {
  return timestamp ? timestamp.slice(0, 10) : '';
}

export function dateTime(timestamp: string | null | undefined): string {
  if (!timestamp) return '';
  return `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)}`;
}

/** "12 pm", "3 pm" — hour labels a person reads, not 24-hour codes. */
export function hourLabel(hour: number): string {
  if (hour === 0) return '12 am';
  if (hour === 12) return '12 pm';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** "just now", "12 min", "1 h 20 m" — how long a table has been sitting. */
export function since(timestamp: string): string {
  const started = new Date(timestamp.replace(' ', 'T')).getTime();
  if (!Number.isFinite(started)) return '';

  const minutes = Math.floor((Date.now() - started) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

export function todayIso(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function daysAgoIso(days: number): string {
  const then = new Date();
  then.setDate(then.getDate() - days);
  return [
    then.getFullYear(),
    String(then.getMonth() + 1).padStart(2, '0'),
    String(then.getDate()).padStart(2, '0'),
  ].join('-');
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
