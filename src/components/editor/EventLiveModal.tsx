import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Copy, ExternalLink, Check, Crown, LayoutDashboard } from 'lucide-react';
import ShareQrCode from '@/components/editor/ShareQrCode';

interface EventLiveModalProps {
  open: boolean;
  onClose: () => void;
  publicUrl: string;
  eventName: string;
  eventId: string | null;
  /** Pro events get the Ops Center link; Free events get a quiet unlock line. */
  isPro: boolean;
  onOpenOpsCenter: () => void;
  onUnlockPro: () => void;
}

/**
 * Shown right after an event goes live. The job here is sharing the link,
 * so that's the whole primary path: copy, QR for race-day signage, preview.
 * Pro is a single secondary line for Free events rather than a modal of its
 * own, and Free events are never pointed at the locked Ops Center.
 */
const EventLiveModal = ({
  open, onClose, publicUrl, eventName, eventId, isPro, onOpenOpsCenter, onUnlockPro,
}: EventLiveModalProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, insecure context). The URL
      // is on screen and selectable, so there's nothing else to do.
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-5 text-center border-b border-border">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <DialogTitle className="text-xl font-display font-bold text-foreground">Your event is live</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{eventName}</span> is public. Share this link with participants and spectators.
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          {/* URL copy row */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 pr-1.5 pl-3 py-2">
            <span className="flex-1 text-xs text-foreground truncate font-mono select-all">{publicUrl}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-background border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>

          {/* Race-day QR code — scans straight to the public page. */}
          <ShareQrCode url={publicUrl} eventName={eventName} eventId={eventId} />

          <Button className="w-full gap-2" asChild>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Preview public page
            </a>
          </Button>

          {isPro && (
            <Button variant="outline" className="w-full gap-2" onClick={onOpenOpsCenter}>
              <LayoutDashboard className="h-4 w-4" />
              Open Ops Center
            </Button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Continue editing
          </button>

          {!isPro && (
            <p className="text-xs text-muted-foreground text-center border-t border-border pt-3">
              Want your logo, unlimited markers and race-day tools?{' '}
              <button
                type="button"
                onClick={onUnlockPro}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <Crown className="h-3 w-3" />
                Unlock Pro for this event — $49
              </button>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EventLiveModal;
