import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Mountain, CircleDot, Cloud, Sun, CloudSun, CloudRain, CloudDrizzle,
  CloudSnow, CloudLightning, Eye, EyeOff, Loader2, ChevronDown, ChevronUp,
  Plus, Minus,
} from 'lucide-react';
import type { EventRoute, RoutePoi, PoiType, Coord } from '@/types/mapEditor';
import { totalDistanceMiles } from '@/lib/geo';
import { poiTone, poisByCategory, POI_CATEGORIES, POI_CATEGORY_ORDER } from '@/lib/pois';
import { fetchEventWeather, daysUntilEvent, type WeatherResult } from '@/lib/weather';
import { getElevationProfile, elevationStats, type ElevationPoint } from '@/lib/elevation';

type Tab = 'elevation' | 'legend' | 'weather';

function formatHour(hour: number) {
  if (hour === 0)  return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function wmoIcon(code: number): React.ComponentType<{ className?: string }> {
  if (code === 0 || code === 1)                 return Sun;
  if (code === 2)                               return CloudSun;
  if (code === 3 || code === 45 || code === 48) return Cloud;
  if (code >= 51 && code <= 55)                 return CloudDrizzle;
  if (code >= 61 && code <= 65)                 return CloudRain;
  if (code >= 71 && code <= 77)                 return CloudSnow;
  if (code >= 80 && code <= 82)                 return CloudRain;
  if (code >= 85 && code <= 86)                 return CloudSnow;
  if (code === 95 || code === 96 || code === 99) return CloudLightning;
  return Cloud;
}

interface PublicMapBottomProps {
  routes: EventRoute[];
  pois: RoutePoi[];
  hiddenRouteIds: Set<string>;
  onToggleRoute: (id: string) => void;
  highlightedPoiType: PoiType | null;
  onHighlightPoiType: (type: PoiType | null) => void;
  activeRoute: EventRoute | undefined;
  mapboxToken: string;
  routeColor: string;
  onHoverPoint?: (coord: Coord | null) => void;
  eventDate: string | null;
  weatherCoord: [number, number] | null;
  eventName?: string;
  badge?: React.ReactNode;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  viewMode?: 'runner' | 'spectator';
}

const PublicMapBottom = ({
  routes, pois, hiddenRouteIds, onToggleRoute,
  highlightedPoiType, onHighlightPoiType,
  activeRoute, mapboxToken, routeColor, onHoverPoint,
  eventDate, weatherCoord, eventName, badge, onZoomIn, onZoomOut, viewMode = 'runner',
}: PublicMapBottomProps) => {
  const hasRoute = !!(activeRoute && activeRoute.routeCoords.length >= 2);

  const [activeTab,    setActiveTab]    = useState<Tab>(hasRoute ? 'elevation' : 'legend');
  const [expanded,     setExpanded]     = useState(() => window.innerWidth >= 768);

  // ── Elevation state ──────────────────────────────────────────────
  const [profile,      setProfile]      = useState<ElevationPoint[]>([]);
  const [elevLoading,  setElevLoading]  = useState(false);
  const [elevError,    setElevError]    = useState('');
  const lastCoordsKey                   = useRef('');

  const coordsKey = activeRoute?.routeCoords
    ? `${activeRoute.id}-${activeRoute.routeCoords.length}-${activeRoute.routeCoords[0]?.[0]}`
    : '';

  useEffect(() => {
    if (!hasRoute || !mapboxToken || coordsKey === lastCoordsKey.current) return;
    setElevLoading(true);
    setElevError('');
    getElevationProfile(activeRoute!.routeCoords, mapboxToken, 50)
      .then((pts) => { setProfile(pts); lastCoordsKey.current = coordsKey; })
      .catch(() => setElevError('Failed to load elevation data'))
      .finally(() => setElevLoading(false));
  }, [hasRoute, mapboxToken, coordsKey, activeRoute]);

  // ── Weather state ─────────────────────────────────────────────────
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

  // ── POI grouping ─────────────────────────────────────────────────
  // Count markers per type so the legend shows ×N badges alongside
  // each category row.
  const grouped = pois.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {});

  // Has-start / has-finish drive the pinned hero row above the
  // category grid — start and finish are the two markers runners need
  // to spot at a glance, and burying them in a 3-col grid violates
  // the "must be instantly recognizable" rule in UX_PATTERNS.md.
  const hasStart  = (grouped.start  || 0) > 0;
  const hasFinish = (grouped.finish || 0) > 0;

  // Group POI types by category, skipping start/finish (rendered as
  // hero) and empty categories. Within each category we preserve the
  // canonical order from `poisByCategory()` and filter to only the
  // types that are actually placed on this event.
  const grouping = poisByCategory();
  const legendCategories = POI_CATEGORY_ORDER
    .map((cat) => ({
      cat,
      types: grouping[cat].filter((t) => {
        if (t === 'start' || t === 'finish') return false;
        return (grouped[t] || 0) > 0;
      }),
    }))
    .filter((g) => g.types.length > 0);

  // Role-aware ordering: spectators see logistics/amenities first
  // (parking, restrooms) and on-course markers last, runners keep the
  // canonical order. We reorder at the category level so on-course
  // support items still group together visually.
  const orderedLegendCategories = viewMode === 'spectator'
    ? [...legendCategories].sort((a, b) => {
        const rank = { logistics: 0, support: 1, course: 2 } as const;
        return rank[a.cat] - rank[b.cat];
      })
    : legendCategories;

  // Sum visible route distances for the Start → Finish hero row.
  const heroDistance = routes
    .filter((r) => r.visible && !hiddenRouteIds.has(r.id))
    .reduce((sum, r) => sum + totalDistanceMiles(r.routeCoords), 0);

  // ── Tabs ──────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    ...(hasRoute ? [{ id: 'elevation' as Tab, label: 'Elevation', icon: <Mountain className="w-3.5 h-3.5" /> }] : []),
    { id: 'legend', label: 'Legend', icon: <CircleDot className="w-3.5 h-3.5" /> },
    ...(tempRange ? [{ id: 'weather' as Tab, label: tempRange, icon: <Cloud className="w-3.5 h-3.5" /> }] : []),
  ];

  // ── Elevation chart data ──────────────────────────────────────────
  const chartData = profile.map((p) => ({
    distance: Number(p.distance.toFixed(2)),
    elevation: Math.round(p.elevation),
    coord: p.coord,
  }));
  const stats = profile.length > 0 ? elevationStats(profile) : null;

  const handleMouseMove = useCallback((state: any) => {
    if (state?.activePayload?.[0]?.payload?.coord && onHoverPoint) {
      onHoverPoint(state.activePayload[0].payload.coord);
    }
  }, [onHoverPoint]);

  const handleMouseLeave = useCallback(() => { onHoverPoint?.(null); }, [onHoverPoint]);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none px-3 pb-3 pb-safe">
      {/* Controls row: badge (left) · attribution + zoom (right) */}
      <div className="flex items-end justify-between mb-2 px-0.5">
        <div className="pointer-events-auto">
          {badge}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <a
            href="https://www.mapbox.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            © Mapbox © OpenStreetMap
          </a>
          <div className="flex rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] overflow-hidden">
            <button
              onClick={onZoomIn}
              className="w-8 h-8 flex items-center justify-center text-foreground hover:bg-muted/50 transition-colors active:scale-95"
              aria-label="Zoom in"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <div className="w-px bg-border/50" />
            <button
              onClick={onZoomOut}
              className="w-8 h-8 flex items-center justify-center text-foreground hover:bg-muted/50 transition-colors active:scale-95"
              aria-label="Zoom out"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      <div className="pointer-events-auto rounded-2xl bg-card/85 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] overflow-hidden max-h-[45vh] flex flex-col">

        {/* ── Header: event name, route stats, collapse toggle ── */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors shrink-0"
        >
          <div className="min-w-0 flex-1">
            <h2
              className="text-sm font-semibold text-foreground truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {eventName || 'Event Details'}
            </h2>
            {hasRoute && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {activeRoute!.name}
                {' · '}
                {totalDistanceMiles(activeRoute!.routeCoords).toFixed(1)} mi
                {stats ? ` · +${stats.gain} ft` : ''}
              </p>
            )}
          </div>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          }
        </button>

        {expanded && (
          <>
            {/* ── Tab bar ──────────────────────────────────────── */}
            <div className="flex items-center gap-1 px-3 border-t border-border/50 pt-1 shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Panel content ─────────────────────────────────── */}
            <div className="overflow-y-auto flex-1 min-h-0">

              {/* Elevation panel */}
              {activeTab === 'elevation' && (
                <div className="px-4 py-3">
                  {elevLoading && (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading elevation…
                    </div>
                  )}
                  {elevError && (
                    <p className="text-sm text-destructive py-3 text-center">{elevError}</p>
                  )}
                  {!elevLoading && !elevError && profile.length > 0 && (
                    <>
                      <div className="flex items-center gap-4 mb-2 text-xs flex-wrap">
                        <span className="font-semibold text-foreground">{activeRoute!.name}</span>
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
                              <linearGradient id="elevGradBS" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={routeColor} stopOpacity={0.3} />
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
                              fill="url(#elevGradBS)"
                              dot={false}
                              activeDot={{ r: 3, fill: routeColor }}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                  {!elevLoading && !elevError && profile.length === 0 && (
                    <p className="text-sm text-muted-foreground py-3 text-center">No elevation data available.</p>
                  )}
                </div>
              )}

              {/* Legend panel */}
              {activeTab === 'legend' && (
                <div className="px-4 py-3">
                  {/* Routes — on multi-route events, the entire row is a
                      tap target that toggles visibility. Single-route
                      events render as a plain row with no toggle. */}
                  {routes.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Routes</span>
                        {routes.length > 1 && (
                          <span className="text-[10px] text-muted-foreground">Tap to show/hide</span>
                        )}
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {routes.map((route) => {
                          const dist = totalDistanceMiles(route.routeCoords);
                          const hidden = hiddenRouteIds.has(route.id);
                          const multi = routes.length > 1;

                          const content = (
                            <>
                              <div
                                className="w-6 h-[3px] rounded-full shrink-0"
                                style={{ backgroundColor: route.color }}
                              />
                              <span className="text-xs text-foreground font-medium flex-1 truncate text-left">
                                {route.name}
                              </span>
                              {dist > 0 && (
                                <span className="text-xs text-muted-foreground">{dist.toFixed(1)} mi</span>
                              )}
                              {multi && (
                                hidden
                                  ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  : <Eye    className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              )}
                            </>
                          );

                          return multi ? (
                            <button
                              key={route.id}
                              onClick={() => onToggleRoute(route.id)}
                              aria-pressed={!hidden}
                              aria-label={hidden ? `Show ${route.name}` : `Hide ${route.name}`}
                              className={`w-full flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-md hover:bg-muted/50 active:scale-[0.99] transition-all ${hidden ? 'opacity-40' : ''}`}
                            >
                              {content}
                            </button>
                          ) : (
                            <div key={route.id} className="flex items-center gap-3 px-2 py-1.5 -mx-2">
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Start → Finish hero row — rendered only when both
                      markers exist. Promotes the two most important POIs
                      out of the category grid and puts them front-and-
                      center with the total visible route distance. */}
                  {hasStart && hasFinish && (
                    <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <span className="text-base leading-none">{poiTone('start').emoji}</span>
                        <span>Start</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className="text-base leading-none">{poiTone('finish').emoji}</span>
                        <span>Finish</span>
                      </div>
                      {heroDistance > 0 && (
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {heroDistance.toFixed(1)} mi
                        </span>
                      )}
                    </div>
                  )}

                  {/* Grouped POI categories — one labeled section per
                      category that actually has markers. Emoji match the
                      on-map markers so scanning the legend maps 1:1 with
                      what's visible. Tap a chip to filter. */}
                  {orderedLegendCategories.length > 0 && (
                    <div className="space-y-3">
                      {orderedLegendCategories.map(({ cat, types }) => (
                        <div key={cat}>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {POI_CATEGORIES[cat].label}
                          </span>
                          <div className="mt-1.5 grid grid-cols-2 md:grid-cols-3 gap-y-1.5 gap-x-2">
                            {types.map((type) => {
                              const tone = poiTone(type);
                              const count = grouped[type] || 0;
                              const isHighlighted = highlightedPoiType === type;
                              // On-course markers get a slightly muted
                              // treatment for spectators — they're still
                              // discoverable, just not the primary focus.
                              const deemphasize = viewMode === 'spectator' && cat === 'course';
                              return (
                                <button
                                  key={type}
                                  onClick={() => onHighlightPoiType(isHighlighted ? null : type)}
                                  className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors text-left ${
                                    isHighlighted
                                      ? 'bg-primary text-primary-foreground font-semibold'
                                      : deemphasize
                                        ? 'hover:bg-muted/50 text-muted-foreground'
                                        : 'hover:bg-muted/50 text-foreground'
                                  }`}
                                  aria-pressed={isHighlighted}
                                  title={`${tone.label}${count > 1 ? ` (${count})` : ''} — ${isHighlighted ? 'Clear filter' : 'Filter markers'}`}
                                >
                                  <span className="text-sm leading-none shrink-0">{tone.emoji}</span>
                                  <span className="truncate flex-1">{tone.label}</span>
                                  {count > 1 && (
                                    <span className={isHighlighted ? 'text-primary-foreground/80' : 'text-muted-foreground'}>
                                      ×{count}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Filter affordance — the POI chips are tappable
                      filters, but that's invisible without a hint. Shown
                      only when there's something to filter. */}
                  {orderedLegendCategories.length > 0 && (
                    <p className="mt-3 text-[10px] text-muted-foreground text-center">
                      {highlightedPoiType
                        ? 'Tap the highlighted type again to clear the filter'
                        : 'Tap any type to filter markers on the map'}
                    </p>
                  )}

                  {routes.length === 0 && orderedLegendCategories.length === 0 && !hasStart && !hasFinish && (
                    <p className="text-sm text-muted-foreground py-3 text-center">No routes or places to show.</p>
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
          </>
        )}

      </div>
    </div>
  );
};

export default PublicMapBottom;
