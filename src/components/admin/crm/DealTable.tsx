import { Check } from 'lucide-react';
import type { Deal } from '@/lib/crm/types';
import { daysUntil, fmtAgo, fmtShort } from '@/lib/crm/format';
import { cn } from '@/lib/utils';
import StageBadge from './StageBadge';
import HeredayIcons from './HeredayIcons';

const NextStep = ({ deal }: { deal: Deal }) => {
  if (!deal.next_step_at) return <span className="text-muted-foreground">—</span>;
  const days = daysUntil(deal.next_step_at) ?? 0;
  const overdue = deal.is_due;
  return (
    <span className={cn('whitespace-nowrap', overdue ? 'text-rose-600 font-medium' : 'text-foreground')}>
      {fmtShort(deal.next_step_at)}
      <span className="text-muted-foreground font-normal text-[11.5px] ml-1">
        {days === 0 ? 'today' : days < 0 ? `${-days}d late` : `in ${days}d`}
      </span>
    </span>
  );
};

const Owner = ({ deal }: { deal: Deal }) => {
  if (!deal.owner_id) return <span className="text-muted-foreground italic">Unclaimed</span>;
  const days = daysUntil(deal.claim_expires_at);
  return (
    <span className="whitespace-nowrap">
      <span className={deal.is_mine ? 'font-medium text-foreground' : 'text-foreground'}>
        {deal.is_mine ? 'You' : deal.owner_name}
      </span>
      {deal.claim_open ? (
        <span className="block text-[11px] text-amber-700">claim expired</span>
      ) : days !== null ? (
        <span className="block text-[11px] text-muted-foreground">claim ends in {Math.max(days, 0)}d</span>
      ) : null}
    </span>
  );
};

interface DealTableProps {
  deals: Deal[];
  onOpen: (slug: string) => void;
}

const DealTable = ({ deals, onOpen }: DealTableProps) => (
  <div className="overflow-x-auto -mx-6 px-6">
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
          <th className="py-2 pr-3 font-medium">Race</th>
          <th className="py-2 pr-3 font-medium">Stage</th>
          <th className="py-2 pr-3 font-medium">Owner</th>
          <th className="py-2 pr-3 font-medium">Next step</th>
          <th className="py-2 pr-3 font-medium hidden md:table-cell">Hereday</th>
          <th className="py-2 pr-3 font-medium hidden lg:table-cell text-right">Tier</th>
          <th className="py-2 font-medium hidden lg:table-cell text-right">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => (
          <tr
            key={d.id}
            onClick={() => onOpen(d.slug)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(d.slug);
            }}
            tabIndex={0}
            className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none align-top"
          >
            <td className="py-2.5 pr-3 min-w-[200px]">
              <span className="font-medium text-foreground">{d.race_name}</span>
              <span className="block text-[11.5px] text-muted-foreground">
                {[d.town, d.race_date ? fmtShort(d.race_date) : null].filter(Boolean).join(' · ') || d.slug}
                {d.race_date && d.date_verified && (
                  <Check className="inline h-3 w-3 ml-0.5 -mt-0.5 text-emerald-600" aria-label="Date verified" />
                )}
              </span>
            </td>
            <td className="py-2.5 pr-3">
              <StageBadge stage={d.effective_stage} outcome={d.outcome} dnc={d.is_dnc} />
              {d.fit_flags.length > 0 && (
                <span className="block text-[11px] text-amber-700 mt-0.5">fit concern</span>
              )}
            </td>
            <td className="py-2.5 pr-3">
              <Owner deal={d} />
            </td>
            <td className="py-2.5 pr-3">
              <NextStep deal={d} />
            </td>
            <td className="py-2.5 pr-3 hidden md:table-cell">
              <HeredayIcons deal={d} />
            </td>
            <td className="py-2.5 pr-3 hidden lg:table-cell text-right tabular-nums text-muted-foreground">
              {d.tier ?? '—'}
            </td>
            <td className="py-2.5 hidden lg:table-cell text-right text-muted-foreground whitespace-nowrap">
              {fmtAgo(d.last_activity_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default DealTable;
