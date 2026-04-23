import { useCallback, useEffect, useMemo, useState } from 'react';
import { MailPlus, Send, AlertTriangle, Eye, Edit, Users, Megaphone, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/analytics';
import { markdownToHtml } from '@/lib/emailTemplate';
import type { VolunteerEntry } from '@/types/mapEditor';

interface SendUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventName: string;
}

interface SendHistoryRow {
  id: number;
  subject: string;
  body_preview: string;
  audiences: string[];
  recipient_count: number;
  sent_at: string;
}

const SUBJECT_MAX = 200;

const SendUpdateDialog = ({ open, onOpenChange, eventId, eventName }: SendUpdateDialogProps) => {
  const { toast } = useToast();

  // Compose state
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [toSubscribers, setToSubscribers] = useState(true);
  const [toVolunteers, setToVolunteers] = useState(true);

  // Counts + history (hydrated when the dialog opens)
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [volunteerCount, setVolunteerCount] = useState<number | null>(null);
  const [history, setHistory] = useState<SendHistoryRow[]>([]);

  // UI flow
  const [step, setStep] = useState<'compose' | 'preview' | 'confirm'>('compose');
  const [sending, setSending] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<string | null>(null);

  const previewHtml = useMemo(() => markdownToHtml(body || ''), [body]);

  // Reset state each open so back-to-back sends don't leak state.
  useEffect(() => {
    if (!open) return;
    setSubject('');
    setBody('');
    setToSubscribers(true);
    setToVolunteers(true);
    setStep('compose');
    setSending(false);
    setRateLimitedUntil(null);
  }, [open]);

  // Fetch audience counts + history once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const [subsQ, eventQ, historyQ] = await Promise.all([
        supabase
          .from('event_subscribers')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .is('unsubscribed_at', null),
        supabase
          .from('events')
          .select('volunteer_roster')
          .eq('id', eventId)
          .maybeSingle(),
        supabase
          .from('email_sends')
          .select('id, subject, body_preview, audiences, recipient_count, sent_at')
          .eq('event_id', eventId)
          .order('sent_at', { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      setSubscriberCount(subsQ.count ?? 0);

      const roster = ((eventQ.data as { volunteer_roster?: unknown } | null)?.volunteer_roster ?? []) as VolunteerEntry[];
      const volEmailable = Array.isArray(roster)
        ? roster.filter((v) => !!v.email?.trim() && !v.emailUnsubscribedAt).length
        : 0;
      setVolunteerCount(volEmailable);

      setHistory((historyQ.data ?? []) as SendHistoryRow[]);

      // If there's a send within the last 24h, surface the cool-down.
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const recent = (historyQ.data ?? []).find((r) => new Date(r.sent_at).getTime() >= cutoff);
      if (recent) {
        const nextEligible = new Date(new Date(recent.sent_at).getTime() + 24 * 3600 * 1000);
        setRateLimitedUntil(nextEligible.toISOString());
      }
    })();

    return () => { cancelled = true; };
  }, [open, eventId]);

  const totalRecipients = (toSubscribers ? (subscriberCount ?? 0) : 0) + (toVolunteers ? (volunteerCount ?? 0) : 0);

  const canCompose =
    subject.trim().length > 0 &&
    subject.length <= SUBJECT_MAX &&
    body.trim().length > 0 &&
    (toSubscribers || toVolunteers) &&
    totalRecipients > 0 &&
    !rateLimitedUntil;

  const handleSend = useCallback(async () => {
    setSending(true);
    const audiences: string[] = [];
    if (toSubscribers) audiences.push('subscribers');
    if (toVolunteers) audiences.push('volunteers');
    logEvent('email_update_sent', eventId, { audiences, recipient_count: totalRecipients });

    const { data, error } = await supabase.functions.invoke('send-event-update', {
      body: { eventId, subject: subject.trim(), body, audiences },
    });
    setSending(false);

    if (error) {
      // Try to tease out a structured error from the function response.
      const ctx = (error as { context?: { body?: string | Record<string, unknown> } }).context;
      let message = 'Send failed. Please try again.';
      try {
        if (typeof ctx?.body === 'string') {
          const parsed = JSON.parse(ctx.body) as { error?: string; code?: string };
          if (parsed.error) message = parsed.error;
        } else if (ctx?.body && typeof ctx.body === 'object') {
          const parsed = ctx.body as { error?: string };
          if (parsed.error) message = parsed.error;
        }
      } catch {
        // fall through to default
      }
      toast({ title: 'Could not send', description: message, variant: 'destructive' });
      return;
    }

    const sent = (data as { sent?: { subscribers?: number; volunteers?: number }; totalRecipients?: number })?.sent ?? {};
    const total = (data as { totalRecipients?: number })?.totalRecipients ?? 0;
    toast({
      title: 'Update sent',
      description: `Delivered to ${total} ${total === 1 ? 'recipient' : 'recipients'}.`,
    });
    onOpenChange(false);
  }, [eventId, toSubscribers, toVolunteers, subject, body, totalRecipients, toast, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <MailPlus className="h-4 w-4 text-primary" /> Send update
          </DialogTitle>
          <DialogDescription>
            Email your subscribers and volunteers for <strong>{eventName}</strong>. Sends are
            rate-limited to one per event per 24 hours.
          </DialogDescription>
        </DialogHeader>

        {rateLimitedUntil && (
          <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-600/30 px-3 py-2 flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">You've already sent for this event today.</div>
              <div className="text-xs mt-0.5">
                Next send eligible at {new Date(rateLimitedUntil).toLocaleString(undefined, {
                  weekday: 'short', hour: 'numeric', minute: '2-digit',
                })}.
              </div>
            </div>
          </div>
        )}

        {step === 'compose' ? (
          <div className="space-y-4">
            {/* Audience */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Audience
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <AudienceCard
                  label="Subscribers"
                  description="People who opted in from your public event page"
                  count={subscriberCount}
                  checked={toSubscribers}
                  onToggle={() => setToSubscribers((v) => !v)}
                />
                <AudienceCard
                  label="Volunteers"
                  description="Roster members with an email address on file"
                  count={volunteerCount}
                  checked={toVolunteers}
                  onToggle={() => setToVolunteers((v) => !v)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="update-subject">Subject</Label>
              <Input
                id="update-subject"
                placeholder="Course change for tomorrow's race"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={SUBJECT_MAX}
              />
              <p className="text-[11px] text-muted-foreground text-right">
                {subject.length}/{SUBJECT_MAX}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="update-body">Message</Label>
                <span className="text-[11px] text-muted-foreground">
                  Supports **bold** and [links](https://…)
                </span>
              </div>
              <Textarea
                id="update-body"
                placeholder={`Hi everyone,\n\nQuick update about Saturday's race...`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
            </div>

            {history.length > 0 && (
              <details className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                <summary className="text-xs font-medium text-muted-foreground cursor-pointer list-none flex items-center gap-2">
                  <Megaphone className="h-3 w-3" /> Send history ({history.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {history.slice(0, 5).map((row) => (
                    <div key={row.id} className="text-xs text-foreground/80">
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{row.subject}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          {new Date(row.sent_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        {row.recipient_count} {row.recipient_count === 1 ? 'recipient' : 'recipients'} · {row.audiences.join(' + ')}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex justify-between items-center pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep('preview')}
                disabled={body.trim().length === 0}
                className="gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => setStep('confirm')}
                  disabled={!canCompose}
                  className="gap-1.5"
                >
                  Review & send <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ) : step === 'preview' ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-white dark:bg-neutral-900 p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                Update from {eventName}
              </div>
              <h3 className="font-display text-lg font-bold mb-3">{subject || 'Subject'}</h3>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="text-muted-foreground">Your message will appear here.</p>' }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('compose')} className="gap-1.5">
                <Edit className="h-3.5 w-3.5" /> Keep editing
              </Button>
              <Button onClick={() => setStep('confirm')} disabled={!canCompose} className="gap-1.5">
                Review & send <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-1.5 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="font-medium">Ready to send</div>
              </div>
              <div className="text-foreground/80 pl-6 space-y-1">
                <div>
                  <strong>{totalRecipients}</strong> {totalRecipients === 1 ? 'recipient' : 'recipients'} — {[
                    toSubscribers ? `${subscriberCount ?? 0} subscribers` : null,
                    toVolunteers ? `${volunteerCount ?? 0} volunteers` : null,
                  ].filter(Boolean).join(' + ')}
                </div>
                <div>Subject: <span className="font-medium">{subject}</span></div>
                <div className="text-xs text-muted-foreground">
                  Replies will go to you (the organizer). Sends can't be undone or recalled.
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('compose')} disabled={sending} className="gap-1.5">
                <Edit className="h-3.5 w-3.5" /> Back
              </Button>
              <Button onClick={handleSend} disabled={sending || !canCompose} className="gap-1.5">
                {sending ? 'Sending…' : (<>Send now <Send className="h-3.5 w-3.5" /></>)}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const AudienceCard = ({
  label, description, count, checked, onToggle,
}: {
  label: string;
  description: string;
  count: number | null;
  checked: boolean;
  onToggle: () => void;
}) => {
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className={`text-left rounded-md border p-3 transition-colors ${
        checked && !disabled
          ? 'border-primary/60 bg-primary/5'
          : 'border-border bg-background hover:border-primary/30'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs font-semibold text-primary">
          {count === null ? '…' : count}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{description}</p>
      {disabled && (
        <p className="text-[11px] text-muted-foreground mt-1">No one to send to.</p>
      )}
    </button>
  );
};

export default SendUpdateDialog;
