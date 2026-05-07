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

interface CompGrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId: string | null;
  targetEmail: string | null;
  onGranted: () => void;
}

const CompGrantDialog = ({
  open,
  onOpenChange,
  targetUserId,
  targetEmail,
  onGranted,
}: CompGrantDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= 3 && trimmed.length <= 500;

  const handleGrant = async () => {
    if (!targetUserId || !user || !reasonValid) return;
    setSubmitting(true);

    const { error } = await supabase
      // comp_grants table is added in migration 20260504120000_comp_grants.sql.
      // Cast the table name through `from(... as never)` until generated types catch up.
      .from('comp_grants' as never)
      .insert({
        user_id: targetUserId,
        granted_by: user.id,
        grant_reason: trimmed,
      } as never);

    setSubmitting(false);

    if (error) {
      toast({
        title: 'Failed to grant comp',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Comp granted', description: `${targetEmail ?? 'User'} now has Pro on all events.` });
    setReason('');
    onOpenChange(false);
    onGranted();
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Grant comp Pro to {targetEmail ?? 'this user'}?</AlertDialogTitle>
          <AlertDialogDescription>
            Every event this user owns — existing and any they create later — will be marked Pro until you
            revoke this grant. This is reversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 my-2">
          <label className="text-sm font-medium" htmlFor="comp-grant-reason">
            Reason <span className="text-muted-foreground">(required, 3-500 chars)</span>
          </label>
          <Textarea
            id="comp-grant-reason"
            placeholder="e.g. Early adopter — partner event for May 2026 conference"
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
              handleGrant();
            }}
            disabled={submitting || !reasonValid}
          >
            {submitting ? 'Granting…' : 'Grant comp'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CompGrantDialog;
