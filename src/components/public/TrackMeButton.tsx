import { useState, useMemo } from 'react';
import { MapPin, Square, Loader2, Navigation, Clock } from 'lucide-react';
import { useTracking } from '@/hooks/useTracking';

/** Convert m/s to min:sec /mi string. Returns null if speed isn't usable. */
function formatPace(speed: number | null): string | null {
  if (speed == null || speed <= 0 || speed > 12.5) return null;
  const minPerMile = 26.8224 / speed;
  if (minPerMile > 30) return null;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')} /mi`;
}

interface TrackMeButtonProps {
  eventId: string;
  trackingStart: string | null;
  trackingEnd: string | null;
}

type WindowStatus = 'not-configured' | 'too-early' | 'open' | 'closed';

function getWindowStatus(start: string | null, end: string | null): WindowStatus {
  if (!start || !end) return 'not-configured';
  const now = Date.now();
  if (now < new Date(start).getTime()) return 'too-early';
  if (now > new Date(end).getTime()) return 'closed';
  return 'open';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const TrackMeButton = ({ eventId, trackingStart, trackingEnd }: TrackMeButtonProps) => {
  const { isTracking, error, position, startTracking, stopTracking } = useTracking(eventId);
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [name, setName] = useState('');
  const [starting, setStarting] = useState(false);

  const windowStatus = useMemo(
    () => getWindowStatus(trackingStart, trackingEnd),
    [trackingStart, trackingEnd],
  );

  const handleStart = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Double-check window before hitting DB (the RLS policy is the real gate)
    if (getWindowStatus(trackingStart, trackingEnd) !== 'open') return;
    setStarting(true);
    await startTracking(trimmed);
    setStarting(false);
    setShowNameEntry(false);
  };

  // ── Tracking active ──
  if (isTracking) {
    return (
      <div className="absolute bottom-[calc(45vh+16px)] left-3 z-20 flex flex-col gap-2 items-start">
        {/* Status pill */}
        <div className="flex items-center gap-2 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] px-3 py-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-xs font-medium text-foreground">Tracking</span>
          {position && (
            <span className="text-[10px] text-muted-foreground">
              {formatPace(position.speed) && (
                <>{formatPace(position.speed)} · </>
              )}
              ±{Math.round(position.accuracy)}m
            </span>
          )}
        </div>

        {/* Stop button */}
        <button
          onClick={stopTracking}
          className="flex items-center gap-1.5 rounded-full bg-destructive/90 backdrop-blur-xl text-destructive-foreground shadow-lg px-3 py-2 text-xs font-semibold hover:bg-destructive active:scale-95 transition-all"
        >
          <Square className="h-3 w-3" />
          Stop tracking
        </button>

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-xs px-3 py-2 max-w-[200px]">
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Window not open — show status message ──
  if (windowStatus === 'not-configured') {
    // Organizer hasn't set tracking times yet — hide button entirely
    return null;
  }

  if (windowStatus === 'too-early') {
    return (
      <div className="absolute bottom-[calc(45vh+16px)] left-3 z-20">
        <div className="flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] px-3 py-2.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Tracking opens {formatDateTime(trackingStart!)}
        </div>
      </div>
    );
  }

  if (windowStatus === 'closed') {
    return (
      <div className="absolute bottom-[calc(45vh+16px)] left-3 z-20">
        <div className="flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] px-3 py-2.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          Tracking has ended
        </div>
      </div>
    );
  }

  // ── Name entry ──
  if (showNameEntry) {
    return (
      <div className="absolute bottom-[calc(45vh+16px)] left-3 z-20">
        <div className="bg-card/90 backdrop-blur-xl rounded-2xl shadow-lg ring-1 ring-black/[0.06] p-3 w-56">
          <p className="text-xs font-semibold text-foreground mb-2">Enter your name</p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            placeholder="e.g. Kevin P."
            maxLength={50}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setShowNameEntry(false)}
              className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={!name.trim() || starting}
              className="flex-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              {starting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Navigation className="h-3 w-3" />
              )}
              Go
            </button>
          </div>

          {error && (
            <p className="text-xs text-destructive mt-2">{error}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Idle — show "Track me" button ──
  return (
    <div className="absolute bottom-[calc(45vh+16px)] left-3 z-20">
      <button
        onClick={() => setShowNameEntry(true)}
        className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/20 px-4 py-2.5 text-xs font-semibold hover:bg-primary/90 active:scale-95 transition-all"
      >
        <MapPin className="h-3.5 w-3.5" />
        Track me
      </button>
    </div>
  );
};

export default TrackMeButton;
