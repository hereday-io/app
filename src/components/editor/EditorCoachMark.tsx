import { useEffect, useState } from 'react';
import { MousePointerClick, Globe, X } from 'lucide-react';

interface EditorCoachMarkProps {
  /** Unique key per user so the hint dismisses permanently. */
  userId: string;
  /** Dismiss the draw hint once the user has placed their first waypoint. */
  hasRouteWaypoints: boolean;
  /** Show publish hint once a route is finished and event isn't published. */
  hasFinishedRoute?: boolean;
  /** Already published — suppress the publish hint. */
  isPublished?: boolean;
}

/**
 * A thin floating hint pill rendered above the map for first-time users.
 *
 * Phase 1: "Click anywhere on the map to start your route"
 *   — dismisses on first waypoint or X click, never shown again.
 *
 * Phase 2: "Hit Publish when you're ready to share"
 *   — shown after route finishes (if not published), dismisses on publish
 *     or X click, never shown again.
 */
const EditorCoachMark = ({ userId, hasRouteWaypoints, hasFinishedRoute, isPublished }: EditorCoachMarkProps) => {
  const drawKey = `editor-coachmark-seen-${userId}`;
  const publishKey = `editor-coachmark-publish-seen-${userId}`;

  const [drawVisible, setDrawVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !window.localStorage.getItem(drawKey);
  });

  const [publishVisible, setPublishVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !window.localStorage.getItem(publishKey);
  });

  // Auto-dismiss draw hint once the user has started drawing.
  useEffect(() => {
    if (hasRouteWaypoints && drawVisible) {
      window.localStorage.setItem(drawKey, '1');
      setDrawVisible(false);
    }
  }, [hasRouteWaypoints, drawVisible, drawKey]);

  // Auto-dismiss publish hint once the event is published.
  useEffect(() => {
    if (isPublished && publishVisible) {
      window.localStorage.setItem(publishKey, '1');
      setPublishVisible(false);
    }
  }, [isPublished, publishVisible, publishKey]);

  // Phase 1: draw hint
  if (drawVisible) {
    return (
      <div className="absolute left-1/2 -translate-x-1/2 top-4 z-30 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-500">
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-card/90 backdrop-blur-xl border border-border shadow-lg max-w-[90vw]">
          <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <MousePointerClick className="h-3.5 w-3.5" />
          </div>
          <p className="text-sm text-foreground font-medium whitespace-nowrap">
            Click on the map to place your first waypoint
          </p>
          <button
            onClick={() => {
              window.localStorage.setItem(drawKey, '1');
              setDrawVisible(false);
            }}
            className="shrink-0 w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Phase 2: publish hint — only after route finished, not yet published
  if (publishVisible && hasFinishedRoute && !isPublished) {
    return (
      <div className="absolute left-1/2 -translate-x-1/2 top-4 z-30 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-500">
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-card/90 backdrop-blur-xl border border-border shadow-lg max-w-[90vw]">
          <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Globe className="h-3.5 w-3.5" />
          </div>
          <p className="text-sm text-foreground font-medium whitespace-nowrap">
            Hit Publish when you're ready to share
          </p>
          <button
            onClick={() => {
              window.localStorage.setItem(publishKey, '1');
              setPublishVisible(false);
            }}
            className="shrink-0 w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default EditorCoachMark;
