import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import type { TimelineItem } from '@/lib/crm/types';
import { fmtDateTime } from '@/lib/crm/format';
import { ACTIVITY_LABELS, OUTCOME_LABELS, STAGE_LABELS, type Outcome, type Stage } from '@/lib/crm/vocab';
import { cn } from '@/lib/utils';

const describe = (item: TimelineItem): string | null => {
  const m = item.meta ?? {};
  if (item.type === 'stage_change') {
    const from = STAGE_LABELS[m.from as Stage] ?? String(m.from ?? '');
    const to = STAGE_LABELS[m.to as Stage] ?? String(m.to ?? '');
    const outcome = m.outcome ? ` (${OUTCOME_LABELS[m.outcome as Outcome] ?? m.outcome})` : '';
    return `${from} → ${to}${outcome}`;
  }
  if (item.type === 'app_purchase' || item.type === 'app_refund') {
    const cents = Number(m.amount_total);
    if (Number.isFinite(cents)) {
      const currency = String(m.currency ?? 'usd').toUpperCase();
      return `${(cents / 100).toLocaleString('en-US', { style: 'currency', currency })}${m.promo_code ? ` · ${m.promo_code}` : ''}`;
    }
  }
  if (item.type === 'claim' && m.took_over_expired) return 'Took over an expired claim';
  if (item.meta?.synthetic) return 'From the imported tracker';
  return null;
};

interface DealTimelineProps {
  items: TimelineItem[];
  canVoid: boolean;
}

/** Newest first. Customer quotes are shown verbatim; app facts are muted. */
const DealTimeline = ({ items, canVoid }: DealTimelineProps) => {
  const { toast } = useToast();
  const voidActivity = useCrmAction('crm_void_activity');
  const [voiding, setVoiding] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">Nothing logged yet.</p>;
  }

  const handleVoid = (id: string) => {
    const reason = window.prompt('Why void this entry? It stays in the history, struck through.');
    if (!reason?.trim()) return;
    setVoiding(id);
    voidActivity.mutate(
      { p_activity_id: id, p_reason: reason.trim() },
      {
        onSettled: () => setVoiding(null),
        onError: (e) => toast({ title: "Couldn't void it", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <ol className="space-y-3">
      {items.map((item) => {
        const app = item.source === 'app';
        const voided = !!item.voided_at;
        const extra = describe(item);
        return (
          <li key={item.id} className={cn('border-l-2 pl-3', app ? 'border-emerald-200' : 'border-border')}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span className={cn('text-[13px] font-medium', app ? 'text-emerald-800' : 'text-foreground', voided && 'line-through opacity-60')}>
                {ACTIVITY_LABELS[item.type] ?? item.type}
                {extra && <span className="font-normal text-muted-foreground"> · {extra}</span>}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {fmtDateTime(item.occurred_at)}
                {item.actor_name ? ` · ${item.actor_name}` : app ? ' · Hereday' : ''}
              </span>
            </div>
            {item.quote && (
              <blockquote className={cn('mt-1 border-l-2 border-amber-300 bg-amber-50/60 pl-2 py-1 text-[13px] text-foreground italic whitespace-pre-wrap', voided && 'opacity-60')}>
                “{item.quote}”
              </blockquote>
            )}
            {item.body && (
              <p className={cn('mt-1 text-[13px] text-muted-foreground whitespace-pre-wrap', voided && 'line-through opacity-60')}>
                {item.body}
              </p>
            )}
            {voided && <p className="text-[11.5px] text-muted-foreground mt-0.5">Voided: {item.void_reason}</p>}
            {canVoid && !app && !voided && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-[11.5px] text-muted-foreground"
                disabled={voiding === item.id}
                onClick={() => handleVoid(item.id)}
              >
                Void
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default DealTimeline;
