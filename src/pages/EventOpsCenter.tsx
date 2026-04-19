import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Eye,
  ListChecks,
  Lock,
  Megaphone,
  Navigation,
  QrCode,
  Radio,
  TrendingUp,
  Trash2,
  Users,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useEventAnalytics } from '@/hooks/useEventAnalytics';
import { usePoiStatuses } from '@/hooks/usePoiStatuses';
import { supabase } from '@/integrations/supabase/client';
import { poiTone } from '@/lib/pois';
import { STATUS_DOT_COLORS } from '@/lib/mapMarkers';
import { logEvent } from '@/lib/analytics';
import type { EventRoute, PoiStatusState, RoutePoi } from '@/types/mapEditor';
import StatusTokenDialog from '@/components/editor/StatusTokenDialog';
import UpgradeModal, { PAYMENTS_LIVE } from '@/components/UpgradeModal';
import ProWaitlistCapture from '@/components/ProWaitlistCapture';
import type { ScoutedPoiRecord } from '@/components/editor/ScoutReviewPanel';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────
interface EventRow {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  start_time: string | null;
  status: string;
  slug: string | null;
  paid_at: string | null;
  plan: string;
  pois: RoutePoi[];
  routes: EventRoute[];
  scouted_pois: ScoutedPoiRecord[];
  emergency_contacts: Record<string, string> | null;
  user_id: string;
}

interface ActivityItem {
  id: string;
  kind: 'status' | 'subscriber' | 'scouted';
  title: string;
  sub: string;
  icon: 'status' | 'subscriber' | 'scouted';
  at: number;
}

const STATUS_LABEL: Record<PoiStatusState, string> = {
  open: 'Open',
  low: 'Low',
  closed: 'Closed',
  moved: 'Moved',
};

const STATUS_RANK: Record<PoiStatusState, number> = {
  closed: 0, // most urgent
  low: 1,
  moved: 2,
  open: 3, // least urgent
};

const chartConfig: ChartConfig = {
  count: { label: 'Views', color: 'hsl(var(--primary))' },
};

function formatAgo(input: string | number | null | undefined): string {
  if (input == null) return '';
  const ms = typeof input === 'string' ? Date.parse(input) : input;
  if (!Number.isFinite(ms)) return '';
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : value + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDay(day: string): string {
  return new Date(day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────
const EventOpsCenter = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [checklistLoading, setChecklistLoading] = useState(false);

  // Redirect unauthed users
  useEffect(() => {
    if (!authLoading && !user) navigate('/login');
  }, [authLoading, user, navigate]);

  // Fetch event (owner-only via RLS)
  const fetchEvent = useCallback(async () => {
    if (!user || !eventId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('events')
      .select('id, name, city, event_date, start_time, status, slug, paid_at, plan, pois, routes, scouted_pois, emergency_contacts, user_id')
      .eq('id', eventId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    if (!data) {
      setLoadError('Event not found');
      return;
    }
    setEvent(data as unknown as EventRow);
  }, [user, eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name);
      });
  }, [user]);

  useEffect(() => {
    if (event?.id) logEvent('ops_center_viewed', event.id);
  }, [event?.id]);

  const handleDownloadChecklist = useCallback(async () => {
    if (!event || checklistLoading) return;
    setChecklistLoading(true);
    logEvent('checklist_pdf_downloaded', event.id, {
      plan: event.paid_at ? 'pro' : 'free',
      source: 'ops_center',
    });
    try {
      const { renderRaceDayChecklistPdf } = await import('@/lib/pdf/generateRaceDayChecklist');
      const blob = await renderRaceDayChecklistPdf({
        event: {
          id: event.id,
          name: event.name,
          city: event.city,
          event_date: event.event_date,
          start_time: event.start_time ?? null,
          slug: event.slug,
          paid_at: event.paid_at ?? null,
          routes: event.routes ?? [],
          pois: event.pois ?? [],
          emergency_contacts: event.emergency_contacts ?? null,
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
      console.error('[OpsCenter] checklist failed', err);
      toast({
        title: 'Could not generate checklist',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setChecklistLoading(false);
    }
  }, [event, checklistLoading, displayName, user, toast]);

  // ── Gating ─────────────────────────────────────────────────────────
  const isPublished = event?.status === 'published';
  const isPro = !!event?.paid_at;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (loadError || !event) {
    return <LoadErrorState message={loadError ?? 'Event not found'} onBack={() => navigate('/dashboard')} />;
  }

  if (!isPublished) {
    return <PublishFirstState event={event} onBack={() => navigate('/dashboard')} />;
  }
  if (!isPro) {
    return (
      <LockedPreviewState
        event={event}
        onBack={() => navigate('/dashboard')}
        onUpgrade={() => setUpgradeModalOpen(true)}
        upgradeModalOpen={upgradeModalOpen}
        onCloseUpgrade={() => setUpgradeModalOpen(false)}
      />
    );
  }

  // ── Full ops center (published + pro) ──────────────────────────────
  return (
    <>
      <OpsCenterContent
        event={event}
        onBack={() => navigate('/dashboard')}
        onOpenStatusDialog={() => setStatusDialogOpen(true)}
        onEventUpdated={fetchEvent}
        onDownloadChecklist={handleDownloadChecklist}
        checklistLoading={checklistLoading}
      />
      {user && (
        <StatusTokenDialog
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
          eventId={event.id}
          userId={user.id}
        />
      )}
    </>
  );
};

export default EventOpsCenter;

// ────────────────────────────────────────────────────────────────────
// Gating screens
// ────────────────────────────────────────────────────────────────────
const LoadErrorState = ({ message, onBack }: { message: string; onBack: () => void }) => (
  <div className="min-h-screen bg-background flex items-center justify-center px-6">
    <div className="max-w-md text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
        <BarChart3 className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-display font-bold text-foreground">Ops center unavailable</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
        Back to dashboard
      </Button>
    </div>
  </div>
);

const PublishFirstState = ({ event, onBack }: { event: EventRow; onBack: () => void }) => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
          <Radio className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-display font-bold text-foreground">Publish this event first</h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            The ops center shows live volunteer activity, subscriber growth, and analytics — all of
            which start once <strong>{event.name}</strong> is published.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back
          </Button>
          <Button size="sm" onClick={() => navigate(`/editor?id=${event.id}`)}>
            Open editor
          </Button>
        </div>
      </div>
    </div>
  );
};

const LockedPreviewState = ({
  event,
  onBack,
  onUpgrade,
  upgradeModalOpen,
  onCloseUpgrade,
}: {
  event: EventRow;
  onBack: () => void;
  onUpgrade: () => void;
  upgradeModalOpen: boolean;
  onCloseUpgrade: () => void;
}) => (
  <>
    <div className="min-h-screen bg-background">
      <Header event={event} onBack={onBack} locked />
      <main className="max-w-[1180px] mx-auto px-6 py-10">
        <div
          className="rounded-2xl border border-border bg-card p-8 max-w-2xl mx-auto text-center space-y-4"
          style={{
            background: 'linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--muted) / 0.3) 100%)',
          }}
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <Lock className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-display font-bold text-foreground">Open the ops center for {event.name}</h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Unlock Pro to follow live volunteer updates, scouted markers, and race-day analytics — all
              in one place.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto pt-2">
            <FeatureChip icon={Radio} label="Live marker statuses" />
            <FeatureChip icon={BarChart3} label="Analytics + sponsors" />
            <FeatureChip icon={Users} label="Subscriber tracking" />
            <FeatureChip icon={Megaphone} label="Activity feed" />
          </div>
          {PAYMENTS_LIVE ? (
            <Button onClick={onUpgrade} className="gap-2 mt-2">
              <Crown className="h-4 w-4" />
              Unlock for $49
            </Button>
          ) : (
            <div className="max-w-sm mx-auto w-full pt-1">
              <ProWaitlistCapture
                variant="card"
                eventId={event.id}
                trigger="ops_center_lock"
              />
            </div>
          )}
        </div>
      </main>
    </div>
    <UpgradeModal
      open={upgradeModalOpen}
      onClose={onCloseUpgrade}
      trigger="publish"
      eventId={event.id}
    />
  </>
);

const FeatureChip = ({ icon: Icon, label }: { icon: typeof Radio; label: string }) => (
  <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-[12.5px] text-foreground">
    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    <span className="truncate">{label}</span>
  </div>
);

// ────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────
const Header = ({
  event,
  onBack,
  locked,
  onOpenStatusDialog,
  onDownloadChecklist,
  checklistLoading,
}: {
  event: EventRow;
  onBack: () => void;
  locked?: boolean;
  onOpenStatusDialog?: () => void;
  onDownloadChecklist?: () => void;
  checklistLoading?: boolean;
}) => {
  // Hide Checklist for past events — a race-day checklist for a race
  // that already happened has no value. Matches the same gate on the
  // Dashboard card button.
  const today = new Date().toISOString().slice(0, 10);
  const isPastEvent = !!event.event_date && event.event_date < today;
  const { toast } = useToast();
  const publicUrl = event.slug ? `${window.location.origin}/event/${event.slug}` : null;

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast({ title: 'Share link copied!' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur-md">
      <div className="max-w-[1180px] mx-auto px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={onBack}
            aria-label="Back to dashboard"
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Radio className="h-3 w-3" />
              Ops center
            </div>
            <h1 className="font-display font-bold text-[18px] leading-tight text-foreground truncate">
              {event.name}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11.5px] text-muted-foreground">
              {event.event_date && <span>{formatDate(event.event_date)}</span>}
              {event.city && <span>· {event.city}</span>}
              <span
                className="ml-1 font-display font-semibold text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={
                  event.status === 'published'
                    ? { background: 'hsl(152 60% 42%)', color: 'white' }
                    : { background: 'hsl(210 15% 93%)', color: 'hsl(215 20% 45%)' }
                }
              >
                {event.status === 'published' ? 'Live' : 'Draft'}
              </span>
              <span
                className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={
                  event.paid_at
                    ? {
                        background: 'hsl(217 91% 50% / 0.1)',
                        color: 'hsl(217 91% 40%)',
                        border: '1px solid hsl(217 91% 50% / 0.2)',
                      }
                    : { background: 'hsl(45 93% 94%)', color: 'hsl(32 65% 35%)' }
                }
              >
                {event.paid_at ? 'Pro' : 'Free'}
              </span>
            </div>
          </div>
        </div>

        {!locked && (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
              <Link to={`/editor?id=${event.id}`}>
                <ExternalLink className="h-3 w-3" />
                Editor
              </Link>
            </Button>
            {publicUrl && (
              <>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleCopy}>
                  <Copy className="h-3 w-3" />
                  Copy link
                </Button>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <Navigation className="h-3 w-3" />
                    View live
                  </a>
                </Button>
              </>
            )}
            {onOpenStatusDialog && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onOpenStatusDialog}>
                <Radio className="h-3 w-3" />
                Volunteer link
              </Button>
            )}
            {onDownloadChecklist && !isPastEvent && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={onDownloadChecklist}
                disabled={checklistLoading}
              >
                <ListChecks className="h-3 w-3" />
                {checklistLoading ? 'Preparing…' : 'Checklist'}
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

// ────────────────────────────────────────────────────────────────────
// Full Ops Center (Pro + Published)
// ────────────────────────────────────────────────────────────────────
const OpsCenterContent = ({
  event,
  onBack,
  onOpenStatusDialog,
  onEventUpdated,
  onDownloadChecklist,
  checklistLoading,
}: {
  event: EventRow;
  onBack: () => void;
  onOpenStatusDialog: () => void;
  onEventUpdated: () => void;
  onDownloadChecklist: () => void;
  checklistLoading: boolean;
}) => {
  const statuses = usePoiStatuses(event.id);
  const { data: analytics, loading: analyticsLoading } = useEventAnalytics(event.id);
  const scoutedPois = event.scouted_pois ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Header
        event={event}
        onBack={onBack}
        onOpenStatusDialog={onOpenStatusDialog}
        onDownloadChecklist={onDownloadChecklist}
        checklistLoading={checklistLoading}
      />

      <main className="max-w-[1180px] mx-auto px-6 py-8 space-y-6">
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* LEFT column */}
          <div className="space-y-5">
            <LiveStatusesPanel
              event={event}
              statuses={statuses}
              onOpenStatusDialog={onOpenStatusDialog}
            />
            <ScoutedPoisPanel
              event={event}
              scoutedPois={scoutedPois}
              onUpdated={onEventUpdated}
            />
          </div>

          {/* RIGHT column */}
          <aside className="space-y-5">
            <AnalyticsColumn analytics={analytics} loading={analyticsLoading} />
          </aside>
        </div>

        <ActivityFeed event={event} scoutedPois={scoutedPois} />
      </main>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Live statuses panel
// ────────────────────────────────────────────────────────────────────
const LiveStatusesPanel = ({
  event,
  statuses,
  onOpenStatusDialog,
}: {
  event: EventRow;
  statuses: Map<string, { state: string; note: string | null; updated_by_name: string | null; updated_at: string; poi_id: string }>;
  onOpenStatusDialog: () => void;
}) => {
  const navigate = useNavigate();
  const rows = useMemo(() => {
    const out: Array<{
      poi: RoutePoi | null;
      status: { state: PoiStatusState; note: string | null; updated_by_name: string | null; updated_at: string };
    }> = [];
    statuses.forEach((s) => {
      const poi = event.pois.find((p) => p.id === s.poi_id) ?? null;
      out.push({
        poi,
        status: {
          state: s.state as PoiStatusState,
          note: s.note,
          updated_by_name: s.updated_by_name,
          updated_at: s.updated_at,
        },
      });
    });
    return out.sort((a, b) => {
      const rankDiff = STATUS_RANK[a.status.state] - STATUS_RANK[b.status.state];
      if (rankDiff !== 0) return rankDiff;
      return Date.parse(b.status.updated_at) - Date.parse(a.status.updated_at);
    });
  }, [statuses, event.pois]);

  const needsAttention = rows.filter((r) => r.status.state !== 'open');
  const reported = rows.filter((r) => r.status.state === 'open');

  return (
    <section className="rounded-[14px] border border-border bg-card overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="h-4 w-4 text-primary shrink-0" />
          <h2 className="font-display font-semibold text-[15px] tracking-tight text-foreground">
            Live statuses
          </h2>
          {needsAttention.length > 0 && (
            <span
              className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: 'hsl(0 72% 55%)', color: 'white' }}
            >
              {needsAttention.length} needs attention
            </span>
          )}
        </div>
        <span className="text-[11.5px] text-muted-foreground font-display">
          {rows.length} update{rows.length === 1 ? '' : 's'} · live
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-7 text-center space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Waiting for the first volunteer update
            </p>
            <p className="text-[12.5px] text-muted-foreground max-w-xs mx-auto leading-snug">
              Create a volunteer link and share it with your course marshals — updates land here in real time.
            </p>
          </div>
          <Button size="sm" onClick={onOpenStatusDialog} className="gap-1.5">
            <Radio className="h-3 w-3" />
            Generate volunteer link
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {needsAttention.map((r) => (
            <StatusRow
              key={`na-${r.status.updated_at}-${r.poi?.id ?? 'unknown'}`}
              poi={r.poi}
              status={r.status}
              onFlyTo={() => navigate(`/editor?id=${event.id}&focus=${r.poi?.id ?? ''}`)}
            />
          ))}
          {reported.length > 0 && needsAttention.length > 0 && (
            <li className="px-5 py-1.5 text-[10.5px] uppercase tracking-wider font-display font-semibold text-muted-foreground bg-muted/40">
              Reported open
            </li>
          )}
          {reported.map((r) => (
            <StatusRow
              key={`o-${r.status.updated_at}-${r.poi?.id ?? 'unknown'}`}
              poi={r.poi}
              status={r.status}
              onFlyTo={() => navigate(`/editor?id=${event.id}&focus=${r.poi?.id ?? ''}`)}
              muted
            />
          ))}
        </ul>
      )}
    </section>
  );
};

const StatusRow = ({
  poi,
  status,
  onFlyTo,
  muted,
}: {
  poi: RoutePoi | null;
  status: { state: PoiStatusState; note: string | null; updated_by_name: string | null; updated_at: string };
  onFlyTo: () => void;
  muted?: boolean;
}) => {
  const tone = poi ? poiTone(poi.type) : null;
  const label = poi?.title || tone?.label || 'Unknown marker';
  const color = STATUS_DOT_COLORS[status.state];

  return (
    <li className={`flex items-start gap-3 px-5 py-3 ${muted ? 'opacity-70' : ''}`}>
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 border-2"
        style={tone ? { background: `${tone.dot}15`, borderColor: `${tone.dot}40` } : {}}
      >
        {tone?.emoji ?? '📍'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[14px] font-semibold text-foreground truncate">{label}</p>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-display font-semibold uppercase tracking-wider text-white"
            style={{ background: color }}
          >
            <span className="inline-block w-1 h-1 rounded-full bg-white" />
            {STATUS_LABEL[status.state]}
          </span>
        </div>
        <p className="text-[11.5px] text-muted-foreground mt-0.5">
          updated {formatAgo(status.updated_at)}
          {status.updated_by_name ? ` by ${status.updated_by_name}` : ''}
        </p>
        {status.note && (
          <p className="text-[12.5px] text-foreground/85 leading-snug mt-1 italic">
            “{status.note}”
          </p>
        )}
      </div>
      {poi && (
        <Button variant="ghost" size="sm" className="h-9 sm:h-7 text-[11.5px]" onClick={onFlyTo}>
          Open in editor
        </Button>
      )}
    </li>
  );
};

// ────────────────────────────────────────────────────────────────────
// Scouted POIs panel
// ────────────────────────────────────────────────────────────────────
const ScoutedPoisPanel = ({
  event,
  scoutedPois,
  onUpdated,
}: {
  event: EventRow;
  scoutedPois: ScoutedPoiRecord[];
  onUpdated: () => void;
}) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [mutating, setMutating] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...scoutedPois].sort((a, b) => Date.parse(b.scouted_at) - Date.parse(a.scouted_at)),
    [scoutedPois],
  );

  const persist = async (nextPois: RoutePoi[], nextScouted: ScoutedPoiRecord[]) => {
    const { error } = await supabase
      .from('events')
      .update({
        pois: nextPois as unknown as Parameters<typeof supabase.from>[0] extends never ? never : object,
        scouted_pois: nextScouted as unknown as object,
        poi_count: nextPois.length,
      } as never)
      .eq('id', event.id);
    if (error) throw error;
  };

  const handleAccept = async (poi: ScoutedPoiRecord) => {
    setMutating(poi.id);
    try {
      // Strip scouted_* fields when promoting into events.pois
      const { scouted_at: _, scouted_via_token: __, ...clean } = poi as ScoutedPoiRecord & {
        scouted_at: string;
        scouted_via_token: string;
      };
      const nextPois = [...event.pois, clean as RoutePoi];
      const nextScouted = scoutedPois.filter((p) => p.id !== poi.id);
      await persist(nextPois, nextScouted);
      onUpdated();
      toast({ title: 'Accepted — marker added to your event' });
      logEvent('scouted_poi_accepted', event.id, { poi_id: poi.id });
    } catch (err) {
      console.error('[OpsCenter] accept failed', err);
      toast({ title: 'Failed to accept', variant: 'destructive' });
    } finally {
      setMutating(null);
    }
  };

  const handleReject = async (poi: ScoutedPoiRecord) => {
    setMutating(poi.id);
    try {
      const nextScouted = scoutedPois.filter((p) => p.id !== poi.id);
      await persist(event.pois, nextScouted);
      onUpdated();
      toast({ title: 'Dismissed' });
      logEvent('scouted_poi_rejected', event.id, { poi_id: poi.id });
    } catch (err) {
      console.error('[OpsCenter] reject failed', err);
      toast({ title: 'Failed to dismiss', variant: 'destructive' });
    } finally {
      setMutating(null);
    }
  };

  if (ordered.length === 0) return null;

  return (
    <section className="rounded-[14px] border border-border bg-card overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <span className="text-[13px]">🧭</span>
          </div>
          <h2 className="font-display font-semibold text-[15px] tracking-tight text-foreground">
            Scouted markers
          </h2>
          <span
            className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{ background: 'hsl(38 92% 50%)', color: 'white' }}
          >
            {ordered.length} pending
          </span>
        </div>
      </header>
      <ul className="divide-y divide-border">
        {ordered.map((poi) => {
          const tone = poiTone(poi.type);
          const isMut = mutating === poi.id;
          return (
            <li key={poi.id} className="px-5 py-3 flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 border-2"
                style={{ background: `${tone.dot}15`, borderColor: `${tone.dot}40` }}
              >
                {tone.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-foreground truncate">
                  {poi.title || tone.label}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {tone.label} · scouted {formatAgo(poi.scouted_at)}
                </p>
                {poi.description && (
                  <p className="text-[12.5px] text-foreground/85 leading-snug mt-1">{poi.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    size="sm"
                    className="h-9 sm:h-7 gap-1.5 text-[12px]"
                    onClick={() => handleAccept(poi)}
                    disabled={isMut}
                  >
                    <Check className="h-3 w-3" />
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 sm:h-7 text-[12px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleReject(poi)}
                    disabled={isMut}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Dismiss
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 sm:h-7 text-[12px] ml-auto"
                    onClick={() => navigate(`/editor?id=${event.id}&focus=${poi.id}`)}
                  >
                    Open in editor →
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ────────────────────────────────────────────────────────────────────
// Analytics column
// ────────────────────────────────────────────────────────────────────
const AnalyticsColumn = ({
  analytics,
  loading,
}: {
  analytics: ReturnType<typeof useEventAnalytics>['data'];
  loading: boolean;
}) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (!analytics) return null;

  const chartData = analytics.views_by_day.map((d) => ({ day: formatDay(d.day), count: d.count }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Eye}
          iconBg="bg-primary/10"
          iconColor="text-primary"
          label="Views"
          value={analytics.views_total}
          sub={`${analytics.views_runner} runner · ${analytics.views_spectator} spectator`}
        />
        <StatCard
          icon={Users}
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-500"
          label="Subscribers"
          value={analytics.subscribers_total}
          sub="Active emails"
        />
        <StatCard
          icon={QrCode}
          iconBg="bg-violet-500/10"
          iconColor="text-violet-500"
          label="QR Shares"
          value={analytics.qr_generated}
          sub={`${analytics.qr_downloaded} downloaded`}
        />
        <StatCard
          icon={Navigation}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-500"
          label="Tracking"
          value={analytics.tracking_sessions}
          sub={`${analytics.tracking_runners} runners`}
        />
      </div>

      {chartData.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Views over time</span>
            </div>
            <ChartContainer config={chartConfig} className="h-[140px] w-full">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="opsViewsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#opsViewsFill)"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {analytics.sponsors.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Sponsors</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {analytics.sponsors.length} sponsor{analytics.sponsors.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="space-y-2.5">
              {analytics.sponsors.map((s) => (
                <div
                  key={s.poi_id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-2.5 py-2"
                >
                  <div
                    className="w-9 h-9 rounded-md bg-white border flex items-center justify-center overflow-hidden shrink-0"
                    style={{ borderColor: `${s.brand_color ?? '#2563eb'}40` }}
                  >
                    {s.logo_url ? (
                      <img src={s.logo_url} alt="" className="max-w-[85%] max-h-[85%] object-contain" />
                    ) : (
                      <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{s.title}</p>
                    <p className="text-[10.5px] text-muted-foreground font-display">
                      <span className="font-semibold text-foreground">{s.impressions}</span> impr ·{' '}
                      <span className="font-semibold text-foreground">{s.clicks}</span> clicks
                      {s.promo_copies > 0 && (
                        <>
                          {' · '}
                          <span className="font-semibold text-foreground">{s.promo_copies}</span> copies
                        </>
                      )}
                    </p>
                  </div>
                  {s.impressions > 0 && (
                    <div className="text-right shrink-0">
                      <div className="text-[9.5px] text-muted-foreground uppercase tracking-wider font-display font-semibold">
                        CTR
                      </div>
                      <div className="text-[12px] font-display font-bold text-foreground">
                        {Math.round((s.clicks / s.impressions) * 100)}%
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
};

const StatCard = ({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
}: {
  icon: typeof Eye;
  iconBg: string;
  iconColor: string;
  label: string;
  value: number;
  sub: string;
}) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-3xl font-display font-bold text-foreground">{value}</div>
      <p className="text-[10px] text-muted-foreground mt-1.5 truncate">{sub}</p>
    </CardContent>
  </Card>
);

// ────────────────────────────────────────────────────────────────────
// Activity feed
// ────────────────────────────────────────────────────────────────────
const ActivityFeed = ({
  event,
  scoutedPois,
}: {
  event: EventRow;
  scoutedPois: ScoutedPoiRecord[];
}) => {
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  const fetchItems = useCallback(async () => {
    if (!event.id) return;
    const [historyRes, subsRes] = await Promise.all([
      supabase
        .from('poi_status_history')
        .select('id, poi_id, state, note, updated_by_name, created_at')
        .eq('event_id', event.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('event_subscribers')
        .select('id, email, created_at, source')
        .eq('event_id', event.id)
        .is('unsubscribed_at', null)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const list: ActivityItem[] = [];

    (historyRes.data ?? []).forEach((h) => {
      const typedH = h as {
        id: number;
        poi_id: string;
        state: string;
        note: string | null;
        updated_by_name: string | null;
        created_at: string;
      };
      const poi = event.pois.find((p) => p.id === typedH.poi_id);
      const label = poi?.title || poiTone(poi?.type ?? 'custom').label || 'Marker';
      const who = typedH.updated_by_name || 'A volunteer';
      list.push({
        id: `status-${typedH.id}`,
        kind: 'status',
        title: `${who} marked ${label} ${STATUS_LABEL[typedH.state as PoiStatusState] ?? typedH.state}`,
        sub: typedH.note ? `“${typedH.note}”` : '',
        icon: 'status',
        at: Date.parse(typedH.created_at),
      });
    });

    (subsRes.data ?? []).forEach((s) => {
      const typedS = s as { id: number; email: string; created_at: string; source: string | null };
      list.push({
        id: `sub-${typedS.id}`,
        kind: 'subscriber',
        title: `New subscriber: ${typedS.email}`,
        sub: typedS.source ? `via ${typedS.source}` : '',
        icon: 'subscriber',
        at: Date.parse(typedS.created_at),
      });
    });

    scoutedPois.forEach((p) => {
      list.push({
        id: `scout-${p.id}`,
        kind: 'scouted',
        title: `Scouted: ${p.title || poiTone(p.type).label}`,
        sub: `pending review`,
        icon: 'scouted',
        at: Date.parse(p.scouted_at),
      });
    });

    list.sort((a, b) => b.at - a.at);
    setItems(list.slice(0, 50));
  }, [event.id, event.pois, scoutedPois]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return (
    <section className="rounded-[14px] border border-border bg-card overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display font-semibold text-[15px] tracking-tight text-foreground">
            Activity
          </h2>
        </div>
        <span className="text-[11.5px] text-muted-foreground font-display">
          {items === null ? '…' : `last ${items.length}`}
        </span>
      </header>
      {items === null ? (
        <div className="p-5"><Skeleton className="h-20 w-full" /></div>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No activity yet. Updates will appear here as volunteers report statuses and runners subscribe.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-3 flex items-start gap-3">
              <ActivityIcon kind={item.icon} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-foreground leading-snug">{item.title}</p>
                {item.sub && (
                  <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{item.sub}</p>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0 font-display">{formatAgo(item.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const ActivityIcon = ({ kind }: { kind: 'status' | 'subscriber' | 'scouted' }) => {
  if (kind === 'status') {
    return (
      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
        <Radio className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (kind === 'subscriber') {
    return (
      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
        <Users className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-[13px]">🧭</span>
    </div>
  );
};
