import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import { todayIso } from '@/lib/crm/format';
import type { Deal } from '@/lib/crm/types';
import {
  ACTIVITY_LABELS,
  LOGGABLE_ACTIVITIES,
  OUTBOUND_ACTIVITIES,
  type LoggableActivity,
} from '@/lib/crm/vocab';

interface LogActivityDialogProps {
  deal: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: LoggableActivity;
}

const EFFECT: Partial<Record<LoggableActivity, string>> = {
  email_sent: 'Moves the deal to Sent and sets a follow-up 5 business days out.',
  form_submitted: 'Moves the deal to Sent and sets a follow-up 5 business days out.',
  followup_sent: 'Marks it followed up. One follow-up only, then close as no response.',
  call: 'First contact if nothing was sent yet, otherwise counts as the follow-up.',
  voicemail: 'First contact if nothing was sent yet, otherwise counts as the follow-up.',
  reply: 'Moves the deal to Replied. Paste what they said.',
  objection: 'Moves the deal to Replied and records the objection in their exact words.',
};

const LogActivityDialog = ({ deal, open, onOpenChange, initialType = 'note' }: LogActivityDialogProps) => {
  const { toast } = useToast();
  const log = useCrmAction('crm_log_activity');
  const [type, setType] = useState<LoggableActivity>(initialType);
  const [date, setDate] = useState(todayIso());
  const [body, setBody] = useState('');
  const [quote, setQuote] = useState('');

  useEffect(() => {
    if (open) {
      setType(initialType);
      setDate(todayIso());
      setBody('');
      setQuote('');
    }
  }, [open, initialType]);

  const wantsQuote = type === 'reply' || type === 'objection';
  const blocked = deal.is_dnc && OUTBOUND_ACTIVITIES.includes(type);
  const hasBody = body.trim().length > 0;
  const hasQuote = quote.trim().length > 0;
  const valid =
    (type === 'note' || type === 'research' ? hasBody : true) &&
    (type === 'objection' ? hasQuote : true) &&
    (type === 'reply' ? hasQuote || hasBody : true) &&
    body.length <= 10000 &&
    quote.length <= 5000;

  const save = () => {
    // Today means "just now"; an earlier day is logged at midday local.
    const occurredAt = date === todayIso() ? null : new Date(`${date}T12:00:00`).toISOString();
    log.mutate(
      {
        p_deal_id: deal.id,
        p_type: type,
        p_body: body.trim() || null,
        p_quote: wantsQuote ? quote.trim() || null : null,
        p_occurred_at: occurredAt,
      },
      {
        onSuccess: () => {
          toast({ title: `${ACTIVITY_LABELS[type]} logged` });
          onOpenChange(false);
        },
        onError: (e) => toast({ title: "Couldn't log that", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !log.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Log activity · {deal.race_name}</DialogTitle>
          <DialogDescription>{EFFECT[type] ?? 'Adds an entry to the timeline.'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="activity-type">What happened</Label>
              <Select value={type} onValueChange={(v) => setType(v as LoggableActivity)}>
                <SelectTrigger id="activity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOGGABLE_ACTIVITIES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACTIVITY_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-date">When</Label>
              <Input id="activity-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {blocked && (
            <p className="text-sm text-destructive">
              This contact asked not to be contacted. Outreach can't be logged.
            </p>
          )}

          {wantsQuote && (
            <div className="space-y-1.5">
              <Label htmlFor="activity-quote">
                Their exact words{type === 'objection' ? '' : ' (if any)'}
              </Label>
              <Textarea
                id="activity-quote"
                rows={3}
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="Paste it verbatim. Don't summarize."
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="activity-body">{wantsQuote ? 'Your notes (optional)' : 'Notes'}</Label>
            <Textarea id="activity-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={log.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || blocked || log.isPending}>
            {log.isPending ? 'Saving…' : 'Log it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LogActivityDialog;
