import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, Copy, Check, Trash2, Link2, Compass } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/analytics';
import { generateScoutToken } from '@/lib/scoutApi';

interface ScoutLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  userId: string;
}

interface TokenRow {
  token: string;
  created_at: string;
  revoked_at: string | null;
}

/**
 * Desktop dialog for generating and managing the scout-mode link on an
 * event. Phase 1 surfaces at most one live token per event: if one
 * already exists, we show it; if not, we offer a "Generate scout link"
 * button. "Revoke" marks the current token as revoked and falls back to
 * the empty state so the organizer can mint a fresh one.
 *
 * The token IS the authorization — anyone with the URL can add POIs to
 * the event's review queue and view its existing routes/POIs (even on a
 * draft event). The copy in this dialog explains that directly so
 * organizers don't share it publicly by accident.
 */
const ScoutLinkDialog = ({ open, onOpenChange, eventId, userId }: ScoutLinkDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [activeToken, setActiveToken] = useState<TokenRow | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const scoutUrl = activeToken
    ? `${window.location.origin}/scout/${activeToken.token}`
    : '';

  // Load the newest live token when the dialog opens.
  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('poi_volunteer_tokens')
      .select('token, created_at, revoked_at')
      .eq('event_id', eventId)
      .eq('purpose', 'scout')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error) {
          console.error('[ScoutLinkDialog] load failed', error);
          toast({ title: 'Failed to load scout link', variant: 'destructive' });
          return;
        }
        setActiveToken((data?.[0] as TokenRow | undefined) ?? null);
      });
    return () => { cancelled = true; };
  }, [open, eventId, toast]);

  // Render QR whenever the active token changes.
  useEffect(() => {
    if (!scoutUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(scoutUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 200,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => console.error('[ScoutLinkDialog] QR failed', err));
    return () => { cancelled = true; };
  }, [scoutUrl]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    const token = generateScoutToken();
    const { error } = await supabase.from('poi_volunteer_tokens').insert({
      token,
      event_id: eventId,
      purpose: 'scout',
      created_by: userId,
    });
    setGenerating(false);
    if (error) {
      console.error('[ScoutLinkDialog] generate failed', error);
      toast({ title: 'Failed to generate link', variant: 'destructive' });
      return;
    }
    setActiveToken({
      token,
      created_at: new Date().toISOString(),
      revoked_at: null,
    });
    logEvent('scout_token_generated', eventId);
    toast({ title: 'Scout link created', description: 'Copy it below and open on your phone.' });
  };

  const handleRevoke = async () => {
    if (!activeToken || revoking) return;
    if (!window.confirm('Revoke this scout link? Anyone using it right now will lose access.')) {
      return;
    }
    setRevoking(true);
    const { error } = await supabase
      .from('poi_volunteer_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', activeToken.token);
    setRevoking(false);
    if (error) {
      console.error('[ScoutLinkDialog] revoke failed', error);
      toast({ title: 'Failed to revoke link', variant: 'destructive' });
      return;
    }
    setActiveToken(null);
    logEvent('scout_token_revoked', eventId);
    toast({ title: 'Scout link revoked' });
  };

  const handleCopy = async () => {
    if (!scoutUrl) return;
    try {
      await navigator.clipboard.writeText(scoutUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Copy failed', description: 'Select the URL manually.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            Scout mode link
          </DialogTitle>
          <DialogDescription>
            Open this link on your phone while walking the course to drop POIs with
            your GPS. POIs land in a review queue here on desktop before going live.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : activeToken ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="shrink-0 h-24 w-24 rounded-md bg-white p-1.5 flex items-center justify-center border border-border/60">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Scout link QR code" className="h-full w-full" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    readOnly
                    value={scoutUrl}
                    onFocus={(e) => e.target.select()}
                    className="bg-transparent flex-1 min-w-0 text-xs font-mono text-foreground outline-none"
                  />
                  <button
                    onClick={handleCopy}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title="Copy link"
                  >
                    {copied
                      ? <Check className="h-3.5 w-3.5 text-green-500" />
                      : <Copy className="h-3.5 w-3.5" />
                    }
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Anyone with this link can add POIs and view your routes. Share only
                  with people you trust. Revoke and regenerate if the link leaks.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRevoke}
                disabled={revoking}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {revoking ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Revoke link
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              No active scout link for this event yet.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate scout link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ScoutLinkDialog;
