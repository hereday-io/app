/** Number formatting, period-over-period math and chart axes for the admin dashboard. */

export const nf = new Intl.NumberFormat('en-US');

/**
 * Percent change between two periods. Returns null when the prior period
 * was zero and this one wasn't — that's an infinite increase, which the
 * UI should say rather than render as a number.
 */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function formatDay(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Day-count queries only return days that had rows. Rendering those
 * straight into a chart silently compresses quiet stretches, so rebuild
 * a continuous UTC axis across the whole window and fill gaps with 0.
 */
export function buildSeries(
  days: number,
  series: Record<string, Array<{ day: string; count: number }>>,
): Array<Record<string, string | number>> {
  const keys = Object.keys(series);
  const lookup: Record<string, Map<string, number>> = {};
  for (const k of keys) {
    lookup[k] = new Map(series[k].map((d) => [d.day, d.count]));
  }

  const out: Array<Record<string, string | number>> = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const row: Record<string, string | number> = { day: formatDay(iso) };
    for (const k of keys) row[k] = lookup[k].get(iso) ?? 0;
    out.push(row);
  }
  return out;
}
