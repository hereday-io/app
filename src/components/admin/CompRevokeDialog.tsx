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
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface CompRevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grantId: string | null;
  targetEmail: string | null;
  onRevoked: () => void;
}

const CompRevokeDialog = ({
  open,
  onOpenChange,
  grantId,
  targetEmail,
  onRevoked,
}: CompRevokeDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= 3 && trimmed.length <= 500;

  const handleRevoke = async () => {
    if (!grantId || !user || !reasonValid) return;
    setSubmitting(true);

    const { error } = await supabase
      .from('comp_grants' as never)
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: user.id,
        revoke_reason: trimmed,
      } as never)
      .eq('id', grantId);

    setSubmitting(false);

    if (error) {
      toast({
        title: 'Failed to revoke comp',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Comp revoked',
      description: `Pro access removed for ${targetEmail ?? 'user'}. Stripe-paid events are unaffected.`,
    });
    setReason('');
    onOpenChange(false);
    onRevoked();
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">
            Revoke comp Pro from {targetEmail ?? 'this user'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Events the user paid for via Stripe will keep their Pro status. Only events that became Pro
            from this comp will return to free.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 my-2">
          <label className="text-sm font-medium" htmlFor="comp-revoke-reason">
            Reason <span className="text-muted-foreground">(required, 3-500 chars)</span>
          </label>
          <Textarea
            id="comp-revoke-reason"
            placeholder="e.g. Trial period ended — converted to paid plan"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            disabled={submitting}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleRevoke();
            }}
            disabled={submitting || !reasonValid}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? 'Revoking…' : 'Revoke comp'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CompRevokeDialog;
