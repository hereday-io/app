import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import PublicEventView from '@/components/public/PublicEventView';
import EventEndedView from '@/components/public/EventEndedView';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logEvent } from '@/lib/analytics';

interface PublicEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  start_time: string | null;
  registration_url: string | null;
  routes: EventRoute[];
  pois: RoutePoi[];
  route_count: number;
  poi_count: number;
  logo_url: string | null;
  branding_style: string;
  /** Same meaning as isPro() in lib/eventStatus; paid_at itself isn't public. */
  is_pro: boolean;
  tracking_start: string | null;
  tracking_end: string | null;
  has_ended: boolean;
}

type ViewMode = 'runner' | 'spectator';
const VIEW_MODE_KEY = 'hereday:publicViewMode';

const EventPublic = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinguish "event doesn't exist" (render the not-found card) from
  // "the request failed" (render a retry card). Supabase returns PGRST116
  // on .single() zero-rows, which we treat as not-found; anything else is
  // a transport/RLS error and gets the retry path.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // Map-first: land straight on the map. Remember the last role chosen so
  // returning visitors open the same view they used last time.
  // Wrap localStorage reads in try/catch — Safari private mode / quota-
  // exceeded scenarios throw on getItem and would crash the public page
  // before it ever paints.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'runner';
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_KEY);
      return saved === 'spectator' ? 'spectator' : 'runner';
    } catch {
      return 'runner';
    }
  });
  // First visit: show a one-time hint next to the Run/Watch toggle.
  // Returning visitors (anyone with a stored mode) skip it.
  const [hasChosenRole, setHasChosenRole] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(VIEW_MODE_KEY) !== null;
    } catch {
      // Unreadable storage would show the hint on every visit; skip it.
      return true;
    }
  });

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    setHasChosenRole(true);
    if (event) logEvent('public_view', event.id, { mode, slug, switch: true });
    try { window.localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* ignore */ }
  };

  // Closing the first-visit hint keeps the current mode and stops the
  // hint from coming back. Not a mode switch, so nothing is logged.
  const dismissModeHint = () => {
    setHasChosenRole(true);
    try { window.localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch { /* ignore */ }
  };

  // Honor the OS theme on public pages. Organizer pages keep the app's
  // default light theme; a cold visitor opening a link from an iPhone in
  // dark mode gets a dark map without having to hunt for a toggle.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // Snapshot whether the app already had `dark` set (e.g., user toggled
    // it manually on a different page) so cleanup restores the prior
    // state instead of unconditionally removing it. Without this snapshot
    // a navigation away from a public page caused a visible light-mode
    // flicker on dark-themed apps.
    const hadDark = document.documentElement.classList.contains('dark');
    const apply = (dark: boolean) => {
      document.documentElement.classList.toggle('dark', dark);
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => {
      mq.removeEventListener?.('change', onChange);
      document.documentElement.classList.toggle('dark', hadDark);
    };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    // Reads from the column-filtered public_events view so anon clients
    // never see user_id or draft events. See supabase/migrations for the
    // view definition.
    supabase
      .from('public_events')
      .select('*')
      .eq('slug', slug)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // PGRST116 = "no rows" → genuine not-found. Everything else
          // (network blip, 5xx, RLS hiccup) is a recoverable error.
          const notFound = (error as { code?: string }).code === 'PGRST116';
          if (notFound) {
            setEvent(null);
            setFetchError(null);
          } else {
            setFetchError(error.message || 'Network error');
          }
          setLoading(false);
          return;
        }
        // View columns are all nullable in the generated types; id and
        // name are NOT NULL on the base table, so a row missing either
        // is treated as not-found.
        if (!data?.id || !data.name) {
          setEvent(null);
          setLoading(false);
          return;
        }
        setEvent({
          id: data.id,
          name: data.name,
          city: data.city,
          event_date: data.event_date,
          start_time: data.start_time ?? null,
          registration_url: data.registration_url ?? null,
          routes: (data.routes as unknown as EventRoute[]) || [],
          pois: (data.pois as unknown as RoutePoi[]) || [],
          route_count: data.route_count ?? 0,
          poi_count: data.poi_count ?? 0,
          logo_url: data.logo_url ?? null,
          branding_style: data.branding_style ?? 'none',
          // Despite the name, public_events.owner_is_paid is per-event
          // `paid_at IS NOT NULL` since 20260411120000_event_billing_columns.
          is_pro: data.owner_is_paid === true,
          tracking_start: data.tracking_start ?? null,
          tracking_end: data.tracking_end ?? null,
          has_ended: data.has_ended ?? false,
        });
        logEvent('public_view', data.id, {
          mode: viewMode,
          slug,
          ended: data.has_ended ?? false,
        });
        setLoading(false);
      }, (err) => {
        // .then's second arg catches rejected promises (network failures
        // the postgrest client surfaces as throws rather than { error }).
        if (cancelled) return;
        setFetchError((err as Error)?.message || 'Network error');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // retryTick is intentionally a dep so clicking "Try again" re-runs
    // the effect from the top with a fresh request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, retryTick]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground text-lg">Loading event…</div>
      </div>
    );
  }

  // Transport/5xx failure — distinct from "not found" so intermittent
  // errors get a recoverable retry affordance instead of a dead-end page.
  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <WifiOff className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Couldn't load this event
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={() => setRetryTick((t) => t + 1)}>Try again</Button>
            <Button variant="ghost" onClick={() => navigate('/')}>Go home</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Event Not Found</h1>
        <p className="text-muted-foreground">This event doesn't exist or hasn't been published yet.</p>
        <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
      </div>
    );
  }

  // Event date has passed — show the ended screen instead of the course.
  // The row is still `published`; the view layer made this decision via
  // the `has_ended` column in the public_events view.
  if (event.has_ended) {
    return (
      <EventEndedView
        eventId={event.id}
        eventName={event.name}
        eventDate={event.event_date}
        city={event.city}
        logoUrl={event.logo_url}
        brandingStyle={event.branding_style}
        routes={event.routes}
        routeCount={event.route_count}
        poiCount={event.poi_count}
      />
    );
  }

  // One component for both roles so Run/Watch restyles the live map
  // instead of tearing it down and loading a fresh one. There's no role
  // picker: visitors land in Run (most open the link because they're
  // racing), and a first-visit hint points spectators at the toggle.
  return (
    <PublicEventView
      event={event}
      mode={viewMode}
      onSwitchMode={switchView}
      showModeHint={!hasChosenRole}
      onModeHintDismiss={dismissModeHint}
    />
  );
};

export default EventPublic;
