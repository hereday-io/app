import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ChevronRight,
  Gift,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import AdminRouteGuard from '@/components/admin/AdminRouteGuard';
import AdminHeader from '@/components/admin/AdminHeader';
import SearchConsolePanel from '@/components/admin/SearchConsolePanel';
import { Delta, EmptyRow, SectionCard, StatCard } from '@/components/admin/AdminStats';
import { nf } from '@/lib/metrics';
import { useAdminOverview, type DayCount } from '@/hooks/useAdminOverview';

// Stripe holds the real amounts (promos, refunds), so anything derived
// from a paid-event count is a list-price estimate and says so.
const LIST_PRICE_USD = 49;

const RANGES = [7, 30, 90] as const;

function formatDay(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The RPC only returns days that had rows. Rendering those straight
 * into a chart silently compresses quiet stretches, so rebuild a
 * continuous UTC axis across the whole window and fill gaps with 0.
 */
function buildSeries(
  days: number,
  series: Record<string, DayCount[]>,
): Array<Record<string, string | number>> {
  const keys = Object.keys(series);
  const lookup: Record<string, Map<string, number>> = {};
  for (const k of keys) {
    lookup[k] = new Map(series[k].map((d) => [d.day, d.count]));
  }

  const out: Array<Record<string, string | number>> = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const row: Record<string, string | number> = { day: formatDay(iso) };
    for (const k of keys) row[k] = lookup[k].get(iso) ?? 0;
    out.push(row);
  }
  return out;
}

const trafficChartConfig: ChartConfig = {
  signups: { label: 'Signups', color: 'hsl(var(--primary))' },
  active: { label: 'Active users', color: 'hsl(160 84% 39%)' },
};

const viewsChartConfig: ChartConfig = {
  views: { label: 'Public views', color: 'hsl(var(--primary))' },
};

const AdminOverviewInner = () => {
  const [days, setDays] = useState<number>(30);
  const { data, loading, refreshing, error, refresh } = useAdminOverview(days);

  const growthSeries = useMemo(() => {
    if (!data) return [];
    return buildSeries(data.window_days, {
      signups: data.users.new_by_day,
      active: data.active.by_day,
    });
  }, [data]);

  const viewsSeries = useMemo(() => {
    if (!data) return [];
    return buildSeries(data.window_days, { views: data.public.views_by_day });
  }, [data]);

  const funnelSteps = useMemo(() => {
    if (!data) return [];
    const f = data.funnel;
    return [
      { label: 'Signup page views', value: f.signup_page_views },
      { label: 'Signed up', value: f.signups },
      { label: 'Created an event', value: f.created_event },
      { label: 'Published', value: f.published },
      { label: 'Hit the paywall', value: f.hit_paywall },
      { label: 'Paid', value: f.paid },
    ];
  }, [data]);

  const funnelTop = funnelSteps.length ? Math.max(...funnelSteps.map((s) => s.value), 1) : 1;

  return (
    <div className="min-h-screen" style={{ background: 'hsl(210 20% 98%)' }}>
      <AdminHeader />

      <main className="max-w-[1180px] mx-auto px-6 pt-9 pb-16">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mb-3">
          <span>Admin</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Overview</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-7">
          <div>
            <h1 className="font-display font-bold text-[32px] leading-none tracking-tight mb-1.5 text-foreground flex items-center gap-3">
              <ShieldCheck className="h-7 w-7 text-primary" />
              Admin · Overview
            </h1>
            <p className="text-[14.5px] text-muted-foreground max-w-[62ch] leading-relaxed">
              How Hereday is doing, from the database rather than from six dashboards. Every number
              below is live Supabase data for the selected window.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={`px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${
                    days === r
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r}d
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading || refreshing}
              className="gap-1.5 h-9"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="text-xs">Refresh</span>
            </Button>
          </div>
        </div>

        {error && (
          <Card className="p-5 mb-6 border-destructive/40">
            <p className="text-sm font-medium text-destructive">Couldn't load metrics</p>
            <p className="text-[13px] text-muted-foreground mt-1">{error}</p>
            <p className="text-[12.5px] text-muted-foreground mt-2">
              If this says the function doesn't exist, the{' '}
              <code className="text-[11.5px]">get_admin_overview</code> migration hasn't been applied
              to this Supabase project yet.
            </p>
          </Card>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
            <div className="h-72 rounded-xl bg-muted animate-pulse" />
          </div>
        ) : !data ? null : (
          <div className="space-y-6">
            {/* ── Headline stats ─────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon={UserPlus}
                tint="bg-primary/10 text-primary"
                label={`New users · ${days}d`}
                value={nf.format(data.users.new_in_window)}
                footer={
                  <Delta
                    current={data.users.new_in_window}
                    previous={data.users.new_prev_window}
                  />
                }
              />
              <StatCard
                icon={Activity}
                tint="bg-emerald-500/10 text-emerald-600"
                label="Active users · 7d"
                value={nf.format(data.active.wau)}
                footer={
                  <span className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{data.active.dau}</span> today ·{' '}
                    <span className="font-semibold text-foreground">{data.active.mau}</span> in 30d
                  </span>
                }
              />
              <StatCard
                icon={Users}
                tint="bg-indigo-500/10 text-indigo-600"
                label="Total users"
                value={nf.format(data.users.total)}
                footer={
                  <span className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {nf.format(data.events.published_total)}
                    </span>{' '}
                    published events all time
                  </span>
                }
              />
              <StatCard
                icon={Ticket}
                tint="bg-amber-500/10 text-amber-600"
                label={`Paid events · ${days}d`}
                value={nf.format(data.billing.paid_events_in_window)}
                footer={
                  <span className="text-[11px] text-muted-foreground">
                    ≈ ${nf.format(data.billing.paid_events_in_window * LIST_PRICE_USD)} at list ·{' '}
                    <Delta
                      current={data.billing.paid_events_in_window}
                      previous={data.billing.paid_events_prev_window}
                    />
                  </span>
                }
              />
            </div>

            {/* ── Growth chart ───────────────────────────────────── */}
            <SectionCard
              title="Signups and active users"
              hint={`Daily, UTC. Active = signed-in users who did something in the product. Last ${days} days.`}
            >
              {data.users.new_in_window === 0 && data.active.in_window === 0 ? (
                <EmptyRow>No signups or product activity in this window.</EmptyRow>
              ) : (
                <ChartContainer config={trafficChartConfig} className="h-[260px] w-full">
                  <ComposedChart data={growthSeries} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {/* Bars, not a smoothed area: these are whole people
                        per day. A monotone curve through 0-1-0 bulges
                        above 1 between the points and reads as traffic
                        that never happened. */}
                    <Bar dataKey="signups" fill="var(--color-signups)" radius={[2, 2, 0, 0]} />
                    <Line
                      type="linear"
                      dataKey="active"
                      stroke="var(--color-active)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </ComposedChart>
                </ChartContainer>
              )}
            </SectionCard>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* ── Funnel ───────────────────────────────────────── */}
              <SectionCard
                title="Acquisition funnel"
                hint={`Last ${days} days. Steps after "Signed up" count distinct users; "Paid" counts events, excluding comps.`}
              >
                <div className="space-y-2.5">
                  {funnelSteps.map((step, i) => {
                    const prev = i === 0 ? null : funnelSteps[i - 1].value;
                    const conv = prev && prev > 0 ? (step.value / prev) * 100 : null;
                    return (
                      <div key={step.label}>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-[13px] text-foreground">{step.label}</span>
                          <span className="text-[13px] font-semibold text-foreground tabular-nums">
                            {nf.format(step.value)}
                            {conv !== null && (
                              <span className="text-[11px] font-normal text-muted-foreground ml-1.5">
                                {conv.toFixed(0)}%
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.max((step.value / funnelTop) * 100, step.value > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {/* ── Activation + comps ───────────────────────────── */}
              <div className="space-y-6">
                <SectionCard
                  title="Activation"
                  hint="Share of new signups that published an event within 7 days — the metric that says whether a signup got any value."
                >
                  {data.activation.cohort_size === 0 ? (
                    <EmptyRow>
                      No cohort yet — signups need 7 full days before they count here.
                    </EmptyRow>
                  ) : (
                    <div className="flex items-end gap-4">
                      <div className="text-[44px] font-display font-bold leading-none text-foreground">
                        {data.activation.pct ?? 0}
                        <span className="text-2xl">%</span>
                      </div>
                      <div className="text-[12.5px] text-muted-foreground pb-1.5 leading-relaxed">
                        <span className="font-semibold text-foreground">
                          {data.activation.activated}
                        </span>{' '}
                        of{' '}
                        <span className="font-semibold text-foreground">
                          {data.activation.cohort_size}
                        </span>{' '}
                        signups in this window published within 7 days.
                      </div>
                    </div>
                  )}
                </SectionCard>

                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={Rocket}
                    tint="bg-sky-500/10 text-sky-600"
                    label={`Events created · ${days}d`}
                    value={nf.format(data.events.created_in_window)}
                    footer={
                      <span className="text-[11px] text-muted-foreground">
                        {nf.format(data.events.total)} all time
                      </span>
                    }
                  />
                  <StatCard
                    icon={Gift}
                    tint="bg-fuchsia-500/10 text-fuchsia-600"
                    label="Active comps"
                    value={nf.format(data.billing.comps_active)}
                    footer={
                      <Link
                        to="/admin/comps"
                        className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        Manage comps <ChevronRight className="h-3 w-3" />
                      </Link>
                    }
                  />
                </div>
              </div>
            </div>

            {/* ── Public pages (top of funnel) ───────────────────── */}
            <SectionCard
              title="Public event pages"
              hint="Every published event puts Hereday in front of runners and spectators. This is organic top-of-funnel, including anonymous visitors."
            >
              <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  {data.public.views_in_window === 0 ? (
                    <EmptyRow>No public event page views in this window.</EmptyRow>
                  ) : (
                    <ChartContainer config={viewsChartConfig} className="h-[200px] w-full">
                      <AreaChart data={viewsSeries} margin={{ left: -20, right: 8, top: 8 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="day"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={28}
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11 }}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Area
                          type="linear"
                          dataKey="views"
                          stroke="var(--color-views)"
                          fill="var(--color-views)"
                          fillOpacity={0.15}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ChartContainer>
                  )}
                  <div className="flex gap-6 mt-3 text-[12.5px] text-muted-foreground">
                    <span>
                      <span className="font-semibold text-foreground">
                        {nf.format(data.public.views_in_window)}
                      </span>{' '}
                      views ·{' '}
                      <Delta
                        current={data.public.views_in_window}
                        previous={data.public.views_prev_window}
                      />
                    </span>
                    <span>
                      <span className="font-semibold text-foreground">
                        {nf.format(data.public.shares_in_window)}
                      </span>{' '}
                      shares / link copies
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="text-[12.5px] font-medium text-muted-foreground mb-2">
                    Most viewed events
                  </h3>
                  {data.public.top_events.length === 0 ? (
                    <EmptyRow>Nothing yet.</EmptyRow>
                  ) : (
                    <ul className="space-y-1.5">
                      {data.public.top_events.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 text-[13px]">
                          {e.slug ? (
                            // New tab, not an in-app Link: reviewing these
                            // means opening several in a row, and a
                            // same-tab nav throws away the dashboard's
                            // loaded state and window each time.
                            <a
                              href={`/event/${e.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-foreground hover:text-primary hover:underline"
                            >
                              {e.name}
                            </a>
                          ) : (
                            <span className="truncate text-foreground">{e.name}</span>
                          )}
                          <span className="tabular-nums font-semibold text-foreground shrink-0">
                            {nf.format(e.views)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* ── Attribution ────────────────────────────────────── */}
            <div className="grid lg:grid-cols-2 gap-6">
              <SectionCard
                title="Where signups come from"
                hint="First-touch attribution. Signups from before June 2026 have no attribution and show as direct / unknown."
              >
                {data.sources.length === 0 ? (
                  <EmptyRow>No signups in this window.</EmptyRow>
                ) : (
                  <ul className="space-y-1.5">
                    {data.sources.map((s) => (
                      <li
                        key={s.source}
                        className="flex items-center justify-between gap-3 text-[13px]"
                      >
                        <span className="truncate text-foreground">{s.source}</span>
                        <span className="tabular-nums font-semibold text-foreground shrink-0">
                          {nf.format(s.signups)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                title="Landing pages that convert"
                hint="The first page a user saw before they signed up."
              >
                {data.landing_pages.length === 0 ? (
                  <EmptyRow>No attributed landing pages in this window.</EmptyRow>
                ) : (
                  <ul className="space-y-1.5">
                    {data.landing_pages.map((l) => (
                      <li
                        key={l.path}
                        className="flex items-center justify-between gap-3 text-[13px]"
                      >
                        <span className="truncate text-foreground font-mono text-[12px]">
                          {l.path}
                        </span>
                        <span className="tabular-nums font-semibold text-foreground shrink-0">
                          {nf.format(l.signups)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>

            {/* ── Feature usage ──────────────────────────────────── */}
            <SectionCard
              title="What people actually do"
              hint={`Every logged product action in the last ${days} days, most frequent first.`}
            >
              {data.top_actions.length === 0 ? (
                <EmptyRow>No product events in this window.</EmptyRow>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                        <th className="py-2 font-medium">Action</th>
                        <th className="py-2 font-medium text-right">Count</th>
                        <th className="py-2 font-medium text-right">Distinct users</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_actions.map((a) => (
                        <tr key={a.event_type} className="border-b border-border/50 last:border-0">
                          <td className="py-1.5 font-mono text-[12px] text-foreground">
                            {a.event_type}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-foreground">
                            {nf.format(a.count)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {nf.format(a.users)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* ── Google Search Console ──────────────────────────── */}
            <SearchConsolePanel days={days} />

            <p className="text-[11.5px] text-muted-foreground text-center pt-2">
              Data as of{' '}
              {new Date(data.generated_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
              . Day buckets are UTC.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

const AdminOverview = () => (
  <AdminRouteGuard>
    <AdminOverviewInner />
  </AdminRouteGuard>
);

export default AdminOverview;
