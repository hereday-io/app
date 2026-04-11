import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin, Bell, Check, Loader2, ArrowLeft, Trophy, Route as RouteIcon, MapPinned } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { logEvent } from '@/lib/analytics';
import { totalDistanceMiles } from '@/lib/geo';
import type { EventRoute } from '@/types/mapEditor';

interface EventEndedViewProps {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  city: string | null;
  logoUrl: string | null;
  brandingStyle: string;
  /** Counts + route geometry for the recap module. Spectator-facing
   *  stats — "this course was 13.1 mi with 14 aid stations" — give the
   *  ended screen something to brag about instead of a bare email form. */
  routes?: EventRoute[];
  routeCount?: number;
  poiCount?: number;
}

/** Parse out a year from the event name or date so the retention copy
 *  can read "2026 wrapped — want to know when 2027 opens?". */
const nextYearLabel = (name: string, eventDate: string | null): string | null => {
  const fromName = name.match(/\b(20\d{2})\b/);
  if (fromName) return String(parseInt(fromName[1], 10) + 1);
  if (eventDate) {
    const y = new Date(`${eventDate}T00:00:00`).getFullYear();
    if (Number.isFinite(y)) return String(y + 1);
  }
  return null;
};

/**
 * Shown when someone lands on a public event page the day after (or later
 * than) the event date. The event row is still `published` — the
 * `public_events` view just flipped `has_ended` to true.
 *
 * This is deliberately a warm "come back next time" surface rather than a
 * 404. The organizer may re-run the event next year, and every email we
 * capture here rolls into the same `event_subscribers` row space so the
 * audience is already there when they republish.
 */
const EventEndedView = ({
  eventId,
  eventName,
  eventDate,
  city,
  logoUrl,
  brandingStyle,
  routes = [],
  routeCount,
  poiCount,
}: EventEndedViewProps) => {
  const navigate = useNavigate();
  const storageKey = `hereday:subscribed:${eventId}`;
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.sessionStorage.getItem(storageKey) === '1'; } catch { return false; }
  });

  const formattedDate = eventDate
    ? new Date(`${eventDate}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  // Total course distance — sum of every route on the event. A marathon
  // weekend with 5K/10K/half/full shows the combined mileage, which is
  // exactly the "we ran a lot" brag the recap module is selling.
  const totalMiles = useMemo(() => {
    if (!routes.length) return 0;
    return routes.reduce((sum, r) => sum + totalDistanceMiles(r.routeCoords ?? []), 0);
  }, [routes]);

  const nextYear = nextYearLabel(eventName, eventDate);
  const yearFromName = eventName.match(/\b(20\d{2})\b/)?.[1] ?? null;

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError("That email doesn't look right.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from('event_subscribers').insert({
      event_id: eventId,
      email: trimmed,
      source: 'ended',
    });

    setSubmitting(false);

    // 23505 = unique violation → already subscribed, treat as success
    const isDuplicate = insertError?.code === '23505';
    if (insertError && !isDuplicate) {
      setError('Something went wrong. Try again in a moment.');
      return;
    }

    logEvent(isDuplicate ? 'email_subscribe_duplicate' : 'email_captured', eventId, {
      source: 'ended',
    });

    try { window.sessionStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    setSubscribed(true);
  };

  // Heroed email input lives inside the gradient section so the first
  // fold of the ended page is an action surface, not a eulogy. If we
  // have enough context for a year (from the name or the event_date),
  // the copy frames it as "[year] wrapped — want to know when [year+1]
  // opens?". Otherwise we fall back to a generic retention prompt.
  const wrappedLabel = yearFromName ? `${yearFromName} wrapped` : 'Event wrapped';
  const primaryHeadline = nextYear
    ? `Want to know when ${nextYear} opens?`
    : 'Want to know when it runs again?';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Soft gradient hero — email capture is the hero, not a buried card */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.08),transparent_60%)]" />

        <div className="relative max-w-xl mx-auto px-4 pt-10 pb-12 sm:px-6 sm:pt-16 sm:pb-16 text-center">
          <button
            onClick={() => navigate('/')}
            className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {logoUrl && brandingStyle !== 'none' && (
            <img
              src={logoUrl}
              alt={`${eventName} logo`}
              className="w-20 h-20 object-contain mx-auto mb-6 rounded-xl border border-border bg-card/80 p-2 shadow-sm"
            />
          )}

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium mb-4 uppercase tracking-wide">
            <Trophy className="h-3.5 w-3.5" />
            {wrappedLabel}
          </div>

          <h1
            className="text-3xl sm:text-4xl font-bold text-foreground mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {eventName}
          </h1>

          <p className="mt-4 text-lg sm:text-xl font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            {primaryHeadline}
          </p>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
            Drop your email and we'll send you one message the moment the organizer republishes the course.
          </p>

          {/* Hero email input — the page's primary action. */}
          <div className="mt-6 max-w-md mx-auto">
            {subscribed ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-primary/10 text-primary px-4 py-3 text-sm font-medium">
                <Check className="h-4 w-4" />
                You're on the list for <strong className="ml-1">{eventName}</strong>.
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="you@example.com"
                  disabled={submitting}
                  required
                  className="h-11 text-base sm:flex-1 bg-card"
                />
                <Button type="submit" size="lg" className="h-11 shrink-0" disabled={submitting || !email.trim()}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Subscribing…
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4 mr-2" />
                      Notify me
                    </>
                  )}
                </Button>
              </form>
            )}
            {error && <p className="text-xs text-destructive mt-2">{error}</p>}
            <p className="text-[11px] text-muted-foreground leading-snug mt-2">
              One email when this event is back. No marketing, no list-selling.
            </p>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-xs text-muted-foreground">
            {formattedDate && (
              <div className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {formattedDate}
              </div>
            )}
            {city && (
              <div className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {city}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recap module — a brag reel for the course. Only renders when we
          have numbers to show; a zero-stat block is worse than none. */}
      {(totalMiles > 0 || (routeCount ?? 0) > 0 || (poiCount ?? 0) > 0) && (
        <div className="px-4 py-10 sm:px-6 sm:py-12">
          <div className="max-w-xl mx-auto">
            <p className="text-center text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-4">
              Recap
            </p>
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              {totalMiles > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 text-center">
                  <p className="text-2xl sm:text-3xl font-display font-bold text-foreground">
                    {totalMiles >= 10 ? totalMiles.toFixed(0) : totalMiles.toFixed(1)}
                  </p>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                    Total miles
                  </p>
                </div>
              )}
              {(routeCount ?? 0) > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <RouteIcon className="h-4 w-4 text-primary" />
                    <p className="text-2xl sm:text-3xl font-display font-bold text-foreground">
                      {routeCount}
                    </p>
                  </div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                    Route{routeCount !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
              {(poiCount ?? 0) > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <MapPinned className="h-4 w-4 text-brand" />
                    <p className="text-2xl sm:text-3xl font-display font-bold text-foreground">
                      {poiCount}
                    </p>
                  </div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                    POI{poiCount !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="pb-8 text-center text-xs text-muted-foreground">
        <a
          href="https://hereday.io"
          className="hover:text-foreground transition-colors"
          target="_blank"
          rel="noreferrer"
        >
          Made with Hereday
        </a>
      </div>
    </div>
  );
};

export default EventEndedView;
