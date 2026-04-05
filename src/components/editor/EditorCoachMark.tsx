import { useEffect, useState } from 'react';
import { MousePointerClick, X } from 'lucide-react';

interface EditorCoachMarkProps {
  /** Unique key per user so the hint dismisses permanently. */
  userId: string;
  /** Dismiss the hint once the user has placed their first waypoint. */
  hasRouteWaypoints: boolean;
}

/**
 * A thin floating hint pill rendered above the map for first-time users.
 * Replaces the old 5-step EditorWelcomeModal that blocked the canvas.
 *
 * Dismisses on first waypoint placement, or when the user clicks the close
 * button. Once dismissed it is never shown again for this user.
 */
const EditorCoachMark = ({ userId, hasRouteWaypoints }: EditorCoachMarkProps) => {
  const storageKey = `editor-coachmark-seen-${userId}`;
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !window.localStorage.getItem(storageKey);
  });

  // Auto-dismiss once the user has actually started drawing.
  useEffect(() => {
    if (hasRouteWaypoints && visible) {
      window.localStorage.setItem(storageKey, '1');
      setVisible(false);
    }
  }, [hasRouteWaypoints, visible, storageKey]);

  if (!visible) return null;

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-4 z-30 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-card/90 backdrop-blur-xl border border-border shadow-lg max-w-[90vw]">
        <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <MousePointerClick className="h-3.5 w-3.5" />
        </div>
        <p className="text-sm text-foreground font-medium whitespace-nowrap">
          Click anywhere on the map to start your route
        </p>
        <button
          onClick={() => {
            window.localStorage.setItem(storageKey, '1');
            setVisible(false);
          }}
          className="shrink-0 w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default EditorCoachMark;
