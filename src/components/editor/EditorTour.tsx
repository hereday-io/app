import { useState, useEffect, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TourStep {
  target: string; // CSS selector
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="sidebar-routes"]',
    title: 'Your routes live here',
    content: 'Add routes, name them, and pick colors. Most events start with one.',
    placement: 'right',
  },
  {
    target: '[data-tour="map-area"]',
    title: 'Draw your course',
    content: 'Click to place points — your route follows the road automatically.',
    placement: 'left',
  },
  {
    target: '[data-tour="snap-toggle"]',
    title: 'Road mode vs. off-road',
    content: 'On by default: your route hugs the road. Turn it off for trails or cross-country.',
    placement: 'right',
  },
  {
    target: '[data-tour="poi-section"]',
    title: 'Drop markers',
    content: 'Pick a type, click the map. Water stations, parking, aid — whatever runners need to find.',
    placement: 'right',
  },
  {
    target: '[data-tour="save-button"]',
    title: 'You\'re covered',
    content: 'Your work autosaves. Come back anytime from the dashboard.',
    placement: 'bottom',
  },
];

interface EditorTourProps {
  active: boolean;
  onEnd: () => void;
}

const EditorTour = ({ active, onEnd }: EditorTourProps) => {
  const [step, setStep] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const positionTooltip = useCallback(() => {
    if (!active) return;
    const currentStep = TOUR_STEPS[step];
    const el = document.querySelector(currentStep.target);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    setHighlightRect(rect);

    const tooltipWidth = 300;
    const tooltipHeight = 160;
    const gap = 12;

    let top = 0;
    let left = 0;
    const placement = currentStep.placement ?? 'bottom';

    switch (placement) {
      case 'right':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + gap;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - gap;
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        top = rect.top - tooltipHeight - gap;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
    }

    // Clamp within viewport
    top = Math.max(8, Math.min(top, window.innerHeight - tooltipHeight - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));

    setPosition({ top, left });
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    return () => window.removeEventListener('resize', positionTooltip);
  }, [active, positionTooltip]);

  useEffect(() => {
    if (active) {
      // Small delay to let layout settle
      const timer = setTimeout(positionTooltip, 100);
      return () => clearTimeout(timer);
    }
  }, [active, step, positionTooltip]);

  if (!active) return null;

  const currentStep = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <>
      {/* Semi-transparent overlay with cutout */}
      <div className="fixed inset-0 z-[9998]" style={{ pointerEvents: 'none' }}>
        <svg className="w-full h-full" style={{ pointerEvents: 'auto' }}>
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              {highlightRect && (
                <rect
                  x={highlightRect.left - 4}
                  y={highlightRect.top - 4}
                  width={highlightRect.width + 8}
                  height={highlightRect.height + 8}
                  rx={8}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.5)"
            mask="url(#tour-mask)"
            onClick={onEnd}
          />
        </svg>
      </div>

      {/* Highlight border */}
      {highlightRect && (
        <div
          className="fixed z-[9999] rounded-lg border-2 border-primary pointer-events-none"
          style={{
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
            boxShadow: '0 0 0 4px hsl(var(--primary) / 0.2)',
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="fixed z-[10000] w-[300px] bg-card border border-border rounded-xl shadow-xl p-4"
        style={{ top: position.top, left: position.left }}
      >
        <div className="flex items-start justify-between mb-2">
          <h4 className="font-display font-bold text-sm text-foreground">{currentStep.title}</h4>
          <button onClick={onEnd} aria-label="End tour" className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{currentStep.content}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{step + 1} / {TOUR_STEPS.length}</span>
          <div className="flex gap-1.5">
            {!isFirst && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setStep(step - 1)}>
                <ChevronLeft className="h-3 w-3 mr-0.5" /> Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" className="h-7 text-xs" onClick={onEnd}>
                Done
              </Button>
            ) : (
              <Button size="sm" className="h-7 text-xs" onClick={() => setStep(step + 1)}>
                Next <ChevronRight className="h-3 w-3 ml-0.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default EditorTour;
