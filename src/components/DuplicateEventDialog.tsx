import { useState } from 'react';
import { format, addYears } from 'date-fns';
import { CalendarIcon, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SourceEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  route_count: number;
  poi_count: number;
}

interface DuplicateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: SourceEvent;
  userId: string;
  onCreated: (eventId: string) => void;
}

/** If the name contains a 4-digit year, increment it. Otherwise append " (Copy)". */
function suggestName(name: string): string {
  const match = name.match(/\b(20\d{2})\b/);
  if (match) return name.replace(match[1], String(parseInt(match[1]) + 1));
  return `${name} (Copy)`;
}

const DuplicateEventDialog = ({ open, onOpenChange, event, userId, onCreated }: DuplicateEventDialogProps) => {
  const [name, setName] = useState(() => suggestName(event.name));
  const [date, setDate] = useState<Date | undefined>(() => {
    if (!event.event_date) return undefined;
    return addYears(new Date(event.event_date + 'T00:00:00'), 1);
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleDuplicate = async () => {
    if (!name.trim()) return;
    setSaving(true);

    // Fetch source event's routes, pois, and city
    const { data: source, error: fetchError } = await supabase
      .from('events')
      .select('routes, pois, city')
      .eq('id', event.id)
      .single();

    if (fetchError || !source) {
      toast({ title: 'Could not read source event', variant: 'destructive' });
      setSaving(false);
      return;
    }

    const slug =
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 7);

    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: userId,
        name: name.trim(),
        city: source.city ?? null,
        event_date: date ? format(date, 'yyyy-MM-dd') : null,
        slug,
        status: 'draft',
        routes: source.routes ?? [],
        pois: source.pois ?? [],
        route_count: event.route_count,
        poi_count: event.poi_count,
      })
      .select('id')
      .single();

    if (error || !data) {
      toast({ title: 'Failed to duplicate event', description: error?.message, variant: 'destructive' });
    } else {
      onOpenChange(false);
      onCreated(data.id);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Copy className="h-4 w-4 text-primary" />
            Duplicate Event
          </DialogTitle>
          <DialogDescription>
            Creates a new draft with the same route and POIs as <strong>{event.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="dup-name">New event name</Label>
            <Input
              id="dup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Turkey Trot 2026"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Event date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  className={cn('p-3 pointer-events-auto')}
                />
              </PopoverContent>
            </Popover>
          </div>

          <p className="text-xs text-muted-foreground bg-secondary/60 rounded-lg px-3 py-2">
            The city, route, and all points of interest will be copied. You can make changes in the editor.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleDuplicate} disabled={saving || !name.trim()}>
              {saving ? 'Duplicating…' : 'Duplicate & Edit'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DuplicateEventDialog;
