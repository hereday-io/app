import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Radio, Link as LinkIcon, Lock } from 'lucide-react';
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
  tracking_start?: string | null;
  tracking_end?: string | null;
  /** Optional so existing call sites don't break. When present, the
   *  slug field surfaces as editable on drafts and read-only on
   *  published events (live links must stay stable). */
  status?: string;
  slug?: string | null;
}

/** Normalize a user-typed slug candidate. Kept generous — we only
 *  strip characters that would break a URL, we don't touch case or
 *  length. Supabase's unique index handles collisions. */
const normalizeSlug = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');

interface EditEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventData | null;
  onUpdated: () => void;
  /** Pass true when the event owner is on a Pro plan */
  isPro?: boolean;
}

/** Convert a TIMESTAMPTZ ISO string to a datetime-local input value (local tz). */
function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // yyyy-MM-ddTHH:mm in local timezone
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EditEventDialog = ({ open, onOpenChange, event, onUpdated, isPro }: EditEventDialogProps) => {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState<Date>();
  const [slug, setSlug] = useState('');
  const [trackingStart, setTrackingStart] = useState('');
  const [trackingEnd, setTrackingEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Published events lock the slug — once the organizer has shared the
  // URL to runners, SMS threads, Instagram stories, and race-day QR
  // codes, the one thing we cannot do is change it under them.
  const slugLocked = event?.status === 'published';

  useEffect(() => {
    if (event) {
      setName(event.name);
      setCity(event.city ?? '');
      setDate(event.event_date ? new Date(event.event_date + 'T00:00:00') : undefined);
      setSlug(event.slug ?? '');
      setTrackingStart(toLocalDatetime(event.tracking_start));
      setTrackingEnd(toLocalDatetime(event.tracking_end));
    }
  }, [event]);

  // Auto-suggest tracking window when event date changes and no tracking times set yet
  const suggestTrackingWindow = useMemo(() => {
    if (!date || trackingStart || trackingEnd) return null;
    const dayStr = format(date, 'yyyy-MM-dd');
    return { start: `${dayStr}T05:00`, end: `${dayStr}T23:00` };
  }, [isPro, date, trackingStart, trackingEnd]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !name.trim()) return;

    // Only push a slug change when the event is still a draft AND the
    // normalized value actually differs from what's on the row. Zero-
    // length slugs fall through — the DB has a NOT NULL constraint.
    const normalizedSlug = normalizeSlug(slug);
    const slugChanged =
      !slugLocked &&
      normalizedSlug.length > 0 &&
      normalizedSlug !== (event.slug ?? '');
    if (!slugLocked && slug.trim().length > 0 && normalizedSlug.length === 0) {
      toast({ title: 'Slug must contain letters or numbers', variant: 'destructive' });
      return;
    }

    setSaving(true);

    type UpdatePayload = {
      name: string;
      city: string | null;
      event_date: string | null;
      tracking_start: string | null;
      tracking_end: string | null;
      slug?: string;
    };
    const payload: UpdatePayload = {
      name: name.trim(),
      city: city.trim() || null,
      event_date: date ? format(date, 'yyyy-MM-dd') : null,
      tracking_start: trackingStart ? new Date(trackingStart).toISOString() : null,
      tracking_end: trackingEnd ? new Date(trackingEnd).toISOString() : null,
    };
    if (slugChanged) payload.slug = normalizedSlug;

    const { error } = await supabase.from('events').update(payload).eq('id', event.id);

    if (error) {
      // 23505 on slug means another event already owns this URL. Surface
      // it as something the user can actually fix instead of a raw
      // constraint error.
      const isSlugCollision = slugChanged && (error as { code?: string }).code === '23505';
      toast({
        title: isSlugCollision ? 'That URL is already taken' : 'Failed to update event',
        description: isSlugCollision ? 'Pick a different slug and try again.' : error.message,
        variant: 'destructive',
      });
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
          {/* Public URL slug — only editable while draft. Once the event
              is published, this field becomes a read-only display so
              the organizer never accidentally breaks a live share link. */}
          <div className="space-y-2">
            <Label htmlFor="edit-event-slug" className="flex items-center gap-1.5">
              <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Public URL
              {slugLocked && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full ml-1">
                  <Lock className="h-2.5 w-2.5" />
                  Locked
                </span>
              )}
            </Label>
            <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden">
              <span className="px-2.5 py-2 text-xs text-muted-foreground bg-muted/50 border-r border-border font-mono shrink-0">
                /event/
              </span>
              <Input
                id="edit-event-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="spring-marathon-2026"
                disabled={slugLocked}
                className="border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none font-mono text-xs"
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {slugLocked
                ? 'Slug is locked while the event is published — unpublish first to change it.'
                : 'Letters, numbers, and dashes. Customize it before publishing — once live, changing it breaks shared links.'}
            </p>
          </div>

          {/* Live Tracking Window */}
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Radio className="h-3.5 w-3.5 text-primary" />
              Live Tracking Window
            </div>
            {isPro ? (
              <>
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
                    <Label htmlFor="tracking-start" className="text-xs">Opens</Label>
                    <Input
                      id="tracking-start"
                      type="datetime-local"
                      value={trackingStart}
                      onChange={(e) => setTrackingStart(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tracking-end" className="text-xs">Closes</Label>
                    <Input
                      id="tracking-end"
                      type="datetime-local"
                      value={trackingEnd}
                      onChange={(e) => setTrackingEnd(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground leading-snug">
                  Let spectators watch runners move along the course in real time.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs border-primary text-primary hover:bg-primary/10"
                  onClick={() => window.open('/#pricing', '_blank')}
                >
                  Upgrade to Pro
                </Button>
              </div>
            )}
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
