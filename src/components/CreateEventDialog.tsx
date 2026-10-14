import { useState } from 'react';
import { Radio, Crown, Check } from 'lucide-react';
import { LIVE_TRACKING_ENABLED } from '@/lib/featureFlags';
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
import { reportError } from '@/lib/posthog';
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
  const [startTime, setStartTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [wantsPro, setWantsPro] = useState(false);
  const { toast } = useToast();
  const { token: mapboxToken } = useMapboxToken();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    // crypto.randomUUID() gives 122 bits of entropy → effectively zero collision
    // risk vs. the prior Math.random()-derived 5-char suffix (~26 bits) which
    // could collide on near-simultaneous creates and surface a confusing
    // unique-violation toast. Slice to 8 hex chars for a friendly URL.
    const slugSuffix = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + slugSuffix;

    const { data, error } = await supabase.from('events').insert({
      user_id: userId,
      name: name.trim(),
      city: city.trim() || null,
      event_date: date || null,
      start_time: startTime || null,
      slug,
    }).select('id').single();

    if (error || !data) {
      toast({ title: 'Failed to create event', description: error?.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // If the user selected Pro, redirect to Stripe checkout. If checkout
    // can't be opened the event still exists, so fall through to the
    // editor, where the upgrade button retries it.
    if (wantsPro && data.id) {
      try {
        const { data: checkout, error: checkoutErr } = await supabase.functions.invoke('create-checkout', {
          body: { eventId: data.id, returnUrl: `${window.location.origin}/editor?id=${data.id}` },
        });
        if (!checkoutErr && checkout?.url) {
          // Stripe checkout will redirect back; don't navigate to editor
          window.location.href = checkout.url;
          return;
        }
        reportError(checkoutErr ?? new Error('create-checkout returned no url'), {
          area: 'billing', action: 'create_checkout', hereday_event_id: data.id, trigger: 'create_dialog',
        });
      } catch (err) {
        reportError(err, {
          area: 'billing', action: 'create_checkout', hereday_event_id: data.id, trigger: 'create_dialog',
        });
      }
      toast({
        title: 'Event created',
        description: "Checkout didn't open and you haven't been charged. Upgrade from the editor to try again.",
      });
    } else {
      toast({ title: 'Event created' });
    }

    const center = cityCenter;
    setName('');
    setCity('');
    setCityCenter(null);
    setDate('');
    setStartTime('');
    setWantsPro(false);
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
          {/* Pro section — the create-time upgrade opt-in. Pro is per event
              (paid_at), and an event that doesn't exist yet hasn't been
              paid for, so the tracking-window fields live in the Edit
              dialog once the event is Pro. */}
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {LIVE_TRACKING_ENABLED ? (
                <><Radio className="h-3.5 w-3.5 text-primary" /> Live Tracking Window</>
              ) : (
                <><Crown className="h-3.5 w-3.5 text-primary" /> Go Pro</>
              )}
            </div>
            {wantsPro ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-amber-600" />
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Pro upgrade selected</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWantsPro(false)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Remove
                  </button>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  You'll be taken to checkout after creating this event. Unlimited routes & markers and custom branding included.
                </p>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground leading-snug">
                  {LIVE_TRACKING_ENABLED
                    ? 'Let spectators watch runners move along the course in real time.'
                    : 'Unlock unlimited routes & markers and custom branding.'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs border-primary text-primary hover:bg-primary/10"
                  onClick={() => setWantsPro(true)}
                >
                  Upgrade to Pro
                </Button>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()} className={wantsPro ? 'gap-2 bg-amber-600 hover:bg-amber-700' : ''}>
              <>{wantsPro && <Crown className="h-3.5 w-3.5" />}{saving ? 'Creating…' : wantsPro ? 'Create & Upgrade — $49' : 'Create Event'}</>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateEventDialog;
