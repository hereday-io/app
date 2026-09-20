import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { pctChange } from '@/lib/metrics';

/**
 * The shared vocabulary of the admin dashboard: a stat tile, a section
 * card, a period-over-period delta, and an empty state. Kept in one
 * place so /admin and any panel bolted onto it stay visually identical.
 * Number formatting lives in lib/metrics so this file exports only
 * components (fast refresh).
 */

interface DeltaProps {
  current: number;
  previous: number;
  /** For metrics where down is good — average search position, say. */
  invert?: boolean;
}

export const Delta = ({ current, previous, invert = false }: DeltaProps) => {
  const change = pctChange(current, previous);
  if (change === null) {
    return <span className="text-[11px] text-muted-foreground">no prior data</span>;
  }
  if (Math.abs(change) < 0.5) {
    return <span className="text-[11px] text-muted-foreground">flat vs prior period</span>;
  }
  const rising = change > 0;
  const good = invert ? !rising : rising;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`text-[11px] inline-flex items-center gap-0.5 font-medium ${
        good ? 'text-emerald-600' : 'text-rose-600'
      }`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(change).toFixed(0)}%
      <span className="text-muted-foreground font-normal ml-0.5">vs prior</span>
    </span>
  );
};

interface StatCardProps {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
  footer?: React.ReactNode;
}

export const StatCard = ({ icon: Icon, tint, label, value, footer }: StatCardProps) => (
  <Card className="p-4">
    <div className="flex items-center gap-2 mb-2">
      <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${tint}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
    <div className="text-3xl font-display font-bold text-foreground leading-none">{value}</div>
    {footer && <div className="mt-2 min-h-[16px]">{footer}</div>}
  </Card>
);

export const SectionCard = ({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Card className="p-6">
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display font-semibold text-lg leading-none">{title}</h2>
        {hint && <p className="text-[12.5px] text-muted-foreground mt-1.5 max-w-[80ch]">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </Card>
);

export const EmptyRow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[13px] text-muted-foreground py-6 text-center">{children}</p>
);
