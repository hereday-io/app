import { CreditCard, Gift, Globe, Map as MapIcon, Send, UserCheck } from 'lucide-react';
import type { Deal } from '@/lib/crm/types';
import { cn } from '@/lib/utils';

/**
 * A compact row of the app milestones the CRM reads from Hereday: map
 * built, map published, handed off, signed up, paid / comped. Lit icons
 * are facts from the database, not anything someone typed.
 */
const HeredayIcons = ({ deal }: { deal: Deal }) => {
  const items = [
    { on: deal.map_built, icon: MapIcon, label: 'Map built' },
    { on: deal.map_published || deal.customer_published, icon: Globe, label: 'Map published' },
    { on: !!deal.handed_off_at, icon: Send, label: 'Handed off to the director' },
    { on: !!deal.signed_up_at, icon: UserCheck, label: 'Director has a Hereday account' },
    deal.comped && !deal.paid_at
      ? { on: true, icon: Gift, label: 'Pro (comped)' }
      : { on: !!deal.paid_at, icon: CreditCard, label: deal.refunded && !deal.paid_at ? 'Refunded' : 'Paid' },
  ];
  return (
    <span className="inline-flex items-center gap-1">
      {items.map(({ on, icon: Icon, label }) => (
        <span key={label} title={`${label}${on ? '' : ' — not yet'}`} aria-label={`${label}: ${on ? 'yes' : 'no'}`}>
          <Icon className={cn('h-3.5 w-3.5', on ? 'text-emerald-600' : 'text-muted-foreground/30')} />
        </span>
      ))}
    </span>
  );
};

export default HeredayIcons;
