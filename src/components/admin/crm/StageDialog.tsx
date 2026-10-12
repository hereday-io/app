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
import { OUTCOMES, OUTCOME_LABELS, STAGES, STAGE_LABELS, type Outcome, type Stage } from '@/lib/crm/vocab';

interface StageDialogProps {
  deal: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DATED: Stage[] = ['sent', 'followed_up'];

/**
 * The manual correction tool. Logging an activity moves stages forward
 * on its own; this is for everything else (closing, reopening, fixing).
 */
const StageDialog = ({ deal, open, onOpenChange }: StageDialogProps) => {
  const { toast } = useToast();
  const setStage = useCrmAction('crm_set_stage');
  const [stage, setStageValue] = useState<Stage>(deal.stage);
  const [outcome, setOutcome] = useState<Outcome | ''>(deal.outcome ?? '');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setStageValue(deal.stage);
      setOutcome(deal.outcome ?? '');
      setDate(todayIso());
      setNote('');
    }
  }, [open, deal.stage, deal.outcome]);

  const needsOutcome = stage === 'closed';
  const canSave = !setStage.isPending && (!needsOutcome || !!outcome) && note.length <= 10000;
  const outboundBlocked = deal.is_dnc && ['drafted', 'sent', 'followed_up'].includes(stage);

  const save = () => {
    setStage.mutate(
      {
        p_deal_id: deal.id,
        p_stage: stage,
        p_outcome: needsOutcome ? outcome : null,
        p_note: note.trim() || null,
        p_occurred_on: DATED.includes(stage) ? date : null,
      },
      {
        onSuccess: () => {
          toast({ title: `Stage set to ${STAGE_LABELS[stage]}` });
          onOpenChange(false);
        },
        onError: (e) => toast({ title: "Couldn't change the stage", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !setStage.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Change stage</DialogTitle>
          <DialogDescription>
            Logging a send, call or reply moves the stage for you. Use this to close, reopen or correct.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="stage">Stage</Label>
            <Select value={stage} onValueChange={(v) => setStageValue(v as Stage)}>
              <SelectTrigger id="stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {outboundBlocked && (
              <p className="text-xs text-destructive">This contact asked not to be contacted.</p>
            )}
          </div>

          {needsOutcome && (
            <div className="space-y-1.5">
              <Label htmlFor="outcome">Outcome</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as Outcome)}>
                <SelectTrigger id="outcome">
                  <SelectValue placeholder="Why is it closed?" />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOMES.filter((o) => o !== 'do_not_contact').map((o) => (
                    <SelectItem key={o} value={o}>
                      {OUTCOME_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                If they asked not to be contacted, use Do not contact instead. It's permanent.
              </p>
            </div>
          )}

          {DATED.includes(stage) && (
            <div className="space-y-1.5">
              <Label htmlFor="stage-date">When</Label>
              <Input id="stage-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="stage-note">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea id="stage-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={setStage.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave || outboundBlocked}>
            {setStage.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StageDialog;
