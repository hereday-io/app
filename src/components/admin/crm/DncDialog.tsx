import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import type { DealDetail } from '@/lib/crm/types';

interface DncDialogProps {
  detail: DealDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DncResult {
  closed_deal_ids: string[];
  draft_ids: string[];
}

/** Do not contact: permanent, and it closes every open deal with that person or organization. */
const DncDialog = ({ detail, open, onOpenChange }: DncDialogProps) => {
  const { toast } = useToast();
  const mark = useCrmAction<DncResult>('crm_mark_dnc');
  const hasContact = !!detail.contact;
  const hasAccount = !!detail.account;
  const [scope, setScope] = useState<'contact' | 'account'>(hasContact ? 'contact' : 'account');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setScope(hasContact ? 'contact' : 'account');
      setReason('');
    }
  }, [open, hasContact]);

  const trimmed = reason.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 500;

  const save = () => {
    mark.mutate(
      { p_deal_id: detail.deal.id, p_scope: scope, p_reason: trimmed },
      {
        onSuccess: (r) => {
          const drafts = r?.draft_ids ?? [];
          toast({
            title: 'Marked do not contact',
            description:
              `${r?.closed_deal_ids.length ?? 0} open deal(s) closed.` +
              (drafts.length ? ` Delete ${drafts.length} Gmail draft(s) for them: ${drafts.join(', ')}` : ''),
          });
          onOpenChange(false);
        },
        onError: (e) => toast({ title: "Couldn't mark do not contact", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !mark.isPending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Do not contact</AlertDialogTitle>
          <AlertDialogDescription>
            This is permanent. It closes every open deal for them, and nobody can log outreach to them again.
            Use it the moment anyone asks.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!hasContact && !hasAccount ? (
          <p className="text-sm text-muted-foreground">Add a contact or an organization first.</p>
        ) : (
          <div className="space-y-4 my-1">
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as 'contact' | 'account')} className="gap-2">
              {hasContact && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="contact" id="dnc-contact" />
                  <Label htmlFor="dnc-contact" className="font-normal">
                    This person
                    {detail.contact?.full_name ? ` (${detail.contact.full_name})` : ''}
                    {detail.contact && detail.contact.other_deal_count > 0
                      ? `, and their ${detail.contact.other_deal_count} other deal(s)`
                      : ''}
                  </Label>
                </div>
              )}
              {hasAccount && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="account" id="dnc-account" />
                  <Label htmlFor="dnc-account" className="font-normal">
                    The whole organization ({detail.account?.name})
                  </Label>
                </div>
              )}
            </RadioGroup>
            <div className="space-y-1.5">
              <Label htmlFor="dnc-reason">What they said</Label>
              <Textarea
                id="dnc-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Replied 10/14: please take us off your list"
              />
              {trimmed.length > 500 && <p className="text-xs text-destructive">Keep it under 500 characters.</p>}
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={mark.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              save();
            }}
            disabled={!valid || mark.isPending || (!hasContact && !hasAccount)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mark.isPending ? 'Saving…' : 'Mark do not contact'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DncDialog;
