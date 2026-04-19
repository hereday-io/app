import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Loader2, Radio } from 'lucide-react';
import type { PoiStatusState, RoutePoi } from '@/types/mapEditor';
import {
  resolveStatusToken,
  updatePoiStatus,
  type PoiStatusSnapshot,
  type ResolvedStatusEvent,
} from '@/lib/statusApi';
import { poiTone } from '@/lib/pois';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/analytics';

/**
 * Volunteer status page — tokenized, no login. Mounted at /v/:token.
 *
 * The URL IS the authorization. Volunteers see the POI list for an
 * event, tap a status button, optionally leave a note, and the public
 * map updates in real time via the postgres_changes subscription the
 * public views set up.
 *
 * Mobile-first: giant tappable buttons, minimum UI chrome, state
 * survives a network blip (optimistic update + reconcile on
 * confirmation). Desktop is supported but not optimized.
 */

const STATES: Array<{
  state: PoiStatusState;
  label: string;
  description: string;
  colorClass: string;
  activeClass: string;
}> = [
  {
    state: 'open',
    label: 'Open',
    description: 'Fully operational',
    colorClass: 'bg-emerald-500',
    activeClass: 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/30',
  },
  {
    state: 'low',
    label: 'Low',
    description: 'Running out of supplies',
    colorClass: 'bg-amber-500',
    activeClass: 'bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/30',
  },
  {
    state: 'closed',
    label: 'Closed',
    description: 'Not operational right now',
    colorClass: 'bg-red-500',
    activeClass: 'bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/30',
  },
  {
    state: 'moved',
    label: 'Moved',
    description: 'Location has changed',
    colorClass: 'bg-blue-500',
    activeClass: 'bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-500/30',
  },
];

const VOLUNTEER_NAME_KEY = 'hereday-volunteer-name';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

const VolunteerStatusPage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [resolved, setResolved] = useState<ResolvedStatusEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, PoiStatusSnapshot>>({});
  const [savingPoiId, setSavingPoiId] = useState<string | null>(null);
  const [volunteerName, setVolunteerName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(VOLUNTEER_NAME_KEY) ?? '';
  });
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) {
      setLoadError('Missing status token');
      return;
    }
    let cancelled = false;
    resolveStatusToken(token)
      .then((data) => {
        if (cancelled) return;
        setResolved(data);
        setStatuses(data.statuses ?? {});
        logEvent('volunteer_page_opened', data.eventId, { status: data.status });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message || 'Failed to load event');
      });
    return () => { cancelled = true; };
  }, [token]);

  // Persist volunteer name across reloads — volunteers working a long
  // shift shouldn't have to re-type on every refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (volunteerName) {
      window.localStorage.setItem(VOLUNTEER_NAME_KEY, volunteerName);
    }
  }, [volunteerName]);

  const pois = resolved?.pois ?? [];
  const selectedPoi = useMemo(
    () => pois.find((p) => p.id === selectedPoiId) ?? null,
    [pois, selectedPoiId],
  );

  const submitStatus = async (poi: RoutePoi, state: PoiStatusState) => {
    if (!token) return;
    if (!volunteerName.trim()) {
      toast({ title: 'Add your name first', description: 'So the organizer knows who updated this.' });
      nameInputRef.current?.focus();
      return;
    }
    setSavingPoiId(poi.id);

    // Optimistic update — the realtime sub will reconcile if the server
    // version differs.
    const optimistic: PoiStatusSnapshot = {
      poi_id: poi.id,
      state,
      note: noteDraft.trim() || null,
      moved_to_lng: null,
      moved_to_lat: null,
      updated_by_name: volunteerName.trim() || null,
      updated_at: new Date().toISOString(),
    };
    setStatuses((prev) => ({ ...prev, [poi.id]: optimistic }));

    try {
      const result = await updatePoiStatus({
        token,
        poi_id: poi.id,
        state,
        note: noteDraft.trim() || undefined,
        volunteer_name: volunteerName.trim() || undefined,
      });
      setStatuses((prev) => ({ ...prev, [poi.id]: result }));
      setNoteDraft('');
      setSelectedPoiId(null);
      toast({ title: `Marked ${poi.title || poiTone(poi.type).label} ${STATES.find((s) => s.state === state)?.label}` });
      logEvent('poi_status_updated', resolved?.eventId ?? null, { poi_id: poi.id, state });
    } catch (err) {
      // Roll back optimistic update
      setStatuses((prev) => {
        const next = { ...prev };
        if (resolved?.statuses[poi.id]) {
          next[poi.id] = resolved.statuses[poi.id];
        } else {
          delete next[poi.id];
        }
        return next;
      });
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSavingPoiId(null);
    }
  };

  if (loadError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <Radio className="h-7 w-7" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h1 className="text-xl font-display font-bold text-foreground">This volunteer link isn't active</h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-2 text-sm text-primary font-medium hover:underline"
        >
          Back to Hereday
        </button>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <header className="shrink-0 px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary mb-0.5">
          <Radio className="h-3 w-3" />
          Volunteer mode
        </div>
        <h1 className="text-base font-display font-bold text-foreground truncate">
          {resolved.name}
        </h1>
        {resolved.tokenLabel && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{resolved.tokenLabel}</p>
        )}
      </header>

      {/* Name capture — persistent at top */}
      <div className="shrink-0 px-4 py-3 border-b border-border bg-card">
        <label htmlFor="volunteer-name" className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Your name
        </label>
        <input
          ref={nameInputRef}
          id="volunteer-name"
          value={volunteerName}
          onChange={(e) => setVolunteerName(e.target.value)}
          placeholder="e.g. Kevin"
          maxLength={80}
          className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary"
        />
      </div>

      {/* One-line explainer */}
      <div className="shrink-0 px-4 py-2 bg-muted/40 border-b border-border/60">
        <p className="text-[11px] text-muted-foreground text-center leading-snug">
          Tap any spot to mark it Open, Low, Closed, or Moved. Updates reach the organizer and runners in seconds.
        </p>
      </div>

      {/* Marker list */}
      <div className="flex-1 overflow-y-auto">
        {pois.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground leading-relaxed">
            Nothing to update yet. Ask your organizer to add water stations, aid, or parking — they'll show up here.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pois.map((poi) => {
              const tone = poiTone(poi.type);
              const current = statuses[poi.id];
              const activeStateMeta = current
                ? STATES.find((s) => s.state === current.state)
                : null;
              const isOpen = selectedPoiId === poi.id;
              return (
                <li key={poi.id} className="bg-card">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPoiId(isOpen ? null : poi.id);
                      setNoteDraft(isOpen ? '' : (current?.note ?? ''));
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 border-2"
                      style={{ background: `${tone.dot}15`, borderColor: `${tone.dot}40` }}
                    >
                      {tone.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-foreground truncate">
                        {poi.title || tone.label}
                      </p>
                      {current ? (
                        <p className="text-[11.5px] flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${activeStateMeta?.colorClass ?? 'bg-muted-foreground'}`}
                          />
                          <span className="font-medium text-foreground">
                            {activeStateMeta?.label ?? current.state}
                          </span>
                          <span className="text-muted-foreground">
                            · {relativeTime(current.updated_at)}
                            {current.updated_by_name ? ` · by ${current.updated_by_name}` : ''}
                          </span>
                        </p>
                      ) : (
                        <p className="text-[11.5px] text-muted-foreground mt-0.5">
                          Not yet updated
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {isOpen && selectedPoi && (
                    <div className="px-4 pb-4 pt-1 bg-muted/20 border-t border-border/60">
                      {/* Status buttons */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {STATES.map((s) => {
                          const isActive = current?.state === s.state;
                          const isSaving = savingPoiId === poi.id;
                          return (
                            <button
                              key={s.state}
                              onClick={() => submitStatus(poi, s.state)}
                              disabled={isSaving}
                              className={`h-16 rounded-xl border-2 font-display font-bold text-[14px] flex flex-col items-center justify-center gap-0.5 transition-all active:scale-[0.98] disabled:opacity-50 ${
                                isActive
                                  ? s.activeClass
                                  : 'border-border bg-card text-foreground hover:bg-secondary'
                              }`}
                            >
                              <span>{s.label}</span>
                              <span className={`text-[9.5px] font-body font-normal ${isActive ? 'opacity-90' : 'text-muted-foreground'}`}>
                                {s.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {/* Optional note */}
                      <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Add a note (optional)
                      </label>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="e.g. Ran out of water at mile 3"
                        maxLength={200}
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary resize-none"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {noteDraft.length} / 200
                      </p>
                      {savingPoiId === poi.id && (
                        <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Saving…
                        </p>
                      )}
                      {current && !savingPoiId && (
                        <p className="text-[11px] text-emerald-600 mt-2 flex items-center gap-1.5">
                          <Check className="h-3 w-3" />
                          Saved
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default VolunteerStatusPage;
