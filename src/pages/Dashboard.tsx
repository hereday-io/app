import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MapPin, Calendar, Route, MapPinned, Plus, LogOut, FileText, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import CreateEventDialog from '@/components/CreateEventDialog';
import EditEventDialog from '@/components/EditEventDialog';
import DeleteEventDialog from '@/components/DeleteEventDialog';

interface Event {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  status: string;
  route_count: number;
  poi_count: number;
  created_at: string;
}

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setEvents(data ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const publishedCount = events.filter((e) => e.status === 'published').length;
  const draftCount = events.filter((e) => e.status === 'draft').length;
  const totalRoutes = events.reduce((sum, e) => sum + e.route_count, 0);
  const totalPois = events.reduce((sum, e) => sum + e.poi_count, 0);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Events', value: events.length, icon: FileText, color: 'text-primary' },
    { label: 'Published', value: publishedCount, icon: MapPin, color: 'text-accent' },
    { label: 'Drafts', value: draftCount, icon: Calendar, color: 'text-warning' },
    { label: 'Routes', value: totalRoutes, icon: Route, color: 'text-primary' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-2 text-primary">
            <MapPin className="h-6 w-6" />
            <span className="text-xl font-display font-bold tracking-tight">Event Mapper</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your event maps</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Event
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="border-border/60">
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-3xl font-display font-bold mt-1">{stat.value}</p>
                  </div>
                  <stat.icon className={`h-8 w-8 ${stat.color} opacity-60`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Event List */}
        <div>
          <h2 className="text-lg font-display font-semibold mb-4">Your Events</h2>
          {events.length === 0 ? (
            <Card className="border-border/60 border-dashed">
              <CardContent className="py-16 text-center">
                <MapPinned className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
                <h3 className="font-display font-semibold text-lg mb-1">No events yet</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Create your first event to start mapping routes and points of interest.
                </p>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Event
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {events.map((event) => (
                <Card
                  key={event.id}
                  className="border-border/60 hover:border-primary/30 transition-colors cursor-pointer"
                >
                  <CardContent className="py-4 px-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <MapPin className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-display font-semibold">{event.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {event.city ?? 'No city set'}
                          {event.event_date && ` · ${new Date(event.event_date).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="hidden sm:flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Route className="h-3.5 w-3.5" /> {event.route_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPinned className="h-3.5 w-3.5" /> {event.poi_count}
                        </span>
                      </div>
                      <Badge
                        variant={event.status === 'published' ? 'default' : 'secondary'}
                        className={
                          event.status === 'published'
                            ? 'bg-accent text-accent-foreground'
                            : ''
                        }
                      >
                        {event.status}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditEvent(event)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteEvent(event)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {user && (
        <CreateEventDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          userId={user.id}
          onCreated={fetchEvents}
        />
      )}

      <EditEventDialog
        open={!!editEvent}
        onOpenChange={(open) => !open && setEditEvent(null)}
        event={editEvent}
        onUpdated={fetchEvents}
      />

      <DeleteEventDialog
        open={!!deleteEvent}
        onOpenChange={(open) => !open && setDeleteEvent(null)}
        eventId={deleteEvent?.id ?? null}
        eventName={deleteEvent?.name ?? ''}
        onDeleted={fetchEvents}
      />
    </div>
  );
};

export default Dashboard;
