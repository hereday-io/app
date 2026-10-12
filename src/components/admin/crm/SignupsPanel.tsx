import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyRow, SectionCard } from '@/components/admin/AdminStats';
import { useSignups } from '@/hooks/crm/useCrm';
import type { Signup, SignupEvent, SignupScope } from '@/lib/crm/types';
import { fmtShort } from '@/lib/crm/format';
import { cn } from '@/lib/utils';
import TriageDialog from './TriageDialog';

const SITE_URL = 'https://hereday.io';

const SCOPES: Array<{ value: SignupScope; label: string; hint: string }> = [
  {
    value: 'untriaged',
    label: 'To triage',
    hint: "Hereday accounts with a map that isn't tied to any deal. Every one is a customer or a test; decide which.",
  },
  { value: 'all', label: 'All customers', hint: 'Every non-staff account that has made a map, linked or not.' },
  {
    value: 'staff_maps',
    label: 'Our unlinked maps',
    hint: "Maps built in staff accounts with no deal. Usually a hereday_link nobody pasted, or a test to dismiss.",
  },
];

const EventLine = ({ ev, onTriage }: { ev: SignupEvent; onTriage?: () => void }) => (
  <li className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
    <span className="min-w-0">
      <span className="text-foreground">{ev.name}</span>
      <span className="text-muted-foreground">
        {' '}
        · {ev.status}
        {ev.event_date ? ` · ${fmtShort(ev.event_date)}` : ''}
        {ev.is_paid ? ' · paid' : ev.is_comped ? ' · comped' : ''}
        {ev.disposition === 'linked' && ev.deal_race_name ? ` · linked to ${ev.deal_race_name}` : ''}
        {ev.disposition === 'dismissed' ? ` · dismissed (${ev.dismiss_reason})` : ''}
      </span>
    </span>
    <span className="flex items-center gap-2 shrink-0">
      {ev.slug && ev.status === 'published' && (
        <a
          href={`${SITE_URL}/event/${ev.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`View ${ev.name}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {onTriage && !ev.disposition && (
        <Button size="sm" variant="outline" className="h-7" onClick={onTriage}>
          Triage
        </Button>
      )}
    </span>
  </li>
);

const SignupsPanel = ({ onOpenDeal }: { onOpenDeal: (slug: string) => void }) => {
  const [scope, setScope] = useState<SignupScope>('untriaged');
  const { data = [], isLoading, error } = useSignups(scope, true);
  const [target, setTarget] = useState<{ signup: Signup; event: SignupEvent } | null>(null);
  const current = SCOPES.find((s) => s.value === scope)!;

  return (
    <SectionCard
      title="Signups"
      hint={current.hint}
      action={
        <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => setScope(s.value)}
              className={cn(
                'px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap',
                scope === s.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.length === 0 ? (
        <EmptyRow>{scope === 'untriaged' ? 'Nothing to triage. Every map is accounted for.' : 'None.'}</EmptyRow>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((s) => (
            <li key={s.user_id} className="py-3">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-[14px] font-medium text-foreground">
                  {s.display_name || s.email}
                  <span className="font-normal text-muted-foreground">
                    {s.display_name ? ` · ${s.email}` : ''}
                    {s.organization_name ? ` · ${s.organization_name}` : ''}
                  </span>
                </p>
                <span className="text-[11.5px] text-muted-foreground">
                  joined {fmtShort(s.signed_up_at)}
                  {s.utm_source ? ` · via ${s.utm_source}` : s.first_referrer ? ` · from ${s.first_referrer.replace(/^https?:\/\//, '').split('/')[0]}` : ''}
                </span>
              </div>
              {s.suggestions.length > 0 && scope !== 'staff_maps' && (
                <p className="text-[12px] text-emerald-700 mt-0.5">
                  Possible match:{' '}
                  {s.suggestions.map((m, i) => (
                    <span key={m.deal_id}>
                      {i > 0 && ', '}
                      <button type="button" className="underline hover:no-underline" onClick={() => onOpenDeal(m.slug)}>
                        {m.race_name}
                      </button>
                    </span>
                  ))}
                </p>
              )}
              <ul className="mt-1">
                {s.events.map((ev) => (
                  <EventLine key={ev.event_id} ev={ev} onTriage={() => setTarget({ signup: s, event: ev })} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <TriageDialog
        signup={target?.signup ?? null}
        event={target?.event ?? null}
        onOpenChange={(o) => !o && setTarget(null)}
        onCreated={onOpenDeal}
      />
    </SectionCard>
  );
};

export default SignupsPanel;
