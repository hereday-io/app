import { useState } from 'react';
import { Users, X, Eye } from 'lucide-react';
import type { RunnerPosition } from '@/types/mapEditor';

interface RunnerListPanelProps {
  runners: Map<string, RunnerPosition>;
  focusedRunnerId: string | null;
  onFocusRunner: (id: string | null) => void;
}

/** Convert m/s → min:sec /mi */
function formatPace(speed: number | null): string | null {
  if (speed == null || speed <= 0 || speed > 12.5) return null;
  const minPerMile = 26.8224 / speed;
  if (minPerMile > 30) return null;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')} /mi`;
}

const RunnerListPanel = ({ runners, focusedRunnerId, onFocusRunner }: RunnerListPanelProps) => {
  const [expanded, setExpanded] = useState(false);
  const count = runners.size;

  if (count === 0) return null;

  // Collapsed pill
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] px-3 py-2 text-xs font-medium text-foreground hover:bg-card/90 active:scale-95 transition-all"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <Users className="h-3.5 w-3.5" />
        {count} runner{count !== 1 ? 's' : ''} live
      </button>
    );
  }

  // Expanded panel
  const runnerList = Array.from(runners.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-card/90 backdrop-blur-xl rounded-2xl shadow-lg ring-1 ring-black/[0.06] w-56 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          {count} runner{count !== 1 ? 's' : ''} live
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Show all button (when one is focused) */}
      {focusedRunnerId && (
        <button
          onClick={() => onFocusRunner(null)}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors border-b border-border/50"
        >
          <Eye className="h-3 w-3" />
          Show all runners
        </button>
      )}

      {/* Runner list */}
      <div className="max-h-48 overflow-y-auto">
        {runnerList.map((runner) => {
          const isFocused = focusedRunnerId === runner.sessionId;
          const pace = formatPace(runner.speed);

          return (
            <button
              key={runner.sessionId}
              onClick={() => onFocusRunner(isFocused ? null : runner.sessionId)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 active:bg-muted transition-colors ${
                isFocused ? 'bg-primary/5' : ''
              }`}
            >
              {/* Color dot */}
              <span
                className="h-3 w-3 rounded-full shrink-0 ring-2 ring-white shadow-sm"
                style={{ background: runner.color }}
              />
              {/* Name + pace */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{runner.name}</div>
                {pace && (
                  <div className="text-[10px] text-muted-foreground">{pace}</div>
                )}
              </div>
              {/* Focus indicator */}
              {isFocused && (
                <span className="text-[10px] text-primary font-medium shrink-0">Focused</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RunnerListPanel;
