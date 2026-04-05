import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import CitySearch from '@/components/editor/CitySearch';

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onCreated: (eventId: string, cityCenter: [number, number] | null) => void;
}

const CreateEventDialog = ({ open, onOpenChange, userId, onCreated }: CreateEventDialogProps) => {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityCenter, setCityCenter] = useState<[number, number] | null>(null);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { token: mapboxToken } = useMapboxToken();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).slice(2, 7);

    const { data, error } = await supabase.from('events').insert({
      user_id: userId,
      name: name.trim(),
      city: city.trim() || null,
      event_date: date || null,
      slug,
    }).select('id').single();

    if (error || !data) {
      toast({ title: 'Failed to create event', description: error?.message, variant: 'destructive' });
    } else {
      toast({ title: 'Event created' });
      const center = cityCenter;
      setName('');
      setCity('');
      setCityCenter(null);
      setDate('');
      onOpenChange(false);
      onCreated(data.id, center);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">New Event</DialogTitle>
          <DialogDescription>Create a new event map to get started.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="event-name">Event name *</Label>
            <Input
              id="event-name"
              placeholder="Spring Marathon 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>City</Label>
            {mapboxToken ? (
              <CitySearch
                value={city}
                onChange={(val, center) => {
                  setCity(val);
                  if (center) setCityCenter(center);
                }}
                token={mapboxToken}
              />
            ) : (
              <Input
                placeholder="San Francisco"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-date">Event date</Label>
            <Input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create Event'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateEventDialog;
