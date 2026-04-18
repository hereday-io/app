import { Eye, Users, QrCode, Navigation, Lock, TrendingUp, Megaphone } from 'lucide-react';
import { Area, AreaChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useEventAnalytics } from '@/hooks/useEventAnalytics';

interface EventAnalyticsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  eventName: string;
  isPro: boolean;
}

const chartConfig: ChartConfig = {
  count: {
    label: 'Views',
    color: 'hsl(var(--primary))',
  },
};

function formatDay(day: string): string {
  const d = new Date(day + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const EventAnalyticsSheet = ({ open, onOpenChange, eventId, eventName, isPro }: EventAnalyticsSheetProps) => {
  const { data, loading } = useEventAnalytics(open ? eventId : null);

  const hasViews = data && data.views_total > 0;
  const chartData = data?.views_by_day?.map(d => ({ day: formatDay(d.day), count: d.count })) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="font-display text-lg">{eventName}</SheetTitle>
          <p className="text-sm text-muted-foreground">Event analytics</p>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : !data || (!hasViews && data.subscribers_total === 0 && data.tracking_sessions === 0) ? (
          <div className="text-center py-12">
            <Eye className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No data yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">
              Publish your event and share the link to start seeing stats here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stat cards — 2x2 grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Page Views */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Eye className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">Page Views</span>
                  </div>
                  <div className="text-3xl font-display font-bold text-foreground">{data.views_total}</div>
                  <div className="flex gap-3 mt-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{data.views_runner}</span> runner
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{data.views_spectator}</span> spectator
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Subscribers */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Users className="h-3.5 w-3.5 text-emerald-500" />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">Subscribers</span>
                  </div>
                  <div className="text-3xl font-display font-bold text-foreground">{data.subscribers_total}</div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">Active email subscribers</p>
                </CardContent>
              </Card>

              {/* QR Shares */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <QrCode className="h-3.5 w-3.5 text-violet-500" />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">QR Shares</span>
                  </div>
                  <div className="text-3xl font-display font-bold text-foreground">{data.qr_generated}</div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    <span className="font-semibold text-foreground">{data.qr_downloaded}</span> downloaded
                  </p>
                </CardContent>
              </Card>

              {/* Live Tracking */}
              <Card className={!isPro ? 'opacity-60' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      {isPro ? (
                        <Navigation className="h-3.5 w-3.5 text-amber-500" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-amber-500" />
                      )}
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">Tracking</span>
                  </div>
                  {isPro ? (
                    <>
                      <div className="text-3xl font-display font-bold text-foreground">{data.tracking_sessions}</div>
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        <span className="font-semibold text-foreground">{data.tracking_runners}</span> unique runners
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-muted-foreground mt-1">Pro feature</div>
                      <p className="text-[10px] text-muted-foreground mt-1">Upgrade to see tracking stats</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sponsors — per-POI impressions + clicks + promo copies.
                Ranked server-side by clicks desc. Only renders when the
                event has at least one branded sponsor. */}
            {data.sponsors.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">Sponsors</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {data.sponsors.length} sponsor{data.sponsors.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {data.sponsors.map((s) => (
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
                            <span className="font-semibold text-foreground">{s.impressions}</span> impression{s.impressions === 1 ? '' : 's'}
                            {' · '}
                            <span className="font-semibold text-foreground">{s.clicks}</span> click{s.clicks === 1 ? '' : 's'}
                            {s.promo_copies > 0 && (
                              <>
                                {' · '}
                                <span className="font-semibold text-foreground">{s.promo_copies}</span> promo cop{s.promo_copies === 1 ? 'y' : 'ies'}
                              </>
                            )}
                          </p>
                        </div>
                        {s.impressions > 0 && (
                          <div className="text-right shrink-0">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-display font-semibold">CTR</div>
                            <div className="text-[12px] font-display font-bold text-foreground">
                              {Math.round((s.clicks / s.impressions) * 100)}%
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-3 leading-snug">
                    Impressions include map taps on the sponsor marker.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Views over time chart */}
            {chartData.length > 1 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Views over time</span>
                  </div>
                  <ChartContainer config={chartConfig} className="h-[160px] w-full">
                    <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
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
                        fill="url(#viewsFill)"
                      />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default EventAnalyticsSheet;
