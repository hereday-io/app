import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Eye,
  Users,
  Plus,
  LogOut,
  FileText,
  MoreVertical,
  Pencil,
  Trash2,
  Globe,
  EyeOff,
  Copy,
  ExternalLink,
  BarChart3,
  Search,
  Rocket,
  ChevronRight,
  ListChecks,
  CreditCard,
  MailPlus,
  Link as LinkIcon,
} from 'lucide-react';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import SendUpdateDialog from '@/components/SendUpdateDialog';
import { useToast } from '@/hooks/use-toast';
import CreateEventDialog from '@/components/CreateEventDialog';
import EditEventDialog from '@/components/EditEventDialog';
import DeleteEventDialog from '@/components/DeleteEventDialog';
import DuplicateEventDialog from '@/components/DuplicateEventDialog';
import EventAnalyticsSheet from '@/components/EventAnalyticsSheet';
import { logEvent } from '@/lib/analytics';
import { EventChip } from '@/components/ui/event-chip';
import { InfoCallout } from '@/components/ui/info-callout';
import {
  isReadyToPublish,
  isApproachingMarkerLimit,
  markersUntilLimit,
  isPro as isEventPro,
} from '@/lib/eventStatus';
import { cn } from '@/lib/utils';

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
  updated_at?: string | null;
  routes?: Array<{ routeCoords?: [number, number][]; waypoints?: [number, number][] }>;
  tracking_start?: string | null;
  tracking_end?: string | null;
  plan?: string | null;
  paid_at?: string | null;
}

const PANEL_CHROME =
  'bg-white border border-border rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]';

const formatDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const formatRelative = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
};

interface StatBlockProps {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}

const StatBlock = ({ label, value, sub, icon: Icon, accent }: StatBlockProps) => (
  <div className={cn(PANEL_CHROME, 'px-5 py-[18px]')}>
    <div className="flex items-center gap-2 mb-3">
      <Icon className={cn('h-3.5 w-3.5', accent ?? 'text-muted-foreground')} />
      <span className="font-display font-semibold text-[11px] uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </span>
    </div>
    <div className="font-display font-bold text-[28px] tracking-[-0.02em] leading-none text-foreground tabular-nums">
      {value}
    </div>
    {sub && <div className="text-[12px] text-muted-foreground mt-[6px]">{sub}</div>}
  </div>
);

interface EventRowActions {
  onOpenEditor: () => void;
  onTogglePublish: () => void;
  onCopyLink: () => void;
  onOpsCenter: () => void;
  onQuickStats: () => void;
  onChecklist: () => void;
  onSendUpdate: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPublicPage: () => void;
  checklistLoading: boolean;
}

interface EventRowProps {
  event: Event;
  views: number;
  subs: number;
  isPast: boolean;
  actions: EventRowActions;
}

const EventRow = ({ event, views, subs, isPast, actions }: EventRowProps) => {
  const isLive = event.status === 'published' && !isPast;
  const isDraft = event.status === 'draft';
  const isPro = isEventPro(event);
  const barColor = isPro ? 'bg-[hsl(217_91%_50%)]' : isLive ? 'bg-[hsl(152_60%_42%)]' : 'bg-border';
  const showLimitWarning = !isPro && event.poi_count >= 22;

  return (
    <div
      onClick={actions.onOpenEditor}
      className="grid grid-cols-[4px_1fr_auto_auto] items-stretch bg-white border-b border-border last:border-b-0 hover:bg-[hsl(210_20%_99%)] transition-colors cursor-pointer"
    >
      <div className={cn('w-1', barColor)} />

      <div className="px-5 py-4 flex flex-col gap-[5px] min-w-0">
        <h3 className="font-display font-semibold text-[15.5px] tracking-[-0.01em] text-foreground flex items-center gap-2 flex-wrap m-0">
          <span className="truncate">{event.name}</span>
          {isPast ? (
            <EventChip kind="past">Past</EventChip>
          ) : isLive ? (
            <EventChip kind="live">Live</EventChip>
          ) : (
            <EventChip kind="draft">Draft</EventChip>
          )}
          {isPro ? <EventChip kind="pro">Pro</EventChip> : <EventChip kind="free">Free plan</EventChip>}
        </h3>
        <div className="text-[12px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 items-center">
          <span>
            {event.event_date ? formatDate(event.event_date) : 'No date'}
            {event.city ? ` · ${event.city}` : ''}
          </span>
          <span className="opacity-50">·</span>
          <span>
            <b className="text-[hsl(215_20%_35%)] font-medium">{event.route_count} routes</b>
            {' · '}
            <b className="text-[hsl(215_20%_35%)] font-medium">{event.poi_count} markers</b>
          </span>
          {showLimitWarning && (
            <>
              <span className="opacity-50">·</span>
              <span className="text-[hsl(38_92%_40%)]">
                {markersUntilLimit(event)} markers until limit
              </span>
            </>
          )}
        </div>
      </div>

      <div className="px-3 py-4 flex flex-col justify-center items-end gap-[3px] min-w-[150px] text-right">
        {isLive && (
          <>
            <div className="font-display font-semibold text-[13px] text-foreground tabular-nums">
              {views.toLocaleString()} views
            </div>
            <div className="text-[11.5px] text-muted-foreground tabular-nums">
              {subs.toLocaleString()} subscribers
            </div>
          </>
        )}
        {isDraft && (
          <div className="text-[11.5px] text-muted-foreground">
            {event.updated_at ? `Last edited ${formatRelative(event.updated_at)}` : 'Last edited recently'}
          </div>
        )}
        {isPast && (
          <>
            <div className="font-display font-semibold text-[13px] text-foreground tabular-nums">
              {views.toLocaleString()} views
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              Archived · {event.event_date ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''}
            </div>
          </>
        )}
      </div>

      <div className="px-5 py-4 flex items-center gap-2">
        {isPast ? (
          <button
            onClick={(e) => { e.stopPropagation(); actions.onDuplicate(); }}
            className="h-8 px-3 rounded-lg border border-border bg-white text-[12.5px] font-medium text-foreground inline-flex items-center gap-1.5 hover:bg-[hsl(210_20%_99%)] whitespace-nowrap"
          >
            <Copy className="h-3 w-3 text-muted-foreground" />
            Duplicate
          </button>
        ) : isLive ? (
          <button
            onClick={(e) => { e.stopPropagation(); actions.onPublicPage(); }}
            className="h-8 px-3 rounded-lg border border-border bg-white text-[12.5px] font-medium text-foreground inline-flex items-center gap-1.5 hover:bg-[hsl(210_20%_99%)] whitespace-nowrap"
          >
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
            Public page
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); actions.onTogglePublish(); }}
            className="h-8 px-3 rounded-lg bg-[hsl(217_91%_50%)] text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 hover:bg-[hsl(217_91%_45%)] whitespace-nowrap"
          >
            <Rocket className="h-3 w-3" />
            Publish
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="More actions"
              className="h-8 w-8 rounded-md hover:bg-[hsl(215_20%_94%)] flex items-center justify-center text-muted-foreground flex-shrink-0"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={actions.onOpenEditor}>
              <Pencil className="h-4 w-4 mr-2" /> Open Editor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onTogglePublish}>
              {isLive ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" /> Unpublish
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4 mr-2" /> Publish
                </>
              )}
            </DropdownMenuItem>
            {isLive && event.slug && (
              <DropdownMenuItem onClick={actions.onCopyLink}>
                <LinkIcon className="h-4 w-4 mr-2" /> Copy share link
              </DropdownMenuItem>
            )}
            {isLive && (
              <DropdownMenuItem onClick={actions.onOpsCenter}>
                <BarChart3 className="h-4 w-4 mr-2" /> Ops Center
              </DropdownMenuItem>
            )}
            {isLive && (
              <DropdownMenuItem onClick={actions.onQuickStats}>
                <Eye className="h-4 w-4 mr-2" /> Quick stats
              </DropdownMenuItem>
            )}
            {!isPast && (
              <DropdownMenuItem onClick={actions.onChecklist} disabled={actions.checklistLoading}>
                <ListChecks className="h-4 w-4 mr-2" />
                {actions.checklistLoading ? 'Preparing checklist…' : 'Race-day checklist'}
              </DropdownMenuItem>
            )}
            {isLive && isPro && (
              <DropdownMenuItem onClick={actions.onSendUpdate}>
                <MailPlus className="h-4 w-4 mr-2" /> Send update
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={actions.onDuplicate}>
              <Copy className="h-4 w-4 mr-2" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onEdit}>
              <FileText className="h-4 w-4 mr-2" /> Edit details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewsByEvent, setViewsByEvent] = useState<Record<string, number>>({});
  const [viewsByEventPrior, setViewsByEventPrior] = useState<Record<string, number>>({});
  const [subsByEvent, setSubsByEvent] = useState<Record<string, number>>({});
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<Event | null>(null);
  const [duplicateEvent, setDuplicateEvent] = useState<Event | null>(null);
  const [analyticsEvent, setAnalyticsEvent] = useState<Event | null>(null);
  const [sendUpdateEvent, setSendUpdateEvent] = useState<Event | null>(null);
  const [isProUser, setIsProUser] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'draft' | 'past'>('all');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const [pdfLoadingEventId, setPdfLoadingEventId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('is_paid, plan, display_name').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (!data) return;
        setIsProUser(data.plan === 'pro' || data.is_paid === true);
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

    const ids = evts.map((e) => e.id);
    if (ids.length === 0) return;

    // Page-views in the trailing 60 days, bucketed into current 30 vs prior 30 for the delta.
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    supabase
      .from('product_events')
      .select('event_id, created_at')
      .eq('event_type', 'public_view')
      .in('event_id', ids)
      .gte('created_at', sixtyDaysAgo)
      .then(({ data: views }) => {
        const current: Record<string, number> = {};
        const prior: Record<string, number> = {};
        views?.forEach((v) => {
          const ts = new Date(v.created_at as string).getTime();
          if (ts >= thirtyDaysAgoMs) current[v.event_id] = (current[v.event_id] || 0) + 1;
          else prior[v.event_id] = (prior[v.event_id] || 0) + 1;
        });
        setViewsByEvent(current);
        setViewsByEventPrior(prior);
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
  }, [user]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const toggleStatus = async (event: Event) => {
    const newStatus = event.status === 'published' ? 'draft' : 'published';
    await supabase.from('events').update({ status: newStatus }).eq('id', event.id);
    fetchEvents();
  };

  // Lazy-imports @react-pdf/renderer on click so it stays out of the
  // main Dashboard bundle.
  const handleDownloadChecklist = useCallback(async (event: Event) => {
    if (pdfLoadingEventId) return;
    setPdfLoadingEventId(event.id);
    logEvent('checklist_pdf_downloaded', event.id, { plan: event.paid_at ? 'pro' : 'free' });
    try {
      const { renderRaceDayChecklistPdf } = await import('@/lib/pdf/generateRaceDayChecklist');
      const row = event as unknown as { routes?: EventRoute[]; pois?: RoutePoi[]; start_time?: string | null; emergency_contacts?: Record<string, string> | null };
      const blob = await renderRaceDayChecklistPdf({
        event: {
          id: event.id,
          name: event.name,
          city: event.city,
          event_date: event.event_date,
          start_time: row.start_time ?? null,
          slug: event.slug,
          paid_at: event.paid_at ?? null,
          routes: row.routes ?? [],
          pois: row.pois ?? [],
          emergency_contacts: row.emergency_contacts ?? null,
        },
        organizer: { displayName, email: user?.email ?? null },
        publicBaseUrl: window.location.origin,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${event.name.replace(/[^\w-]+/g, '-') || 'event'}-race-day-checklist.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate checklist', err);
      toast({
        title: 'Could not generate checklist',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setPdfLoadingEventId(null);
    }
  }, [pdfLoadingEventId, displayName, user, toast]);

  const today = new Date().toISOString().split('T')[0];
  const isPastEvent = (e: Event) => !!e.event_date && e.event_date < today;
  const isLiveEvent = (e: Event) => e.status === 'published' && (!e.event_date || e.event_date >= today);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (normalizedQuery && !`${e.name} ${e.city ?? ''} ${e.slug ?? ''}`.toLowerCase().includes(normalizedQuery)) {
        return false;
      }
      if (statusFilter === 'live') return isLiveEvent(e);
      if (statusFilter === 'draft') return e.status === 'draft';
      if (statusFilter === 'past') return isPastEvent(e);
      return true;
    });
  }, [events, normalizedQuery, statusFilter, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = useMemo(() => filtered.filter((e) => !isPastEvent(e)), [filtered, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const past = useMemo(() => filtered.filter(isPastEvent), [filtered, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stats — computed off the unfiltered list so the row counts don't shift when the user searches.
  const liveEvents = useMemo(() => events.filter(isLiveEvent), [events, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftEvents = useMemo(() => events.filter((e) => e.status === 'draft'), [events]);
  const unlockedCount = useMemo(() => events.filter(isEventPro).length, [events]);

  const liveEventIds = useMemo(() => new Set(liveEvents.map((e) => e.id)), [liveEvents]);

  const totalViews30d = useMemo(
    () => Object.entries(viewsByEvent).reduce((sum, [, n]) => sum + n, 0),
    [viewsByEvent],
  );
  const totalViewsPrior30d = useMemo(
    () => Object.entries(viewsByEventPrior).reduce((sum, [, n]) => sum + n, 0),
    [viewsByEventPrior],
  );
  const viewsDelta = useMemo(() => {
    if (totalViewsPrior30d === 0) return totalViews30d > 0 ? 100 : 0;
    return Math.round(((totalViews30d - totalViewsPrior30d) / totalViewsPrior30d) * 100);
  }, [totalViews30d, totalViewsPrior30d]);
  const totalSubsLive = useMemo(
    () => Object.entries(subsByEvent).reduce((sum, [eventId, n]) => sum + (liveEventIds.has(eventId) ? n : 0), 0),
    [subsByEvent, liveEventIds],
  );

  const draftsReadyToPublish = useMemo(() => draftEvents.filter(isReadyToPublish), [draftEvents]);
  const upcomingApproachingLimit = useMemo(
    () => liveEvents.filter(isApproachingMarkerLimit),
    [liveEvents],
  );

  // Pick the most pressing next-action for the callout. Publish-ready beats marker-limit.
  const calloutEvent = draftsReadyToPublish[0] ?? upcomingApproachingLimit[0] ?? null;
  const calloutKind: 'publish-ready' | 'approaching-limit' | null = calloutEvent
    ? draftsReadyToPublish.includes(calloutEvent) ? 'publish-ready' : 'approaching-limit'
    : null;

  const publishedSubText = (() => {
    if (liveEvents.length === 0) return undefined;
    const names = liveEvents.map((e) => e.name);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  })();

  const tabs: Array<{ key: typeof statusFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: events.length },
    { key: 'live', label: 'Live', count: liveEvents.length },
    { key: 'draft', label: 'Drafts', count: draftEvents.length },
    { key: 'past', label: 'Past', count: events.filter(isPastEvent).length },
  ];

  // Avatar initials. Prefer display_name so the avatar reads as the person, not the email slug.
  const userInitials = (() => {
    if (displayName) {
      const parts = displayName.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    return user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  })();
  const firstName = displayName?.trim().split(/\s+/)[0] ?? null;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(210_20%_98%)]">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const eventsGoingLiveSoon = (() => {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    const horizonIso = horizon.toISOString().split('T')[0];
    return liveEvents.filter((e) => e.event_date && e.event_date <= horizonIso).length;
  })();

  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)]">
      <header className="sticky top-0 z-50 border-b border-border bg-white/80 backdrop-blur-md">
        <div className="mx-auto max-w-[1180px] flex items-center justify-between py-[10px] px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-3"
            aria-label="Hereday home"
          >
            <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto -my-3" />
          </button>
          <nav className="flex items-center gap-[22px] text-[13.5px] text-muted-foreground">
            <span className="font-medium text-foreground hidden sm:inline">Events</span>
            <button
              type="button"
              onClick={() => navigate('/billing')}
              className="hidden sm:inline hover:text-foreground"
            >
              Billing
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open user menu"
                  className="h-[30px] w-[30px] rounded-full bg-[hsl(217_91%_50%)] text-white font-display font-semibold text-[12px] flex items-center justify-center tracking-[0.02em] hover:bg-[hsl(217_91%_45%)]"
                >
                  {userInitials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate('/billing')}>
                  <CreditCard className="h-4 w-4 mr-2" /> Billing
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="h-4 w-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 pt-9 pb-16">
        {/* Email verification banner — non-blocking */}
        {user && !user.email_confirmed_at && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 mb-6">
            <p className="text-sm text-amber-800">
              <strong>Verify your email to publish.</strong> We sent a confirmation link to {user.email}.
            </p>
            <button
              type="button"
              className="shrink-0 text-xs h-8 px-3 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-100"
              onClick={async () => {
                await supabase.auth.resend({ type: 'signup', email: user.email! });
                toast({ title: 'Confirmation email resent' });
              }}
            >
              Resend
            </button>
          </div>
        )}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mb-3">
          <span>Hereday</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Events</span>
        </div>

        {/* Page title row */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-7">
          <div>
            <h1 className="font-display font-bold text-[32px] leading-none tracking-[-0.02em] mb-[6px]">
              {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
            </h1>
            <p className="text-[14.5px] text-muted-foreground max-w-[62ch] leading-[1.6]">
              You have{' '}
              <b className="text-foreground font-medium">
                {eventsGoingLiveSoon} event{eventsGoingLiveSoon === 1 ? '' : 's'} going live
              </b>{' '}
              in the next 30 days. Manage your maps, review subscriber growth, and publish what's
              ready.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 px-4 rounded-lg bg-[hsl(217_91%_50%)] text-white font-medium text-[13.5px] inline-flex items-center gap-2 hover:bg-[hsl(217_91%_45%)] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> New event
          </button>
        </div>

        {/* Reinforcing callout */}
        {calloutEvent && calloutKind === 'publish-ready' && (
          <InfoCallout
            className="mb-9"
            icon={<Rocket className="h-4 w-4" />}
            title={`${calloutEvent.name} is ready to go live.`}
          >
            Your route is mapped, all {calloutEvent.poi_count} markers are placed, and the public
            page passes our checklist.{' '}
            <button
              type="button"
              onClick={() => navigate(`/editor?id=${calloutEvent.id}`)}
              className="text-[hsl(217_91%_45%)] border-b border-[hsl(217_91%_50%/0.3)] hover:border-[hsl(217_91%_45%)]"
            >
              Review &amp; publish
            </button>{' '}
            when you're ready — it's free until you upgrade.
          </InfoCallout>
        )}
        {calloutEvent && calloutKind === 'approaching-limit' && (
          <InfoCallout
            className="mb-9"
            icon={<Rocket className="h-4 w-4" />}
            title={`${calloutEvent.name} is approaching the marker limit.`}
          >
            Free events include 30 markers.{' '}
            <button
              type="button"
              onClick={() => navigate('/billing')}
              className="text-[hsl(217_91%_45%)] border-b border-[hsl(217_91%_50%/0.3)] hover:border-[hsl(217_91%_45%)]"
            >
              Unlock for $49
            </button>{' '}
            to add unlimited water stations, parking, and more.
          </InfoCallout>
        )}

        {/* Stats */}
        {events.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-9">
            <StatBlock
              label="Published"
              value={String(liveEvents.length)}
              sub={publishedSubText}
              icon={Globe}
              accent="text-[hsl(152_60%_42%)]"
            />
            <StatBlock
              label="Drafts"
              value={String(draftEvents.length)}
              sub={draftsReadyToPublish.length > 0 ? `${draftsReadyToPublish.length} ready to publish` : undefined}
              icon={FileText}
            />
            <StatBlock
              label="Page views"
              value={totalViews30d.toLocaleString()}
              sub={
                <span
                  className={cn(
                    viewsDelta > 0 && 'text-[hsl(152_60%_42%)]',
                    viewsDelta < 0 && 'text-[hsl(0_72%_55%)]',
                  )}
                >
                  {viewsDelta > 0 ? '+' : ''}{viewsDelta}% vs previous 30 days
                </span>
              }
              icon={Eye}
              accent="text-[hsl(217_91%_50%)]"
            />
            <StatBlock
              label="Subscribers"
              value={totalSubsLive.toLocaleString()}
              sub="Across all live events"
              icon={Users}
              accent="text-[hsl(152_60%_42%)]"
            />
          </div>
        )}

        {/* Empty state — no events at all */}
        {events.length === 0 && (
          <section className={cn(PANEL_CHROME, 'py-16 text-center px-6')}>
            <p className="font-display font-semibold text-[18px] mb-1">No events yet</p>
            <p className="text-[13px] text-muted-foreground mb-5">
              Create your first event and start drawing your course.
            </p>
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-10 px-4 rounded-lg bg-[hsl(217_91%_50%)] text-white font-medium text-[13.5px] inline-flex items-center gap-2 hover:bg-[hsl(217_91%_45%)]"
              >
                <Plus className="h-4 w-4" /> Create event
              </button>
              <a
                href="/event/crystal-lake-5k-demo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Or explore a sample event →
              </a>
            </div>
          </section>
        )}

        {/* Events panel */}
        {events.length > 0 && (
          <section className={cn(PANEL_CHROME, 'overflow-hidden')}>
            <div className="px-5 py-[14px] border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="font-display font-semibold text-[15px] tracking-[-0.005em] m-0">
                  Your events
                </h2>
                <span className="text-[12px] text-muted-foreground font-display">
                  {events.length} total · {unlockedCount} unlocked
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search events…"
                    className="h-8 w-[220px] pl-8 pr-3 rounded-lg text-[12.5px] focus-visible:ring-[hsl(217_91%_50%/0.15)] focus-visible:ring-offset-0"
                  />
                </div>
                <div className="inline-flex items-center rounded-lg border border-border bg-white p-[2px] text-[12px]">
                  {tabs.map((t) => {
                    const active = statusFilter === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setStatusFilter(t.key)}
                        className={cn(
                          'h-7 px-[10px] rounded-md font-medium font-display transition-colors inline-flex items-center gap-[5px]',
                          active
                            ? 'bg-foreground text-white'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t.label}
                        <span
                          className={cn(
                            'text-[10px] tabular-nums',
                            active ? 'text-white/70' : 'text-muted-foreground',
                          )}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="font-display font-semibold text-[15px] text-foreground mb-1">
                  No events match.
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  Try clearing the filter or searching for something else.
                </p>
              </div>
            ) : (
              <>
                {upcoming.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    views={viewsByEvent[event.id] ?? 0}
                    subs={subsByEvent[event.id] ?? 0}
                    isPast={false}
                    actions={{
                      checklistLoading: pdfLoadingEventId === event.id,
                      onOpenEditor: () => navigate(`/editor?id=${event.id}`),
                      onTogglePublish: () => toggleStatus(event),
                      onCopyLink: () => {
                        if (event.slug) {
                          navigator.clipboard.writeText(`${window.location.origin}/event/${event.slug}`);
                          toast({ title: 'Share link copied!' });
                        }
                      },
                      onOpsCenter: () => navigate(`/dashboard/events/${event.id}`),
                      onQuickStats: () => setAnalyticsEvent(event),
                      onChecklist: () => handleDownloadChecklist(event),
                      onSendUpdate: () => setSendUpdateEvent(event),
                      onDuplicate: () => setDuplicateEvent(event),
                      onEdit: () => setEditEvent(event),
                      onDelete: () => setDeleteEvent(event),
                      onPublicPage: () => {
                        if (event.slug) window.open(`/event/${event.slug}`, '_blank', 'noopener,noreferrer');
                      },
                    }}
                  />
                ))}
                {past.length > 0 && upcoming.length > 0 && (
                  <div className="px-5 py-2 bg-[hsl(210_20%_99%)] border-b border-t border-border flex items-center gap-3">
                    <span className="font-display font-semibold text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      Past events
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {past.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    views={viewsByEvent[event.id] ?? 0}
                    subs={subsByEvent[event.id] ?? 0}
                    isPast={true}
                    actions={{
                      checklistLoading: pdfLoadingEventId === event.id,
                      onOpenEditor: () => navigate(`/editor?id=${event.id}`),
                      onTogglePublish: () => toggleStatus(event),
                      onCopyLink: () => {
                        if (event.slug) {
                          navigator.clipboard.writeText(`${window.location.origin}/event/${event.slug}`);
                          toast({ title: 'Share link copied!' });
                        }
                      },
                      onOpsCenter: () => navigate(`/dashboard/events/${event.id}`),
                      onQuickStats: () => setAnalyticsEvent(event),
                      onChecklist: () => handleDownloadChecklist(event),
                      onSendUpdate: () => setSendUpdateEvent(event),
                      onDuplicate: () => setDuplicateEvent(event),
                      onEdit: () => setEditEvent(event),
                      onDelete: () => setDeleteEvent(event),
                      onPublicPage: () => {
                        if (event.slug) window.open(`/event/${event.slug}`, '_blank', 'noopener,noreferrer');
                      },
                    }}
                  />
                ))}
              </>
            )}
          </section>
        )}

        <div className="mt-4 text-center">
          <p className="text-[12px] text-muted-foreground">
            Need help organizing your race? Read the{' '}
            <a href="/getting-started" className="text-[hsl(217_91%_45%)] hover:underline">
              getting-started guide
            </a>{' '}
            or email{' '}
            <a href="mailto:support@hereday.io" className="text-[hsl(217_91%_45%)] hover:underline">
              support@hereday.io
            </a>
            .
          </p>
        </div>
      </main>

      {user && (
        <CreateEventDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          userId={user.id}
          isPro={isProUser}
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
        isPro={!!editEvent?.paid_at}
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
        isPro={isProUser}
      />

      {sendUpdateEvent && (
        <SendUpdateDialog
          open={!!sendUpdateEvent}
          onOpenChange={(open) => !open && setSendUpdateEvent(null)}
          eventId={sendUpdateEvent.id}
          eventName={sendUpdateEvent.name}
        />
      )}
    </div>
  );
};

export default Dashboard;
