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
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import type { Deal } from '@/lib/crm/types';

interface LinkEventDialogProps {
  deal: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Ties a Hereday map to the deal so its published / handed-off / paid state shows here. */
const LinkEventDialog = ({ deal, open, onOpenChange }: LinkEventDialogProps) => {
  const { toast } = useToast();
  const link = useCrmAction('crm_link_event');
  const [ref, setRef] = useState('');

  useEffect(() => {
    if (open) setRef('');
  }, [open]);

  const save = () => {
    link.mutate(
      { p_deal_id: deal.id, p_event_ref: ref.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Map linked' });
          onOpenChange(false);
        },
        onError: (e) => toast({ title: "Couldn't link that map", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !link.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Link a Hereday map</DialogTitle>
          <DialogDescription>
            Paste the public link, the editor link or the slug. Once linked, publishing, handoff and payment show
            up here on their own.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="https://hereday.io/event/…"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ref.trim()) save();
          }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={link.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ref.trim() || link.isPending}>
            {link.isPending ? 'Linking…' : 'Link map'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LinkEventDialog;
