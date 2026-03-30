import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
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

interface EventData {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
}

interface EditEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventData | null;
  onUpdated: () => void;
}

const EditEventDialog = ({ open, onOpenChange, event, onUpdated }: EditEventDialogProps) => {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState<Date>();
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (event) {
      setName(event.name);
      setCity(event.city ?? '');
      setDate(event.event_date ? new Date(event.event_date + 'T00:00:00') : undefined);
    }
  }, [event]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !name.trim()) return;
    setSaving(true);

    const { error } = await supabase
      .from('events')
      .update({
        name: name.trim(),
        city: city.trim() || null,
        event_date: date ? format(date, 'yyyy-MM-dd') : null,
      })
      .eq('id', event.id);

    if (error) {
      toast({ title: 'Failed to update event', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Event updated' });
      onOpenChange(false);
      onUpdated();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Edit Event</DialogTitle>
          <DialogDescription>Update your event details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="edit-event-name">Event name *</Label>
            <Input
              id="edit-event-name"
              placeholder="Spring Marathon 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-event-city">City</Label>
            <Input
              id="edit-event-city"
              placeholder="San Francisco"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Event date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
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
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditEventDialog;
