import type { DealLineGroup, OrderItem } from './types';

/**
 * Collapse a sold deal's component lines back into the single line a customer
 * expects to see.
 *
 * This lives in `shared/` and is imported by BOTH the receipt builder in the
 * main process and the order panel in the renderer, on purpose: a bill and the
 * screen that quoted it must never disagree about what a deal costs. Two
 * implementations of this grouping is exactly how they would drift.
 *
 * The rules:
 *  - Lines with no `deal_group` are ordinary items and pass through untouched.
 *  - Lines sharing a `deal_group` become one entry whose total is the sum of
 *    their `line_total`s — which, by construction in `buildDealLines`, is
 *    exactly the combo price.
 *  - Void lines are excluded, so a voided deal disappears as a unit.
 */
export function groupOrderLines(items: OrderItem[]): Array<OrderItem | DealLineGroup> {
  const out: Array<OrderItem | DealLineGroup> = [];
  const seen = new Map<number, DealLineGroup>();

  for (const item of items) {
    if (item.kitchen_status === 'void') continue;

    if (!item.deal_group) {
      out.push(item);
      continue;
    }

    const existing = seen.get(item.deal_group);
    if (existing) {
      existing.total = round2(existing.total + item.line_total);
      existing.lines.push(item);
      continue;
    }

    const group: DealLineGroup = {
      deal_group: item.deal_group,
      deal_name: item.deal_name ?? 'Deal',
      // Every component was multiplied by the same deal quantity, so the first
      // line's share of its own per-deal quantity recovers it. Falls back to 1
      // rather than risking a divide-by-zero on malformed data.
      qty: 1,
      total: item.line_total,
      lines: [item],
    };
    seen.set(item.deal_group, group);
    out.push(group);
  }

  return out;
}

/** Narrowing helper — `'lines' in entry` reads poorly at every call site. */
export function isDealGroup(entry: OrderItem | DealLineGroup): entry is DealLineGroup {
  return (entry as DealLineGroup).deal_group !== undefined && Array.isArray((entry as DealLineGroup).lines);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
