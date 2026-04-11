import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { logEvent } from '@/lib/analytics';

interface PublicShareButtonProps {
  eventId: string;
  eventName: string;
  /** Which public view surfaced this — recorded for attribution. */
  source: 'runner' | 'spectator';
}

/**
 * Forward-share affordance for the public map. Uses the native
 * `navigator.share` sheet on mobile (AirDrop / iMessage / WhatsApp /
 * the Android share tray) and falls back to a clipboard copy on
 * desktop browsers that don't implement it.
 *
 * Intentionally a standalone component rather than a button baked into
 * RunnerView/SpectatorView so the two views stay visually and
 * behaviorally identical without duplicating the share state machine.
 */
const PublicShareButton = ({ eventId, eventName, source }: PublicShareButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const shareData = {
      title: eventName,
      text: `Check out ${eventName} on Hereday`,
      url: shareUrl,
    };

    // `navigator.share` exists on most mobile browsers + Safari desktop.
    // When it does, use it — it's the fastest path to a friend's DM.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        logEvent('public_share', eventId, { source, method: 'native' });
        return;
      } catch (err) {
        // AbortError = user cancelled the share sheet — not a failure.
        if ((err as Error)?.name === 'AbortError') return;
        // Fall through to clipboard on any other rejection.
      }
    }

    // Desktop fallback: copy the URL and flash a check icon so the
    // user knows something happened.
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      logEvent('public_share', eventId, { source, method: 'clipboard' });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — last-resort: nothing we can do silently.
    }
  };

  return (
    <button
      onClick={handleShare}
      aria-label="Share this event"
      title={copied ? 'Link copied' : 'Share this event'}
      className="shrink-0 w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center text-foreground hover:bg-card/95 active:scale-95 transition-all"
    >
      {copied
        ? <Check className="w-4 h-4 text-emerald-600" />
        : <Share2 className="w-4 h-4" />}
    </button>
  );
};

export default PublicShareButton;
