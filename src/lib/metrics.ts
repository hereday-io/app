/** Number formatting and period-over-period math for the admin dashboard. */

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
