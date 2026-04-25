import { cn } from '@/lib/utils';

export type EventChipKind = 'live' | 'draft' | 'pro' | 'free' | 'past';

const KIND_STYLES: Record<EventChipKind, string> = {
  live: 'bg-[hsl(152_60%_42%)] text-white',
  draft: 'bg-[hsl(210_15%_93%)] text-[hsl(215_20%_45%)]',
  pro: 'bg-[hsl(217_91%_50%/0.1)] text-[hsl(217_91%_40%)] border border-[hsl(217_91%_50%/0.2)]',
  free: 'bg-[hsl(45_93%_94%)] text-[hsl(32_65%_35%)]',
  past: 'bg-[hsl(210_15%_93%)] text-[hsl(215_20%_45%)]',
};

interface EventChipProps {
  kind: EventChipKind;
  children: React.ReactNode;
  className?: string;
}

export function EventChip({ kind, children, className }: EventChipProps) {
  return (
    <span
      className={cn(
        'font-display font-semibold text-[9.5px] uppercase tracking-[0.07em] rounded-full px-2 py-0.5 inline-flex items-center gap-[5px] whitespace-nowrap',
        KIND_STYLES[kind],
        className,
      )}
    >
      {kind === 'live' && <span className="h-1 w-1 rounded-full bg-white" />}
      {children}
    </span>
  );
}
