import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles } from '@/lib/geo';
import { poiTone } from '@/lib/pois';

interface PublicMapLegendProps {
  routes: EventRoute[];
  pois: RoutePoi[];
  hiddenRouteIds: Set<string>;
}

const PublicMapLegend = ({ routes, pois, hiddenRouteIds }: PublicMapLegendProps) => {
  const [collapsed, setCollapsed] = useState(false);

  const visibleRoutes = routes.filter((r) => r.visible && !hiddenRouteIds.has(r.id) && r.routeCoords.length > 1);

  // Group all pois by type (including auto start/finish)
  const grouped = pois.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {});

  // Order: start/finish first, then rest
  const poiTypes = Object.keys(grouped) as PoiType[];
  const orderedTypes = [
    ...poiTypes.filter((t) => t === 'start' || t === 'finish'),
    ...poiTypes.filter((t) => t !== 'start' && t !== 'finish'),
  ];

  // Nothing to show
  if (visibleRoutes.length === 0 && orderedTypes.length === 0) return null;

  return (
    <div className="absolute bottom-8 right-4 z-20 min-w-[160px] max-w-[200px]">
      <div className="bg-card/80 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/30 transition-colors"
        >
          <span className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase">Legend</span>
          {collapsed
            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
            : <ChevronUp className="h-3 w-3 text-muted-foreground" />
          }
        </button>

        {!collapsed && (
          <div className="pb-2">
            {/* Routes */}
            {visibleRoutes.length > 0 && (
              <div className="px-3 pb-1.5 space-y-1.5">
                {visibleRoutes.map((route) => {
                  const dist = totalDistanceMiles(route.routeCoords);
                  return (
                    <div key={route.id} className="flex items-center gap-2">
                      {/* Colored line swatch */}
                      <div className="flex items-center shrink-0 w-6">
                        <div className="w-full h-[3px] rounded-full" style={{ backgroundColor: route.color }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate leading-tight">{route.name}</p>
                        {dist > 0 && <p className="text-[10px] text-muted-foreground">{dist.toFixed(1)} mi</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Divider if both sections present */}
            {visibleRoutes.length > 0 && orderedTypes.length > 0 && (
              <div className="mx-3 my-1.5 border-t border-border/50" />
            )}

            {/* POI types */}
            {orderedTypes.length > 0 && (
              <div className="px-3 space-y-1">
                {orderedTypes.map((type) => {
                  const tone = poiTone(type);
                  const count = grouped[type];
                  return (
                    <div key={type} className="flex items-center gap-1.5">
                      <span className="text-sm leading-none shrink-0">{tone.emoji}</span>
                      <span className="text-xs text-foreground flex-1 truncate">{tone.label}</span>
                      {count > 1 && (
                        <span className="text-[10px] text-muted-foreground shrink-0">×{count}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicMapLegend;
