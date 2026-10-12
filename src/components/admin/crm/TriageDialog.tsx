import { useEffect, useMemo, useState } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction, useDeals } from '@/hooks/crm/useCrm';
import type { Deal, Signup, SignupEvent } from '@/lib/crm/types';
import { cn } from '@/lib/utils';

interface TriageDialogProps {
  signup: Signup | null;
  event: SignupEvent | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}

type Action = 'link' | 'create' | 'dismiss';

const REASON_LABEL: Record<string, string> = {
  contact: 'their email is on this deal',
  transfer: 'we handed them a map from this deal',
  name: 'similar race name',
};

/** One untriaged event: link it to a deal, make a new inbound deal, or dismiss it. */
const TriageDialog = ({ signup, event, onOpenChange, onCreated }: TriageDialogProps) => {
  const { toast } = useToast();
  const triage = useCrmAction<{ deal?: Deal }>('crm_triage_event');
  const { data: deals = [] } = useDeals(true);
  const [action, setAction] = useState<Action>('create');
  const [dealId, setDealId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');

  const open = !!signup && !!event;
  const suggestions = useMemo(() => signup?.suggestions ?? [], [signup]);

  // Reset per event, not per refetch: the signups list refetches on
  // window focus and must not wipe a half-made choice.
  const eventId = event?.event_id ?? null;
  useEffect(() => {
    if (!eventId) return;
    setAction(suggestions.length ? 'link' : 'create');
    setDealId(suggestions[0]?.deal_id ?? null);
    setSearch('');
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = q
      ? deals.filter((d) => [d.race_name, d.slug, d.town ?? '', d.account_name ?? ''].some((v) => v.toLowerCase().includes(q)))
      : deals.filter((d) => suggestions.some((s) => s.deal_id === d.id));
    return pool.slice(0, 8);
  }, [deals, search, suggestions]);

  const valid =
    action === 'create' || (action === 'link' && !!dealId) || (action === 'dismiss' && reason.trim().length > 0);

  const save = () => {
    if (!event) return;
    triage.mutate(
      {
        p_event_id: event.event_id,
        p_action: action,
        p_deal_id: action === 'link' ? dealId : null,
        p_reason: action === 'dismiss' ? reason.trim() : null,
      },
      {
        onSuccess: (r) => {
          toast({ title: action === 'dismiss' ? 'Dismissed' : action === 'link' ? 'Linked' : 'Deal created' });
          onOpenChange(false);
          if (action === 'create' && r?.deal?.slug) onCreated(r.deal.slug);
        },
        onError: (e) => toast({ title: "Couldn't triage it", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !triage.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{event?.name}</DialogTitle>
          <DialogDescription>
            By {signup?.display_name || signup?.email}
            {signup?.organization_name ? ` · ${signup.organization_name}` : ''}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={action} onValueChange={(v) => setAction(v as Action)} className="gap-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="link" id="t-link" />
            <Label htmlFor="t-link" className="font-normal">Link to a deal we already have</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="create" id="t-create" />
            <Label htmlFor="t-create" className="font-normal">New inbound customer (creates a deal you own)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="dismiss" id="t-dismiss" />
            <Label htmlFor="t-dismiss" className="font-normal">Not a customer (test, duplicate, spam)</Label>
          </div>
        </RadioGroup>

        {action === 'link' && (
          <div className="space-y-2">
            <Input placeholder="Search deals by race, town or organization" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-56 overflow-y-auto divide-y divide-border rounded-md border border-border">
              {matches.length === 0 ? (
                <p className="text-[13px] text-muted-foreground p-3">
                  {search ? 'No deals match.' : 'No suggested matches. Search for one.'}
                </p>
              ) : (
                matches.map((d) => {
                  const why = suggestions.find((s) => s.deal_id === d.id)?.reason;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDealId(d.id)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-[13px] hover:bg-muted/50',
                        dealId === d.id && 'bg-primary/10',
                      )}
                    >
                      <span className="font-medium text-foreground">{d.race_name}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {d.town ?? d.slug}
                        {why ? ` · ${REASON_LABEL[why] ?? why}` : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {action === 'dismiss' && (
          <div className="space-y-1.5">
            <Label htmlFor="t-reason">Why</Label>
            <Input id="t-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Kevin's test event" />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={triage.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || triage.isPending}>
            {triage.isPending ? 'Saving…' : action === 'dismiss' ? 'Dismiss' : action === 'link' ? 'Link' : 'Create deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TriageDialog;
