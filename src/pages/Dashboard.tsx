import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Route, MapPinned, Plus, LogOut, FileText, MoreVertical, Pencil, Trash2, Globe, EyeOff, Link, Copy, ExternalLink, Calendar } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import CreateEventDialog from '@/components/CreateEventDialog';
import EditEventDialog from '@/components/EditEventDialog';
import DeleteEventDialog from '@/components/DeleteEventDialog';
import DuplicateEventDialog from '@/components/DuplicateEventDialog';
import EventWeatherBadge from '@/components/EventWeatherBadge';
import { logEvent } from '@/lib/analytics';

interface Event {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  status: string;
  slug: string | null;
  route_count: number;
  poi_count: number;
  created_at: string;
  routes?: Array<{ routeCoords?: [number, number][]; waypoints?: [number, number][] }>;
}

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickCreating, setQuickCreating] = useState(false);
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null);
  const [duplicateEvent, setDuplicateEvent] = useState<Event | null>(null);
  const navigate = useNavigate();
  const menuActionRef = useRef(false);

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

  const handleQuickCreate = async () => {
    const name = quickName.trim();
    if (!name || !user || quickCreating) return;
    setQuickCreating(true);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).slice(2, 7);
    const { data, error } = await supabase
      .from('events')
      .insert({ user_id: user.id, name, slug })
      .select('id')
      .single();
    setQuickCreating(false);
    if (error || !data) {
      toast({ title: 'Failed to create event', description: error?.message, variant: 'destructive' });
      return;
    }
    logEvent('event_created', data.id, { source: 'dashboard_quick' });
    setQuickName('');
    navigate(`/editor?id=${data.id}`);
  };

  const toggleStatus = async (event: Event) => {
    const newStatus = event.status === 'published' ? 'draft' : 'published';
    await supabase.from('events').update({ status: newStatus }).eq('id', event.id);
    fetchEvents();
  };

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
    { label: 'Published', value: publishedCount, icon: Globe, color: 'text-emerald-500' },
    { label: 'Drafts', value: draftCount, icon: FileText, color: 'text-muted-foreground' },
    { label: 'Routes', value: totalRoutes, icon: Route, color: 'text-primary' },
    { label: 'Places', value: totalPois, icon: MapPinned, color: 'text-primary' },
  ];

  const userInitials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between py-2 px-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-2" />
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-border flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-primary">{userInitials}</span>
              </div>
              <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your event maps</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Input
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleQuickCreate();
                  }
                }}
                placeholder="Name your next event…"
                disabled={quickCreating}
                className="h-10 w-60 pr-10"
              />
              <button
                onClick={handleQuickCreate}
                disabled={!quickName.trim() || quickCreating}
                title="Create event (Enter)"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)} className="text-muted-foreground">
              Advanced
            </Button>
          </div>
        </div>

        {/* Stats — only shown once there's something to count */}
        {events.length > 0 && (
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
        )}

        {/* Event List */}{(() => {
          if (events.length === 0) {
            return (
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
            );
          }

          const today = new Date().toISOString().split('T')[0];
          const upcoming = events.filter((e) => !e.event_date || e.event_date >= today);
          const past = events.filter((e) => e.event_date && e.event_date < today);

          const formatDate = (dateStr: string) =>
            new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

          const renderCard = (event: Event, opts: { isPast?: boolean } = {}) => {
            const isPublished = event.status === 'published';
            const nextYearLabel = (() => {
              const match = event.name.match(/\b(20\d{2})\b/);
              if (match) return String(parseInt(match[1], 10) + 1);
              if (event.event_date) return String(new Date(event.event_date + 'T00:00:00').getFullYear() + 1);
              return 'next year';
            })();
            return (
              <Card
                key={event.id}
                className="border-border/60 hover:shadow-sm hover:border-border transition-all cursor-pointer relative overflow-hidden"
                onClick={() => {
                  if (menuActionRef.current) { menuActionRef.current = false; return; }
                  navigate(`/editor?id=${event.id}`);
                }}
              >
                {/* Status accent bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${isPublished ? 'bg-emerald-500' : 'bg-border'}`} />

                <CardContent className="pl-6 pr-4 py-4 flex items-center justify-between gap-4">
                  {/* Left: name + meta */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-semibold truncate">{event.name}</h3>
                      {isPublished
                        ? <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">Live</span>
                        : <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">Draft</span>
                      }
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">
                      {event.city ?? 'No city set'}
                      {event.event_date && (
                        <><span className="mx-1.5">·</span><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3 inline" /> {formatDate(event.event_date)}</span></>
                      )}
                    </p>
                  </div>

                  {/* Right: counts + actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Route + POI counts */}
                    <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Route className="h-3.5 w-3.5" /> {event.route_count}</span>
                      <span className="flex items-center gap-1"><MapPinned className="h-3.5 w-3.5" /> {event.poi_count}</span>
                      {(() => {
                        const coord = event.routes?.[0]?.routeCoords?.[0] ?? event.routes?.[0]?.waypoints?.[0];
                        if (!event.event_date || !coord) return null;
                        return (
                          <EventWeatherBadge
                            eventDate={event.event_date}
                            lat={coord[1]}
                            lon={coord[0]}
                          />
                        );
                      })()}
                    </div>

                    {/* Past events: primary duplicate affordance. The #1 retention lever for
                        seasonal organizers — surface it directly on the card instead of burying
                        it in the dropdown. */}
                    {opts.isPast && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 hidden sm:inline-flex items-center gap-1.5 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          menuActionRef.current = true;
                          logEvent('duplicate_clicked', event.id, { source: 'past_event_card' });
                          setDuplicateEvent(event);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Duplicate for {nextYearLabel}
                      </Button>
                    )}

                    {/* View live — published only */}
                    {isPublished && event.slug && (
                      <a
                        href={`/event/${event.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); menuActionRef.current = true; }}
                        className="hidden sm:flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { menuActionRef.current = true; toggleStatus(event); }}>
                          {isPublished
                            ? <><EyeOff className="h-4 w-4 mr-2" /> Unpublish</>
                            : <><Globe className="h-4 w-4 mr-2" /> Publish</>}
                        </DropdownMenuItem>
                        {isPublished && event.slug && (
                          <DropdownMenuItem onClick={() => {
                            menuActionRef.current = true;
                            navigator.clipboard.writeText(`${window.location.origin}/event/${event.slug}`);
                            toast({ title: 'Share link copied!' });
                          }}>
                            <Link className="h-4 w-4 mr-2" /> Copy share link
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => { menuActionRef.current = true; navigate(`/editor?id=${event.id}`); }}>
                          <Pencil className="h-4 w-4 mr-2" /> Open Editor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { menuActionRef.current = true; setDuplicateEvent(event); }}>
                          <Copy className="h-4 w-4 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { menuActionRef.current = true; setEditEvent(event); }}>
                          <FileText className="h-4 w-4 mr-2" /> Edit Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { menuActionRef.current = true; setDeleteEvent(event); }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          };

          return (
            <div className="space-y-8">
              {upcoming.length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-lg font-display font-semibold">Your Events</h2>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">{upcoming.length}</span>
                  </div>
                  <div className="grid gap-3">{upcoming.map(renderCard)}</div>
                </div>
              )}
              {past.length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-lg font-display font-semibold text-muted-foreground">Past Events</h2>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="grid gap-3">{past.map((e) => renderCard(e, { isPast: true }))}</div>
                </div>
              )}
            </div>
          );
        })()}
      </main>

      {user && (
        <CreateEventDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          userId={user.id}
          onCreated={(eventId, cityCenter) => {
            fetchEvents();
            const params = new URLSearchParams({ id: eventId });
            if (cityCenter) {
              params.set('lng', String(cityCenter[0]));
              params.set('lat', String(cityCenter[1]));
            }
            navigate(`/editor?${params.toString()}`);
          }}
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

      {duplicateEvent && user && (
        <DuplicateEventDialog
          open={!!duplicateEvent}
          onOpenChange={(open) => !open && setDuplicateEvent(null)}
          event={duplicateEvent}
          userId={user.id}
          onCreated={(eventId) => {
            fetchEvents();
            navigate(`/editor?id=${eventId}`);
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;
