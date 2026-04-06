import { useState } from 'react';
import { Bell, BellRing, Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { logEvent } from '@/lib/analytics';

interface SubscribeButtonProps {
  eventId: string;
  eventName: string;
  /** Which public view surfaced this — recorded on the row for later analysis. */
  source: 'runner' | 'spectator';
  /** Show expanded pill with label instead of icon-only circle */
  expanded?: boolean;
}

/**
 * Small bell icon button with an expand-to-dialog subscribe flow.
 *
 * Sits in the floating glass header next to the back button on both the
 * Runner and Spectator views. One component, two placements — the only
 * difference is the `source` prop for attribution.
 *
 * Intentional design choices:
 * - **Soft success on duplicate.** The unique index on (event_id, lower(email))
 *   throws 23505 if someone re-submits. We treat that as "you're already on
 *   the list" instead of an error — the user doesn't need to know or care.
 * - **No read-back.** The insert policy doesn't grant SELECT to the caller,
 *   so we can't pre-check. The unique-index dance above covers the case.
 * - **sessionStorage gate.** After a successful submit we flip a per-event
 *   key so the button flips to a checkmark and the dialog doesn't re-open
 *   on accidental taps. This is UX only — the DB is still the source of
 *   truth on refresh.
 */
const SubscribeButton = ({ eventId, eventName, source, expanded: expandedPill }: SubscribeButtonProps) => {
  const storageKey = `hereday:subscribed:${eventId}`;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.sessionStorage.getItem(storageKey) === '1'; } catch { return false; }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    // Lightweight client validation. The DB CHECK is the authoritative gate;
    // this just saves a round-trip on obvious typos.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError('That email doesn\'t look right.');
      return;
    }
    setSubmitting(true);
    setError(null);

    // Cast: event_subscribers isn't in the generated types.ts yet. Regenerate
    // with `supabase gen types` when convenient.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase.from('event_subscribers' as any) as any)
      .insert({ event_id: eventId, email: trimmed, source });

    setSubmitting(false);

    // 23505 = unique violation → "you're already on the list" is a success.
    const isDuplicate = insertError?.code === '23505';
    if (insertError && !isDuplicate) {
      setError('Something went wrong. Try again in a moment.');
      return;
    }

    logEvent(isDuplicate ? 'email_subscribe_duplicate' : 'email_captured', eventId, {
      source,
    });

    try { window.sessionStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    setSubscribed(true);
    // Keep the dialog open for a beat so the user sees the confirmation.
    setTimeout(() => setOpen(false), 1200);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={subscribed ? 'Subscribed to event updates' : 'Get event updates'}
        className={
          expandedPill
            ? 'shrink-0 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center gap-1.5 px-3 text-foreground hover:bg-card/95 active:scale-95 transition-all'
            : 'shrink-0 w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center text-foreground hover:bg-card/95 active:scale-95 transition-all'
        }
      >
        {subscribed ? (
          <BellRing className="w-4 h-4 text-primary" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        {expandedPill && (
          <span className="text-xs font-medium">{subscribed ? 'Subscribed' : 'Get updates'}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Get event updates
            </DialogTitle>
            <DialogDescription>
              Drop your email and we'll reach out with race-day info and a heads-up when{' '}
              <strong>{eventName}</strong> runs again next year.
            </DialogDescription>
          </DialogHeader>

          {subscribed ? (
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 text-primary px-4 py-3 text-sm font-medium">
              <Check className="h-4 w-4" />
              You're on the list for <strong>{eventName}</strong>.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="you@example.com"
                autoFocus
                disabled={submitting}
                required
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !email.trim()}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Subscribing…
                    </>
                  ) : (
                    'Subscribe'
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug pt-1">
                We only email you about this event. No marketing, no list-selling.
              </p>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SubscribeButton;
