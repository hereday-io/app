import { Check, Circle, ExternalLink } from 'lucide-react';
import type { DealDetail } from '@/lib/crm/types';
import { fmtDate } from '@/lib/crm/format';
import { cn } from '@/lib/utils';

const SITE_URL = 'https://hereday.io';

interface Step {
  label: string;
  done: boolean;
  detail?: string | null;
}

/**
 * What Hereday itself knows about this deal, read live from the app's
 * tables: nobody types any of this, and it corrects itself after a
 * refund, a comp revoke or a transfer.
 */
const HeredayStatus = ({ detail }: { detail: DealDetail }) => {
  const { deal, events } = detail;
  const staffMaps = events.filter((e) => e.owner_is_staff);
  const customerMaps = events.filter((e) => !e.owner_is_staff);
  const firstPublished = events
    .map((e) => e.first_published_at)
    .filter(Boolean)
    .sort()[0];

  const steps: Step[] = [
    {
      label: 'Map built',
      done: deal.map_built,
      detail: events.length ? `${events.length} linked map${events.length === 1 ? '' : 's'}` : null,
    },
    { label: 'Map published', done: deal.map_published, detail: firstPublished ? fmtDate(firstPublished) : null },
    {
      label: 'Director signed up',
      done: !!deal.signed_up_at,
      detail: deal.signed_up_at ? fmtDate(deal.signed_up_at) : null,
    },
    { label: 'Handed off', done: !!deal.handed_off_at, detail: deal.handed_off_at ? fmtDate(deal.handed_off_at) : null },
    {
      label: 'Published in their account',
      done: deal.customer_published,
      detail: customerMaps.length ? `${customerMaps.length} map${customerMaps.length === 1 ? '' : 's'} in their account` : null,
    },
    {
      label: deal.comped && !deal.paid_at ? 'Pro (comped)' : 'Paid',
      done: !!deal.paid_at || deal.comped,
      detail: deal.paid_at ? fmtDate(deal.paid_at) : deal.refunded ? 'Refunded' : null,
    },
  ];

  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-[13px]">
            {s.done ? (
              <Check className="h-4 w-4 text-emerald-600 mt-px shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/40 mt-px shrink-0" />
            )}
            <span className={cn(s.done ? 'text-foreground' : 'text-muted-foreground')}>
              {s.label}
              {s.detail && <span className="text-muted-foreground"> · {s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      {events.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-3">
          {[...staffMaps, ...customerMaps].map((e) => (
            <li key={e.event_id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 truncate text-foreground">
                {e.name}
                <span className="text-muted-foreground">
                  {' '}
                  · {e.status === 'published' ? 'published' : 'draft'} ·{' '}
                  {e.owner_is_staff ? 'our account' : 'their account'}
                  {e.owner_email ? ` (${e.owner_email})` : ''}
                  {e.is_paid ? ' · paid' : e.is_comped ? ' · comped' : e.is_refunded ? ' · refunded' : ''}
                </span>
              </span>
              {e.slug && e.status === 'published' && (
                <a
                  href={`${SITE_URL}/event/${e.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default HeredayStatus;
