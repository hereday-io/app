import { useEffect, useState, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Mountain, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { Coord, EventRoute } from '@/types/mapEditor';
import { getElevationProfile, elevationStats, type ElevationPoint } from '@/lib/elevation';

interface ElevationProfileProps {
  route: EventRoute | undefined;
  mapboxToken: string;
  routeColor: string;
  onHoverPoint?: (coord: Coord | null) => void;
  /** When true, skips the absolute-positioned outer wrapper so the parent controls layout */
  contained?: boolean;
  /**
   * When provided, the toggle button is hidden and the chart visibility is controlled
   * externally (true = show chart, false = hide). Used by PublicMapBottom.
   */
  visible?: boolean;
}

const ElevationProfile = ({ route, mapboxToken, routeColor, onHoverPoint, contained = false, visible }: ElevationProfileProps) => {
  const [expanded, setExpanded] = useState(() => window.innerWidth >= 768);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ElevationPoint[]>([]);
  const [error, setError] = useState('');
  const lastCoordsKey = useRef('');

  const coordsKey = route?.routeCoords
    ? `${route.id}-${route.routeCoords.length}-${route.routeCoords[0]?.[0]}-${route.routeCoords[route.routeCoords.length - 1]?.[0]}`
    : '';

  const fetchProfile = useCallback(async () => {
    if (!route?.routeCoords || route.routeCoords.length < 2 || !mapboxToken) return;
    if (coordsKey === lastCoordsKey.current && profile.length > 0) return;

    setLoading(true);
    setError('');
    try {
      const points = await getElevationProfile(route.routeCoords, mapboxToken, 50);
      setProfile(points);
      lastCoordsKey.current = coordsKey;
    } catch {
      setError('Failed to load elevation data');
    } finally {
      setLoading(false);
    }
  }, [route, mapboxToken, coordsKey, profile.length]);

  useEffect(() => {
    const shouldFetch = visible !== undefined ? visible : expanded;
    if (shouldFetch && coordsKey !== lastCoordsKey.current) {
      fetchProfile();
    }
  }, [expanded, visible, fetchProfile, coordsKey]);

  const handleMouseMove = useCallback((state: any) => {
    if (state?.activePayload?.[0]?.payload?.coord && onHoverPoint) {
      onHoverPoint(state.activePayload[0].payload.coord);
    }
  }, [onHoverPoint]);

  const handleMouseLeave = useCallback(() => {
    onHoverPoint?.(null);
  }, [onHoverPoint]);

  const hasRoute = route && route.routeCoords.length >= 2;
  if (!hasRoute) return null;

  const stats = profile.length > 0 ? elevationStats(profile) : null;

  const chartData = profile.map((p) => ({
    distance: Number(p.distance.toFixed(2)),
    elevation: Math.round(p.elevation),
    coord: p.coord,
  }));

  // When `visible` is provided externally, it overrides internal expanded state
  const chartVisible = visible !== undefined ? visible : expanded;

  const inner = (
    <>
        {/* Toggle pill — hidden when parent controls visibility externally */}
        {visible === undefined && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mb-2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-background border border-border/60 shadow-sm text-sm font-medium text-foreground hover:bg-secondary/40 active:scale-95 transition-all"
          >
            <Mountain className="h-3.5 w-3.5" />
            Elevation
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 ml-0.5 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 ml-0.5 text-muted-foreground" />
            )}
          </button>
        )}

        {chartVisible && (
          <div className="bg-background border border-border/60 rounded-2xl shadow-sm p-4 overflow-hidden">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading elevation data…
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive py-4 text-center">{error}</p>
            )}

            {!loading && !error && profile.length > 0 && (
              <>
                {/* Stats bar */}
                <div className="flex items-center gap-4 mb-3 text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1">
                    <Mountain className="h-3 w-3" /> {route.name}
                  </span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>
                      ↑ <strong className="text-accent">{stats?.gain} ft</strong> gain
                    </span>
                    <span>
                      ↓ <strong className="text-destructive">{stats?.loss} ft</strong> loss
                    </span>
                    <span>
                      Min <strong>{stats?.min} ft</strong>
                    </span>
                    <span>
                      Max <strong>{stats?.max} ft</strong>
                    </span>
                  </div>
                </div>

                {/* Chart */}
                <div className="h-[140px] w-full" onMouseLeave={handleMouseLeave}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                    >
                      <defs>
                        <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={routeColor} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={routeColor} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="distance"
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        tickFormatter={(v) => `${v} mi`}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        tickFormatter={(v) => `${v}′`}
                        axisLine={false}
                        tickLine={false}
                        width={42}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        cursor={{ stroke: routeColor, strokeWidth: 1.5, strokeDasharray: '4 3', strokeOpacity: 0.7 }}
                        contentStyle={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(value: number) => [`${value} ft`, 'Elevation']}
                        labelFormatter={(label) => `${label} mi`}
                      />
                      <Area
                        type="monotone"
                        dataKey="elevation"
                        stroke={routeColor}
                        strokeWidth={2}
                        fill="url(#elevGradient)"
                        dot={false}
                        activeDot={{ r: 3, fill: routeColor }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {!loading && !error && profile.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No elevation data available. Try saving your route first.
              </p>
            )}
          </div>
        )}
    </>
  );

  if (contained) return <div>{inner}</div>;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="pointer-events-auto mx-4 mb-4">
        {inner}
      </div>
    </div>
  );
};

export default ElevationProfile;
