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
import { Eye, Users, Plus, LogOut, FileText, MoreVertical, Pencil, Trash2, Globe, EyeOff, Link, Copy, ExternalLink, Calendar, BarChart3, Search, X, Route, MapPinned } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import CreateEventDialog from '@/components/CreateEventDialog';

import EditEventDialog from '@/components/EditEventDialog';
import DeleteEventDialog from '@/components/DeleteEventDialog';
import DuplicateEventDialog from '@/components/DuplicateEventDialog';
import EventWeatherBadge from '@/components/EventWeatherBadge';
import EventAnalyticsSheet from '@/components/EventAnalyticsSheet';
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
  tracking_start?: string | null;
  tracking_end?: string | null;
  plan?: string | null;
  paid_at?: string | null;
}

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // Per-event analytics totals for dashboard stat cards
  const [viewsByEvent, setViewsByEvent] = useState<Record<string, number>>({});
  const [subsByEvent, setSubsByEvent] = useState<Record<string, number>>({});
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null);
  const [duplicateEvent, setDuplicateEvent] = useState<Event | null>(null);
  const [analyticsEvent, setAnalyticsEvent] = useState<Event | null>(null);
  const [isPro, setIsPro] = useState(false);
  // Pulled from profiles.display_name so the top-right avatar + welcome
  // header stop showing the email slug. Falls back to user metadata (for
  // the first render before profiles hydrates) then to the email prefix.
  const [displayName, setDisplayName] = useState<string | null>(null);
  // Search + status filter — only surfaced once the list stops fitting
  // on one screen. A race-series organizer running 3+ events/year hits
  // this immediately; a first-timer with 1 event should never see it.
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'draft' | 'past'>('all');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const menuActionRef = useRef(false);

  // Cmd/Ctrl-K focuses the dashboard search (same shortcut as Linear/Notion).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (searchInputRef.current) {
          e.preventDefault();
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
    if (!authLoading && user) {
      logEvent('dashboard_viewed');
    }
  }, [user, authLoading, navigate]);

  // Fetch user plan status + display name
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('is_paid, plan, display_name').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (!data) return;
        setIsPro(data.plan === 'pro' || data.is_paid === true);
        if (data.display_name) setDisplayName(data.display_name);
      });
  }, [user]);

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    const evts = (data ?? []) as unknown as Event[];
    setEvents(evts);
    setLoading(false);

    // Fetch page views + subscribers per event for dashboard stats
    const ids = evts.map((e) => e.id);
    if (ids.length > 0) {
      supabase
        .from('product_events')
        .select('event_id')
        .eq('event_type', 'public_view')
        .in('event_id', ids)
        .then(({ data: views }) => {
          const map: Record<string, number> = {};
          views?.forEach((v) => { map[v.event_id] = (map[v.event_id] || 0) + 1; });
          setViewsByEvent(map);
        });
      supabase
        .from('event_subscribers')
        .select('event_id')
        .in('event_id', ids)
        .then(({ data: subs }) => {
          const map: Record<string, number> = {};
          subs?.forEach((s) => { map[s.event_id] = (map[s.event_id] || 0) + 1; });
          setSubsByEvent(map);
        });
    }
  }, [user]);

  const toggleStatus = async (event: Event) => {
    const newStatus = event.status === 'published' ? 'draft' : 'published';
    await supabase.from('events').update({ status: newStatus }).eq('id', event.id);
    fetchEvents();
  };

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Filter helpers used by both stats and event list
  const today = new Date().toISOString().split('T')[0];
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (e: Event) => {
    if (!normalizedQuery) return true;
    return `${e.name} ${e.city ?? ''} ${e.slug ?? ''}`.toLowerCase().includes(normalizedQuery);
  };
  const matchesStatus = (e: Event) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'live') return e.status === 'published' && (!e.event_date || e.event_date >= today);
    if (statusFilter === 'draft') return e.status === 'draft';
    if (statusFilter === 'past') return !!e.event_date && e.event_date < today;
    return true;
  };
  const filtered = events.filter((e) => matchesQuery(e) && matchesStatus(e));

  const publishedCount = filtered.filter((e) => e.status === 'published').length;
  const draftCount = filtered.filter((e) => e.status === 'draft').length;
  const totalViews = filtered.reduce((sum, e) => sum + (viewsByEvent[e.id] ?? 0), 0);
  const totalSubs = filtered.reduce((sum, e) => sum + (subsByEvent[e.id] ?? 0), 0);

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
    { label: 'Page Views', value: totalViews, icon: Eye, color: 'text-primary' },
    { label: 'Subscribers', value: totalSubs, icon: Users, color: 'text-emerald-500' },
  ];

  // Prefer display_name for initials so the avatar reads as the person,
  // not the email slug. Two tokens → "KP"; one token → first two letters.
  const userInitials = (() => {
    if (displayName) {
      const parts = displayName.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    return user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  })();
  const firstName = displayName?.trim().split(/\s+/)[0] ?? null;

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
            <h1 className="text-2xl font-display font-bold">
              {firstName ? `Welcome back, ${firstName}` : 'Dashboard'}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your event maps</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Event
          </Button>
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
                    Create your first event and start drawing your course.
                  </p>
                  <div className="flex flex-col items-center gap-3">
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Event
                    </Button>
                    <a
                      href="/event/crystal-lake-5k-demo"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      Or explore a sample event →
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          }

          const upcoming = filtered.filter((e) => !e.event_date || e.event_date >= today);
          const past = filtered.filter((e) => e.event_date && e.event_date < today);
          const isFiltering = normalizedQuery.length > 0 || statusFilter !== 'all';
          // Only surface the filter bar once the list is non-trivial.
          const showFilterBar = events.length >= 4;

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
                      {event.paid_at
                        ? <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">Pro</span>
                        : <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded-full">Free</span>
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
                        {isPublished && (
                          <DropdownMenuItem onClick={() => { menuActionRef.current = true; setAnalyticsEvent(event); }}>
                            <BarChart3 className="h-4 w-4 mr-2" /> View Stats
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

          const statusTabs: Array<{ key: typeof statusFilter; label: string }> = [
            { key: 'all', label: 'All' },
            { key: 'live', label: 'Live' },
            { key: 'draft', label: 'Draft' },
            { key: 'past', label: 'Past' },
          ];

          return (
            <div className="space-y-6">
              {showFilterBar && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search events…"
                      className="h-9 pl-9 pr-9"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <kbd className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 hidden md:inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
                      ⌘K
                    </kbd>
                  </div>
                  <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
                    {statusTabs.map((tab) => {
                      const active = statusFilter === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setStatusFilter(tab.key)}
                          className={`h-7 px-3 rounded-md font-medium transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {isFiltering && filtered.length === 0 && (
                <Card className="border-border/60 border-dashed">
                  <CardContent className="py-10 text-center">
                    <Search className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-foreground">No events match</p>
                    <p className="text-xs text-muted-foreground mt-1">Try a different search or clear the filter.</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={() => { setQuery(''); setStatusFilter('all'); }}
                    >
                      Clear filters
                    </Button>
                  </CardContent>
                </Card>
              )}

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
          isPro={isPro}
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
        isPro={isPro}
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

      <EventAnalyticsSheet
        open={!!analyticsEvent}
        onOpenChange={(open) => !open && setAnalyticsEvent(null)}
        eventId={analyticsEvent?.id ?? null}
        eventName={analyticsEvent?.name ?? ''}
        isPro={isPro}
      />
    </div>
  );
};

export default Dashboard;
