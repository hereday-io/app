import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import RunnerView from '@/components/public/RunnerView';
import SpectatorView from '@/components/public/SpectatorView';
import { MapPin, Calendar, Trophy, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PublicEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  routes: EventRoute[];
  pois: RoutePoi[];
  route_count: number;
  poi_count: number;
}

type ViewMode = 'landing' | 'runner' | 'spectator';

const EventPublic = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('landing');

  useEffect(() => {
    if (!slug) return;
    supabase
      .from('events')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast({ title: 'Event not found', description: 'This event may not be published yet.', variant: 'destructive' });
          setLoading(false);
          return;
        }
        setEvent({
          id: data.id,
          name: data.name,
          city: data.city,
          event_date: data.event_date,
          routes: (data.routes as unknown as EventRoute[]) || [],
          pois: (data.pois as unknown as RoutePoi[]) || [],
          route_count: data.route_count,
          poi_count: data.poi_count,
        });
        setLoading(false);
      });
  }, [slug, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground text-lg">Loading event…</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Event Not Found</h1>
        <p className="text-muted-foreground">This event doesn't exist or hasn't been published yet.</p>
        <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
      </div>
    );
  }

  if (viewMode === 'runner') {
    return <RunnerView event={event} onBack={() => setViewMode('landing')} />;
  }

  if (viewMode === 'spectator') {
    return <SpectatorView event={event} onBack={() => setViewMode('landing')} />;
  }

  // Landing page with role selection
  const formattedDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.08),transparent_60%)]" />
        <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-12 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <MapPin className="w-4 h-4" />
            {event.city || 'Event'}
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            {event.name}
          </h1>

          {formattedDate && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
              <Calendar className="w-4 h-4" />
              <span>{formattedDate}</span>
            </div>
          )}

          <p className="text-muted-foreground mt-4 max-w-md mx-auto">
            {event.route_count} route{event.route_count !== 1 ? 's' : ''} · {event.poi_count} point{event.poi_count !== 1 ? 's' : ''} of interest
          </p>
        </div>
      </div>

      {/* Role selection */}
      <div className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full">
          {/* Runner card */}
          <button
            onClick={() => setViewMode('runner')}
            className="group relative rounded-xl border border-border bg-card p-8 text-left transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <div className="mb-4 inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Trophy className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              I'm Running
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              View the full course with route details, aid stations, water stops, and everything you need on race day.
            </p>
            <div className="mt-4 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
              View runner map →
            </div>
          </button>

          {/* Spectator card */}
          <button
            onClick={() => setViewMode('spectator')}
            className="group relative rounded-xl border border-border bg-card p-8 text-left transition-all hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <div className="mb-4 inline-flex items-center justify-center w-14 h-14 rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
              <Eye className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              I'm Spectating
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Find the best viewing spots, parking, restrooms, and amenities to cheer on your runner.
            </p>
            <div className="mt-4 text-sm font-medium text-accent opacity-0 group-hover:opacity-100 transition-opacity">
              View spectator map →
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default EventPublic;
