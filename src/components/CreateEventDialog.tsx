import { useState, useMemo } from 'react';
import { Radio } from 'lucide-react';
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
  isPro?: boolean;
}

const CreateEventDialog = ({ open, onOpenChange, userId, onCreated, isPro }: CreateEventDialogProps) => {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityCenter, setCityCenter] = useState<[number, number] | null>(null);
  const [date, setDate] = useState('');
  const [trackingStart, setTrackingStart] = useState('');
  const [trackingEnd, setTrackingEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { token: mapboxToken } = useMapboxToken();

  const suggestTrackingWindow = useMemo(() => {
    if (!date || trackingStart || trackingEnd) return null;
    return { start: `${date}T05:00`, end: `${date}T23:00` };
  }, [date, trackingStart, trackingEnd]);

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
      ...(trackingStart && trackingEnd ? {
        tracking_start: new Date(trackingStart).toISOString(),
        tracking_end: new Date(trackingEnd).toISOString(),
      } : {}),
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
      setTrackingStart('');
      setTrackingEnd('');
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
          {/* Live Tracking Window — only shown for Pro users */}
          {isPro && (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Radio className="h-3.5 w-3.5 text-primary" />
                Live Tracking Window
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                Runners can only share their GPS location within this window.
              </p>
              {suggestTrackingWindow && (
                <button
                  type="button"
                  onClick={() => {
                    setTrackingStart(suggestTrackingWindow.start);
                    setTrackingEnd(suggestTrackingWindow.end);
                  }}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  Auto-fill: event day 5 AM – 11 PM
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="create-tracking-start" className="text-xs">Opens</Label>
                  <Input
                    id="create-tracking-start"
                    type="datetime-local"
                    value={trackingStart}
                    onChange={(e) => setTrackingStart(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="create-tracking-end" className="text-xs">Closes</Label>
                  <Input
                    id="create-tracking-end"
                    type="datetime-local"
                    value={trackingEnd}
                    onChange={(e) => setTrackingEnd(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>
          )}

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
