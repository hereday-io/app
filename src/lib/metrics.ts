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

const DAY_MS = 86_400_000;

/**
 * How much of a rolling N-day window, and the window before it, a data
 * source actually covers, given its earliest row. A source that started
 * mid-window would otherwise chart as nothing-then-traffic and inflate
 * any ratio against a full-window number (signups ÷ visitors).
 */
export function windowCoverage(
  firstSeen: string | null | undefined,
  days: number,
  now: Date = new Date(),
): { partial: boolean; prevPartial: boolean; startDay: string | null; coveredDays: number } {
  const start = firstSeen ? Date.parse(firstSeen) : NaN;
  if (!Number.isFinite(start)) {
    return { partial: false, prevPartial: false, startDay: null, coveredDays: days + 1 };
  }
  const windowStart = now.getTime() - days * DAY_MS;
  const partial = start > windowStart;
  // A day of slack: a quiet first morning in the prior window is not a
  // gap in tracking.
  const prevPartial = start > windowStart - days * DAY_MS + DAY_MS;
  const startDay = new Date(start).toISOString().slice(0, 10);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const coveredDays = partial
    ? Math.round((today.getTime() - Date.parse(startDay + 'T00:00:00Z')) / DAY_MS) + 1
    : days + 1;
  return { partial, prevPartial, startDay: partial ? startDay : null, coveredDays };
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
