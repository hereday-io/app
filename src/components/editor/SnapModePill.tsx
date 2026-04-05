import { Route, PenLine } from 'lucide-react';

interface SnapModePillProps {
  snapToRoads: boolean;
  onToggle: (v: boolean) => void;
}

/**
 * Floating segmented control that lives over the map canvas. Shows the
 * current draw mode at all times — Snap to roads or Freeform — regardless
 * of whether the sidebar is open. Keyboard shortcut: "S".
 */
const SnapModePill = ({ snapToRoads, onToggle }: SnapModePillProps) => {
  return (
    <div
      className="absolute left-4 top-4 z-20 flex items-center rounded-full bg-card/90 backdrop-blur-xl border border-border shadow-lg p-1 gap-0.5 pointer-events-auto"
      data-tour="snap-pill"
    >
      <button
        onClick={() => onToggle(true)}
        title="Snap to roads (S)"
        className={`flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold transition-all ${
          snapToRoads
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Route className="h-3.5 w-3.5" />
        Snap
      </button>
      <button
        onClick={() => onToggle(false)}
        title="Freeform drawing (S)"
        className={`flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold transition-all ${
          !snapToRoads
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <PenLine className="h-3.5 w-3.5" />
        Freeform
      </button>
      <kbd className="ml-1 mr-1 text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded font-mono">S</kbd>
    </div>
  );
};

export default SnapModePill;
