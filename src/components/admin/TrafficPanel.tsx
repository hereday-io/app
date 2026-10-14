import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import { Eye, ExternalLink, MousePointerClick, Repeat, UserCheck, Users } from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Delta, EmptyRow, SectionCard, StatCard } from '@/components/admin/AdminStats';
import { buildSeries, formatDay, nf, windowCoverage } from '@/lib/metrics';
import { usePostHogTraffic, type TrafficTotals } from '@/hooks/usePostHogTraffic';

/**
 * Site traffic from PostHog: the anonymous top of the funnel that
 * `product_events` never sees (the homepage, /pro, /faq, and everyone
 * who leaves without signing up).
 *
 * Same three states as the Search Console panel: not configured (setup
 * steps), configured but erroring (the function's hint), and data —
 * plus "configured, but nothing recorded", which is what you get while
 * the site itself isn't sending to PostHog.
 */

const chartConfig: ChartConfig = {
  visitors: { label: 'Visitors', color: 'hsl(var(--primary))' },
  pageviews: { label: 'Pageviews', color: 'hsl(217 91% 60%)' },
};

const EMPTY: TrafficTotals = { pageviews: 0, visitors: 0, sessions: 0 };

function referrerLabel(domain: string): string {
  return domain === '$direct' ? 'Direct / no referrer' : domain;
}

interface TrafficPanelProps {
  days: number;
  /** Signups in the same rolling window, from get_admin_overview. */
  signups: number;
  /** The same signups by UTC day, for when PostHog covers only part of the window. */
  signupsByDay: Array<{ day: string; count: number }>;
}

const TrafficPanel = ({ days, signups, signupsByDay }: TrafficPanelProps) => {
  const { data, loading, error } = usePostHogTraffic(days);

  const coverage = useMemo(() => windowCoverage(data?.first_seen, days), [data, days]);

  // Before PostHog has data the days aren't zero, they're unknown, so
  // the axis starts where tracking does.
  const series = useMemo(() => {
    if (!data?.by_day) return [];
    return buildSeries(days, {
      visitors: data.by_day.map((d) => ({ day: d.day, count: d.visitors })),
      pageviews: data.by_day.map((d) => ({ day: d.day, count: d.pageviews })),
    }).slice(-coverage.coveredDays);
  }, [data, days, coverage]);

  // Divide like by like: when tracking began inside the window, count
  // only the signups since then. Day granularity, so on the first day
  // signups from before tracking started that morning still count.
  const trackedSignups = coverage.startDay
    ? signupsByDay.filter((d) => d.day >= coverage.startDay!).reduce((n, d) => n + d.count, 0)
    : signups;

  const link = data?.app_url ? (
    <a
      href={data.app_url}
      target="_blank"
      rel="noreferrer"
      className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
    >
      PostHog <ExternalLink className="h-3 w-3" />
    </a>
  ) : undefined;

  if (loading) {
    return (
      <SectionCard title="Site traffic">
        <div className="h-[180px] rounded-xl bg-muted animate-pulse" />
      </SectionCard>
    );
  }

  if (data?.configured === false) {
    return (
      <SectionCard
        title="Site traffic"
        hint="Not connected yet. Traffic comes from PostHog, which needs the site sending pageviews and a key the dashboard can query with."
      >
        <ol className="text-[13px] text-muted-foreground space-y-1.5 list-decimal pl-5">
          <li>
            Vercel → Settings → Environment Variables → set{' '}
            <code className="text-[11.5px]">VITE_POSTHOG_KEY</code> (the{' '}
            <code className="text-[11.5px]">phc_</code> project key) for Production, then redeploy.
            Vite bakes it in at build time; until then the site sends PostHog nothing.
          </li>
          <li>
            PostHog → Settings → Personal API keys → create a key with the{' '}
            <span className="font-medium text-foreground">Query Read</span> scope, limited to the
            Hereday project.
          </li>
          <li>
            Set Supabase secrets{' '}
            <code className="text-[11.5px]">POSTHOG_PERSONAL_API_KEY</code> and{' '}
            <code className="text-[11.5px]">POSTHOG_PROJECT_ID</code> (plus{' '}
            <code className="text-[11.5px]">POSTHOG_APP_HOST</code> if the project is on EU
            cloud), then deploy the <code className="text-[11.5px]">posthog-traffic</code> function.
          </li>
        </ol>
      </SectionCard>
    );
  }

  if (error || !data || data.error) {
    return (
      <SectionCard title="Site traffic" hint="Connected, but PostHog refused the query." action={link}>
        <p className="text-[13px] font-medium text-destructive">
          {error ?? data?.error ?? 'The posthog-traffic function could not be reached.'}
        </p>
        {data?.hint && <p className="text-[12.5px] text-muted-foreground mt-1.5">{data.hint}</p>}
      </SectionCard>
    );
  }

  const totals = data.totals ?? EMPTY;
  const prev = data.prev_totals ?? EMPTY;

  if (totals.pageviews === 0 && prev.pageviews === 0) {
    return (
      <SectionCard title="Site traffic" hint={`Last ${days} days, hereday.io only.`} action={link}>
        <EmptyRow>
          PostHog has no pageviews from hereday.io in this window. If that persists, the site isn't
          sending: check that <code className="text-[11.5px]">VITE_POSTHOG_KEY</code> is set for
          Production in Vercel and that a deploy has run since.
        </EmptyRow>
      </SectionCard>
    );
  }

  const signupRate = totals.visitors > 0 ? (trackedSignups / totals.visitors) * 100 : null;
  const since = coverage.startDay ? formatDay(coverage.startDay) : null;

  // A prior window PostHog only partly saw would turn the first weeks
  // of tracking into a fake surge.
  const delta = (current: number, previous: number) =>
    coverage.prevPartial ? (
      <span className="text-[11px] text-muted-foreground">no full prior period yet</span>
    ) : (
      <Delta current={current} previous={previous} />
    );

  return (
    <SectionCard
      title="Site traffic"
      hint={`Every pageview on hereday.io in the last ${days} days, signed in or not, excluding /admin. ${
        since
          ? `PostHog data starts ${since}, so this covers ${coverage.coveredDays} day${coverage.coveredDays === 1 ? '' : 's'} and the signup rate counts signups from then on. `
          : ''
      }Ad-blockers stop some visitors reaching PostHog, so counts run low.`}
      action={link}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={Users}
          tint="bg-primary/10 text-primary"
          label="Visitors"
          value={nf.format(totals.visitors)}
          footer={delta(totals.visitors, prev.visitors)}
        />
        <StatCard
          icon={Eye}
          tint="bg-blue-500/10 text-blue-600"
          label="Pageviews"
          value={nf.format(totals.pageviews)}
          footer={delta(totals.pageviews, prev.pageviews)}
        />
        <StatCard
          icon={Repeat}
          tint="bg-emerald-500/10 text-emerald-600"
          label="Sessions"
          value={nf.format(totals.sessions)}
          footer={
            <span className="text-[11px] text-muted-foreground">
              {totals.sessions > 0 ? (totals.pageviews / totals.sessions).toFixed(1) : '—'} pages per
              session
            </span>
          }
        />
        <StatCard
          icon={UserCheck}
          tint="bg-amber-500/10 text-amber-600"
          label="Visitor → signup"
          value={signupRate === null ? '—' : `${signupRate.toFixed(1)}%`}
          footer={
            <span className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{nf.format(trackedSignups)}</span> signups
              {since ? ` since ${since}` : ''} ÷ visitors
            </span>
          }
        />
      </div>

      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <ComposedChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {/* Visitors are whole people per day — bars, as in the signups
              chart above. Pageviews ride along as a line. */}
          <Bar dataKey="visitors" fill="var(--color-visitors)" radius={[2, 2, 0, 0]} />
          <Line
            type="linear"
            dataKey="pageviews"
            stroke="var(--color-pageviews)"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ChartContainer>

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <div>
          <h3 className="text-[12.5px] font-medium text-muted-foreground mb-2">Top pages</h3>
          {!data.top_pages?.length ? (
            <EmptyRow>No pages yet.</EmptyRow>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-1.5 font-medium">Page</th>
                  <th className="py-1.5 font-medium text-right">Views</th>
                  <th className="py-1.5 font-medium text-right">Visitors</th>
                </tr>
              </thead>
              <tbody>
                {data.top_pages.map((p) => (
                  <tr key={p.path} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 font-mono text-[11.5px] text-foreground truncate max-w-[240px]">
                      {p.path}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-foreground">
                      {nf.format(p.pageviews)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {nf.format(p.visitors)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="text-[12.5px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <MousePointerClick className="h-3 w-3" />
            Where visitors come from
          </h3>
          {!data.top_referrers?.length ? (
            <EmptyRow>No referrers yet.</EmptyRow>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-1.5 font-medium">Referrer</th>
                  <th className="py-1.5 font-medium text-right">Sessions</th>
                  <th className="py-1.5 font-medium text-right">Visitors</th>
                </tr>
              </thead>
              <tbody>
                {data.top_referrers.map((r) => (
                  <tr key={r.domain} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 text-foreground truncate max-w-[240px]">
                      {referrerLabel(r.domain)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-foreground">
                      {nf.format(r.sessions)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {nf.format(r.visitors)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SectionCard>
  );
};

export default TrafficPanel;
