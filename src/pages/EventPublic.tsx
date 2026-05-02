import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import RunnerView from '@/components/public/RunnerView';
import SpectatorView from '@/components/public/SpectatorView';
import EventEndedView from '@/components/public/EventEndedView';
import RolePickerSheet from '@/components/public/RolePickerSheet';
import { MapPin, Calendar, Trophy, Eye, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import WeatherForecast from '@/components/public/WeatherForecast';
import { logEvent } from '@/lib/analytics';

interface PublicEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  routes: EventRoute[];
  pois: RoutePoi[];
  route_count: number;
  poi_count: number;
  logo_url: string | null;
  branding_style: string;
  plan: 'free' | 'pro';
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
  // First-visit role picker: show the floating sheet over the map until the
  // user explicitly chooses (or dismisses, which implicitly picks spectator).
  // Returning visitors — anyone with a stored role — skip the sheet entirely.
  const [hasChosenRole, setHasChosenRole] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(VIEW_MODE_KEY) !== null;
    } catch {
      // If localStorage is unreadable, surface the picker so the visitor
      // explicitly chooses — better than locking them into a default.
      return false;
    }
  });

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    setHasChosenRole(true);
    if (event) logEvent('public_view', event.id, { mode, slug, switch: true });
    try { window.localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* ignore */ }
  };

  const handleRolePick = (mode: ViewMode) => {
    switchView(mode);
  };
  // Dismissing the sheet is an implicit "spectator" pick — it's the lower-
  // commitment default for a cold QR visitor who may not even be running.
  const handleRoleDismiss = () => {
    switchView('spectator');
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
        if (!data) {
          setEvent(null);
          setLoading(false);
          return;
        }
        const row = data;
        setEvent({
          id: row.id,
          name: row.name,
          city: row.city,
          event_date: row.event_date,
          routes: (row.routes as unknown as EventRoute[]) || [],
          pois: (row.pois as unknown as RoutePoi[]) || [],
          route_count: row.route_count,
          poi_count: row.poi_count,
          logo_url: row.logo_url ?? null,
          branding_style: row.branding_style ?? 'none',
          plan: row.owner_is_paid ? 'pro' : 'free',
          tracking_start: row.tracking_start ?? null,
          tracking_end: row.tracking_end ?? null,
          has_ended: row.has_ended ?? false,
        });
        logEvent('public_view', row.id, {
          mode: viewMode,
          slug,
          ended: row.has_ended ?? false,
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

  if (viewMode === 'runner') {
    return (
      <>
        <RunnerView
          event={event}
          onBack={() => navigate('/')}
          onSwitchToSpectator={() => switchView('spectator')}
        />
        {!hasChosenRole && (
          <RolePickerSheet onPick={handleRolePick} onDismiss={handleRoleDismiss} />
        )}
      </>
    );
  }

  if (viewMode === 'spectator') {
    return (
      <>
        <SpectatorView
          event={event}
          onBack={() => navigate('/')}
          onSwitchToRunner={() => switchView('runner')}
        />
        {!hasChosenRole && (
          <RolePickerSheet onPick={handleRolePick} onDismiss={handleRoleDismiss} />
        )}
      </>
    );
  }

  // Landing page (unreachable in the default flow — kept for fallback/SEO)
  const formattedDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  // Pull coordinates from first route waypoint for weather
  const firstCoord = event.routes?.[0]?.routeCoords?.[0] ?? event.routes?.[0]?.waypoints?.[0] ?? null;
  const weatherLat = firstCoord ? firstCoord[1] : null;
  const weatherLon = firstCoord ? firstCoord[0] : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.08),transparent_60%)]" />
        <div className="relative max-w-3xl mx-auto px-4 pt-10 pb-8 sm:px-6 sm:pt-16 sm:pb-12 text-center">
          {event.logo_url && event.branding_style !== 'none' && (
            <img
              src={event.logo_url}
              alt={`${event.name} logo`}
              className="w-20 h-20 object-contain mx-auto mb-6 rounded-xl border border-border bg-card/80 p-2 shadow-sm"
            />
          )}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <MapPin className="w-4 h-4" />
            {event.city || 'Event'}
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {event.name}
          </h1>

          {formattedDate && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
              <Calendar className="w-4 h-4" />
              <span>{formattedDate}</span>
            </div>
          )}

          <p className="text-muted-foreground mt-4 max-w-md mx-auto">
            {event.route_count} route{event.route_count !== 1 ? 's' : ''} · {event.poi_count} point{event.poi_count !== 1 ? 's' : ''} of interest
          </p>
        </div>
      </div>

      {/* Weather forecast */}
      {event.event_date && (
        <div className="pt-6">
          <WeatherForecast
            eventDate={event.event_date}
            lat={weatherLat}
            lon={weatherLon}
          />
        </div>
      )}

      {/* View selection */}
      <div className="flex-1 flex items-start justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-2xl w-full">
          {/* Runner card */}
          <button
            onClick={() => switchView('runner')}
            className="group relative rounded-xl border border-border bg-card p-6 sm:p-8 text-left transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <div className="mb-4 inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Trophy className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              I'm Running
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              View the full course with route details, aid stations, water stops, and everything you need on race day.
            </p>
            <div className="mt-4 text-sm font-medium text-primary">
              View runner map →
            </div>
          </button>

          {/* Spectator card */}
          <button
            onClick={() => switchView('spectator')}
            className="group relative rounded-xl border border-border bg-card p-6 sm:p-8 text-left transition-all hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <div className="mb-4 inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
              <Eye className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              I'm Spectating
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Find the best viewing spots, parking, restrooms, and amenities to cheer on your runner.
            </p>
            <div className="mt-4 text-sm font-medium text-accent">
              View spectator map →
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default EventPublic;
