import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Crown, Route, MapPin, ImageIcon, Check, LayoutDashboard, Sparkles } from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';
import { supabase } from '@/integrations/supabase/client';
import { logEvent } from '@/lib/analytics';
import { reportError } from '@/lib/posthog';
import ProWaitlistCapture from '@/components/ProWaitlistCapture';

// Flip to true once LLC + bank + Stripe are fully configured. Exported
// so other Pro-CTA surfaces (Ops Center lock, paywall hits on editor)
// can render waitlist capture instead of a dead checkout button.
export const PAYMENTS_LIVE = true;

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  /** Which limit was hit — shapes the headline */
  trigger?: 'routes' | 'pois' | 'branding' | 'publish' | 'sponsors';
  /** The event being upgraded */
  eventId?: string | null;
  /** Called before navigating to Stripe so the caller can flush pending saves */
  onBeforeRedirect?: () => Promise<void>;
}

const FEATURES = [
  { icon: Route, text: `Unlimited routes per event (free: ${PAYWALL_LIMITS.routes})` },
  { icon: MapPin, text: `Unlimited markers (free: ${PAYWALL_LIMITS.pois})` },
  { icon: ImageIcon, text: 'Custom event branding — logo & banner' },
  { icon: LayoutDashboard, text: 'Event Ops Center for race-day ops' },
  { icon: Sparkles, text: 'All branded sponsors visible publicly' },
  { icon: Crown, text: 'Priority support' },
];

const TRIGGER_COPY: Record<string, { headline: string; sub: string }> = {
  routes: {
    headline: 'Need more routes?',
    sub: `Free events include up to ${PAYWALL_LIMITS.routes} routes. Unlock this event for unlimited routes — perfect for marathon weekends and multi-day festivals.`,
  },
  pois: {
    headline: 'Need more markers?',
    sub: `Free events include ${PAYWALL_LIMITS.pois} markers. Unlock this event to add as many water stations, parking spots, and more as you need.`,
  },
  branding: {
    headline: 'Custom branding is a Pro feature',
    sub: 'Add your event logo and a branded banner to the public map. Unlock this event to make it look professional.',
  },
  publish: {
    headline: 'Your event is live — want to go Pro?',
    sub: "It's published on the Free plan. Unlock this event to remove limits and add custom branding.",
  },
  sponsors: {
    headline: 'Show every sponsor on the map',
    sub: "Free events show one branded sponsor publicly — the rest render as generic pins. Unlock this event to publish all your sponsors with logos, CTAs, and tracked analytics.",
  },
};

const UpgradeModal = ({ open, onClose, trigger = 'routes', eventId, onBeforeRedirect }: UpgradeModalProps) => {
  const copy = TRIGGER_COPY[trigger];
  const [loading, setLoading] = useState(false);
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <Crown className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-display leading-tight">{copy.headline}</DialogTitle>
              <DialogDescription className="mt-0.5 text-sm">{copy.sub}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="my-2 space-y-2">
          {FEATURES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2.5 text-sm text-foreground">
              <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Check className="h-3 w-3 text-primary" />
              </div>
              {text}
            </div>
          ))}
        </div>

        {/* TODO: Remove PAYMENTS_LIVE gate once Stripe is fully configured */}
        {PAYMENTS_LIVE ? (
          <div className="flex flex-col gap-2 mt-2">
            <Button
              className="w-full gap-2"
              disabled={loading}
              onClick={async () => {
                if (!eventId) {
                  console.error('[UpgradeModal] No eventId provided');
                  return;
                }
                setLoading(true);
                setCheckoutFailed(false);
                logEvent('upgrade_clicked', eventId, { trigger });
                try {
                  // Return to wherever the user triggered the upgrade
                  // from — editor if they hit a paywall mid-draw, ops
                  // center if they were configuring tracking, dashboard
                  // if they upgraded from there. Fall back to /dashboard
                  // only for the landing page (which doesn't rehydrate
                  // auth state cleanly).
                  const here = `${window.location.pathname}${window.location.search}`;
                  const returnPath = here === '/' ? '/dashboard' : here;
                  const { data, error } = await supabase.functions.invoke('create-checkout', {
                    body: {
                      eventId,
                      returnUrl: `${window.location.origin}${returnPath}`,
                    },
                  });
                  if (error || !data?.url) {
                    reportError(error ?? new Error('create-checkout returned no url'), {
                      area: 'billing', action: 'create_checkout', hereday_event_id: eventId, trigger,
                    });
                    setCheckoutFailed(true);
                    setLoading(false);
                    return;
                  }
                  // Flush any pending edits before leaving the page
                  if (onBeforeRedirect) await onBeforeRedirect();
                  window.location.href = data.url;
                } catch (err) {
                  reportError(err, {
                    area: 'billing', action: 'create_checkout', hereday_event_id: eventId, trigger,
                  });
                  setCheckoutFailed(true);
                  setLoading(false);
                }
              }}
            >
              <Crown className="h-4 w-4" />
              {loading ? 'Redirecting to checkout…' : 'Unlock this event — $49'}
            </Button>
            {checkoutFailed && (
              <p role="alert" className="text-xs text-destructive text-center mt-2">
                Couldn't open checkout. You haven't been charged. Try again, or email support@hereday.io.
              </p>
            )}
            <p className="text-xs text-muted-foreground text-center mt-2">
              <span className="font-medium text-foreground">One-time payment.</span> No subscription, no auto-renew.
            </p>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
              Maybe later
            </Button>
            <button
              type="button"
              onClick={() => { onClose(); navigate('/billing#promo'); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center -mt-1"
            >
              Have a code? <span className="text-primary hover:underline">Redeem on Billing →</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-2">
            <ProWaitlistCapture
              variant="card"
              eventId={eventId ?? null}
              trigger={`upgrade_modal:${trigger}`}
            />
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
              Maybe later
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeModal;
