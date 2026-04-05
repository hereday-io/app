import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Crown, Route, MapPin, ImageIcon, Check } from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  /** Which limit was hit — shapes the headline */
  trigger?: 'routes' | 'pois' | 'branding';
}

const FEATURES = [
  { icon: Route, text: `Unlimited routes per event (free: ${PAYWALL_LIMITS.routes})` },
  { icon: MapPin, text: `Unlimited points of interest (free: ${PAYWALL_LIMITS.pois})` },
  { icon: ImageIcon, text: 'Custom event branding — logo & banner' },
  { icon: Crown, text: 'Priority support' },
];

const TRIGGER_COPY: Record<string, { headline: string; sub: string }> = {
  routes: {
    headline: 'You\'ve reached the route limit',
    sub: `The free plan includes up to ${PAYWALL_LIMITS.routes} routes per event. Upgrade for unlimited routes — perfect for marathon weekends and multi-day festivals.`,
  },
  pois: {
    headline: 'You\'ve reached the POI limit',
    sub: `The free plan includes ${PAYWALL_LIMITS.pois} points of interest. Upgrade to add as many water stations, parking spots, and more as your event needs.`,
  },
  branding: {
    headline: 'Custom branding is a paid feature',
    sub: 'Add your event logo and a branded banner to the public map. Upgrade to make your event look professional.',
  },
};

const UpgradeModal = ({ open, onClose, trigger = 'routes' }: UpgradeModalProps) => {
  const copy = TRIGGER_COPY[trigger];

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

        <div className="flex flex-col gap-2 mt-2">
          <Button
            className="w-full gap-2"
            onClick={() => {
              // TODO: wire to Stripe / payment flow
              window.open('mailto:hello@hereday.io?subject=Upgrade inquiry', '_blank');
              onClose();
            }}
          >
            <Crown className="h-4 w-4" />
            Upgrade to Pro
          </Button>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeModal;
