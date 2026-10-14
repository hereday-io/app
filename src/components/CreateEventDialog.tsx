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
import { errorToast } from '@/lib/userFacingError';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import CitySearch from '@/components/editor/CitySearch';
import { normalizeSlug, isUniqueViolation, withRandomTail } from '@/lib/slug';

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
  const [startTime, setStartTime] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { token: mapboxToken } = useMapboxToken();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    // The plain name: the events_unique_slug trigger adds -2, -3… if the
    // URL is taken. One retry with a random tail covers a create racing
    // another for the same name.
    const slug = normalizeSlug(name);
    const insert = (s: string) => supabase.from('events').insert({
      user_id: userId,
      name: name.trim(),
      city: city.trim() || null,
      event_date: date || null,
      start_time: startTime || null,
      slug: s,
    }).select('id').single();
    let { data, error } = await insert(slug);
    if (isUniqueViolation(error)) ({ data, error } = await insert(withRandomTail(slug)));

    if (error || !data) {
      toast(errorToast(error, { action: 'create your event', logLabel: 'CreateEventDialog insert' }));
      setSaving(false);
      return;
    }

    toast({ title: 'Event created' });

    const center = cityCenter;
    setName('');
    setCity('');
    setCityCenter(null);
    setDate('');
    setStartTime('');
    onOpenChange(false);
    onCreated(data.id, center);
    setSaving(false);
  };

  // Treat the form as dirty once the user has typed anything meaningful
  // so the cancel/backdrop close path can confirm before discarding.
  // Ignores the tracking-window defaults (start/end/startTime often get
  // auto-filled alongside date — that's not "user input").
  const isDirty = Boolean(name.trim() || city.trim() || date || startTime);

  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty && !saving) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm('Discard your changes?');
      if (!ok) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="event-date">Event date</Label>
              <Input
                id="event-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-start-time">Start time</Label>
              <Input
                id="event-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="07:00"
              />
            </div>
          </div>
          {/* No Pro offer here: nobody has seen the event yet, so there's
              nothing to pay for. Pro is offered where it earns its place —
              hitting a limit, branding, the Ops Center, and after publish. */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
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
