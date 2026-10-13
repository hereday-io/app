import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
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
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TransferResult {
  event_id: string;
  event_slug: string | null;
  event_name: string;
  to_email: string;
  pro_source: string;
}

interface TransferEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  eventName: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  /** One line describing what happens to Pro, e.g. "Stays Pro". */
  proSummary: string;
  onTransferred: (result: TransferResult) => void;
}

const TransferEventDialog = ({
  open,
  onOpenChange,
  eventId,
  eventName,
  fromEmail,
  toEmail,
  proSummary,
  onTransferred,
}: TransferEventDialogProps) => {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = note.trim();
  const noteValid = trimmed.length <= 500;

  const handleTransfer = async () => {
    if (!eventId || !toEmail || !noteValid) return;
    setSubmitting(true);

    const { data, error } = await supabase.rpc('admin_transfer_event', {
      p_event_id: eventId,
      p_to_email: toEmail,
      p_note: trimmed || undefined, // omitted → the RPC's DEFAULT NULL
    });

    setSubmitting(false);

    if (error) {
      toast({
        title: 'Transfer failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const rows: TransferResult[] = data ?? [];
    if (rows.length === 0) {
      toast({ title: 'Transfer failed', description: 'No result returned.', variant: 'destructive' });
      return;
    }

    toast({ title: 'Map transferred', description: `${rows[0].event_name} now belongs to ${rows[0].to_email}.` });
    setNote('');
    onOpenChange(false);
    onTransferred(rows[0]);
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">
            Move {eventName ?? 'this event'} to {toEmail ?? 'this user'}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {toEmail ?? 'They'} becomes the only owner and can edit and publish it.
                It will leave {fromEmail ?? 'the current owner'}&apos;s dashboard.
              </p>
              <p>
                The public link stays the same. Pro: <span className="font-medium text-foreground">{proSummary}</span>
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 my-2">
          <label className="text-sm font-medium" htmlFor="transfer-note">
            Note <span className="text-muted-foreground">(optional, for the history log)</span>
          </label>
          <Textarea
            id="transfer-note"
            placeholder="e.g. Outreach handoff, director replied 10/14"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            disabled={submitting}
          />
          {!noteValid && (
            <p className="text-xs text-destructive">Keep the note under 500 characters.</p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleTransfer();
            }}
            disabled={submitting || !noteValid}
          >
            {submitting ? 'Transferring…' : 'Transfer map'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default TransferEventDialog;
