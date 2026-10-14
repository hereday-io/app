import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { isPro } from '@/lib/eventStatus';
import { reportError } from '@/lib/posthog';

/**
 * Confirms a Stripe Checkout round trip. create-checkout sends the buyer
 * back to `returnUrl?paid=1&event=<id>` (or `canceled=1`), and the return
 * URL is whichever page opened UpgradeModal (editor, ops center,
 * dashboard or billing), so each of those pages calls this.
 *
 * Arriving with `paid=1` doesn't mean the event is Pro: the
 * stripe-webhook sets `events.paid_at`, usually a second or two after
 * the redirect. So poll for it, and if it never shows, tell the buyer
 * their payment is safe and report it. A charge without Pro is the
 * billing failure that matters most.
 *
 * `onPro` lets the page flip its own Pro state without a reload.
 */

export const CHECKOUT_POLL_INTERVAL_MS = 2_000;
export const CHECKOUT_POLL_TIMEOUT_MS = 30_000;

export type CheckoutProRow = { paid_at: string | null };

export function useCheckoutReturn(onPro?: (eventId: string, row: CheckoutProRow) => void): void {
  // Latest callback without re-running the effect when the page re-renders.
  const onProRef = useRef(onPro);
  onProRef.current = onPro;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paid = params.get('paid') === '1';
    const canceled = params.get('canceled') === '1';
    if (!paid && !canceled) return;

    const eventId = params.get('event');
    // The editor's own `?id=` must survive; only the checkout params go.
    // history.replaceState rather than navigate() so pages keyed on
    // searchParams (the editor's map init) don't re-run, and keeping
    // history.state because BrowserRouter stores its key/index there.
    const stripParams = () => {
      const url = new URL(window.location.href);
      for (const p of ['paid', 'canceled', 'event']) url.searchParams.delete(p);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    };

    // Backing out of Stripe is a choice, not an error. Nothing to say.
    if (canceled || !eventId) {
      stripParams();
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + CHECKOUT_POLL_TIMEOUT_MS;
    const activating = toast({
      title: 'Pro is activating…',
      description: 'Confirming your payment. This usually takes a few seconds.',
      duration: Infinity,
    });

    // A fresh toast rather than update(): TOAST_LIMIT is 1, so anything the
    // page toasts meanwhile replaces the activating one, and an update to
    // it would then land nowhere.
    const finish = (title: string, description: string, sticky = false) => {
      stopped = true;
      activating.dismiss();
      toast({ title, description, duration: sticky ? Infinity : undefined });
      stripParams();
    };

    const poll = async () => {
      let row: CheckoutProRow | null = null;
      try {
        ({ data: row } = await supabase.from('events').select('paid_at').eq('id', eventId).maybeSingle());
      } catch {
        // A failed read is just another miss; the deadline decides.
      }
      if (stopped) return;
      if (row && isPro(row)) {
        finish('Upgrade complete', 'This event is now on Pro.');
        onProRef.current?.(eventId, row);
        return;
      }
      if (Date.now() + CHECKOUT_POLL_INTERVAL_MS > deadline) {
        // Not an error toast: their money is safe, and red reads as
        // "failed". Sticky so it's still there when they look back.
        finish(
          'Your payment went through',
          "Pro is taking longer than usual to switch on. You won't be charged again. Refresh in a minute, or email support@hereday.io and we'll sort it out.",
          true,
        );
        reportError(new Error('paid return but not Pro'), {
          area: 'billing',
          action: 'checkout_return_not_pro',
          hereday_event_id: eventId,
        });
        return;
      }
      timer = setTimeout(() => void poll(), CHECKOUT_POLL_INTERVAL_MS);
    };
    void poll();

    return () => {
      // Navigated away mid-poll: drop it quietly and leave the URL to the
      // page we're on now.
      stopped = true;
      if (timer) clearTimeout(timer);
      activating.dismiss();
    };
  }, []);
}
