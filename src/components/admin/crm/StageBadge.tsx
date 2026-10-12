import { Ban } from 'lucide-react';
import { STAGE_LABELS, OUTCOME_LABELS, type EffectiveStage, type Outcome } from '@/lib/crm/vocab';
import { cn } from '@/lib/utils';

const TONES: Record<EffectiveStage, string> = {
  new: 'bg-slate-100 text-slate-700',
  researched: 'bg-sky-50 text-sky-700',
  drafted: 'bg-sky-100 text-sky-800',
  sent: 'bg-indigo-50 text-indigo-700',
  followed_up: 'bg-indigo-100 text-indigo-800',
  replied: 'bg-amber-50 text-amber-800',
  closed: 'bg-muted text-muted-foreground',
  no_contact: 'bg-muted text-muted-foreground',
  signed_up: 'bg-emerald-50 text-emerald-700',
  published: 'bg-emerald-100 text-emerald-800',
  paid: 'bg-emerald-600 text-white',
};

interface StageBadgeProps {
  stage: EffectiveStage;
  outcome?: Outcome | null;
  dnc?: boolean;
  className?: string;
}

/** The deal's effective stage, its close reason, and a do-not-contact flag. */
const StageBadge = ({ stage, outcome, dnc, className }: StageBadgeProps) => (
  <span className={cn('inline-flex items-center gap-1 flex-wrap', className)}>
    <span className={cn('text-[11.5px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap', TONES[stage])}>
      {STAGE_LABELS[stage]}
      {stage === 'closed' && outcome && outcome !== 'do_not_contact' ? ` · ${OUTCOME_LABELS[outcome]}` : ''}
    </span>
    {dnc && (
      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 inline-flex items-center gap-0.5 whitespace-nowrap">
        <Ban className="h-3 w-3" />
        DNC
      </span>
    )}
  </span>
);

export default StageBadge;
