import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { errorToast } from '@/lib/userFacingError';

interface DeleteEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  eventName: string;
  onDeleted: () => void;
}

const DeleteEventDialog = ({ open, onOpenChange, eventId, eventName, onDeleted }: DeleteEventDialogProps) => {
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    if (!eventId) return;
    setDeleting(true);

    const { data: rows, error } = await supabase.from('events').delete().eq('id', eventId).select('id');

    if (error) {
      toast(errorToast(error, { action: 'delete this event', logLabel: 'DeleteEventDialog delete' }));
    } else if ((rows?.length ?? 0) === 0) {
      // RLS matched no row — nothing was deleted, so don't say it was.
      toast({
        title: "Can't delete: you no longer have access to this event",
        description: 'It may have been moved to another account. Reload to check.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Event deleted' });
      onOpenChange(false);
      onDeleted();
    }
    setDeleting(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete "{eventName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The event and all its data will be permanently removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteEventDialog;
