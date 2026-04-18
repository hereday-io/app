import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Link2, Loader2, Radio, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/analytics';
import { generateStatusToken } from '@/lib/statusApi';

interface StatusTokenDialogProps {
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
 * Desktop dialog for generating + managing the volunteer status link on
 * an event. Tokens are event-wide in v1 — the `/v/:token` page renders
 * every POI on the event, so one link covers an entire volunteer team.
 *
 * Mirrors ScoutLinkDialog's single-active-token pattern: shows the most
 * recent live token if one exists, otherwise offers a Generate button.
 * Revoke marks the token revoked_at and falls back to the empty state.
 *
 * Pro differentiation deferred to v2 (multi-token + per-POI scope).
 */
const StatusTokenDialog = ({ open, onOpenChange, eventId, userId }: StatusTokenDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [activeToken, setActiveToken] = useState<TokenRow | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const statusUrl = activeToken
    ? `${window.location.origin}/v/${activeToken.token}`
    : '';

  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('poi_volunteer_tokens')
      .select('token, created_at, revoked_at')
      .eq('event_id', eventId)
      .eq('purpose', 'status')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error) {
          console.error('[StatusTokenDialog] load failed', error);
          toast({ title: 'Failed to load status link', variant: 'destructive' });
          return;
        }
        setActiveToken((data?.[0] as TokenRow | undefined) ?? null);
      });
    return () => { cancelled = true; };
  }, [open, eventId, toast]);

  useEffect(() => {
    if (!statusUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(statusUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 200,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => console.error('[StatusTokenDialog] QR failed', err));
    return () => { cancelled = true; };
  }, [statusUrl]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    const token = generateStatusToken();
    const { error } = await supabase.from('poi_volunteer_tokens').insert({
      token,
      event_id: eventId,
      purpose: 'status',
      created_by: userId,
    });
    setGenerating(false);
    if (error) {
      console.error('[StatusTokenDialog] generate failed', error);
      toast({ title: 'Failed to generate link', variant: 'destructive' });
      return;
    }
    setActiveToken({
      token,
      created_at: new Date().toISOString(),
      revoked_at: null,
    });
    logEvent('status_token_generated', eventId);
    toast({ title: 'Volunteer link created', description: 'Share it with your course volunteers.' });
  };

  const handleRevoke = async () => {
    if (!activeToken || revoking) return;
    if (!window.confirm('Revoke this volunteer link? Anyone using it right now will lose access.')) {
      return;
    }
    setRevoking(true);
    const { error } = await supabase
      .from('poi_volunteer_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', activeToken.token);
    setRevoking(false);
    if (error) {
      console.error('[StatusTokenDialog] revoke failed', error);
      toast({ title: 'Failed to revoke link', variant: 'destructive' });
      return;
    }
    setActiveToken(null);
    logEvent('status_token_revoked', eventId);
    toast({ title: 'Volunteer link revoked' });
  };

  const handleCopy = async () => {
    if (!statusUrl) return;
    try {
      await navigator.clipboard.writeText(statusUrl);
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
            <Radio className="h-5 w-5 text-primary" />
            Volunteer status link
          </DialogTitle>
          <DialogDescription>
            Share this link with volunteers stationed at your aid stations, parking,
            and other markers. They'll mark each one Open / Low / Closed / Moved from
            their phone — updates reach runners and spectators in real time.
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
                  <img src={qrDataUrl} alt="Volunteer link QR code" className="h-full w-full" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    readOnly
                    value={statusUrl}
                    onFocus={(e) => e.target.select()}
                    className="bg-transparent flex-1 min-w-0 text-xs font-mono text-foreground outline-none"
                  />
                  <button
                    onClick={handleCopy}
                    aria-label="Copy volunteer link"
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
                  Anyone with this link can update any marker's status on this event.
                  Revoke and regenerate if the link leaks.
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
              No active volunteer link for this event yet.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate volunteer link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StatusTokenDialog;
