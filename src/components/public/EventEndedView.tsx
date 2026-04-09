import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin, Bell, Check, Loader2, ArrowLeft, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { logEvent } from '@/lib/analytics';

interface EventEndedViewProps {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  city: string | null;
  logoUrl: string | null;
  brandingStyle: string;
}

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Soft gradient hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.08),transparent_60%)]" />

        <div className="relative max-w-xl mx-auto px-4 pt-10 pb-10 sm:px-6 sm:pt-16 sm:pb-14 text-center">
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
            Event wrapped
          </div>

          <h1
            className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {eventName}
          </h1>

          <p className="text-muted-foreground">
            This event has concluded. Thanks to everyone who showed up.
          </p>

          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-sm text-muted-foreground">
            {formattedDate && (
              <div className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {formattedDate}
              </div>
            )}
            {city && (
              <div className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {city}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notify card */}
      <div className="flex-1 flex items-start justify-center px-4 py-10 sm:px-6 sm:py-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-sm p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Get notified if it runs again
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                We'll email you the moment the organizer republishes the course.
              </p>
            </div>
          </div>

          {subscribed ? (
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 text-primary px-4 py-3 text-sm font-medium">
              <Check className="h-4 w-4" />
              You're on the list for <strong>{eventName}</strong>.
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className="space-y-3">
              <Input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="you@example.com"
                disabled={submitting}
                required
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || !email.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Subscribing…
                  </>
                ) : (
                  'Notify me'
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground leading-snug">
                One email when this event is back. No marketing, no list-selling.
              </p>
            </form>
          )}
        </div>
      </div>

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
