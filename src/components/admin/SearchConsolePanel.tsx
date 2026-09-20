import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ExternalLink,
  Gauge,
  ListChecks,
  MousePointerClick,
  Percent,
  Search,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Delta, EmptyRow, SectionCard, StatCard } from '@/components/admin/AdminStats';
import { nf } from '@/lib/metrics';
import {
  listSearchConsoleSites,
  useSearchConsole,
  type GscRow,
  type GscSitesResult,
} from '@/hooks/useSearchConsole';

/**
 * Google Search Console, rendered inside /admin so search performance
 * sits next to product metrics instead of in another browser tab.
 *
 * Three states worth designing for: not configured (show the setup
 * path), configured but erroring (usually the service account isn't on
 * the property — surface the hint the function returns), and data.
 */

const chartConfig: ChartConfig = {
  clicks: { label: 'Clicks', color: 'hsl(var(--primary))' },
  impressions: { label: 'Impressions', color: 'hsl(217 91% 60%)' },
};

const EMPTY: GscRow = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

function formatDay(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const SearchConsolePanel = ({ days }: { days: number }) => {
  const { data, loading, error } = useSearchConsole(days);
  const [sites, setSites] = useState<GscSitesResult | null>(null);
  const [checking, setChecking] = useState(false);

  const runDiagnostic = async () => {
    setChecking(true);
    setSites(await listSearchConsoleSites());
    setChecking(false);
  };

  const links = (
    <div className="flex items-center gap-3">
      <a
        href="https://search.google.com/search-console"
        target="_blank"
        rel="noreferrer"
        className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        Search Console <ExternalLink className="h-3 w-3" />
      </a>
      <a
        href="https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fhereday.io"
        target="_blank"
        rel="noreferrer"
        className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        PageSpeed <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );

  if (loading) {
    return (
      <SectionCard title="Search performance" action={links}>
        <div className="h-[180px] rounded-xl bg-muted animate-pulse" />
      </SectionCard>
    );
  }

  // Only ONE thing gets to show the setup checklist: the secret being
  // genuinely absent. Anything else — bad JSON, a disabled API, a
  // permission problem — is a failure with a cause, and showing the
  // checklist for those sends you back through setup you already did.
  const unconfigured =
    data?.configured === false && (data.error ?? '').includes('not configured');

  if (unconfigured) {
    return (
      <SectionCard
        title="Search performance"
        hint="Not connected yet. Search Console data needs a Google service account with read access to the property."
        action={links}
      >
        <ol className="text-[13px] text-muted-foreground space-y-1.5 list-decimal pl-5">
          <li>Google Cloud console → enable the Google Search Console API.</li>
          <li>Create a service account, then create a JSON key for it.</li>
          <li>
            Search Console → the <span className="font-medium text-foreground">hereday.io</span>{' '}
            property → Settings → Users and permissions → add the service account's{' '}
            <code className="text-[11.5px]">client_email</code> as a Restricted user.
          </li>
          <li>
            Set the key as a Supabase secret:{' '}
            <code className="text-[11.5px]">GOOGLE_SERVICE_ACCOUNT_JSON</code>, then deploy the{' '}
            <code className="text-[11.5px]">search-console</code> function.
          </li>
        </ol>
        <p className="text-[12px] text-muted-foreground mt-3">
          Full steps: <code className="text-[11.5px]">agents/search-console-setup.md</code>
        </p>
      </SectionCard>
    );
  }

  if (error || !data || data.error) {
    return (
      <SectionCard
        title="Search performance"
        hint="Connected, but Google refused the request."
        action={links}
      >
        <p className="text-[13px] font-medium text-destructive">
          {error ?? data?.error ?? 'The search-console function could not be reached.'}
        </p>
        {data?.hint && <p className="text-[12.5px] text-muted-foreground mt-1.5">{data.hint}</p>}

        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={runDiagnostic}
          disabled={checking}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {checking ? 'Asking Google…' : 'Which properties can it read?'}
        </Button>

        {sites && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
            {sites.error ? (
              <p className="text-[13px] text-destructive">{sites.error}</p>
            ) : (
              <>
                <p className="text-[12.5px] text-muted-foreground mb-2">
                  <span className="font-medium text-foreground">{sites.service_account}</span> is
                  configured to read{' '}
                  <code className="text-[11.5px]">{sites.configured_site_url}</code> and can
                  actually read:
                </p>
                {!sites.sites?.length ? (
                  <p className="text-[13px] text-destructive">
                    Nothing. The service account isn't a user on any property.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {sites.sites.map((s) => (
                      <li key={s.siteUrl} className="text-[13px] flex items-center gap-2">
                        <code className="text-[11.5px] text-foreground">{s.siteUrl}</code>
                        <span className="text-[11px] text-muted-foreground">
                          {s.permissionLevel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[12px] text-muted-foreground mt-3">
                  Set the Supabase secret <code className="text-[11.5px]">GSC_SITE_URL</code> to
                  whichever of those strings you want, exactly as printed.
                </p>
              </>
            )}
          </div>
        )}
      </SectionCard>
    );
  }

  const totals = data.totals ?? EMPTY;
  const prev = data.prev_totals ?? EMPTY;
  const series = (data.by_day ?? []).map((d) => ({
    day: formatDay(d.day),
    clicks: d.clicks,
    impressions: d.impressions,
  }));

  return (
    <SectionCard
      title="Search performance"
      hint={`Google Search Console for ${data.site_url}. ${
        data.range
          ? `${data.range.start} → ${data.range.end} — Google finalises data on a ~${data.range.lag_days} day lag, so this window ends before today.`
          : ''
      }`}
      action={links}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={MousePointerClick}
          tint="bg-primary/10 text-primary"
          label="Clicks"
          value={nf.format(totals.clicks)}
          footer={<Delta current={totals.clicks} previous={prev.clicks} />}
        />
        <StatCard
          icon={Search}
          tint="bg-blue-500/10 text-blue-600"
          label="Impressions"
          value={nf.format(totals.impressions)}
          footer={<Delta current={totals.impressions} previous={prev.impressions} />}
        />
        <StatCard
          icon={Percent}
          tint="bg-emerald-500/10 text-emerald-600"
          label="CTR"
          value={`${(totals.ctr * 100).toFixed(1)}%`}
          footer={<Delta current={totals.ctr} previous={prev.ctr} />}
        />
        <StatCard
          icon={TrendingUp}
          tint="bg-amber-500/10 text-amber-600"
          label="Avg. position"
          value={totals.position ? totals.position.toFixed(1) : '—'}
          footer={<Delta current={totals.position} previous={prev.position} invert />}
        />
      </div>

      {series.length === 0 ? (
        <EmptyRow>
          No search impressions in this window — either the property is new or it's the wrong one.
        </EmptyRow>
      ) : (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="impressions"
              stroke="var(--color-impressions)"
              fill="var(--color-impressions)"
              fillOpacity={0.12}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="clicks"
              stroke="var(--color-clicks)"
              fill="var(--color-clicks)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <div>
          <h3 className="text-[12.5px] font-medium text-muted-foreground mb-2">Top queries</h3>
          {!data.top_queries?.length ? (
            <EmptyRow>No queries yet.</EmptyRow>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-1.5 font-medium">Query</th>
                  <th className="py-1.5 font-medium text-right">Clicks</th>
                  <th className="py-1.5 font-medium text-right">Impr.</th>
                  <th className="py-1.5 font-medium text-right">Pos.</th>
                </tr>
              </thead>
              <tbody>
                {data.top_queries.slice(0, 10).map((q) => (
                  <tr key={q.query} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 text-foreground truncate max-w-[220px]">{q.query}</td>
                    <td className="py-1.5 text-right tabular-nums text-foreground">{nf.format(q.clicks)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {nf.format(q.impressions)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {q.position.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="text-[12.5px] font-medium text-muted-foreground mb-2">Top pages</h3>
          {!data.top_pages?.length ? (
            <EmptyRow>No pages yet.</EmptyRow>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-1.5 font-medium">Page</th>
                  <th className="py-1.5 font-medium text-right">Clicks</th>
                  <th className="py-1.5 font-medium text-right">Impr.</th>
                  <th className="py-1.5 font-medium text-right">Pos.</th>
                </tr>
              </thead>
              <tbody>
                {data.top_pages.slice(0, 10).map((p) => (
                  <tr key={p.page} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 font-mono text-[11.5px] text-foreground truncate max-w-[220px]">
                      {p.page.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-foreground">{nf.format(p.clicks)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {nf.format(p.impressions)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {p.position.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-[11.5px] text-muted-foreground mt-4 flex items-center gap-1.5">
        <Gauge className="h-3 w-3" />
        Core Web Vitals aren't in Search Console's API response — use the PageSpeed link above.
      </p>
    </SectionCard>
  );
};

export default SearchConsolePanel;
