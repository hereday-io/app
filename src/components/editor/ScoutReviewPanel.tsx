import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Check, Trash2, MapPin, Compass } from 'lucide-react';
import type { RoutePoi } from '@/types/mapEditor';
import { poiTone } from '@/lib/pois';

/**
 * Scouted POIs are stored in `events.scouted_pois` with these extra
 * fields added by the server on submit. The editor's canonical
 * `RoutePoi` type doesn't know about them, so we keep a local extension
 * and strip the extras when accepting into `events.pois`.
 */
export interface ScoutedPoiRecord extends RoutePoi {
  scouted_at: string;
  scouted_via_token: string;
}

interface ScoutReviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scoutedPois: ScoutedPoiRecord[];
  /** Called when the user accepts a scouted POI. Caller is responsible
   *  for appending it to the event's regular `pois` array AND removing
   *  it from `scoutedPois`. Both state mutations flow through the
   *  editor's existing autosave path, so no new endpoint is needed. */
  onAccept: (poi: ScoutedPoiRecord) => void;
  /** Called when the user rejects a scouted POI. Caller removes it
   *  from `scoutedPois` only. */
  onReject: (poi: ScoutedPoiRecord) => void;
  /** Focus the main editor map on a specific coordinate. Used by the
   *  row click so organizers can orient themselves before accepting. */
  onFlyTo: (coord: [number, number]) => void;
}

function formatAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ScoutReviewPanel = ({
  open, onOpenChange, scoutedPois, onAccept, onReject, onFlyTo,
}: ScoutReviewPanelProps) => {
  const [confirmingAcceptAll, setConfirmingAcceptAll] = useState(false);

  // Newest first — most recently scouted is usually what the organizer
  // wants to act on first.
  const ordered = useMemo(
    () => [...scoutedPois].sort((a, b) => Date.parse(b.scouted_at) - Date.parse(a.scouted_at)),
    [scoutedPois],
  );

  const handleAcceptAll = () => {
    ordered.forEach((poi) => onAccept(poi));
    setConfirmingAcceptAll(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            Review scouted POIs
          </DialogTitle>
          <DialogDescription>
            Accept to add a POI to your event, or reject to discard it. Click any
            row to fly the map to its location.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-2">
          {ordered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nothing to review.
            </p>
          )}
          {ordered.map((poi) => {
            const tone = poiTone(poi.type);
            return (
              <div
                key={poi.id}
                className="rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition-colors"
              >
                <button
                  onClick={() => onFlyTo(poi.coordinates)}
                  className="w-full text-left flex items-start gap-3"
                >
                  <div className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center text-lg">
                    {tone.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-foreground truncate">{poi.title}</p>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {tone.label}
                      </span>
                    </div>
                    {poi.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {poi.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span className="font-mono">
                        {poi.coordinates[1].toFixed(5)}, {poi.coordinates[0].toFixed(5)}
                      </span>
                      <span>·</span>
                      <span>scouted {formatAgo(poi.scouted_at)}</span>
                    </div>
                  </div>
                </button>

                <div className="flex gap-1.5 mt-2 pl-12">
                  <button
                    onClick={() => onAccept(poi)}
                    className="flex-1 h-8 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </button>
                  <button
                    onClick={() => onReject(poi)}
                    className="flex-1 h-8 rounded-md text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {ordered.length > 1 && (
          <div className="shrink-0 pt-3 border-t border-border">
            {confirmingAcceptAll ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">
                  Accept all {ordered.length} scouted POIs?
                </p>
                <button
                  onClick={() => setConfirmingAcceptAll(false)}
                  className="h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAcceptAll}
                  className="h-8 px-3 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Yes, accept all
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingAcceptAll(true)}
                className="w-full h-9 rounded-md text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                Accept all {ordered.length}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ScoutReviewPanel;
