import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Mountain, Cloud, Sun, CloudSun, CloudRain, CloudDrizzle,
  CloudSnow, CloudLightning, Loader2,
} from 'lucide-react';
import type { EventRoute, Coord } from '@/types/mapEditor';
import { fetchEventWeather, daysUntilEvent, type WeatherResult } from '@/lib/weather';
import { getElevationProfile, elevationStats, type ElevationPoint } from '@/lib/elevation';

type Tab = 'elevation' | 'weather';

function formatHour(hour: number) {
  if (hour === 0)  return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function wmoIcon(code: number): React.ComponentType<{ className?: string }> {
  if (code === 0 || code === 1)                  return Sun;
  if (code === 2)                                return CloudSun;
  if (code === 3 || code === 45 || code === 48)  return Cloud;
  if (code >= 51 && code <= 55)                  return CloudDrizzle;
  if (code >= 61 && code <= 65)                  return CloudRain;
  if (code >= 71 && code <= 77)                  return CloudSnow;
  if (code >= 80 && code <= 82)                  return CloudRain;
  if (code >= 85 && code <= 86)                  return CloudSnow;
  if (code === 95 || code === 96 || code === 99) return CloudLightning;
  return Cloud;
}

interface EditorBottomSheetProps {
  route: EventRoute | undefined;
  mapboxToken: string;
  routeColor: string;
  onHoverPoint?: (coord: Coord | null) => void;
  eventDate: string;
  weatherCoord: [number, number] | null; // [lon, lat]
}

const EditorBottomSheet = ({
  route, mapboxToken, routeColor, onHoverPoint,
  eventDate, weatherCoord,
}: EditorBottomSheetProps) => {
  const hasRoute = !!(route && route.routeCoords.length >= 2);

  const [activeTab,   setActiveTab]   = useState<Tab>('elevation');
  const [expanded,    setExpanded]    = useState(true);

  // ── Elevation ──────────────────────────────────────────────────────
  const [profile,     setProfile]     = useState<ElevationPoint[]>([]);
  const [elevLoading, setElevLoading] = useState(false);
  const [elevError,   setElevError]   = useState('');
  const lastCoordsKey                  = useRef('');

  const coordsKey = route?.routeCoords
    ? `${route.id}-${route.routeCoords.length}-${route.routeCoords[0]?.[0]}`
    : '';

  useEffect(() => {
    if (!hasRoute || !mapboxToken || coordsKey === lastCoordsKey.current) return;
    setElevLoading(true);
    setElevError('');
    getElevationProfile(route!.routeCoords, mapboxToken, 50)
      .then((pts) => { setProfile(pts); lastCoordsKey.current = coordsKey; })
      .catch(() => setElevError('Failed to load elevation data'))
      .finally(() => setElevLoading(false));
  }, [hasRoute, mapboxToken, coordsKey, route]);

  const stats    = profile.length > 0 ? elevationStats(profile) : null;
  const chartData = profile.map((p) => ({
    distance:  Number(p.distance.toFixed(2)),
    elevation: Math.round(p.elevation),
    coord:     p.coord,
  }));

  const handleMouseMove = useCallback((state: any) => {
    if (state?.activePayload?.[0]?.payload?.coord && onHoverPoint) {
      onHoverPoint(state.activePayload[0].payload.coord);
    }
  }, [onHoverPoint]);

  const handleMouseLeave = useCallback(() => { onHoverPoint?.(null); }, [onHoverPoint]);

  // ── Weather ────────────────────────────────────────────────────────
  const [weatherData, setWeatherData] = useState<WeatherResult | null>(null);

  useEffect(() => {
    if (!eventDate || !weatherCoord) return;
    const days = daysUntilEvent(eventDate);
    if (days < 0 || days > 16) return;
    const [lon, lat] = weatherCoord;
    fetchEventWeather(lat, lon, eventDate).then((result) => {
      if (result && result.hours.length > 0) setWeatherData(result);
    });
  }, [eventDate, weatherCoord]);

  const tempRange = weatherData && weatherData.hours.length > 0
    ? (() => {
        const temps = weatherData.hours.map((h) => h.tempF);
        return `${Math.min(...temps)}–${Math.max(...temps)}°`;
      })()
    : null;

  // ── Tabs ───────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'elevation', label: 'Elevation', icon: <Mountain className="w-4 h-4" /> },
    ...(tempRange ? [{
      id: 'weather' as Tab,
      label: tempRange,
      icon: <Cloud className="w-4 h-4" />,
    }] : []),
  ];

  if (!hasRoute && !tempRange) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="pointer-events-auto">

        {/* ── Tab bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 px-3 pb-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                if (activeTab === tab.id) {
                  setExpanded((v) => !v);
                } else {
                  setActiveTab(tab.id);
                  setExpanded(true);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-t-lg text-xs font-medium transition-all ${
                activeTab === tab.id && expanded
                  ? 'bg-card text-foreground shadow-sm border border-b-0 border-border'
                  : 'bg-card/70 text-muted-foreground hover:text-foreground border border-transparent'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Panel ─────────────────────────────────────────────────── */}
        {expanded && (
          <div className="bg-card border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-safe">

            {/* Elevation panel */}
            {activeTab === 'elevation' && (
              <div className="px-4 py-3">
                {!hasRoute && (
                  <p className="text-sm text-muted-foreground py-2 text-center">
                    Add waypoints to see the elevation profile.
                  </p>
                )}
                {hasRoute && elevLoading && (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading elevation…
                  </div>
                )}
                {hasRoute && elevError && (
                  <p className="text-sm text-destructive py-2 text-center">{elevError}</p>
                )}
                {hasRoute && !elevLoading && !elevError && profile.length > 0 && (
                  <>
                    <div className="flex items-center gap-4 mb-2 text-xs flex-wrap">
                      <span className="font-semibold text-foreground">{route!.name}</span>
                      <span className="text-green-600 dark:text-green-400">↑ {stats?.gain} ft gain</span>
                      <span className="text-destructive">↓ {stats?.loss} ft loss</span>
                      <span className="text-muted-foreground">Min {stats?.min} ft</span>
                      <span className="text-muted-foreground">Max {stats?.max} ft</span>
                    </div>
                    <div className="h-20" onMouseLeave={handleMouseLeave}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={chartData}
                          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        >
                          <defs>
                            <linearGradient id="elevGradEditor" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%"   stopColor={routeColor} stopOpacity={0.3} />
                              <stop offset="100%" stopColor={routeColor} stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="distance"
                            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            interval={9}
                            tickFormatter={(v) => `${v} mi`}
                          />
                          <YAxis hide domain={['auto', 'auto']} />
                          <Tooltip
                            cursor={{ stroke: routeColor, strokeWidth: 1, strokeDasharray: '4 3', strokeOpacity: 0.6 }}
                            contentStyle={{
                              background: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px',
                              fontSize: '11px',
                            }}
                            formatter={(value: number) => [`${value} ft`, 'Elevation']}
                            labelFormatter={(label) => `${label} mi`}
                          />
                          <Area
                            type="monotone"
                            dataKey="elevation"
                            stroke={routeColor}
                            strokeWidth={1.5}
                            fill="url(#elevGradEditor)"
                            dot={false}
                            activeDot={{ r: 3, fill: routeColor }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
                {hasRoute && !elevLoading && !elevError && profile.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2 text-center">
                    No elevation data yet. Save your route to fetch elevation.
                  </p>
                )}
              </div>
            )}

            {/* Weather panel */}
            {activeTab === 'weather' && weatherData && (
              <div className="px-4 py-3">
                <div className="flex gap-1 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                  {weatherData.hours.map((h) => {
                    const Icon = wmoIcon(h.code);
                    return (
                      <div
                        key={h.hour}
                        className="flex flex-col items-center min-w-[52px] px-1.5 py-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-[10px] text-muted-foreground">{formatHour(h.hour)}</span>
                        <Icon className="w-4 h-4 my-1 text-primary" />
                        <span className="text-xs font-semibold text-foreground">{h.tempF}°</span>
                        <span className="text-[10px] text-muted-foreground">
                          {h.precipPct > 0 ? `< ${h.precipPct}%` : '< 0%'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
};

export default EditorBottomSheet;
