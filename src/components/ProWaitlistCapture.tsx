import { useState } from 'react';
import { Check, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/analytics';

interface ProWaitlistCaptureProps {
  /** Pre-fill email (e.g., for authed organizers). */
  defaultEmail?: string | null;
  /** Optional event to associate the interest signal with. */
  eventId?: string | null;
  /** Short tag identifying where the capture happened — see CAPTURE_SOURCES list. */
  trigger: 'upgrade_modal' | 'ops_center_lock' | 'publish_upsell' | 'billing_page' | string;
  /** Tone the parent wants — `subtle` keeps it inline, `card` adds a bordered card shell. */
  variant?: 'subtle' | 'card';
  /** Shown above the form, defaults to generic copy. */
  title?: string;
  description?: string;
}

/**
 * Drop-in email capture that stands in for a real Stripe CTA while
 * `PAYMENTS_LIVE = false`. Writes to the `pro_waitlist` table
 * (anon INSERT allowed, no SELECT) and fires a `pro_waitlist_signup`
 * analytics event so we can measure demand by capture surface.
 *
 * Keep the copy warm-but-honest: "Pro upgrades open soon" rather than
 * "coming soon" (which reads as inert). When Stripe lands, delete this
 * component and wire the real checkout.
 */
const ProWaitlistCapture = ({
  defaultEmail,
  eventId,
  trigger,
  variant = 'subtle',
  title = 'Pro upgrades open soon',
  description = 'Drop your email — we\'ll ping you the moment Pro unlocks go live, so you can upgrade this event in one click.',
}: ProWaitlistCaptureProps) => {
  const { toast } = useToast();
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      toast({ title: 'Enter a valid email', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('pro_waitlist').insert({
      email: trimmed,
      event_id: eventId ?? null,
      trigger,
    });
    setSubmitting(false);
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.error('[ProWaitlistCapture] insert failed', error);
      toast({ title: 'Something went wrong', description: 'Try again in a moment.', variant: 'destructive' });
      return;
    }
    setDone(true);
    logEvent('pro_waitlist_signup', eventId ?? null, { trigger });
  };

  const shell =
    variant === 'card'
      ? 'rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 p-3'
      : '';

  if (done) {
    return (
      <div className={`${shell} flex items-center gap-2 text-sm text-foreground`}>
        <div className="h-7 w-7 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
          <Check className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-[13px]">You're on the list</p>
          <p className="text-[11.5px] text-muted-foreground leading-snug">
            We'll email you the minute Pro unlocks go live.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="mb-2">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-1.5">
        <div className="relative flex-1 min-w-0">
          <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-9 pl-8 text-[13px]"
            disabled={submitting}
          />
        </div>
        <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={submitting}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Notify me'}
        </Button>
      </form>
    </div>
  );
};

export default ProWaitlistCapture;
