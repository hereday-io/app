import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from 'date-fns';

/**
 * Date display for the CRM. Plain `YYYY-MM-DD` values (race dates, sent
 * dates, next steps) are calendar dates, not instants: parse them as
 * local dates so Nov 26 never renders as Nov 25 west of UTC.
 */

const asDate = (value: string): Date => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? parseISO(value) : new Date(value));

export const fmtDate = (value: string | null | undefined, pattern = 'MMM d, yyyy'): string =>
  value ? format(asDate(value), pattern) : '—';

export const fmtShort = (value: string | null | undefined): string => {
  if (!value) return '—';
  const d = asDate(value);
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy');
};

export const fmtDateTime = (value: string | null | undefined): string =>
  value ? format(asDate(value), "MMM d, yyyy 'at' h:mm a") : '—';

export const fmtAgo = (value: string | null | undefined): string =>
  value ? `${formatDistanceToNowStrict(asDate(value))} ago` : '—';

/** Days from today to a calendar date: negative when overdue. */
export const daysUntil = (value: string | null | undefined): number | null =>
  value ? differenceInCalendarDays(asDate(value), new Date()) : null;

/** `YYYY-MM-DD` for today in the browser's zone, for date inputs. */
export const todayIso = (): string => format(new Date(), 'yyyy-MM-dd');
