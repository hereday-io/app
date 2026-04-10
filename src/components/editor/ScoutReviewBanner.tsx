import { Compass } from 'lucide-react';

interface ScoutReviewBannerProps {
  count: number;
  onReview: () => void;
}

/**
 * Slim banner shown under the editor top bar when the event has any
 * scouted POIs waiting for the organizer's review. The banner is the
 * primary entry point to `ScoutReviewPanel` — clicking "Review" opens
 * that modal.
 *
 * Rendered by RouteEditor when `scoutedPois.length > 0`. Hidden
 * otherwise — we don't surface an empty state since scout mode is
 * entirely opt-in.
 */
const ScoutReviewBanner = ({ count, onReview }: ScoutReviewBannerProps) => {
  if (count <= 0) return null;
  const label = count === 1 ? '1 scouted POI waiting for review' : `${count} scouted POIs waiting for review`;
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-amber-500/10 text-foreground">
      <Compass className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="flex-1 text-sm font-medium">{label}</p>
      <button
        onClick={onReview}
        className="h-8 px-3 rounded-md text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
      >
        Review
      </button>
    </div>
  );
};

export default ScoutReviewBanner;
