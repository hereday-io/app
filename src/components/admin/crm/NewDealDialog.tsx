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
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import type { Deal } from '@/lib/crm/types';
import { ORG_TYPES, ORG_TYPE_LABELS, type OrgType } from '@/lib/crm/vocab';

interface NewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}

/** A new lead. The creator owns it straight away (claim before you research). */
const NewDealDialog = ({ open, onOpenChange, onCreated }: NewDealDialogProps) => {
  const { toast } = useToast();
  const create = useCrmAction<{ deal: Deal }>('crm_create_deal');
  const [race, setRace] = useState('');
  const [date, setDate] = useState('');
  const [town, setTown] = useState('');
  const [tier, setTier] = useState<string>('');
  const [org, setOrg] = useState('');
  const [orgType, setOrgType] = useState<OrgType | ''>('');

  useEffect(() => {
    if (open) {
      setRace('');
      setDate('');
      setTown('');
      setTier('');
      setOrg('');
      setOrgType('');
    }
  }, [open]);

  const save = () => {
    create.mutate(
      {
        p_deal: {
          race_name: race.trim(),
          race_date: date || null,
          town: town.trim() || null,
          tier: tier ? Number(tier) : null,
          account_name: org.trim() || null,
          org_type: orgType || null,
        },
      },
      {
        onSuccess: (r) => {
          toast({ title: 'Deal created', description: "It's yours. Research it, then build the map." });
          onOpenChange(false);
          if (r?.deal?.slug) onCreated(r.deal.slug);
        },
        onError: (e) => toast({ title: "Couldn't create the deal", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">New deal</DialogTitle>
          <DialogDescription>
            One deal per race edition. If someone already has this race, you'll be told who.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nd-race">Race name, exactly as published</Label>
            <Input id="nd-race" value={race} onChange={(e) => setRace(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nd-date">Race date</Label>
            <Input id="nd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nd-town">Town</Label>
            <Input id="nd-town" value={town} onChange={(e) => setTown(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nd-org">Organization</Label>
            <Input id="nd-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nd-org-type">Type</Label>
            <Select value={orgType} onValueChange={(v) => setOrgType(v as OrgType)}>
              <SelectTrigger id="nd-org-type">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                {ORG_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ORG_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nd-tier">Tier</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger id="nd-tier">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 · McHenry + immediate NW</SelectItem>
                <SelectItem value="2">2 · Near NW / west suburbs</SelectItem>
                <SelectItem value="3">3 · Everything else in radius</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!race.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create and claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewDealDialog;
