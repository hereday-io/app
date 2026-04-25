import { cn } from '@/lib/utils';

interface InfoCalloutProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function InfoCallout({ icon, title, children, className }: InfoCalloutProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl px-4 py-3.5 bg-[hsl(217_91%_50%/0.06)] border border-[hsl(217_91%_50%/0.18)]',
        className,
      )}
    >
      <div className="h-8 w-8 rounded-lg bg-white border border-[hsl(217_91%_50%/0.22)] flex items-center justify-center text-[hsl(217_91%_45%)] flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-display font-semibold text-[14px] text-foreground mb-[3px] tracking-[-0.005em]">
          {title}
        </div>
        <div className="text-[13px] text-[hsl(215_20%_35%)] leading-[1.55]">
          {children}
        </div>
      </div>
    </div>
  );
}
